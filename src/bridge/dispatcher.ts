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
import { ConnType, CodecPreference, ImageQuality, type SessionConfig } from '../protocol/config';
import type { MessageT } from '../protos';
import { BridgeContext } from './context';
import { getCachedCodecAbilities } from './init';
import { createMainHandlers, type MainHandlerRegistry } from './main-handlers';
import type {
  SetRegistry,
  GetRegistry,
  SessionAddSyncPayload,
  InputKeyPayload,
  SendMousePayload,
  ReadRemoteDirPayload,
  SendFilesPayload,
  ElevateWithLogonPayload,
  OptionPayload,
  EnvVarPayload,
  AlternativeCodecs,
} from './types';

/** Map a control-key name (from input_key JSON) to the ControlKey enum value. */
const NAME_TO_CONTROL_KEY: Record<string, number> = {
  Alt: 1,
  Backspace: 2,
  CapsLock: 3,
  Control: 4,
  Delete: 5,
  DownArrow: 6,
  End: 7,
  Escape: 8,
  F1: 9, F2: 13, F3: 14, F4: 15, F5: 16, F6: 17, F7: 18, F8: 19, F9: 20, F10: 10, F11: 11, F12: 12,
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
};

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
  };
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

    session_add: (value: string) => {
      // Alias of session_add_sync in some Flutter builds.
      handleSessionAddSync(ctx, value);
    },

    session_start: (_value: string) => {
      // Flutter sends session_start after session_add_sync; the TS session
      // is already connecting, so this is a no-op apart from status sync.
      const session = ctx.getSession();
      if (session && session.state === 'connected') {
        ctx.setConnStatus('connected');
      }
    },

    session_close: () => {
      ctx.closeSession();
    },

    refresh: () => {
      // Request a video refresh by sending a misc.refreshVideo message.
      const session = ctx.getSession();
      if (!session) return;
      // RemoteSession doesn't expose a public refresh method; use sendOption
      // with an empty payload as a no-op until a refresh API is added.
      stub('set', 'refresh', 'no public refresh API on RemoteSession yet');
    },

    reconnect: () => {
      const session = ctx.getSession();
      if (!session) return;
      // Reconnect by closing and re-creating with the same config is not
      // possible from here (we don't retain the original SessionConfig).
      stub('set', 'reconnect', 'needs retained SessionConfig');
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
      } else if (payload.name.length === 1) {
        session.sendKey({ down: truthy(payload.down), press: truthy(payload.press), chr: payload.name.charCodeAt(0), modifiers: mods });
      }
    },

    send_mouse: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      const payload = parseJson<SendMousePayload>(value);
      if (!payload) return;
      const event: NonNullable<MessageT['mouseEvent']> = {
        mask: payload.mask ?? 0,
        x: payload.x ?? 0,
        y: payload.y ?? 0,
        modifiers: payload.modifiers,
      };
      session.sendMouse(event);
    },

    input_string: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      // Send each character as a key press.
      for (const ch of value) {
        session.sendKey({ press: true, chr: ch.charCodeAt(0), modifiers: [] });
      }
    },

    send_chat: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      // Chat is sent as clipboard content (RustDesk wire protocol).
      const content = new TextEncoder().encode(value);
      session.sendClipboard(content);
    },

    input_os_password: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
      // Send the OS password as a string input.
      for (const ch of value) {
        session.sendKey({ press: true, chr: ch.charCodeAt(0), modifiers: [] });
      }
    },

    enter_or_leave: (value: string) => {
      // Used by Flutter to auto-release keys on focus change.  The TS session
      // does not track pressed keys centrally yet, so this is a no-op stub.
      stub('set', 'enter_or_leave', `enter=${value}`);
    },

    // ---- quality / codec / fps ----
    image_quality: (value: string) => {
      const session = ctx.getSession();
      if (!session) return;
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
      session.sendCodecPreference(parseCodecPreference(value));
    },

    // ---- special keys ----
    lock_screen: () => {
      const session = ctx.getSession();
      if (!session) return;
      // Ctrl+Alt+L is the conventional lock-screen shortcut on most OSes,
      // but RustDesk sends a dedicated misc.lockScreen.  Use the key sequence
      // until a dedicated API is added.
      session.sendKey({ down: true, controlKey: NAME_TO_CONTROL_KEY.Control, modifiers: [] });
      session.sendKey({ down: true, controlKey: NAME_TO_CONTROL_KEY.Alt, modifiers: [4] });
      session.sendKey({ press: true, chr: 'l'.charCodeAt(0), modifiers: [4, 1] });
      session.sendKey({ down: false, controlKey: NAME_TO_CONTROL_KEY.Control, modifiers: [] });
      session.sendKey({ down: false, controlKey: NAME_TO_CONTROL_KEY.Alt, modifiers: [] });
    },

    ctrl_alt_del: () => {
      const session = ctx.getSession();
      if (!session) return;
      session.sendKey({ down: true, controlKey: NAME_TO_CONTROL_KEY.Control, modifiers: [] });
      session.sendKey({ down: true, controlKey: NAME_TO_CONTROL_KEY.Alt, modifiers: [4] });
      session.sendKey({ down: true, controlKey: NAME_TO_CONTROL_KEY.Delete, modifiers: [4, 1] });
      session.sendKey({ down: false, controlKey: NAME_TO_CONTROL_KEY.Delete, modifiers: [4, 1] });
      session.sendKey({ down: false, controlKey: NAME_TO_CONTROL_KEY.Alt, modifiers: [4] });
      session.sendKey({ down: false, controlKey: NAME_TO_CONTROL_KEY.Control, modifiers: [] });
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

    // ---- options ----
    'option:toggle': (value: string) => {
      const session = ctx.getSession();
      ctx.setToggleOption(value, !ctx.getToggleOption(value));
      // Mirror the toggle into the session option message so the peer is notified.
      if (session) {
        const opt = toggleToOptionMessage(value, ctx.getToggleOption(value));
        if (opt) session.sendOption(opt);
      }
    },

    options: (value: string) => {
      const opts = parseJson<Record<string, string>>(value);
      if (opts && typeof opts === 'object') ctx.setOptions(opts);
    },

    option: (value: string) => {
      const payload = parseJson<OptionPayload>(value);
      if (payload && payload.name) ctx.setOption(payload.name, payload.value);
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

    // ---- favorites ----
    fav: (value: string) => {
      const favs = parseJson<string[]>(value);
      if (Array.isArray(favs)) ctx.setFav(favs.map(String));
    },

    // ---- file transfer ----
    cancel_job: (value: string) => {
      const id = parseInt(value, 10);
      if (Number.isFinite(id)) ctx.cancelTransfer(id);
    },

    select_files: () => {
      stub('set', 'select_files', 'file-selection UI lives in Flutter');
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
      // Trigger a download (is_remote=true) or upload (is_remote=false).
      // Full bidirectional transfer is handled by FileTransferManager; here we
      // kick off the read so the peer starts streaming.
      if (payload.is_remote) {
        ftm.readRemoteDir(payload.path, !!payload.include_hidden);
      } else {
        stub('set', 'send_files', 'upload requires a local File handle from Flutter');
      }
    },

    confirm_override_file: () => {
      stub('set', 'confirm_override_file');
    },

    // ---- peers / address book ----
    remove_peer: (value: string) => {
      ctx.removePeer(value);
    },

    query_onlines: (value: string) => {
      // Online-status query would hit the rendezvous server; stubbed for now.
      stub('set', 'query_onlines', value);
    },

    load_ab: () => {
      // Address book is loaded from localStorage on demand; no async work.
      stub('set', 'load_ab', 'address book is localStorage-backed');
    },

    save_ab: (value: string) => {
      const data = parseJson(value);
      ctx.setAddressBook(data ?? value);
    },

    clear_ab: () => {
      ctx.clearAddressBook();
    },

    load_group: () => {
      stub('set', 'load_group', 'group is localStorage-backed');
    },

    save_group: (value: string) => {
      const data = parseJson(value);
      ctx.setGroup(data ?? value);
    },

    clear_group: () => {
      ctx.clearGroup();
    },

    send_note: (value: string) => {
      // value is the note text; apply to the current peer if known.
      const session = ctx.getSession();
      if (!session) return;
      stub('set', 'send_note', `note="${value.slice(0, 32)}..."`);
    },

    // ---- remote control ----
    restart: () => {
      ctx.getSession()?.sendRestartRemoteDevice();
    },

    // ---- account auth ----
    account_auth_cancel: () => {
      stub('set', 'account_auth_cancel');
    },

    // ---- audit ----
    audit_guid: (value: string) => {
      ctx.setAuditGuid(value);
    },

    // ---- login / 2fa (Flutter sends these too) ----
    login: (value: string) => {
      const payload = parseJson<{ password?: string; remember?: boolean }>(value);
      if (payload?.password != null) {
        // The password is applied to the in-flight session; RemoteSession
        // reads it from config at handshake time, so we can't inject it
        // post-construction.  Stub until a setPassword API exists.
        stub('set', 'login', 'password injection post-construction not supported');
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
      const payload = parseJson<{ on?: boolean }>(value);
      session.sendPrivacyMode(!!payload?.on);
    },

    // ---- env var ----
    envvar: (value: string) => {
      const payload = parseJson<EnvVarPayload>(value);
      if (payload && payload.name) ctx.setEnvVar(payload.name, payload.value ?? '');
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
    'option:user:default': (arg: string) => ctx.getUserDefaultOption(arg),

    // ---- favorites ----
    fav: () => JSON.stringify(ctx.getFav()),

    // ---- env ----
    envvar: (arg: string) => ctx.getEnvVar(arg),

    // ---- server ----
    api_server: () => {
      const s = ctx.getServer();
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

    // ---- languages ----
    langs: () => JSON.stringify(['en', 'zh-cn', 'zh-tw', 'de', 'fr', 'es', 'ja', 'ko', 'ru', 'pt']),

    // ---- peers ----
    peer_exists: (arg: string) => (ctx.peerExists(arg) ? 'true' : 'false'),
    peer_has_password: (arg: string) => (ctx.peerHasPassword(arg) ? 'true' : 'false'),
    resolve_avatar_url: (arg: string) => ctx.resolveAvatarUrl(arg),
    load_fav_peers: () => JSON.stringify(ctx.getFavPeers()),
    load_recent_peers: () => JSON.stringify(ctx.getRecentPeers()),
    load_recent_peers_sync: () => JSON.stringify(ctx.getRecentPeers()),

    // ---- session id ----
    conn_session_id: () => {
      // Return the active session's relay uuid if available; empty otherwise.
      stub('get', 'conn_session_id');
      return '';
    },

    // ---- trusted devices ----
    enable_trusted_devices: () => 'false',

    // ---- account auth ----
    account_auth_result: () => {
      stub('get', 'account_auth_result');
      return '';
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

    // ---- input source ----
    'input-source': () => ctx.getLocalOption('input-source') || 'Input source 1',
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
 * Keys prefixed with `main_` are routed to the main-handlers registry
 * (154 methods covering config, address-book, identity, codec, etc.).
 */
export function createDispatcher(ctx: BridgeContext): {
  setByName: (name: string, value?: string) => void;
  getByName: (name: string, arg?: string) => string;
} {
  const setRegistry = createSetRegistry(ctx);
  const getRegistry = createGetRegistry(ctx);
  const mainHandlers: MainHandlerRegistry = createMainHandlers(ctx);

  return {
    setByName(name: string, value: string = ''): void {
      // Route main_* keys to the main handlers.
      if (name.startsWith('main_')) {
        const handler = mainHandlers[name];
        if (handler) {
          try {
            handler(value);
          } catch (err) {
            console.error(`[bridge] setByName("${name}") threw:`, err);
          }
          return;
        }
      }
      const handler = setRegistry[name];
      if (handler) {
        try {
          handler(value);
        } catch (err) {
          console.error(`[bridge] setByName("${name}") threw:`, err);
        }
      } else {
        stub('set', name);
      }
    },
    getByName(name: string, arg: string = ''): string {
      // Route main_* keys to the main handlers.
      if (name.startsWith('main_')) {
        const handler = mainHandlers[name];
        if (handler) {
          try {
            return handler(arg);
          } catch (err) {
            console.error(`[bridge] getByName("${name}") threw:`, err);
            return '';
          }
        }
      }
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