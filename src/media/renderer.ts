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

type RgbFrame = { compress?: boolean; data?: Uint8Array; w?: number; h?: number };
type YuvFrame = { compress?: boolean; stride?: number; data?: Uint8Array; w?: number; h?: number };

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
  const nalUnits: { type: number; data: Uint8Array }[] = [];
  let i = 0;
  while (i < data.length - 4) {
    const is3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
    const is4 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1;
    if (is3 || is4) {
      const nalStart = i + (is4 ? 4 : 3);
      const nalType = data[nalStart] & 0x1f;
      let end = data.length;
      for (let j = nalStart; j < data.length - 3; j++) {
        if (data[j] === 0 && data[j + 1] === 0 && (data[j + 2] === 1 || (data[j + 2] === 0 && data[j + 3] === 1))) {
          end = j;
          break;
        }
      }
      if (nalType === 7 || nalType === 8) {
        nalUnits.push({ type: nalType, data: data.slice(nalStart, end) });
      }
      i = end;
    } else {
      i++;
    }
  }
  const sps = nalUnits.find((n) => n.type === 7);
  const pps = nalUnits.find((n) => n.type === 8);
  if (!sps || !pps) return null;

  const buf = new Uint8Array(11 + sps.data.length + pps.data.length);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 1);
  buf[1] = sps.data[1];
  buf[2] = sps.data[2];
  buf[3] = sps.data[3];
  dv.setUint8(4, 0xff);
  dv.setUint8(5, 0xe1);
  dv.setUint16(6, sps.data.length, false);
  buf.set(sps.data, 8);
  dv.setUint8(8 + sps.data.length, 1);
  dv.setUint16(9 + sps.data.length, pps.data.length, false);
  buf.set(pps.data, 11 + sps.data.length);
  return buf;
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
  const vps = nalUnits.find((n) => n.type === 32);
  const sps = nalUnits.find((n) => n.type === 33);
  const pps = nalUnits.find((n) => n.type === 34);
  if (!vps || !sps || !pps) return null;

  const arrays = [vps, sps, pps];
  const numArrays = arrays.length;
  const totalNalBytes = arrays.reduce((sum, a) => sum + a.data.length, 0);
  const headerSize = 23;
  const buf = new Uint8Array(headerSize + 5 * numArrays + totalNalBytes);
  const dv = new DataView(buf.buffer);

  dv.setUint8(0, 1);
  if (sps.data.length > 14) {
    buf[1] = sps.data[3];
    buf[2] = sps.data[4]; buf[3] = sps.data[5]; buf[4] = sps.data[6]; buf[5] = sps.data[7];
    buf[6] = sps.data[8]; buf[7] = sps.data[9]; buf[8] = sps.data[10]; buf[9] = sps.data[11]; buf[10] = sps.data[12]; buf[11] = sps.data[13];
    buf[12] = sps.data[14];
  }
  dv.setUint16(13, 0xf000, false);
  dv.setUint8(15, 0xfc);
  dv.setUint8(16, 0xfc);
  dv.setUint8(17, 0xf8);
  dv.setUint8(18, 0xf8);
  dv.setUint16(19, 0, false);
  dv.setUint8(21, 0x03);
  dv.setUint8(22, numArrays);

  let offset = headerSize;
  for (const nal of arrays) {
    dv.setUint8(offset, nal.type & 0x3f);
    dv.setUint16(offset + 1, 1, false);
    dv.setUint16(offset + 3, nal.data.length, false);
    buf.set(nal.data, offset + 5);
    offset += 5 + nal.data.length;
  }
  return buf;
}

