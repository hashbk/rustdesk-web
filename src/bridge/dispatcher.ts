/**
 * setByName / getByName dispatcher.
 *
 * Routes each of the 64 unique bridge keys (extracted from RustDesk
 * `flutter/lib/web/bridge.dart`) to the appropriate protocol-stack function.
 *
 * Design:
 *  - `createDispatcher(ctx)` builds two registries (SetRegistry / GetRegistry)
 *    bound to the given BridgeContext.  This makes handlers trivially testable.
 *  - `setByName(name, value)` / `getByName(name, arg)` look up the handler and
 *    invoke it.  Unknown keys produce a console warning (no throw), matching
 *    the "stub unimplemented keys" requirement.
 *  - Handlers that cannot yet be fully implemented (e.g. address-book sync,
 *    account auth) are stubbed with `stub()` which logs a warning and no-ops.
 */

import { BoolOption, boolToOption, type SessionOptionMessage } from '../protocol/session';
import { ConnType, CodecPreference, ImageQuality, type SessionConfig, rendezvousWsUrl } from '../protocol/config';
import type { MessageT, RendezvousMessageT } from '../protos';
import { encodeRendezvous, decodeRendezvous } from '../protos';
import { WsStream } from '../protocol/stream';
import { BridgeContext } from './context';
import { getCachedCodecAbilities } from './init';
import { emitGlobalEvent } from './events';
import { setTransferReadPath, clearTransferReadPath } from './callbacks';

import { translate as translateText, langs as availableLangs } from './translations';
import type {
  SetRegistry,
  GetRegistry,
  SessionAddSyncPayload,
  InputKeyPayload,

  ReadRemoteDirPayload,
  SendFilesPayload,
  SendLocalFilesPayload,
  ElevateWithLogonPayload,
  OptionPayload,
  EnvVarPayload,
  AlternativeCodecs,
  FlutterKeyEventPayload,
  FileActionPayload,
  ChangeResolutionPayload,
  ToggleVirtualDisplayPayload,
  PeerOptionGetPayload,
  PeerOptionSetPayload,
  AccountAuthPayload,
  TerminalOpenPayload,
  TerminalInputPayload,
  TerminalResizePayload,
  TerminalClosePayload,
} from './types';

/** Map a control-key name (from input_key JSON) to the ControlKey enum value.
 *  Includes both bare names (Alt, Control, ...) and VK_ prefixed names
 *  (VK_MENU, VK_CONTROL, ...) used by Flutter's logicalKeyMap/physicalKeyMap. */
const NAME_TO_CONTROL_KEY: Record<string, number> = {
  Alt: 1, VK_MENU: 1, VK_ALT: 1,
  Backspace: 2, VK_BACK: 2,
  CapsLock: 3, VK_CAPITAL: 3,
  Control: 4, VK_CONTROL: 4,
  Delete: 5, VK_DELETE: 5,
  DownArrow: 6, VK_DOWN: 6,
  End: 7, VK_END: 7,
  Escape: 8, VK_ESCAPE: 8,
  F1: 9, F2: 13, F3: 14, F4: 15, F5: 16, F6: 17, F7: 18, F8: 19, F9: 20, F10: 10, F11: 11, F12: 12,
  VK_F1: 9, VK_F2: 13, VK_F3: 14, VK_F4: 15, VK_F5: 16, VK_F6: 17, VK_F7: 18, VK_F8: 19, VK_F9: 20, VK_F10: 10, VK_F11: 11, VK_F12: 12,
  Home: 21, VK_HOME: 21,
  LeftArrow: 22, VK_LEFT: 22,
  Meta: 23, VK_LWIN: 23, VK_RWIN: 23,
  PageDown: 25, VK_NEXT: 25,
  PageUp: 26, VK_PRIOR: 26,
  Return: 27, VK_RETURN: 27, VK_ENTER: 27,
  RightArrow: 28, VK_RIGHT: 28,
  Shift: 29, VK_SHIFT: 29,
  Space: 30, VK_SPACE: 30,
  Tab: 31, VK_TAB: 31,
  UpArrow: 32, VK_UP: 32,
  Insert: 58, VK_INSERT: 58,
  NumLock: 63, VK_NUMLOCK: 63,
  Scroll: 62, VK_SCROLL: 62,
  Pause: 46, VK_PAUSE: 46,
  Snapshot: 47, VK_SNAPSHOT: 47,
  Select: 48, VK_SELECT: 48,
  Print: 49, VK_PRINT: 49,
  Execute: 50, VK_EXECUTE: 50,
  Help: 51, VK_HELP: 51,
  Sleep: 52, VK_SLEEP: 52,
  Cancel: 14, VK_CANCEL: 14,
  Clear: 15, VK_CLEAR: 15,
  Divide: 70, VK_DIVIDE: 70,
  Multiply: 66, VK_MULTIPLY: 66,
  Subtract: 68, VK_SUBTRACT: 68,
  Add: 67, VK_ADD: 67,
  Decimal: 69, VK_DECIMAL: 69,
  Numpad0: 33, Numpad1: 34, Numpad2: 35, Numpad3: 36, Numpad4: 37,
  Numpad5: 38, Numpad6: 39, Numpad7: 40, Numpad8: 41, Numpad9: 42,
  VK_NUMPAD0: 33, VK_NUMPAD1: 34, VK_NUMPAD2: 35, VK_NUMPAD3: 36, VK_NUMPAD4: 37,
  VK_NUMPAD5: 38, VK_NUMPAD6: 39, VK_NUMPAD7: 40, VK_NUMPAD8: 41, VK_NUMPAD9: 42,
  Apps: 64,
  RAlt: 65, RControl: 67, RShift: 68, RWin: 69,
  CtrlAltDel: 71, LOCK_SCREEN: 72,
};

/** Map VK_ character key names to their character code. */
const VK_NAME_TO_CHAR: Record<string, number> = {
  VK_A: 97, VK_B: 98, VK_C: 99, VK_D: 100, VK_E: 101, VK_F: 102, VK_G: 103,
  VK_H: 104, VK_I: 105, VK_J: 106, VK_K: 107, VK_L: 108, VK_M: 109, VK_N: 110,
  VK_O: 111, VK_P: 112, VK_Q: 113, VK_R: 114, VK_S: 115, VK_T: 116, VK_U: 117,
  VK_V: 118, VK_W: 119, VK_X: 120, VK_Y: 121, VK_Z: 122,
  VK_0: 48, VK_1: 49, VK_2: 50, VK_3: 51, VK_4: 52, VK_5: 53, VK_6: 54, VK_7: 55, VK_8: 56, VK_9: 57,
  VK_COMMA: 44, VK_SLASH: 47, VK_SEMICOLON: 59, VK_QUOTE: 39,
  VK_LBRACKET: 91, VK_RBRACKET: 93, VK_BACKSLASH: 92,
  VK_MINUS: 45, VK_PLUS: 61,
};

