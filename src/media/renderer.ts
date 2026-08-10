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

export interface CodecAbilities {
  vp8: boolean;
  vp9: boolean;
  av1: boolean;
  h264: boolean;
  h265: boolean;
}

export async function detectCodecAbilities(): Promise<CodecAbilities> {
  if (typeof VideoDecoder === 'undefined') {
    return { vp8: false, vp9: false, av1: false, h264: false, h265: false };
  }
  const entries: [keyof CodecAbilities, string][] = [
    ['vp8', 'vp8'],
    ['vp9', 'vp09.00.10.08'],
    ['av1', 'av01.0.05M.08'],
    ['h264', 'avc1.42E01E'],
    ['h265', 'hev1.1.6.L93.B0'],
  ];
  const result = { vp8: false, vp9: false, av1: false, h264: false, h265: false };
  await Promise.all(
    entries.map(async ([key, codec]) => {
      try {
        const r = await VideoDecoder.isConfigSupported({ codec });
        result[key] = !!r.supported;
      } catch {
        result[key] = false;
      }
    }),
  );
  return result;
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

function extractH265Description(data: Uint8Array): Uint8Array | null {
  const nalUnits: { type: number; data: Uint8Array }[] = [];
  let i = 0;
  while (i < data.length - 4) {
    const is3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
    const is4 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1;
    if (is3 || is4) {
      const nalStart = i + (is4 ? 4 : 3);
      const nalType = (data[nalStart] >> 1) & 0x3f;
      let end = data.length;
      for (let j = nalStart; j < data.length - 3; j++) {
        if (data[j] === 0 && data[j + 1] === 0 && (data[j + 2] === 1 || (data[j + 2] === 0 && data[j + 3] === 1))) {
          end = j;
          break;
        }
      }
      if (nalType === 32 || nalType === 33 || nalType === 34) {
        nalUnits.push({ type: nalType, data: data.slice(nalStart, end) });
      }
      i = end;
    } else {
      i++;
    }
  }
  if (nalUnits.length === 0) return null;
  const vps = nalUnits.find((n) => n.type === 32);
  const sps = nalUnits.find((n) => n.type === 33);
  const pps = nalUnits.find((n) => n.type === 34);
  if (!vps || !sps || !pps) return null;

  const arrays = [vps, sps, pps];
  const numArrays = arrays.length;
  const totalNalBytes = arrays.reduce((sum, a) => sum + a.data.length, 0);
  const buf = new Uint8Array(22 + 6 * numArrays + totalNalBytes);
  const dv = new DataView(buf.buffer);

  dv.setUint8(0, 1);
  buf[1] = sps.data[1];
  buf[2] = sps.data[2];
  buf[3] = sps.data[3];
  buf[4] = sps.data[4];
  buf[5] = sps.data[5];
  dv.setUint8(6, 0);
  dv.setUint8(7, 0);
  dv.setUint8(8, 0);
  dv.setUint8(9, 0);
  dv.setUint8(10, 0);
  dv.setUint8(11, 0);
  dv.setUint16(12, 0, false);
  dv.setUint8(14, 0);
  dv.setUint8(15, 0);
  dv.setUint8(16, 0);
  dv.setUint8(17, 0);
  dv.setUint8(18, 0);
  dv.setUint8(19, 0);
  dv.setUint8(20, 0);
  dv.setUint8(21, numArrays);

  let offset = 22;
  for (const nal of arrays) {
    dv.setUint8(offset, 0);
    dv.setUint16(offset + 1, 1, false);
    dv.setUint16(offset + 3, nal.type, false);
    dv.setUint32(offset + 5, nal.data.length, false);
    buf.set(nal.data, offset + 9);
    offset += 9 + nal.data.length;
  }
  return buf;
}

export class VideoRenderer {
  private decoders: Map<string, VideoDecoder> = new Map();
  private seenKeyFrame: Set<string> = new Set();
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
      const isKey = !!f.key;
      if (!isKey && !this.seenKeyFrame.has(info.codec)) {
        continue;
      }
      if (isKey) {
        this.seenKeyFrame.add(info.codec);
      }
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
          type: isKey ? 'key' : 'delta',
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
    if (codec === 'h264' && firstFrameData) {
      const desc = extractH264Description(firstFrameData);
      if (desc) (config as VideoDecoderConfig).description = desc;
    } else if (codec === 'h265' && firstFrameData) {
      const desc = extractH265Description(firstFrameData);
      if (desc) (config as VideoDecoderConfig).description = desc;
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
