/**
 * BridgeContext — singleton holding the active session, file-transfer manager,
 * localStorage-backed config store, and persistent web ID/UUID.
 *
 * The bridge dispatcher routes keys to handlers that operate on this context.
 * Keeping the state here (rather than in module-level let vars) makes the
 * handlers testable: tests construct a fresh BridgeContext and pass it to
 * `createDispatcher(ctx)`.
 */

import { RemoteSession, type SessionEvents, type SessionOptionMessage } from '../protocol/session';
import { FileTransferManager } from '../protocol/file_transfer';
import { attachSessionCallbacks } from './callbacks';


import type { ConnStatus, ServerConfigLike } from './types';

const APP_VERSION = '1.3.0';
const APP_NAME = 'RustDesk Web';

const LS_MY_ID = 'rustdesk-web:my-id';
const LS_MY_NAME = 'rustdesk-web:my-name';
const LS_UUID = 'rustdesk-web:uuid';
const LS_OPTIONS = 'rustdesk-web:options';
const LS_LOCAL_OPTIONS = 'rustdesk-web:local-options';
const LS_SESSION_OPTIONS = 'rustdesk-web:session-options';
const LS_FLUTTER_LOCAL = 'rustdesk-web:flutter:local';
const LS_FLUTTER_PEER = 'rustdesk-web:flutter:peer';
const LS_USER_DEFAULT = 'rustdesk-web:user:default';
const LS_FAV = 'rustdesk-web:fav';
const LS_ENVVAR = 'rustdesk-web:envvar';
const LS_PEERS = 'rustdesk-web:peers';
const LS_RECENT = 'rustdesk-web:recent-peers';
const LS_ADDRESS_BOOK = 'rustdesk-web:address-book';
const LS_GROUP = 'rustdesk-web:group';
const LS_AUDIT_GUID = 'rustdesk-web:audit-guid';
const LS_AUDIT_NOTE = 'rustdesk-web:last-audit-note';
const LS_REMEMBER = 'rustdesk-web:remember';
const LS_PEER_OPTIONS = 'rustdesk-web:peer-options';
const LS_TEMP_PASSWORD = 'rustdesk-web:temp-password';
const LS_PERM_PASSWORD = 'rustdesk-web:perm-password';
const LS_COMMON = 'rustdesk-web:common';
const LS_THEME = 'rustdesk-web:theme';
const LS_LANGUAGE = 'rustdesk-web:language';

/** Default public rendezvous server (matches RustDesk default). */
export const DEFAULT_SERVER: ServerConfigLike = {
  rendezvousHost: 'rs-ny.rustdesk.com',
  key: 'OeVuKk5nlHiXp+APNn0Y3pC1Iwpwn44JGqrQCsWqmBw=',
  useWss: true,
};

function generateWebId(): string {
  const n = Math.floor(1_000_000_000 + Math.random() * 9_000_000_000);
  return n.toString();
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback RFC4122-v4-ish UUID.
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += hex[(Math.random() * 4) | 0 | 8];
    else s += hex[(Math.random() * 16) | 0];
  }
  return s;
}

function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / privacy errors */
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Peer record stored in localStorage (address-book entry).
 *  Matches Dart `Peer.fromJson` in flutter/lib/models/peer_model.dart. */
export interface PeerRecord {
  id: string;
  name?: string;
  alias?: string;
  password?: string;
  hash?: string;
  note?: string;
  avatar?: string;
  username?: string;
  hostname?: string;
  platform?: string;
  tags?: string[];
  forceAlwaysRelay?: string;
  rdpPort?: string;
  rdpUsername?: string;
  loginName?: string;
  device_group_name?: string;
  same_server?: boolean;
}

/**
 * Holds the active session and all bridge-level state.
 *
 * A single instance is shared by the dispatcher (production) and by tests
 * (fresh instance per test).  All accessors are synchronous; async work is
 * kicked off inside handlers and errors are reported via the session's
 * `error` event.
 */