/**
 * Map USB HID usage codes (page 0x07) to ControlKey enum values.
 * Used by `flutter_key_event` to translate Flutter key events.
 * Only non-character keys are listed here; character keys (a-z, 0-9)
 * are handled via the `character` field.
 */
const USB_HID_TO_CONTROL_KEY: Record<number, number> = {
  0x28: 27,  // Enter → Return
  0x29: 8,   // Escape
  0x2A: 2,   // Backspace
  0x2B: 31,  // Tab
  0x2C: 30,  // Space
  0x39: 3,   // CapsLock
  0x3A: 9,   // F1
  0x3B: 13,  // F2
  0x3C: 14,  // F3
  0x3D: 15,  // F4
  0x3E: 16,  // F5
  0x3F: 17,  // F6
  0x40: 18,  // F7
  0x41: 19,  // F8
  0x42: 20,  // F9
  0x43: 10,  // F10
  0x44: 11,  // F11
  0x45: 12,  // F12
  0x46: 62,  // Scroll Lock → Scroll
  0x47: 46,  // Pause
  0x48: 58,  // Insert
  0x49: 21,  // Home
  0x4A: 26,  // Page Up
  0x4B: 5,   // Delete
  0x4C: 7,   // End
  0x4D: 25,  // Page Down
  0x4E: 28,  // Right Arrow
  0x4F: 22,  // Left Arrow
  0x50: 6,   // Down Arrow
  0x51: 32,  // Up Arrow
  0x53: 63,  // NumLock
  0x54: 70,  // Numpad / → Divide
  0x55: 66,  // Numpad * → Multiply
  0x56: 68,  // Numpad - → Subtract
  0x57: 67,  // Numpad + → Add
  0x58: 72,  // Numpad Enter → NumpadEnter
  0x59: 34,  // Numpad 1
  0x5A: 35,  // Numpad 2
  0x5B: 36,  // Numpad 3
  0x5C: 37,  // Numpad 4
  0x5D: 38,  // Numpad 5
  0x5E: 39,  // Numpad 6
  0x5F: 40,  // Numpad 7
  0x60: 41,  // Numpad 8
  0x61: 42,  // Numpad 9
  0x62: 33,  // Numpad 0
  0x63: 69,  // Numpad . → Decimal
  0xE0: 4,   // Left Control
  0xE1: 29,  // Left Shift
  0xE2: 1,   // Left Alt
  0xE3: 23,  // Left Meta
  0xE4: 74,  // Right Control → RControl
  0xE5: 73,  // Right Shift → RShift
  0xE6: 75,  // Right Alt → RAlt
  0xE7: 64,  // Right Meta → RWin
  // Media keys (Consumer Page, used when character == "flutter_key")
  0x7F: 76,  // VolumeMute
  0x80: 77,  // VolumeUp
  0x81: 78,  // VolumeDown
  0x66: 79,  // Power
};

/** Tracks active modifier keys for flutter_key_event (Bug 8). */
const modifierState = { ctrl: false, alt: false, shift: false, meta: false };

/** Selected local files from the file picker, keyed by a handle index. */
const selectedFileHandles = new Map<number, File[]>();

/** USB HID ranges for conditional lock_modes (Bug 13). */
const LETTER_HID_MIN = 0x04; // a
const LETTER_HID_MAX = 0x1D; // z
const NUMPAD_HIDS = new Set([0x54, 0x55, 0x56, 0x57, 0x59, 0x5A, 0x5B, 0x5C, 0x5D, 0x5E, 0x5F, 0x60, 0x61, 0x62, 0x63]);

/** Update modifier tracking state from a flutter_key_event. */
function updateModifierState(usbHid: number, down: boolean): void {
  switch (usbHid) {
    case 0xE0: case 0xE4: modifierState.ctrl = down; break;
    case 0xE1: case 0xE5: modifierState.shift = down; break;
    case 0xE2: case 0xE6: modifierState.alt = down; break;
    case 0xE3: case 0xE7: modifierState.meta = down; break;
  }
}

function parseJson<T>(value: string): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function truthy(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}

/** Log a stub warning for not-yet-implemented keys (no throw). */
function stub(kind: 'set' | 'get', name: string, extra?: string): void {
  console.warn(`[bridge] ${kind}ByName("${name}") is not yet implemented${extra ? ': ' + extra : ''}`);
}

/** Convert a codec-preference string to the enum. */
function parseCodecPreference(value: string): CodecPreference {
  const v = value.trim().toLowerCase();
  switch (v) {
    case 'vp9': return CodecPreference.VP9;
    case 'h264': return CodecPreference.H264;
    case 'h265': return CodecPreference.H265;
    case 'vp8': return CodecPreference.VP8;
    case 'av1': return CodecPreference.AV1;
    case 'auto':
    default:
      return CodecPreference.Auto;
  }
}

/** Convert an image-quality string to the enum. */
function parseImageQuality(value: string): ImageQuality {
  const v = value.trim().toLowerCase();
  switch (v) {
    case 'low': return ImageQuality.Low;
    case 'best': return ImageQuality.Best;
    case 'balanced':
    default:
      return ImageQuality.Balanced;
  }
}

/** Shared handler for session_add_sync / session_add (alias). */
function handleSessionAddSync(ctx: BridgeContext, value: string): void {
  const payload = parseJson<SessionAddSyncPayload>(value);
  if (!payload || !payload.id) {
    console.warn('[bridge] session_add_sync: missing peer id');
    return;
  }
  const config = buildSessionConfig(ctx, payload);
  const session = ctx.createSession(config);
  session.setInitialOptions(ctx.getSessionOptionMessage());
  void session.connect();
}