export class VideoRenderer {
  private decoders: Map<string, VideoDecoder> = new Map();
  private seenKeyFrame: Set<string> = new Set();
  private configuredCodecs: Set<string> = new Set();
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
  private statsIntervalId: ReturnType<typeof setInterval> | null = null;
  /** Display index this renderer is responsible for (passed to onDecodedFrame). */
  private displayIndex = 0;
  /**
   * Optional zero-readback callback.  When set, decoded VideoFrames are
   * forwarded here instead of being drawn to the canvas.  This enables the
   * `window.onVideoFrame` GPU-to-GPU path (see web_model.dart
   * `setVideoFrameCallback`).
   */
  onDecodedFrame?: (display: number, frame: VideoFrame) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onError?: (error: Error) => void,
    onStats?: (stats: RenderStats) => void,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.onStats = onStats;
    if (onStats) {
      this.statsIntervalId = setInterval(() => this.reportStats(), 500);
    }
  }

  /** Set the display index (passed to onDecodedFrame). */
  setDisplayIndex(display: number): void {
    this.displayIndex = display;
  }

  setDisplaySize(width: number, height: number): void {
    if (width === this.displayWidth && height === this.displayHeight) return;
    this.displayWidth = width;
    this.displayHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  handleFrame(vf: VideoFrameT): void {
    if (vf.rgb) {
      this.drawRgb(vf.rgb as RgbFrame);
      return;
    }
    if (vf.yuv) {
      this.drawYuv(vf.yuv as YuvFrame);
      return;
    }
    const info = framesOf(vf);
    if (!info) return;
    this.activeCodec = info.codec;
    const keyFrame = info.frames.find((f) => f.key);
    const decoder = this.getDecoder(info.codec, keyFrame?.data);
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

  private getDecoder(codec: string, keyFrameData?: Uint8Array): VideoDecoder | null {
    let decoder = this.decoders.get(codec);
    if (decoder && decoder.state === 'configured') {
      if ((codec === 'h264' || codec === 'h265') && !this.configuredCodecs.has(codec) && keyFrameData) {
        const desc = codec === 'h264'
          ? extractH264Description(keyFrameData)
          : extractH265Description(keyFrameData);
        if (desc) {
          try {
            decoder.configure({ ...CODEC_CONFIG[codec], description: desc });
            this.configuredCodecs.add(codec);
          } catch (err) {
            this.onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }
      return decoder;
    }
    if (typeof VideoDecoder === 'undefined') {
      this.onError?.(new Error('WebCodecs VideoDecoder not available in this browser'));
      return null;
    }
    const config = { ...CODEC_CONFIG[codec] };
    if (codec === 'h264' && keyFrameData) {
      const desc = extractH264Description(keyFrameData);
      if (desc) {
        (config as VideoDecoderConfig).description = desc;
        this.configuredCodecs.add(codec);
      }
    } else if (codec === 'h265' && keyFrameData) {
      const desc = extractH265Description(keyFrameData);
      if (desc) {
        (config as VideoDecoderConfig).description = desc;
        this.configuredCodecs.add(codec);
      }
    }
    decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        if (this.onDecodedFrame) {
          // Zero-readback path: forward the decoded VideoFrame to the
          // registered callback (window.onVideoFrame).  The callback is
          // responsible for closing the frame.
          try {
            this.onDecodedFrame(this.displayIndex, frame);
          } catch (err) {
            this.onError?.(err instanceof Error ? err : new Error(String(err)));
            try { frame.close(); } catch { /* ignore */ }
          }
        } else {
          this.drawFrame(frame);
          frame.close();
        }
        this.pendingFrames = Math.max(0, this.pendingFrames - 1);
      },
      error: (e: DOMException) => {
        this.onError?.(new Error(`decoder(${codec}): ${e.message}`));
        this.decoders.delete(codec);
        this.seenKeyFrame.delete(codec);
        this.configuredCodecs.delete(codec);
      },
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

  private drawRgb(rgb: RgbFrame): void {
    if (!rgb.data || !rgb.w || !rgb.h) return;
    const w = rgb.w;
    const h = rgb.h;
    if (w !== this.displayWidth || h !== this.displayHeight) {
      this.setDisplaySize(w, h);
    }
    if (this.onDecodedFrame) {
      const frame = new VideoFrame(rgb.data, {
        format: 'RGBA',
        codedWidth: w,
        codedHeight: h,
        timestamp: 0,
      });
      try {
        this.onDecodedFrame(this.displayIndex, frame);
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
        try { frame.close(); } catch { /* ignore */ }
      }
    } else if (this.ctx) {
      const imgData = new ImageData(new Uint8ClampedArray(rgb.data), w, h);
      this.ctx.putImageData(imgData, 0, 0);
    }
    this.fpsFrames++;
    this.decodedCount++;
  }

  private drawYuv(yuv: YuvFrame): void {
    if (!yuv.data || !yuv.w || !yuv.h) return;
    const w = yuv.w;
    const h = yuv.h;
    const yStride = yuv.stride || w;
    const uvStride = yStride >> 1;
    const ySize = yStride * h;
    const uvSize = uvStride * (h >> 1);
    if (yuv.data.length < ySize + 2 * uvSize) return;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const yPlane = yuv.data;
    const uPlane = yuv.data.subarray(ySize);
    const vPlane = yuv.data.subarray(ySize + uvSize);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const y = yPlane[j * yStride + i];
        const u = uPlane[(j >> 1) * uvStride + (i >> 1)] - 128;
        const v = vPlane[(j >> 1) * uvStride + (i >> 1)] - 128;
        const r = y + 1.402 * v;
        const g = y - 0.344 * u - 0.714 * v;
        const b = y + 1.772 * u;
        const idx = (j * w + i) * 4;
        rgba[idx] = r < 0 ? 0 : r > 255 ? 255 : r;
        rgba[idx + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        rgba[idx + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        rgba[idx + 3] = 255;
      }
    }
    if (w !== this.displayWidth || h !== this.displayHeight) {
      this.setDisplaySize(w, h);
    }
    if (this.onDecodedFrame) {
      const frame = new VideoFrame(rgba, {
        format: 'RGBA',
        codedWidth: w,
        codedHeight: h,
        timestamp: 0,
      });
      try {
        this.onDecodedFrame(this.displayIndex, frame);
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
        try { frame.close(); } catch { /* ignore */ }
      }
    } else if (this.ctx) {
      const imgData = new ImageData(rgba, w, h);
      this.ctx.putImageData(imgData, 0, 0);
    }
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
    if (this.statsIntervalId !== null) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
    for (const d of this.decoders.values()) {
      try {
        d.close();
      } catch {
        /* ignore */
      }
    }
    this.decoders.clear();
    this.seenKeyFrame.clear();
    this.configuredCodecs.clear();
    this.ctx = null;
  }
}
