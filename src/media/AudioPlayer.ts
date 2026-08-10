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
    for (let c = 0; c < ch; c++) {
      const channel = buf.getChannelData(c);
      data.copyTo(channel, { planeIndex: c });
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