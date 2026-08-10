import type { KeyEventT } from '../protos';

export const ControlKey = {
  Unknown: 0,
  Alt: 1,
  Backspace: 2,
  CapsLock: 3,
  Control: 4,
  Delete: 5,
  DownArrow: 6,
  End: 7,
  Escape: 8,
  F1: 9,
  F10: 10,
  F11: 11,
  F12: 12,
  F2: 13,
  F3: 14,
  F4: 15,
  F5: 16,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  Home: 21,
  LeftArrow: 22,
  Meta: 23,
  PageDown: 25,
  PageUp: 26,
  Return: 27,
  RightArrow: 28,
  Shift: 29,
  Space: 30,
  Tab: 31,
  UpArrow: 32,
  Insert: 58,
  NumLock: 63,
} as const;

const KeyboardMode = { Legacy: 0, Map: 1, Translate: 2, Auto: 3 } as const;

const CODE_TO_CONTROL: Record<string, number> = {
  Backspace: ControlKey.Backspace,
  Tab: ControlKey.Tab,
  Enter: ControlKey.Return,
  ShiftLeft: ControlKey.Shift,
  ShiftRight: ControlKey.Shift,
  ControlLeft: ControlKey.Control,
  ControlRight: ControlKey.Control,
  AltLeft: ControlKey.Alt,
  AltRight: ControlKey.Alt,
  MetaLeft: ControlKey.Meta,
  MetaRight: ControlKey.Meta,
  CapsLock: ControlKey.CapsLock,
  Escape: ControlKey.Escape,
  Space: ControlKey.Space,
  PageUp: ControlKey.PageUp,
  PageDown: ControlKey.PageDown,
  End: ControlKey.End,
  Home: ControlKey.Home,
  ArrowLeft: ControlKey.LeftArrow,
  ArrowUp: ControlKey.UpArrow,
  ArrowRight: ControlKey.RightArrow,
  ArrowDown: ControlKey.DownArrow,
  Insert: ControlKey.Insert,
  Delete: ControlKey.Delete,
  NumLock: ControlKey.NumLock,
  F1: ControlKey.F1,
  F2: ControlKey.F2,
  F3: ControlKey.F3,
  F4: ControlKey.F4,
  F5: ControlKey.F5,
  F6: ControlKey.F6,
  F7: ControlKey.F7,
  F8: ControlKey.F8,
  F9: ControlKey.F9,
  F10: ControlKey.F10,
  F11: ControlKey.F11,
  F12: ControlKey.F12,
};

function modifiers(e: KeyboardEvent): number[] {
  const mods: number[] = [];
  if (e.ctrlKey) mods.push(ControlKey.Control);
  if (e.altKey) mods.push(ControlKey.Alt);
  if (e.shiftKey) mods.push(ControlKey.Shift);
  if (e.metaKey) mods.push(ControlKey.Meta);
  return mods;
}

export class KeyboardAdapter {
  constructor(private readonly send: (event: KeyEventT) => void) {}

  handle(e: KeyboardEvent): boolean {
    if (e.repeat) return false;
    const down = e.type === 'keydown';
    const mods = modifiers(e);
    const ck = CODE_TO_CONTROL[e.code];

    if (ck !== undefined) {
      this.send({ down, controlKey: ck, modifiers: mods, mode: KeyboardMode.Legacy });
      return true;
    }

    if (e.key.length === 1) {
      const code = e.key.charCodeAt(0);
      this.send({ down, chr: code, modifiers: mods, mode: KeyboardMode.Legacy });
      return true;
    }

    return false;
  }
}