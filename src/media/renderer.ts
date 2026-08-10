import type { VideoFrameT } from '../protos';

export interface CodecSupport {
  available: boolean;
  codecs: string[];
  missing: string[];
}

export function checkWebCodecsSupport(): CodecSupport {
  if (typeof VideoDecoder === 'undefined') {
    return { available: false, codecs: [], missing: ['vp9', 'h264', 'h265', 'vp8', 'av1'] };
  }
  const all = ['vp9', 'vp8', 'av1', 'h264', 'h265'];
  const supported: string[] = [];
  const missing: string[] = [];
  for (const c of all) {
    try {
      const dec = new VideoDecoder({ output: () => {}, error: () => {} });
      dec.configure(CODEC_CONFIG[c]);
      if (dec.state === 'configured') supported.push(c);
      else missing.push(c);
      dec.close();
    } catch {
      missing.push(c);
    }
  }
  return { available: supported.length > 0, codecs: supported, missing };
}

export interface RenderStats {
  fps: number;
  decodedFrames: number;
  droppedFrames: number;
  activeCodec: string | null;
  width: number;
  height: number;
}

type EncodedFrame = { data: Uint8Array; key?: boolean; pts?: number | { low: number; high: number } };

function ptsToNumber(pts: EncodedFrame['pts']): number {
  if (pts === undefined || pts === null) return 0;
  if (typeof pts === 'number') return pts;
  return pts.low + (pts.high >>> 0) * 0x100000000;
}

function framesOf(vf: VideoFrameT): { codec: string; frames: EncodedFrame[] } | null {
  if (vf.vp9s?.frames?.length) return { codec: 'vp9', frames: vf.vp9s.frames };
  if (vf.vp8s?.frames?.length) return { codec: 'vp8', frames: vf.vp8s.frames };
  if (vf.av1s?.frames?.length) return { codec: 'av1', frames: vf.av1s.frames };
  if (vf.h264s?.frames?.length) return { codec: 'h264', frames: vf.h264s.frames };
  if (vf.h265s?.frames?.length) return { codec: 'h265', frames: vf.h265s.frames };
  return null;
}

const CODEC_CONFIG: Record<string, VideoDecoderConfig> = {
  vp9: { codec: 'vp09.00.10.08' },
  vp8: { codec: 'vp8' },
  av1: { codec: 'av01.0.05M.08' },
  h264: { codec: 'avc1.42E01E' },
  h265: { codec: 'hev1.1.6.L93.B0' },
};

function annexBToAvcc(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    let start = -1;
    for (let j = i; j < data.length - 3; j++) {
      if (data[j] === 0 && data[j + 1] === 0 && data[j + 2] === 1) {
        start = j + 3;
        break;
      }
      if (data[j] === 0 && data[j + 1] === 0 && data[j + 2] === 0 && data[j + 3] === 1) {
        start = j + 4;
        break;
      }
    }
    if (start === -1) break;
    let end = data.length;
    for (let j = start; j < data.length - 3; j++) {
      if (data[j] === 0 && data[j + 1] === 0 && (data[j + 2] === 1 || (data[j + 2] === 0 && data[j + 3] === 1))) {
        end = j;
        break;
      }
    }
    const len = end - start;
    out.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
    for (let k = start; k < end; k++) out.push(data[k]);
    i = end;
  }
  return new Uint8Array(out);
}

function extractH264Description(data: Uint8Array): Uint8Array | null {
  let i = 0;
  while (i < data.length - 4) {
    const is3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
    const is4 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1;
    if (is3 || is4) {
      const nalStart = i + (is4 ? 4 : 3);
      const nalType = data[nalStart] & 0x1f;
      if (nalType === 7) {
        let end = data.length;
        for (let j = nalStart; j < data.length - 3; j++) {
          if (data[j] === 0 && data[j + 1] === 0 && (data[j + 2] === 1 || (data[j + 2] === 0 && data[j + 3] === 1))) {
            end = j;
            break;
          }
        }
        return data.slice(i, end);
      }
    }
    i++;
  }
  return null;
}