export class BridgeContext {
  private session: RemoteSession | null = null;
  private ftm: FileTransferManager | null = null;
  private connStatus: ConnStatus = 'disconnected';
  private server: ServerConfigLike = { ...DEFAULT_SERVER };
  private appName = APP_NAME;
  private sessionOptions: SessionOptionMessage = {};
  private sessionListeners: Partial<SessionEvents> = {};

  // ---- session lifecycle ----

  getSession(): RemoteSession | null {
    return this.session;
  }

  setSession(session: RemoteSession): void {
    this.session = session;
  }

  getFileTransferManager(): FileTransferManager | null {
    return this.ftm;
  }

  setFileTransferManager(ftm: FileTransferManager): void {
    this.ftm = ftm;
  }

  /**
   * Create a new RemoteSession + FileTransferManager, wire default listeners,
   * and store as the active session.  Returns the session so the caller can
   * call `connect()`.
   */
  createSession(config: ConstructorParameters<typeof RemoteSession>[0]): RemoteSession {
    if (this.session) {
      try {
        this.session.close();
      } catch {
        /* ignore */
      }
    }
    const session = new RemoteSession(config);
    this.session = session;

    for (const [k, fn] of Object.entries(this.sessionListeners)) {
      session.on(k as keyof SessionEvents, fn as never);
    }

    // Wire session events → window.onGlobalEvent / onRgba / onVideoFrame.
    // Display index defaults to 0; switch_display events will update it.
    attachSessionCallbacks(session, 0);

    this.ftm = new FileTransferManager(
      (a) => session.sendFileAction(a),
      (r) => session.sendFileResponse(r),
    );

    this.setConnStatus('connecting');
    return session;
  }

  closeSession(): void {
    if (this.session) {
      try {
        this.session.close();
      } catch {
        /* ignore */
      }
    }
    this.session = null;
    this.ftm = null;
    this.setConnStatus('disconnected');
  }

