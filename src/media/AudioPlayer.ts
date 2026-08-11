export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private decoder: AudioDecoder | null = null;
  private gainNode: GainNode | null = null;

  private muted = false;
  private nextTime = 0;
  private onError?: (error: Error) => void;

  constructor(onError?: (error: Error) => void) {
    this.onError = onError;
  }

  async configure(sampleRate: number, channels: number): Promise<boolean> {

    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate });
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.ctx.destination);
      this.gainNode.gain.value = this.muted ? 0 : 1;
    }

    if (typeof AudioDecoder === 'undefined') {
      this.onError?.(new Error('WebCodecs AudioDecoder not available'));
      return false;
    }

    try {
      const supported = await AudioDecoder.isConfigSupported({
        codec: 'opus',
        sampleRate,
        numberOfChannels: channels,
      });
      if (!supported.supported) {
        this.onError?.(new Error('Opus codec not supported by AudioDecoder'));
        return false;
      }
    } catch {
      this.onError?.(new Error('Failed to check Opus codec support'));
      return false;
    }

    this.decoder?.close();
    this.decoder = new AudioDecoder({
      output: (data) => this.play(data),
      error: (e) => this.onError?.(new Error(`audio decoder: ${e.message}`)),
    });
    this.decoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels: channels,
    });
    this.nextTime = this.ctx.currentTime;
    return true;
  }

  private play(data: AudioData): void {
    if (!this.ctx || !this.gainNode) return;
    const frames = data.numberOfFrames;
    const ch = data.numberOfChannels;
    const buf = this.ctx.createBuffer(ch, frames, data.sampleRate);
    const format = data.format ?? undefined;
    const isPlanar = format ? format.includes('planar') : true;

    if (isPlanar) {
      for (let c = 0; c < ch; c++) {
        const channel = buf.getChannelData(c);
        const size = data.allocationSize({ planeIndex: c });
        if (size === channel.byteLength) {
          data.copyTo(channel, { planeIndex: c });
        } else {
          const temp = new ArrayBuffer(size);
          data.copyTo(new DataView(temp), { planeIndex: c });
          this.copyToChannel(channel, temp, format, frames);
        }
      }
    } else {
      const size = data.allocationSize({ planeIndex: 0 });
      const temp = new ArrayBuffer(size);
      data.copyTo(new DataView(temp), { planeIndex: 0 });
      for (let c = 0; c < ch; c++) {
        const channel = buf.getChannelData(c);
        this.deinterleaveToChannel(channel, temp, format, frames, ch, c);
      }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gainNode);
    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now;
    src.start(this.nextTime);
    this.nextTime += frames / data.sampleRate;
    data.close();
  }

  private copyToChannel(channel: Float32Array, raw: ArrayBuffer, format: string | undefined, frames: number): void {
    if (format === 's16-planar') {
      const view = new Int16Array(raw);
      for (let i = 0; i < frames; i++) channel[i] = view[i] / 32768;
    } else if (format === 's32-planar') {
      const view = new Int32Array(raw);
      for (let i = 0; i < frames; i++) channel[i] = view[i] / 2147483648;
    } else {
      const view = new Float32Array(raw);
      channel.set(view.subarray(0, frames));
    }
  }

  private deinterleaveToChannel(channel: Float32Array, raw: ArrayBuffer, format: string | undefined, frames: number, ch: number, c: number): void {
    if (format === 's16') {
      const view = new Int16Array(raw);
      for (let i = 0; i < frames; i++) channel[i] = view[i * ch + c] / 32768;
    } else if (format === 's32') {
      const view = new Int32Array(raw);
      for (let i = 0; i < frames; i++) channel[i] = view[i * ch + c] / 2147483648;
    } else {
      const view = new Float32Array(raw);
      for (let i = 0; i < frames; i++) channel[i] = view[i * ch + c];
    }
  }

  handleFrame(data: Uint8Array): void {
    if (!this.decoder || this.decoder.state !== 'configured') return;
    try {
      this.decoder.decode(new EncodedAudioChunk({ type: 'key', data, timestamp: 0 }));
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(muted ? 0 : 1, this.ctx.currentTime);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  destroy(): void {
    this.decoder?.close();
    this.decoder = null;
    this.ctx?.close();
    this.ctx = null;
    this.gainNode = null;
  }
}