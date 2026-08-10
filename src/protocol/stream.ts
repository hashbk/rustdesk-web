import { StreamCipher } from './crypto';

export type StreamState = 'connecting' | 'open' | 'closing' | 'closed';

export interface StreamCallbacks {
  onOpen?: () => void;
  onMessage?: (data: Uint8Array) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (error: Error) => void;
}

export class WsStream {
  private ws: WebSocket | null = null;
  private cipher: StreamCipher | null = null;
  state: StreamState = 'closed';

  constructor(
    private readonly url: string,
    private readonly callbacks: StreamCallbacks,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.state = 'connecting';
      const ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        this.state = 'open';
        this.callbacks.onOpen?.();
        resolve();
      };
      ws.onmessage = (ev) => {
        const buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(ev.data);
        let plain = buf;
        if (this.cipher) {
          const dec = this.cipher.decrypt(buf);
          if (dec === null) {
            this.callbacks.onError?.(new Error('decryption failed'));
            return;
          }
          plain = dec;
        }
        this.callbacks.onMessage?.(plain);
      };
      ws.onerror = () => {
        const err = new Error(`WebSocket error: ${this.url}`);
        if (this.state === 'connecting') {
          this.state = 'closed';
          reject(err);
        } else {
          this.callbacks.onError?.(err);
        }
      };
      ws.onclose = (ev) => {
        this.state = 'closed';
        this.callbacks.onClose?.(ev.code, ev.reason);
      };
    });
  }

  setKey(key: Uint8Array): void {
    this.cipher = new StreamCipher(key);
  }

  isSecured(): boolean {
    return this.cipher !== null;
  }

  send(data: Uint8Array): void {
    if (!this.ws || this.state !== 'open') throw new Error('stream not open');
    const payload = this.cipher ? this.cipher.encrypt(data) : data;
    this.ws.send(payload);
  }

  close(): void {
    if (this.ws && this.state === 'open') {
      this.state = 'closing';
      this.ws.close();
    }
  }
}