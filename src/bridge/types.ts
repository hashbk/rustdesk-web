/**
 * Shared types for the JS bridge layer.
 *
 * The bridge exposes three globals on `window`:
 *   - setByName(name, value?)  → void   (fire-and-forget commands)
 *   - getByName(name, arg?)    → string (synchronous queries)
 *   - init()                   → void   (one-shot bootstrap)
 *
 * Flutter Web calls into these instead of the native FFI handlers that the
 * Flutter desktop/mobile clients use.  Each key is routed to the existing
 * TypeScript protocol stack (`src/protocol/`).
 */

/** A setByName handler: receives the raw string value (may be JSON). */
export type SetHandler = (value: string) => void;

/** A getByName handler: receives the optional arg string and returns a string. */
export type GetHandler = (arg: string) => string;

/** Registry of setByName key → handler. */
export type SetRegistry = Record<string, SetHandler>;

/** Registry of getByName key → handler. */
export type GetRegistry = Record<string, GetHandler>;

/** Connection status reported by `get_conn_status`. Mirrors RustDesk native. */
export type ConnStatus = 'disconnected' | 'connecting' | 'connected';

/** JSON payload of `session_add_sync`. */
export interface SessionAddSyncPayload {
  id: string;
  password?: string;
  is_shared_password?: boolean;
  isFileTransfer?: boolean;
  isViewCamera?: boolean;
  isTerminal?: boolean;
  isPortForward?: boolean;
  isRdp?: boolean;
  switchUuid?: string;
  forceRelay?: boolean;
  connToken?: string;
}

/** JSON payload of `input_key`. */
export interface InputKeyPayload {
  name: string;
  down?: string;
  press?: string;
  alt?: string;
  ctrl?: string;
  shift?: string;
  command?: string;
}

/** JSON payload of `send_mouse`. */
export interface SendMousePayload {
  mask?: number;
  x?: number;
  y?: number;
  modifiers?: number[];
}

/** JSON payload of `read_remote_dir`. */
export interface ReadRemoteDirPayload {
  path: string;
  include_hidden?: boolean;
}

/** JSON payload of `send_files`. */
export interface SendFilesPayload {
  id: number;
  path: string;
  to: string;
  file_num: number;
  include_hidden?: boolean;
  is_remote?: boolean;
  is_dir?: boolean;
}

/** JSON payload of `elevate_with_logon`. */
export interface ElevateWithLogonPayload {
  username: string;
  password: string;
}

/** JSON payload of `option` (set single option). */
export interface OptionPayload {
  name: string;
  value: string;
}

/** JSON payload of `envvar` (set env var). */
export interface EnvVarPayload {
  name: string;
  value?: string;
}

/** JSON payload of `flutter_key_event`. */
export interface FlutterKeyEventPayload {
  name: string;
  usb_hid: number;
  lock_modes: number;
  down?: string;
}

/** JSON payload of file-transfer actions (remove_file, create_dir, etc.). */
export interface FileActionPayload {
  id: number;
  path: string;
  file_num?: number;
  is_remote?: boolean;
  show_hidden?: boolean;
  new_name?: string;
}

/** JSON payload of `change_resolution`. */
export interface ChangeResolutionPayload {
  display: number;
  width: number;
  height: number;
}

/** JSON payload of `toggle_virtual_display`. */
export interface ToggleVirtualDisplayPayload {
  index: number;
  on: boolean;
}

/** JSON payload of `option:peer` (get). */
export interface PeerOptionGetPayload {
  id: string;
  name: string;
}

/** JSON payload of `option:peer` (set). */
export interface PeerOptionSetPayload {
  id: string;
  name: string;
  value: string;
}

/** JSON payload of `account_auth`. */
export interface AccountAuthPayload {
  op: string;
  remember: boolean;
}

/** JSON payload of terminal actions. */
export interface TerminalOpenPayload {
  terminal_id: number;
  rows: number;
  cols: number;
}

export interface TerminalInputPayload {
  terminal_id: number;
  data: string;
}

export interface TerminalResizePayload {
  terminal_id: number;
  rows: number;
  cols: number;
}

export interface TerminalClosePayload {
  terminal_id: number;
}

/** Result of `alternative_codecs` query. */
export interface AlternativeCodecs {
  vp8: boolean;
  vp9: boolean;
  av1: boolean;
  h264: boolean;
  h265: boolean;
}

/** Bridge initialization options (passed to `init()`). */
export interface BridgeInitOptions {
  /** Override the default rendezvous server config. */
  server?: ServerConfigLike;
  /** Override the default app name. */
  appName?: string;
}

/** Minimal server config shape accepted by the bridge. */
export interface ServerConfigLike {
  rendezvousHost: string;
  relayHost?: string;
  /** Full API server URL (with scheme) when set separately via the `api-server` option. */
  apiHost?: string;
  key: string;
  useWss: boolean;
}