/** Build a SessionConfig from a session_add_sync payload + context. */
function buildSessionConfig(ctx: BridgeContext, payload: SessionAddSyncPayload): SessionConfig {
  let connType = ConnType.DEFAULT_CONN;
  if (payload.isFileTransfer) connType = ConnType.FILE_TRANSFER;
  else if (payload.isViewCamera) connType = ConnType.VIEW_CAMERA;
  else if (payload.isPortForward) connType = ConnType.PORT_FORWARD;
  else if (payload.isRdp) connType = ConnType.RDP;
  else if (payload.isTerminal) connType = ConnType.TERMINAL;

  const server = ctx.getServer();
  return {
    peerId: payload.id,
    password: payload.password,
    accessToken: payload.connToken,
    connType,
    myId: ctx.getMyId(),
    myName: ctx.getMyName(),
    server: {
      rendezvousHost: server.rendezvousHost,
      relayHost: server.relayHost,
      key: server.key,
      useWss: server.useWss,
    },
    forceRelay: payload.forceRelay,  // preserve undefined so session.ts ?? true applies (web always relays)
    switchUuid: payload.switchUuid,
    isSharedPassword: payload.is_shared_password,
    remoteDir: payload.remoteDir,
    showHidden: payload.showHidden,
    portForwardHost: payload.portForwardHost,
    portForwardPort: payload.portForwardPort,
    terminalServiceId: payload.terminalServiceId,
  };
}

/** Option keys that map to ServerConfig fields. */
const SERVER_OPTION_KEYS = new Set([
  'custom-rendezvous-server',
  'relay-server',
  'api-server',
  'key',
]);

/**
 * When a server-related option changes, sync it into `ctx.server` so that
 * `api_server`, `is_using_public_server`, and `buildSessionConfig` reflect
 * the new value immediately (mirrors RustDesk native behaviour where the
 * in-memory ServerConfig is derived from options on every access).
 */
function syncServerOption(ctx: BridgeContext, key: string, value: string): void {
  if (!SERVER_OPTION_KEYS.has(key)) return;
  const server = { ...ctx.getServer() };
  switch (key) {
    case 'custom-rendezvous-server':
      server.rendezvousHost = value || server.rendezvousHost;
      break;
    case 'relay-server':
      server.relayHost = value;
      break;
    case 'api-server':
      server.apiHost = value;
      if (value.startsWith('https://')) server.useWss = true;
      else if (value.startsWith('http://')) server.useWss = false;
      break;
    case 'key':
      server.key = value || server.key;
      break;
  }
  ctx.setServer(server);
}

/**
 * Build the setByName handler registry for the given context.
 */