function findNalUnits(data: Uint8Array): { type: number; start: number; end: number }[] {
  const nals: { type: number; start: number; end: number }[] = [];
  let i = 0;
  while (i < data.length - 4) {
    const is3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
    const is4 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1;
    if (is3 || is4) {
      const nalStart = i + (is4 ? 4 : 3);
      let end = data.length;
      for (let j = nalStart; j < data.length - 3; j++) {
        if (data[j] === 0 && data[j + 1] === 0 && (data[j + 2] === 1 || (data[j + 2] === 0 && data[j + 3] === 1))) {
          end = j;
          break;
        }
      }
      nals.push({ start: nalStart, end, type: -1 });
      i = end;
    } else {
      i++;
    }
  }
  return nals;
}

function extractH265Description(data: Uint8Array): Uint8Array | null {
  const nals = findNalUnits(data);
  const vps: Uint8Array[] = [];
  const sps: Uint8Array[] = [];
  const pps: Uint8Array[] = [];
  for (const nal of nals) {
    if (nal.start >= data.length) continue;
    const nalType = (data[nal.start] >> 1) & 0x3f;
    const raw = data.slice(nal.start, nal.end);
    if (nalType === 32) vps.push(raw);
    else if (nalType === 33) sps.push(raw);
    else if (nalType === 34) pps.push(raw);
  }
  if (sps.length === 0) return null;

  let profileSpace = 0, tierFlag = 0, profileIdc = 1, levelIdc = 93;
  const constraintFlags = new Uint8Array(6);
  if (sps[0].length >= 13) {
    const spsData = sps[0];
    profileSpace = (spsData[2] >> 6) & 0x03;
    tierFlag = (spsData[2] >> 5) & 0x01;
    profileIdc = spsData[2] & 0x1f;
    constraintFlags.set(spsData.subarray(3, 9));
    levelIdc = spsData[9];
  }

  const arrays: { nalType: number; units: Uint8Array[] }[] = [];
  if (vps.length) arrays.push({ nalType: 32, units: vps });
  if (sps.length) arrays.push({ nalType: 33, units: sps });
  if (pps.length) arrays.push({ nalType: 34, units: pps });

  let totalSize = 23 + arrays.length * 3;
  for (const a of arrays) {
    for (const u of a.units) totalSize += 2 + u.length;
  }
  const out = new Uint8Array(totalSize);
  let p = 0;
  out[p++] = 1;
  out[p++] = (profileSpace << 6) | (tierFlag << 5) | profileIdc;
  out.set(constraintFlags, p); p += 6;
  out[p++] = levelIdc;
  out[p++] = 0xf0; out[p++] = 0x00;
  out[p++] = 0xfc;
  out[p++] = 0xfc;
  out[p++] = 0xf8;
  out[p++] = 0xf8;
  out[p++] = 0x00; out[p++] = 0x00;
  out[p++] = 0x00 | (0 << 2) | (1 << 1) | 3;
  out[p++] = arrays.length;
  for (const a of arrays) {
    out[p++] = 0x80 | a.nalType;
    out[p++] = 0x00; out[p++] = a.units.length;
    for (const u of a.units) {
      out[p++] = (u.length >> 8) & 0xff; out[p++] = u.length & 0xff;
      out.set(u, p); p += u.length;
    }
  }
  return out;
}