  /** Register a listener that will be attached to every new session. */
  onSessionEvent<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): void {
    this.sessionListeners[event] = listener;
  }

  // ---- connection status ----

  getConnStatus(): ConnStatus {
    return this.connStatus;
  }

  setConnStatus(status: ConnStatus): void {
    this.connStatus = status;
  }

  // ---- server config ----

  getServer(): ServerConfigLike {
    return this.server;
  }

  setServer(server: ServerConfigLike): void {
    this.server = { ...server };
  }

  isUsingPublicServer(): boolean {
    return (
      this.server.rendezvousHost === DEFAULT_SERVER.rendezvousHost &&
      this.server.key === DEFAULT_SERVER.key
    );
  }

  // ---- app metadata ----

  getAppName(): string {
    return this.appName;
  }

  setAppName(name: string): void {
    this.appName = name;
  }

  getAppVersion(): string {
    return APP_VERSION;
  }

  getBuildDate(): string {
    return typeof __BRIDGE_BUILD_DATE__ !== 'undefined'
      ? __BRIDGE_BUILD_DATE__
      : '';
  }

  // ---- persistent identity ----

  getMyId(): string {
    let id = lsGet(LS_MY_ID);
    if (!id) {
      id = generateWebId();
      lsSet(LS_MY_ID, id);
    }
    return id;
  }

  getMyName(): string {
    let name = lsGet(LS_MY_NAME);
    if (!name) {
      name = 'Web-' + this.getMyId().slice(-6);
      lsSet(LS_MY_NAME, name);
    }
    return name;
  }

  setMyName(name: string): void {
    lsSet(LS_MY_NAME, name);
  }

  getUuid(): string {
    let uuid = lsGet(LS_UUID);
    if (!uuid) {
      uuid = generateUuid();
      lsSet(LS_UUID, uuid);
    }
    return uuid;
  }

  // ---- remember-password flag ----

  getRemember(): boolean {
    return lsGet(LS_REMEMBER) === 'true';
  }

  setRemember(remember: boolean): void {
    lsSet(LS_REMEMBER, remember ? 'true' : 'false');
  }

  // ---- options (main config JSON blob) ----

  getOptions(): Record<string, string> {
    const raw = lsGet(LS_OPTIONS);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  setOptions(options: Record<string, string>): void {
    lsSet(LS_OPTIONS, JSON.stringify(options));
  }

  getOption(key: string): string {
    return this.getOptions()[key] ?? '';
  }

  setOption(key: string, value: string): void {
    const opts = this.getOptions();
    opts[key] = value;
    this.setOptions(opts);
  }

  // ---- local options (per-browser, not synced) ----

  getLocalOptions(): Record<string, string> {
    const raw = lsGet(LS_LOCAL_OPTIONS);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  setLocalOptions(options: Record<string, string>): void {
    lsSet(LS_LOCAL_OPTIONS, JSON.stringify(options));
  }

  getLocalOption(key: string): string {
    return this.getLocalOptions()[key] ?? '';
  }

  setLocalOption(key: string, value: string): void {
    const opts = this.getLocalOptions();
    opts[key] = value;
    this.setLocalOptions(opts);
  }

  // ---- session options (per-peer, persisted) ----

  getSessionOptions(): Record<string, string> {
    const raw = lsGet(LS_SESSION_OPTIONS);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  setSessionOptions(options: Record<string, string>): void {
    lsSet(LS_SESSION_OPTIONS, JSON.stringify(options));
  }

  getSessionOption(key: string): string {
    return this.getSessionOptions()[key] ?? '';
  }

  setSessionOption(key: string, value: string): void {
    const opts = this.getSessionOptions();
    opts[key] = value;
    this.setSessionOptions(opts);
  }

  // ---- toggle options (boolean, stored as "true"/"false") ----

  getToggleOption(key: string): boolean {
    return lsGet('rustdesk-web:toggle:' + key) === 'true';
  }

  setToggleOption(key: string, enabled: boolean): void {
    lsSet('rustdesk-web:toggle:' + key, enabled ? 'true' : 'false');
  }

  // ---- flutter local / peer options ----

  getFlutterLocalOption(key: string): string {
    const raw = lsGet(LS_FLUTTER_LOCAL);
    if (!raw) return '';
    try {
      return (JSON.parse(raw) as Record<string, string>)[key] ?? '';
    } catch {
      return '';
    }
  }

  setFlutterLocalOption(key: string, value: string): void {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(lsGet(LS_FLUTTER_LOCAL) || '{}') as Record<string, string>;
    } catch {
      map = {};
    }
    map[key] = value;
    lsSet(LS_FLUTTER_LOCAL, JSON.stringify(map));
  }

  getFlutterPeerOption(key: string): string {
    const raw = lsGet(LS_FLUTTER_PEER);
    if (!raw) return '';
    try {
      return (JSON.parse(raw) as Record<string, string>)[key] ?? '';
    } catch {
      return '';
    }
  }

  setFlutterPeerOption(key: string, value: string): void {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(lsGet(LS_FLUTTER_PEER) || '{}') as Record<string, string>;
    } catch {
      map = {};
    }
    map[key] = value;
    lsSet(LS_FLUTTER_PEER, JSON.stringify(map));
  }

  // ---- user-default options ----

  getUserDefaultOption(key: string): string {
    const raw = lsGet(LS_USER_DEFAULT);
    if (!raw) return '';
    try {
      return (JSON.parse(raw) as Record<string, string>)[key] ?? '';
    } catch {
      return '';
    }
  }

  setUserDefaultOption(key: string, value: string): void {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(lsGet(LS_USER_DEFAULT) || '{}') as Record<string, string>;
    } catch {
      map = {};
    }
    map[key] = value;
    lsSet(LS_USER_DEFAULT, JSON.stringify(map));
  }

  // ---- favorites (array of peer ids) ----

  getFav(): string[] {
    const raw = lsGet(LS_FAV);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? (arr as string[]).map(String) : [];
    } catch {
      return [];
    }
  }

  setFav(favs: string[]): void {
    lsSet(LS_FAV, JSON.stringify(favs));
  }

  // ---- environment variables (web shim) ----

  getEnvVar(name: string): string {
    const raw = lsGet(LS_ENVVAR);
    if (!raw) return '';
    try {
      return (JSON.parse(raw) as Record<string, string>)[name] ?? '';
    } catch {
      return '';
    }
  }

  setEnvVar(name: string, value: string): void {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(lsGet(LS_ENVVAR) || '{}') as Record<string, string>;
    } catch {
      map = {};
    }
    map[name] = value;
    lsSet(LS_ENVVAR, JSON.stringify(map));
  }

  // ---- peers (address-book + recent) ----

  getPeers(): PeerRecord[] {
    const raw = lsGet(LS_PEERS);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? (arr as PeerRecord[]) : [];
    } catch {
      return [];
    }
  }

  setPeers(peers: PeerRecord[]): void {
    lsSet(LS_PEERS, JSON.stringify(peers));
  }

  getPeer(id: string): PeerRecord | null {
    return this.getPeers().find((p) => p.id === id) ?? null;
  }

  peerExists(id: string): boolean {
    return this.getPeers().some((p) => p.id === id);
  }

  peerHasPassword(id: string): boolean {
    const p = this.getPeer(id);
    return !!(p && (p.password || p.hash));
  }

  removePeer(id: string): void {
    this.setPeers(this.getPeers().filter((p) => p.id !== id));
  }

  setPeerNote(id: string, note: string): void {
    const peers = this.getPeers();
    const idx = peers.findIndex((p) => p.id === id);
    if (idx >= 0) {
      peers[idx] = { ...peers[idx], note };
      this.setPeers(peers);
    }
  }

  getRecentPeers(): PeerRecord[] {
    const raw = lsGet(LS_RECENT);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? (arr as PeerRecord[]) : [];
    } catch {
      return [];
    }
  }

  setRecentPeers(peers: PeerRecord[]): void {
    lsSet(LS_RECENT, JSON.stringify(peers));
  }

  getFavPeers(): PeerRecord[] {
    const favs = new Set(this.getFav());
    return this.getPeers().filter((p) => favs.has(p.id));
  }

  // ---- address book / group ----

  getAddressBook(): unknown {
    const raw = lsGet(LS_ADDRESS_BOOK);
    if (!raw) return '';
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  setAddressBook(data: unknown): void {
    lsSet(LS_ADDRESS_BOOK, typeof data === 'string' ? data : JSON.stringify(data));
  }

  clearAddressBook(): void {
    lsRemove(LS_ADDRESS_BOOK);
  }

  getGroup(): unknown {
    const raw = lsGet(LS_GROUP);
    if (!raw) return '';
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  setGroup(data: unknown): void {
    lsSet(LS_GROUP, typeof data === 'string' ? data : JSON.stringify(data));
  }

  clearGroup(): void {
    lsRemove(LS_GROUP);
  }

  // ---- audit ----

  getAuditGuid(): string {
    return lsGet(LS_AUDIT_GUID);
  }

  setAuditGuid(guid: string): void {
    lsSet(LS_AUDIT_GUID, guid);
  }

  getLastAuditNote(): string {
    return lsGet(LS_AUDIT_NOTE);
  }

  setLastAuditNote(note: string): void {
    lsSet(LS_AUDIT_NOTE, note);
  }

  // ---- session option message (in-memory, sent on connect) ----

  getSessionOptionMessage(): SessionOptionMessage {
    return this.sessionOptions;
  }

  setSessionOptionMessage(options: SessionOptionMessage): void {
    this.sessionOptions = { ...options };
  }

  // ---- avatar ----

  resolveAvatarUrl(avatar: string): string {
    if (!avatar) return '';
    if (/^https?:\/\//i.test(avatar)) return avatar;
    // Treat as a peer id; look up stored avatar.
    const peer = this.getPeer(avatar);
    return peer?.avatar ?? '';
  }

  // ---- file transfer helpers ----

  readRemoteDir(path: string, includeHidden = false): void {
    this.ftm?.readRemoteDir(path, includeHidden);
  }

  cancelTransfer(id: number): void {
    this.ftm?.cancelTransfer(id);
  }

  // ---- terminal (stub; no terminal manager yet) ----

  // ---- misc stubs return empty ----

  // ---- per-peer options (keyed by peerId:optionKey) ----

  private getPeerOptionsMap(): Record<string, Record<string, string>> {
    const raw = lsGet(LS_PEER_OPTIONS);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, Record<string, string>>;
    } catch {
      return {};
    }
  }

  getPeerOption(peerId: string, key: string): string {
    return this.getPeerOptionsMap()[peerId]?.[key] ?? '';
  }

  setPeerOption(peerId: string, key: string, value: string): void {
    const map = this.getPeerOptionsMap();
    if (!map[peerId]) map[peerId] = {};
    map[peerId][key] = value;
    lsSet(LS_PEER_OPTIONS, JSON.stringify(map));
  }

  // ---- temporary / permanent password ----

  getTemporaryPassword(): string {
    return lsGet(LS_TEMP_PASSWORD);
  }

  setTemporaryPassword(pwd: string): void {
    lsSet(LS_TEMP_PASSWORD, pwd);
  }

  getPermanentPassword(): string {
    return lsGet(LS_PERM_PASSWORD);
  }

  setPermanentPassword(pwd: string): void {
    lsSet(LS_PERM_PASSWORD, pwd);
  }

  // ---- common options (shared across peers) ----

  getCommon(key: string): string {
    const raw = lsGet(LS_COMMON);
    if (!raw) return '';
    try {
      return (JSON.parse(raw) as Record<string, string>)[key] ?? '';
    } catch {
      return '';
    }
  }

  setCommon(key: string, value: string): void {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(lsGet(LS_COMMON) || '{}') as Record<string, string>;
    } catch {
      map = {};
    }
    map[key] = value;
    lsSet(LS_COMMON, JSON.stringify(map));
  }

  // ---- theme / language ----

  getTheme(): string {
    return lsGet(LS_THEME);
  }

  setTheme(theme: string): void {
    lsSet(LS_THEME, theme);
  }

  getLanguage(): string {
    return lsGet(LS_LANGUAGE);
  }

  setLanguage(lang: string): void {
    lsSet(LS_LANGUAGE, lang);
  }

  // ---- device info (browser-derived) ----

  getDeviceId(): string {
    return this.getMyId();
  }

  getDeviceName(): string {
    return this.getMyName();
  }

  // ---- new version (no update check on web) ----

  getNewVersion(): string {
    return APP_VERSION;
  }

  // ---- software update url (stub) ----

  getSoftwareUpdateUrl(): string {
    return '';
  }

  // ---- fingerprint (stub) ----

  getFingerprint(): string {
    return '';
  }

  // ---- home dir (empty on web) ----

  getHomeDir(): string {
    return '';
  }

  // ---- access token (for HBBS API auth, used by Dart side via getLocalOption) ----

  getAccessToken(): string {
    return this.getLocalOption('access_token');
  }

  setAccessToken(token: string): void {
    this.setLocalOption('access_token', token);
  }

  /** Reset all in-memory state (tests use this). */
  reset(): void {
    this.closeSession();
    this.server = { ...DEFAULT_SERVER };
    this.appName = APP_NAME;
    this.sessionOptions = {};
    this.sessionListeners = {};
  }
}

/** Default singleton context used by the wired-up window globals. */
export const defaultContext = new BridgeContext();

/** Build-date injected by Vite define; declared here for TS. */
declare global {

  var __BRIDGE_BUILD_DATE__: string | undefined;
}