export function createSetRegistry(ctx: BridgeContext): SetRegistry {
  return {
    // ---- session lifecycle ----
    session_add_sync: (value: string) => {
      handleSessionAddSync(ctx, value);
    },


    session_start: (value: string) => {
      // Flutter sends session_start after session_add_sync with the peer id.
      // The TS session is already connecting; log the id for debugging.  If
      // no session exists yet (session_add_sync not called), this is a no-op.
      const payload = parseJson<{ id?: string }>(value);
      if (payload?.id) {
        console.debug('[bridge] session_start for peer', payload.id);
      }
      const session = ctx.getSession();
      if (session && session.state === 'connected') {
        ctx.setConnStatus('connected');
      }
    },

    session_close: () => {
      ctx.closeSession();
    },

    refresh: () => {
      ctx.getSession()?.sendRefresh();
    },

    reconnect: () => {
      const session = ctx.reconnect();
      if (session) {
        session.setInitialOptions(ctx.getSessionOptionMessage());
        void session.connect();
      }
    },

    // ---- input ----
    input_key: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<InputKeyPayload>(value);
      if (!payload || !payload.name) return;
      const ck = NAME_TO_CONTROL_KEY[payload.name];
      const mods: number[] = [];
      if (truthy(payload.alt)) mods.push(1);
      if (truthy(payload.ctrl)) mods.push(4);
      if (truthy(payload.shift)) mods.push(29);
      if (truthy(payload.command)) mods.push(23);
      if (ck !== undefined) {
        session.sendKey({ down: truthy(payload.down), press: truthy(payload.press), controlKey: ck, modifiers: mods });
      } else {
        const charCode = VK_NAME_TO_CHAR[payload.name] ?? (payload.name.length === 1 ? payload.name.charCodeAt(0) : undefined);
        if (charCode !== undefined) {
          session.sendKey({ down: truthy(payload.down), press: truthy(payload.press), chr: charCode, modifiers: mods });
        }
      }
    },

    send_mouse: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<Record<string, unknown>>(value);
      if (!payload) return;
      let mask = 0;
      const t = String(payload.type ?? '');
      if (t === 'down') mask = 1;
      else if (t === 'up') mask = 2;
      else if (t === 'wheel') mask = 3;
      else if (t === 'trackpad') mask = 4;
      else if (t === 'move_relative') mask = 5;
      const btn = String(payload.buttons ?? '');
      if (btn === 'left') mask |= 1 << 3;
      else if (btn === 'right') mask |= 2 << 3;
      else if (btn === 'wheel') mask |= 4 << 3;
      else if (btn === 'back') mask |= 8 << 3;
      else if (btn === 'forward') mask |= 16 << 3;
      const modifiers: number[] = [];
      if (payload.alt) modifiers.push(1);
      if (payload.ctrl) modifiers.push(4);
      if (payload.shift) modifiers.push(29);
      if (payload.command) modifiers.push(23);
      const event: NonNullable<MessageT['mouseEvent']> = {
        mask,
        x: parseInt(String(payload.x ?? '0'), 10) || 0,
        y: parseInt(String(payload.y ?? '0'), 10) || 0,
        modifiers,
      };
      session.sendMouse(event);
    },

    input_string: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      session.sendKey({ press: true, seq: value, modifiers: [] });
    },

    send_chat: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      session.sendMisc({ misc: { chatMessage: { text: value } } });
    },

    input_os_password: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      session.sendKey({ press: true, seq: value, modifiers: [] });
    },

    enter_or_leave: (value: string) => {
      // Flutter sends enter=true when the session area gains focus and
      // enter=false when it loses focus.  Dart's dart:js passes bool as a
      // JS boolean (true/false), not a string, so we must accept both.
      // On leave, release any pressed modifier keys so they don't stay
      // stuck on the peer.
      const v = String(value);
      const enter = v === 'true' || v === '1';
      if (!enter) {
        const session = ctx.getSession();
        if (!session) return;
        if (modifierState.ctrl) {
          session.sendKey({ down: false, controlKey: NAME_TO_CONTROL_KEY.Control, modifiers: [] });
        }
        if (modifierState.alt) {
          session.sendKey({ down: false, controlKey: NAME_TO_CONTROL_KEY.Alt, modifiers: [] });
        }
        if (modifierState.shift) {
          session.sendKey({ down: false, controlKey: NAME_TO_CONTROL_KEY.Shift, modifiers: [] });
        }
        if (modifierState.meta) {
          session.sendKey({ down: false, controlKey: NAME_TO_CONTROL_KEY.Meta, modifiers: [] });
        }
        modifierState.ctrl = false;
        modifierState.alt = false;
        modifierState.shift = false;
        modifierState.meta = false;
      }
    },

    flutter_key_event: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<FlutterKeyEventPayload>(value);
      if (!payload) return;
      const down = truthy(payload.down);
      updateModifierState(payload.usb_hid, down);
      const modifiers: number[] = [];
      if (modifierState.alt) modifiers.push(1);
      if (modifierState.ctrl) modifiers.push(4);
      if (modifierState.shift) modifiers.push(29);
      if (modifierState.meta) modifiers.push(23);
      const isLetter = payload.usb_hid >= LETTER_HID_MIN && payload.usb_hid <= LETTER_HID_MAX;
      const isNumpad = NUMPAD_HIDS.has(payload.usb_hid);
      if (isLetter && (payload.lock_modes & (1 << 1))) modifiers.push(3);  // CapsLock
      if (isNumpad && (payload.lock_modes & (1 << 2))) modifiers.push(63); // NumLock
      const mode = 1; // KeyboardMode.Translate
      const ck = USB_HID_TO_CONTROL_KEY[payload.usb_hid];
      if (ck !== undefined) {
        session.sendKey({ down, controlKey: ck, modifiers, mode });
      } else if (payload.name && payload.name.length === 1) {
        session.sendKey({ down, chr: payload.name.charCodeAt(0), modifiers, mode });
      } else if (payload.name && payload.name.length > 1) {
        const code = payload.name.codePointAt(0);
        if (code !== undefined) {
          session.sendKey({ down, unicode: code, modifiers, mode });
        }
      }
    },

    // ---- quality / codec / fps ----
    image_quality: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      ctx.setSessionOption('image_quality', value);
      if (/^\d+$/.test(value.trim())) {
        session.sendCustomImageQuality(parseInt(value, 10));
      } else {
        session.sendImageQuality(parseImageQuality(value));
      }
    },

    'custom-fps': (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const fps = parseInt(value, 10);
      if (Number.isFinite(fps)) {
        session.sendOption({ customFps: Math.max(0, fps) });
      }
    },

    custom_image_quality: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const q = parseInt(value, 10);
      if (Number.isFinite(q)) session.sendCustomImageQuality(q);
    },

    change_prefer_codec: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      // Dart does not pass the codec value; read the stored session option
      // (set by the codec selection UI via option:session).
      const stored = ctx.getSessionOption('codec-preference') || value;
      session.sendCodecPreference(parseCodecPreference(stored));
    },

    // ---- special keys ----
    lock_screen: () => {
      const session = ctx.getSession();
      if (!session) return;
      // Send the dedicated LOCK_SCREEN control key (enum 72) as a single
      // key event, matching the native RustDesk client behaviour.
      session.sendKey({ press: true, controlKey: NAME_TO_CONTROL_KEY.LOCK_SCREEN, modifiers: [] });
    },

    ctrl_alt_del: () => {
      const session = ctx.getSession();
      if (!session) return;
      // Send the dedicated CtrlAltDel control key (enum 71) as a single
      // key event (SAS / Secure Attention Sequence on Windows peers).
      session.sendKey({ press: true, controlKey: NAME_TO_CONTROL_KEY.CtrlAltDel, modifiers: [] });
    },

    // ---- elevation ----
    elevate_direct: () => {
      ctx.getSession()?.sendElevationRequest(true);
    },

    elevate_with_logon: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<ElevateWithLogonPayload>(value);
      if (!payload) return;
      session.sendElevationWithLogon(payload.username, payload.password);
    },

    // ---- display selection ----
    selected_sid: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const display = parseInt(value, 10);
      if (Number.isFinite(display)) session.sendSwitchDisplay(display);
    },

    switch_display: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<{ value?: number[]; display?: number }>(value);
      const display = payload?.value?.[0] ?? payload?.display ?? parseInt(value, 10);
      if (Number.isFinite(display)) session.sendSwitchDisplay(display);
    },

    change_resolution: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<ChangeResolutionPayload>(value);
      if (!payload) return;
      // Use change_display_resolution (misc field 36) for peers >= 1.2.4,
      // falling back to change_resolution (misc field 24) for older peers.
      const msg: MessageT = {
        misc: {
          change_display_resolution: {
            display: payload.display,
            resolution: { width: payload.width, height: payload.height },
          },
        },
      };
      session.sendMisc(msg);
    },

    toggle_virtual_display: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<ToggleVirtualDisplayPayload>(value);
      if (!payload) return;
      const msg: MessageT = {
        misc: {
          toggle_virtual_display: { display: payload.index, on: payload.on },
        },
      };
      session.sendMisc(msg);
    },

    // ---- options ----
    'option:toggle': (value: string) => {
      const session = ctx.getSession();
      // privacy-mode and block-input/unblock-input: don't update local state
      // immediately; wait for peer confirmation (matches native client.rs).
      const skipLocalUpdate = value === 'privacy-mode' || value.includes('block-input');
      if (!skipLocalUpdate) {
        ctx.setToggleOption(value, !ctx.getToggleOption(value));
      }
      // Mirror the toggle into the session option message so the peer is notified.
      if (session) {
        const toggled = skipLocalUpdate ? !ctx.getToggleOption(value) : ctx.getToggleOption(value);
        const opt = toggleToOptionMessage(value, toggled);
        if (opt) session.sendOption(opt);
      }
    },

    options: (value: string) => {
      const opts = parseJson<Record<string, string>>(value);
      if (opts && typeof opts === 'object') {
        ctx.setOptions(opts);
        for (const [k, v] of Object.entries(opts)) syncServerOption(ctx, k, v);
      }
    },

    option: (value: string) => {
      const payload = parseJson<OptionPayload>(value);
      if (payload && payload.name) {
        ctx.setOption(payload.name, payload.value);
        syncServerOption(ctx, payload.name, payload.value);
      }
    },

    'option:local': (value: string) => {
      const payload = parseJson<OptionPayload>(value);
      if (payload && payload.name) ctx.setLocalOption(payload.name, payload.value);
    },

    'option:session': (value: string) => {
      const payload = parseJson<OptionPayload>(value);
      if (payload && payload.name) {
        ctx.setSessionOption(payload.name, payload.value);
        const opt = sessionOptionToMessage(payload.name, payload.value);
        if (opt) ctx.getSession()?.sendOption(opt);
      }
    },

    'option:flutter:local': (value: string) => {
      const payload = parseJson<OptionPayload>(value);
      if (payload && payload.name) ctx.setFlutterLocalOption(payload.name, payload.value);
    },

    'option:flutter:peer': (value: string) => {
      const payload = parseJson<OptionPayload>(value);
      if (payload && payload.name) ctx.setFlutterPeerOption(payload.name, payload.value);
    },

    'option:peer': (value: string) => {
      const payload = parseJson<PeerOptionSetPayload>(value);
      if (payload && payload.id && payload.name) {
        ctx.setPeerOption(payload.id, payload.name, payload.value);
      }
    },

    'option:user:default': (value: string) => {
      const payload = parseJson<OptionPayload>(value);
      if (payload && payload.name) ctx.setUserDefaultOption(payload.name, payload.value);
    },

    common: (value: string) => {
      const payload = parseJson<OptionPayload>(value);
      if (payload && payload.name) ctx.setCommon(payload.name, payload.value);
    },

    // ---- favorites ----
    fav: (value: string) => {
      const favs = parseJson<string[]>(value);
      if (Array.isArray(favs)) ctx.setFav(favs.map(String));
    },

    // ---- file transfer ----
    cancel_job: (value: string) => {
      const id = parseInt(value, 10);
      if (Number.isFinite(id)) {
        clearTransferReadPath(id);
        ctx.cancelTransfer(id);
      }
    },

    select_files: (value: string) => {
      // Open a file/folder picker.  value is the is_folder flag from
      // web_unique.dart:7 — Dart passes a JS boolean (true/false), not a
      // string.  After selection, emit one 'selected_files' event per file
      // so Flutter's fileModel.onSelectedFiles (file_model.dart:283-310)
      // can decode each Entry and call webSendLocalFiles.
      const v = String(value);
      const isFolder = v === 'true' || v === '1';
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      if (isFolder) {
        input.webkitdirectory = true;
      }
      input.onchange = () => {
        const files = Array.from(input.files ?? []);
        if (files.length === 0) return;
        const handleIndex = Date.now() & 0xffff;
        selectedFileHandles.set(handleIndex, files);
        // Emit one event per file with the vendor-expected format:
        //   handleIndex (camelCase), file (single Entry JSON string)
        // Entry.fromJson (file_model.dart:1580-1585) expects:
        //   entry_type (int), modified_time (int, seconds), name, size
        for (const f of files) {
          emitGlobalEvent({
            name: 'selected_files',
            handleIndex: String(handleIndex),
            file: JSON.stringify({
              name: f.name,
              size: f.size,
              modified_time: Math.floor(f.lastModified / 1000),
              entry_type: 4, // file
            }),
          });
        }
      };
      input.click();
    },

    send_local_files: (value: string) => {
      // Upload local files to the peer.  Reads files from the picker handle
      // and streams them via FileTransferManager.uploadFile.
      const session = ctx.getSession();
      const ftm = ctx.getFileTransferManager();
      if (!session || !ftm) return;
      const payload = parseJson<SendLocalFilesPayload>(value);
      if (!payload) return;
      const files = selectedFileHandles.get(payload.handle_index);
      if (!files || files.length === 0) return;
      // Upload each selected file to the remote destination path.
      const remoteBase = payload.to || '';
      for (const file of files) {
        const remotePath = remoteBase.endsWith('/') ? remoteBase + file.name : remoteBase;
        // Track the read_path for override_file_confirm events.
        setTransferReadPath(payload.id, remotePath);
        void ftm.uploadFile(file, remotePath);
      }
      // Clean up the handle after dispatching.
      selectedFileHandles.delete(payload.handle_index);
    },

    read_remote_dir: (value: string) => {
      const payload = parseJson<ReadRemoteDirPayload>(value);
      if (payload && payload.path) {
        ctx.readRemoteDir(payload.path, !!payload.include_hidden);
      }
    },

    send_files: (value: string) => {
      const session = ctx.getSession();
      const ftm = ctx.getFileTransferManager();
      if (!session || !ftm) return;
      const payload = parseJson<SendFilesPayload>(value);
      if (!payload) return;
      if (payload.is_remote) {
        // Download: ask the peer to send files from the remote path.
        // Track the read_path for override_file_confirm events.
        setTransferReadPath(payload.id, payload.path);
        session.sendFileAction({
          send: { id: payload.id, path: payload.path, includeHidden: !!payload.include_hidden, fileNum: payload.file_num },
        });
      } else {
        // Upload: tell the peer to receive files at the remote destination.
        // Track the read_path for override_file_confirm events.
        setTransferReadPath(payload.id, payload.to);
        session.sendFileAction({
          receive: { id: payload.id, path: payload.to, fileNum: payload.file_num },
        });
      }
    },

    confirm_override_file: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<{ id: number; file_num: number; need_override: boolean; remember: boolean; is_upload: boolean }>(value);
      if (!payload) return;
      // For download (is_upload=false), send the confirm to the peer.
      // For upload (is_upload=true), the confirm is handled locally by FTM.
      if (!payload.is_upload) {
        session.sendFileAction({
          sendConfirm: {
            id: payload.id,
            fileNum: payload.file_num,
            ...(payload.need_override ? { offsetBlk: 0 } : { skip: true }),
          },
        });
      }
    },

    remove_file: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<FileActionPayload>(value);
      if (!payload) return;
      session.sendFileAction({
        removeFile: { id: payload.id, path: payload.path, fileNum: payload.file_num ?? 0 },
      });
    },

    read_dir_to_remove_recursive: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<FileActionPayload>(value);
      if (!payload) return;
      session.sendFileAction({
        readDir: { id: payload.id, path: payload.path, includeHidden: !!payload.show_hidden },
      });
    },

    remove_all_empty_dirs: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<FileActionPayload>(value);
      if (!payload) return;
      session.sendFileAction({
        removeDir: { id: payload.id, path: payload.path, recursive: true },
      });
    },

    create_dir: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<FileActionPayload>(value);
      if (!payload) return;
      session.sendFileAction({
        create: { id: payload.id, path: payload.path },
      });
    },

    rename_file: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<FileActionPayload>(value);
      if (!payload || !payload.new_name) return;
      session.sendFileAction({
        rename: { id: payload.id, path: payload.path, newName: payload.new_name },
      });
    },

    // ---- peers / address book ----
    remove_peer: (value: string) => {
      // Remove from local recent-peers cache only.  Address-book peer
      // deletion is handled by the Dart side (AbModel.deletePeers) which
      // calls the HBBS API directly via the http package.
      ctx.removePeer(value);
    },

    query_onlines: (value: string) => {
      try {
        const ids = JSON.parse(value) as string[];
        if (!Array.isArray(ids) || ids.length === 0) return;
        const server = ctx.getServer();
        const myId = ctx.getMyId();
        const url = rendezvousWsUrl(server);
        const cb = (window as unknown as { onGlobalEvent?: (name: string, data: unknown) => void }).onGlobalEvent;
        const allOffline = () => cb?.('callback_query_onlines', { onlines: '', offlines: ids.join(',') });

        let timer: ReturnType<typeof setTimeout> | undefined;
        const ws = new WsStream(url, {
          onMessage: (data: Uint8Array) => {
            clearTimeout(timer);
            try {
              const resp = decodeRendezvous(data);
              if (resp.onlineResponse && resp.onlineResponse.states.length > 0) {
                const states = resp.onlineResponse.states;
                const onlines: string[] = [];
                const offlines: string[] = [];
                for (let i = 0; i < ids.length; i++) {
                  const bit = 0x01 << (7 - (i % 8));
                  if ((states[Math.floor(i / 8)] & bit) === bit) {
                    onlines.push(ids[i]);
                  } else {
                    offlines.push(ids[i]);
                  }
                }
                cb?.('callback_query_onlines', { onlines: onlines.join(','), offlines: offlines.join(',') });
              } else {
                allOffline();
              }
            } catch {
              allOffline();
            }
            ws.close();
          },
          onError: () => { clearTimeout(timer); allOffline(); },
          onClose: () => {},
        });
        ws.connect().then(() => {
          const req: RendezvousMessageT = {
            onlineRequest: { id: myId, peers: ids },
          };
          ws.send(encodeRendezvous(req));
          timer = setTimeout(() => { ws.close(); allOffline(); }, 3000);
        }).catch(() => allOffline());
      } catch {
        // ignore parse errors
      }
    },

    load_ab: () => {
      // Return cached address book from localStorage.  The Dart side
      // (AbModel.loadCache) calls this on startup and expects the cache
      // JSON via onLoadAbFinished.  Server sync is handled by the Dart
      // side directly via the http package (AbModel.pullAb).
      const cached = ctx.getAddressBook();
      const cb = (window as unknown as { onLoadAbFinished?: (s: string) => void }).onLoadAbFinished;
      const cachedStr = typeof cached === 'string' ? cached : JSON.stringify(cached);
      cb?.(cachedStr);
    },

    save_ab: (value: string) => {
      // Save address book cache to localStorage.  The Dart side
      // (AbModel._saveCache) calls this with a JSON blob containing
      // {access_token, ab_entries}.  Server writes are handled by the
      // Dart side directly via the http package.
      const data = parseJson(value);
      ctx.setAddressBook(data ?? value);
    },

    clear_ab: () => {
      ctx.clearAddressBook();
    },

    load_group: () => {
      // Return cached group data from localStorage.  The Dart side
      // (GroupModel.loadCache) calls this on startup and expects the
      // cache JSON via onLoadGroupFinished.  Server sync is handled by
      // the Dart side directly via the http package.
      const cached = ctx.getGroup();
      const cb = (window as unknown as { onLoadGroupFinished?: (s: string) => void }).onLoadGroupFinished;
      const cachedStr = typeof cached === 'string' ? cached : JSON.stringify(cached);
      cb?.(cachedStr);
    },

    save_group: (value: string) => {
      const data = parseJson(value);
      ctx.setGroup(data ?? value);
    },

    clear_group: () => {
      ctx.clearGroup();
    },

    send_note: (value: string) => {
      // Store the note locally for audit purposes.  The actual HTTP POST
      // to the audit server is handled by the Dart side directly.
      ctx.setLastAuditNote(value);
    },

    // ---- remote control ----
    cursor: (value: string) => {
      // Set a custom cursor from a data URL with hotspot, or 'auto' to reset.
      // Applied via the CSS cursor property on the document body.
      if (value === 'auto') {
        document.body.style.cursor = '';
        return;
      }
      const payload = parseJson<{ url?: string; hotx?: number; hoty?: number }>(value);
      if (payload?.url) {
        const hotx = payload.hotx ?? 0;
        const hoty = payload.hoty ?? 0;
        document.body.style.cursor = `url("${payload.url}") ${hotx} ${hoty}, auto`;
      }
    },

    fullscreen: (value: string) => {
      // Enter fullscreen when value === 'Y', exit when 'N'.
      if (value === 'Y') {
        const el = document.documentElement;
        const req = el.requestFullscreen?.() ?? (el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen?.();
        if (req && typeof (req as { catch?: () => void }).catch === 'function') {
          (req as Promise<void>).catch(() => { /* ignore fullscreen errors */ });
        }
      } else if (value === 'N') {
        const exit = document.exitFullscreen?.() ?? (document as unknown as { webkitExitFullscreen?: () => void }).webkitExitFullscreen?.();
        if (exit && typeof (exit as { catch?: () => void }).catch === 'function') {
          (exit as Promise<void>).catch(() => { /* ignore fullscreen errors */ });
        }
      }
    },

    restart: () => {
      ctx.getSession()?.sendRestartRemoteDevice();
    },

    // ---- account auth ----
    account_auth: (value: string) => {
      // Account auth uses OIDC redirect flow.  On web, the Dart side
      // handles the HTTP calls directly; the bridge stores the remember
      // flag and triggers the auth via a global callback.
      const payload = parseJson<AccountAuthPayload>(value);
      if (payload?.remember != null) ctx.setRemember(payload.remember);
      const cb = (window as unknown as { onAccountAuth?: (op: string, remember: boolean) => void }).onAccountAuth;
      if (cb && payload) {
        cb(payload.op, payload.remember);
      } else {
        stub('set', 'account_auth', 'no onAccountAuth callback registered');
      }
    },

    account_auth_cancel: () => {
      const cb = (window as unknown as { onAccountAuthCancel?: () => void }).onAccountAuthCancel;
      cb?.();
    },

    // ---- audit ----
    audit_guid: (value: string) => {
      ctx.setAuditGuid(value);
    },

    // ---- login / 2fa (Flutter sends these too) ----
    login: (value: string) => {
      const payload = parseJson<{ os_username?: string; os_password?: string; password?: string; remember?: boolean }>(value);
      if (payload?.password) {
        const session = ctx.getSession();
        if (session) {
          void session.sendLoginWithPassword(payload.password, payload.os_username, payload.os_password);
        }
      }
      if (payload?.remember != null) ctx.setRemember(payload.remember);
    },

    send_2fa: (value: string) => {
      const payload = parseJson<{ code?: string }>(value);
      if (payload?.code) {
        void ctx.getSession()?.send2fa(payload.code);
      }
    },

    // ---- toggle privacy / block (Flutter sends these as setByName) ----
    toggle_privacy_mode: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<{ on?: boolean; impl_key?: string }>(value);
      session.sendPrivacyMode(!!payload?.on, payload?.impl_key ?? '');
    },

    // ---- env var ----
    envvar: (value: string) => {
      const payload = parseJson<EnvVarPayload>(value);
      if (payload && payload.name) ctx.setEnvVar(payload.name, payload.value ?? '');
    },

    // ---- terminal ----
    open_terminal: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<TerminalOpenPayload>(value);
      if (!payload) return;
      session.sendTerminalAction({
        open: { terminalId: payload.terminal_id, rows: payload.rows, cols: payload.cols },
      });
    },

    send_terminal_input: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<TerminalInputPayload>(value);
      if (!payload) return;
      session.sendTerminalAction({
        data: { terminalId: payload.terminal_id, data: new TextEncoder().encode(payload.data) },
      });
    },

    resize_terminal: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<TerminalResizePayload>(value);
      if (!payload) return;
      session.sendTerminalAction({
        resize: { terminalId: payload.terminal_id, rows: payload.rows, cols: payload.cols },
      });
    },

    close_terminal: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<TerminalClosePayload>(value);
      if (!payload) return;
      session.sendTerminalAction({
        close: { terminalId: payload.terminal_id },
      });
    },
  };
}