export class VideoRenderer {
  private decoders: Map<string, VideoDecoder> = new Map();
  private ctx: CanvasRenderingContext2D | null = null;
  private displayWidth = 0;
  private displayHeight = 0;
  private pendingFrames = 0;
  private activeCodec: string | null = null;
  private decodedCount = 0;
  private droppedCount = 0;
  private fpsFrames = 0;
  private fpsLastTs = Date.now();
  private fps = 0;
  private onStats?: (stats: RenderStats) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onError?: (error: Error) => void,
    onStats?: (stats: RenderStats) => void,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.onStats = onStats;
    if (onStats) {
      setInterval(() => this.reportStats(), 500);
    }
  }

  setDisplaySize(width: number, height: number): void {
    if (width === this.displayWidth && height === this.displayHeight) return;
    this.displayWidth = width;
    this.displayHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  handleFrame(vf: VideoFrameT): void {
    if (vf.rgb || vf.yuv) {
      return;
    }
    const info = framesOf(vf);
    if (!info) return;
    this.activeCodec = info.codec;
    const decoder = this.getDecoder(info.codec, info.frames[0]?.data);
    if (!decoder) return;

    for (const f of info.frames) {
      if (decoder.decodeQueueSize > 30) {
        this.droppedCount++;
        continue;
      }
      let data = f.data;
      if (info.codec === 'h264' || info.codec === 'h265') {
        data = annexBToAvcc(f.data);
      }
      try {
        const chunk = new EncodedVideoChunk({
          type: f.key ? 'key' : 'delta',
          timestamp: ptsToNumber(f.pts),
          data,
        });
        decoder.decode(chunk);
        this.pendingFrames++;
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private getDecoder(codec: string, firstFrameData?: Uint8Array): VideoDecoder | null {
    let decoder = this.decoders.get(codec);
    if (decoder) return decoder;
    if (typeof VideoDecoder === 'undefined') {
      this.onError?.(new Error('WebCodecs VideoDecoder not available in this browser'));
      return null;
    }
    const config = { ...CODEC_CONFIG[codec] };
    if (firstFrameData) {
      if (codec === 'h264') {
        const desc = extractH264Description(firstFrameData);
        if (desc) (config as VideoDecoderConfig).description = desc;
      } else if (codec === 'h265') {
        const desc = extractH265Description(firstFrameData);
        if (desc) (config as VideoDecoderConfig).description = desc;
      }
    }
    decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        this.drawFrame(frame);
        frame.close();
        this.pendingFrames = Math.max(0, this.pendingFrames - 1);
      },
      error: (e: DOMException) => this.onError?.(new Error(`decoder(${codec}): ${e.message}`)),
    });
    try {
      decoder.configure(config);
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
      return null;
    }
    this.decoders.set(codec, decoder);
    return decoder;
  }

  private drawFrame(frame: VideoFrame): void {
    if (!this.ctx) return;
    if (frame.displayWidth !== this.displayWidth || frame.displayHeight !== this.displayHeight) {
      this.setDisplaySize(frame.displayWidth, frame.displayHeight);
    }
    this.ctx.drawImage(frame, 0, 0, this.displayWidth, this.displayHeight);
    this.fpsFrames++;
    this.decodedCount++;
  }

  private reportStats(): void {
    const now = Date.now();
    const elapsed = (now - this.fpsLastTs) / 1000;
    this.fps = elapsed > 0 ? Math.round(this.fpsFrames / elapsed) : 0;
    this.fpsFrames = 0;
    this.fpsLastTs = now;
    this.onStats?.({
      fps: this.fps,
      decodedFrames: this.decodedCount,
      droppedFrames: this.droppedCount,
      activeCodec: this.activeCodec,
      width: this.displayWidth,
      height: this.displayHeight,
    });
  }

  getStats(): RenderStats {
    return {
      fps: this.fps,
      decodedFrames: this.decodedCount,
      droppedFrames: this.droppedCount,
      activeCodec: this.activeCodec,
      width: this.displayWidth,
      height: this.displayHeight,
    };
  }

  flush(): void {
    for (const d of this.decoders.values()) {
      try {
        d.flush();
      } catch {
        /* ignore */
      }
    }
  }

  destroy(): void {
    for (const d of this.decoders.values()) {
      try {
        d.close();
      } catch {
        /* ignore */
      }
    }
    this.decoders.clear();
    this.ctx = null;
  }
}
