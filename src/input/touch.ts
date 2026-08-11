import type { MouseEventT } from '../protos';

const MOUSE_TYPE_DOWN = 1;
const MOUSE_TYPE_UP = 2;
const MOUSE_TYPE_WHEEL = 3;
const BTN_LEFT = 0x01;
const BTN_RIGHT = 0x02;

function mask(typeBits: number, buttons: number): number {
  return typeBits | (buttons << 3);
}

export interface TouchAdapterOptions {
  displayWidth: number;
  displayHeight: number;
  send: (event: MouseEventT) => void;
}

export class TouchAdapter {
  private active = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private twoFinger = false;

  private longPressTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private opts: TouchAdapterOptions) {}

  setDisplaySize(width: number, height: number): void {
    this.opts.displayWidth = width;
    this.opts.displayHeight = height;
  }

  private toRemote(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    const x = Math.round(((clientX - rect.left) / rect.width) * this.opts.displayWidth);
    const y = Math.round(((clientY - rect.top) / rect.height) * this.opts.displayHeight);
    return { x, y };
  }

  onTouchStart(e: TouchEvent, rect: DOMRect): void {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const { x, y } = this.toRemote(t.clientX, t.clientY, rect);
      this.active = true;
      this.twoFinger = false;
      this.startX = x;
      this.startY = y;
      this.lastX = x;
      this.lastY = y;
      this.opts.send({ mask: mask(0, 0), x, y });
      this.longPressTimer = setTimeout(() => {
        if (this.active && !this.twoFinger) {
          this.opts.send({ mask: mask(MOUSE_TYPE_DOWN, BTN_RIGHT), x, y });
          this.opts.send({ mask: mask(MOUSE_TYPE_UP, BTN_RIGHT), x, y });
          this.active = false;
        }
      }, 500);
    } else if (e.touches.length === 2) {
      this.twoFinger = true;
      if (this.longPressTimer) clearTimeout(this.longPressTimer);
      if (this.active) {
        this.opts.send({ mask: mask(MOUSE_TYPE_UP, BTN_LEFT), x: this.lastX, y: this.lastY });
        this.active = false;
      }
    }
  }

  onTouchMove(e: TouchEvent, rect: DOMRect): void {
    if (e.touches.length === 1 && this.active && !this.twoFinger) {
      const t = e.touches[0];
      const { x, y } = this.toRemote(t.clientX, t.clientY, rect);
      const dx = x - this.startX;
      const dy = y - this.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        if (this.longPressTimer) clearTimeout(this.longPressTimer);
        this.opts.send({ mask: mask(MOUSE_TYPE_DOWN, BTN_LEFT), x, y });
        this.active = false;
        this.dragging = true;
      }
      this.lastX = x;
      this.lastY = y;
      this.opts.send({ mask: mask(0, BTN_LEFT), x, y });
    } else if (e.touches.length === 2 && this.twoFinger) {
      const t = e.touches[0];
      const { x, y } = this.toRemote(t.clientX, t.clientY, rect);
      const dy = y - this.lastY;
      if (dy !== 0) {
        this.opts.send({ mask: MOUSE_TYPE_WHEEL, x: 0, y: dy > 0 ? -1 : 1 });
      }
      this.lastX = x;
      this.lastY = y;
    }
  }

  private dragging = false;

  onTouchEnd(e: TouchEvent, rect: DOMRect): void {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    if (e.touches.length === 0) {
      if (this.twoFinger) {
        this.twoFinger = false;
      } else if (this.active) {
        const { x, y } = this.toRemote(this.lastX, this.lastY, rect);
        this.opts.send({ mask: mask(MOUSE_TYPE_DOWN, BTN_LEFT), x, y });
        this.opts.send({ mask: mask(MOUSE_TYPE_UP, BTN_LEFT), x, y });
        this.active = false;
      } else if (this.dragging) {
        this.opts.send({ mask: mask(MOUSE_TYPE_UP, BTN_LEFT), x: this.lastX, y: this.lastY });
        this.dragging = false;
      }
    }
  }
}