/**
 * Build the getByName handler registry for the given context.
 */
export function createGetRegistry(ctx: BridgeContext): GetRegistry {
  return {
    // ---- identity ----
    my_id: () => ctx.getMyId(),
    my_name: () => ctx.getMyName(),
    uuid: () => ctx.getUuid(),

    // ---- app metadata ----
    version: () => ctx.getAppVersion(),
    get_version_number: (arg: string) => {
      // Flutter passes a version string and expects a normalized number.
      // Return the raw version if no arg, else a best-effort numeric parse.
      if (!arg) return ctx.getAppVersion();
      const match = arg.match(/(\d+)\.(\d+)\.(\d+)/);
      if (match) {
        return String((parseInt(match[1], 10) << 16) | (parseInt(match[2], 10) << 8) | parseInt(match[3], 10));
      }
      return arg;
    },
    'app-name': () => ctx.getAppName(),
    build_date: () => ctx.getBuildDate(),
    platform: () => 'web',

    // ---- remember ----
    remember: () => (ctx.getRemember() ? 'true' : 'false'),

    // ---- options ----
    option: (arg: string) => ctx.getOption(arg),
    options: () => JSON.stringify(ctx.getOptions()),
    'option:local': (arg: string) => ctx.getLocalOption(arg),
    'option:session': (arg: string) => ctx.getSessionOption(arg),
    'option:toggle': (arg: string) => (ctx.getToggleOption(arg) ? 'true' : 'false'),
    'option:flutter:local': (arg: string) => ctx.getFlutterLocalOption(arg),
    'option:flutter:peer': (arg: string) => ctx.getFlutterPeerOption(arg),
    'option:peer': (arg: string) => {
      const payload = parseJson<PeerOptionGetPayload>(arg);
      if (!payload || !payload.id || !payload.name) return '';
      return ctx.getPeerOption(payload.id, payload.name);
    },
    'option:user:default': (arg: string) => {
      const stored = ctx.getUserDefaultOption(arg);
      if (stored) return stored;
      const defaults: Record<string, string> = {
        'view_style': 'original',
        'scroll_style': 'scrollauto',
        'image_quality': 'balanced',
        'codec-preference': 'auto',
        'custom_image_quality': '50',
        'custom-fps': '30',
        'edge-scroll-edge-thickness': '100',
        'trackpad-speed': '100',
      };
      return defaults[arg] ?? '';
    },

    // ---- favorites ----
    fav: () => JSON.stringify(ctx.getFav()),

    // ---- env ----
    envvar: (arg: string) => ctx.getEnvVar(arg),

    // ---- server ----
    api_server: () => {
      const s = ctx.getServer();
      if (s.apiHost) return s.apiHost;
      const scheme = s.useWss ? 'https' : 'http';
      return `${scheme}://${s.rendezvousHost}`;
    },
    is_using_public_server: () => (ctx.isUsingPublicServer() ? 'true' : 'false'),

    // ---- connection status ----
    get_conn_status: () => ctx.getConnStatus(),

    // ---- codecs ----
    alternative_codecs: () => {
      const cached = getCachedCodecAbilities();
      const ab: AlternativeCodecs = cached ?? { vp8: false, vp9: false, av1: false, h264: false, h265: false };
      return JSON.stringify(ab);
    },

    // ---- display ----
    main_display: () => '0',

    screen_info: () => {
      // Return screen dimensions and devicePixelRatio (common.dart:16).
      return JSON.stringify({
        width: window.screen.width,
        height: window.screen.height,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
        scale: window.devicePixelRatio ?? 1,
      });
    },

    local_os: () => {
      // Detect the local OS platform (common.dart:18).  Returns one of
      // "Windows", "Linux", "Mac OS" to match kPeerPlatform constants.
      const ua = navigator.userAgent;
      const platform = (navigator.platform ?? '') + ' ' + ua;
      if (/Win/i.test(platform)) return 'Windows';
      if (/Mac/i.test(platform)) return 'Mac OS';
      if (/Linux/i.test(platform)) return 'Linux';
      return '';
    },

    fullscreen: () => {
      // Return 'Y' if currently fullscreen, 'N' otherwise (state_model.dart:92).
      return document.fullscreenElement != null ? 'Y' : 'N';
    },

    // ---- languages ----
    langs: () => JSON.stringify(availableLangs),

    // ---- translation ----
    translate: (arg: string) => {
      const payload = parseJson<{ locale: string; text: string }>(arg);
      if (!payload || !payload.text) return '';
      const stored = ctx.getLocalOption('lang');
      const locale = stored || payload.locale || 'en';
      return translateText(locale, payload.text);
    },

    // ---- peers ----
    peer_exists: (arg: string) => (ctx.peerExists(arg) ? 'true' : 'false'),
    peer_has_password: (arg: string) => (ctx.peerHasPassword(arg) ? 'true' : 'false'),
    resolve_avatar_url: (arg: string) => ctx.resolveAvatarUrl(arg),
    load_fav_peers: () => JSON.stringify(ctx.getFavPeers()),
    load_recent_peers: () => JSON.stringify(ctx.getRecentPeers()),
    load_recent_peers_sync: () => JSON.stringify(ctx.getRecentPeers()),

    // ---- session id ----
    conn_session_id: () => {
      return ctx.getSession()?.connSessionId ?? '';
    },

    // ---- trusted devices ----
    enable_trusted_devices: () => 'N',

    // ---- account auth ----
    account_auth_result: () => {
      // OIDC auth result is handled via the onAccountAuth callback flow.
      // Return empty string when no result is available.
      return (window as unknown as { __accountAuthResult?: string }).__accountAuthResult ?? '';
    },

    // ---- audit ----
    audit_server: (_arg: string) => {
      const s = ctx.getServer();
      return s.rendezvousHost;
    },
    audit_guid: () => ctx.getAuditGuid(),
    last_audit_note: () => ctx.getLastAuditNote(),

    // ---- image quality (read back) ----
    image_quality: () => ctx.getSessionOption('image_quality') || 'balanced',

  };
}

