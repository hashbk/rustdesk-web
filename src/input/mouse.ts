import type { MouseEventT } from '../protos';

const MOUSE_TYPE_DOWN = 1;
const MOUSE_TYPE_UP = 2;
const MOUSE_TYPE_WHEEL = 3;

const BTN_LEFT = 0x01;
const BTN_RIGHT = 0x02;
const BTN_WHEEL = 0x04;
const BTN_BACK = 0x08;
const BTN_FORWARD = 0x10;

function mask(typeBits: number, buttons: number): number {
  return typeBits | (buttons << 3);
}

export interface MouseAdapterOptions {
  displayWidth: number;
  displayHeight: number;
  send: (event: MouseEventT) => void;
}

export class MouseAdapter {
  private pressed = 0;

  constructor(private opts: MouseAdapterOptions) {}

  setDisplaySize(width: number, height: number): void {
    this.opts.displayWidth = width;
    this.opts.displayHeight = height;
  }

  private toRemote(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    const x = Math.round(((clientX - rect.left) / rect.width) * this.opts.displayWidth);
    const y = Math.round(((clientY - rect.top) / rect.height) * this.opts.displayHeight);
    return { x, y };
  }

  private buttonBit(button: number): number {
    switch (button) {
      case 0:
        return BTN_LEFT;
      case 1:
        return BTN_RIGHT;
      case 2:
        return BTN_WHEEL;
      case 3:
        return BTN_BACK;
      case 4:
        return BTN_FORWARD;
      default:
        return 0;
    }
  }

  onMove(e: MouseEvent, rect: DOMRect): void {
    const { x, y } = this.toRemote(e.clientX, e.clientY, rect);
    this.opts.send({ mask: mask(0, this.pressed), x, y });
  }

  onDown(e: MouseEvent, rect: DOMRect): void {
    const bit = this.buttonBit(e.button);
    this.pressed |= bit;
    const { x, y } = this.toRemote(e.clientX, e.clientY, rect);
    this.opts.send({ mask: mask(MOUSE_TYPE_DOWN, bit), x, y });
  }

  onUp(e: MouseEvent, rect: DOMRect): void {
    const bit = this.buttonBit(e.button);
    this.pressed &= ~bit;
    const { x, y } = this.toRemote(e.clientX, e.clientY, rect);
    this.opts.send({ mask: mask(MOUSE_TYPE_UP, bit), x, y });
  }

  onWheel(e: WheelEvent, rect: DOMRect): void {
    const { x } = this.toRemote(e.clientX, e.clientY, rect);
    const step = 40;
    const ticksX = Math.round(e.deltaX / step);
    const ticksY = Math.round(e.deltaY / step);
    for (let i = 0; i < Math.abs(ticksY); i++) {
      const dir = ticksY > 0 ? 1 : -1;
      this.opts.send({ mask: mask(MOUSE_TYPE_WHEEL, BTN_WHEEL), x, y: dir });
    }
    for (let i = 0; i < Math.abs(ticksX); i++) {
      const dir = ticksX > 0 ? 1 : -1;
      this.opts.send({ mask: mask(MOUSE_TYPE_WHEEL, BTN_WHEEL), x: dir, y: 0 });
    }
  }

  releaseAll(): void {
    if (this.pressed === 0) return;
    this.opts.send({ mask: mask(MOUSE_TYPE_UP, this.pressed), x: 0, y: 0 });
    this.pressed = 0;
  }
}