/** Map a toggle-option name to a SessionOptionMessage field. */
function toggleToOptionMessage(name: string, enabled: boolean): SessionOptionMessage | null {
  const value = boolToOption(enabled);
  switch (name) {
    case 'show-remote-cursor': return { showRemoteCursor: value };
    case 'lock-after-session-end': return { lockAfterSessionEnd: value };
    case 'privacy-mode': return { privacyMode: value };
    case 'disable-audio': return { disableAudio: value };
    case 'disable-clipboard': return { disableClipboard: value };
    case 'disable-keyboard': return { disableKeyboard: value };
    case 'follow-remote-cursor': return { followRemoteCursor: value };
    case 'follow-remote-window': return { followRemoteWindow: value };
    case 'show-my-cursor': return { showMyCursor: value };
    case 'view-only':
      return { disableKeyboard: value, disableClipboard: value };
    case 'enable-file-copy-paste':
      return { enableFileTransfer: value };
    case 'terminal-persistent':
      return { terminalPersistent: value };
    case 'block-input':
      return { blockInput: BoolOption.Yes };
    case 'unblock-input':
      return { blockInput: BoolOption.No };
    default: return null;
  }
}

/** Map a session-option name/value to a SessionOptionMessage field. */
function sessionOptionToMessage(name: string, value: string): SessionOptionMessage | null {
  switch (name) {
    case 'image_quality':
      return { imageQuality: parseImageQuality(value) };
    case 'custom_image_quality': {
      const q = parseInt(value, 10);
      return Number.isFinite(q) ? { customImageQuality: q } : null;
    }
    case 'custom-fps':
    case 'custom_fps': {
      const fps = parseInt(value, 10);
      return Number.isFinite(fps) ? { customFps: fps } : null;
    }
    case 'lock-after-session-end':
      return { lockAfterSessionEnd: value === 'true' ? BoolOption.Yes : BoolOption.No };
    case 'show-remote-cursor':
      return { showRemoteCursor: value === 'true' ? BoolOption.Yes : BoolOption.No };
    case 'privacy-mode':
      return { privacyMode: value === 'true' ? BoolOption.Yes : BoolOption.No };
    case 'disable-audio':
      return { disableAudio: value === 'true' ? BoolOption.Yes : BoolOption.No };
    case 'disable-clipboard':
      return { disableClipboard: value === 'true' ? BoolOption.Yes : BoolOption.No };
    case 'disable-keyboard':
      return { disableKeyboard: value === 'true' ? BoolOption.Yes : BoolOption.No };
    case 'follow-remote-cursor':
      return { followRemoteCursor: value === 'true' ? BoolOption.Yes : BoolOption.No };
    case 'follow-remote-window':
      return { followRemoteWindow: value === 'true' ? BoolOption.Yes : BoolOption.No };
    case 'show-my-cursor':
      return { showMyCursor: value === 'true' ? BoolOption.Yes : BoolOption.No };
    default:
      return null;
  }
}

/**
 * Create a bound setByName/getByName pair for the given context.
 * Unknown keys log a console warning and no-op (never throw).
 *
 * setByName returns a string (matching bridge.dart's expectation that
 * sessionAddSync returns a String).  For session_add_sync the session id is
 * returned; for all other keys '' is returned.
 */
export function createDispatcher(ctx: BridgeContext): {
  setByName: (name: string, value?: string) => string;
  getByName: (name: string, arg?: string) => string;
} {
  const setRegistry = createSetRegistry(ctx);
  const getRegistry = createGetRegistry(ctx);

  return {
    setByName(name: string, value: string = ''): string {
      const handler = setRegistry[name];
      if (handler) {
        try {
          handler(value);
        } catch (err) {
          console.error(`[bridge] setByName("${name}") threw:`, err);
        }
        // session_add_sync expects a String return (the session id).
        if (name === 'session_add_sync') {
          return ctx.getSession()?.connSessionId ?? '';
        }
        return '';
      }
      stub('set', name);
      return '';
    },
    getByName(name: string, arg: string = ''): string {
      const handler = getRegistry[name];
      if (handler) {
        try {
          return handler(arg);
        } catch (err) {
          console.error(`[bridge] getByName("${name}") threw:`, err);
          return '';
        }
      }
      stub('get', name);
      return '';
    },
  };
}
