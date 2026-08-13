/**
 * Unit tests for the setByName / getByName dispatcher.
 *
 * Covers 20+ core keys: session lifecycle, input routing, options, identity
 * queries, and stub behavior for unimplemented keys.  The RemoteSession is
 * mocked so we can assert which protocol-stack methods are called without
 * opening a real WebSocket.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeContext } from '../context';
import { createDispatcher } from '../dispatcher';
import { resetInit } from '../init';

// ---- mock RemoteSession ----
// vi.hoisted ensures the mock object exists before vi.mock's hoisted factory
// runs.  Without this, `mockSession` would be undefined inside the factory.

const { mockSession, mockFtm } = vi.hoisted(() => {
  const mockSession = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    sendMouse: vi.fn(),
    sendKey: vi.fn(),
    sendClipboard: vi.fn(),
    sendImageQuality: vi.fn(),
    sendCustomImageQuality: vi.fn(),
    sendCodecPreference: vi.fn(),
    sendSwitchDisplay: vi.fn(),
    sendElevationRequest: vi.fn(),
    sendElevationWithLogon: vi.fn(),
    sendRestartRemoteDevice: vi.fn(),
    sendOption: vi.fn(),
    sendPrivacyMode: vi.fn(),
    sendBlockInput: vi.fn(),
    send2fa: vi.fn().mockResolvedValue(undefined),
    sendFileAction: vi.fn(),
    sendFileResponse: vi.fn(),
    sendTerminalAction: vi.fn(),
    sendMisc: vi.fn(),
    sendRefresh: vi.fn(),
    sendLoginWithPassword: vi.fn().mockResolvedValue(undefined),
    connSessionId: 'test-session-id',
    setInitialOptions: vi.fn(),
    getCodecAbilities: vi.fn().mockReturnValue(null),
    on: vi.fn(),
    state: 'idle',
  };
  const mockFtm = {
    readRemoteDir: vi.fn(),
    cancelTransfer: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    setCallbacks: vi.fn(),
    handleFileResponse: vi.fn(),
  };
  return { mockSession, mockFtm };
});

vi.mock('../../protocol/session', () => ({
  RemoteSession: vi.fn(function () {
    return mockSession;
  }),
  BoolOption: { NotSet: 0, No: 1, Yes: 2 },
  boolToOption: (b: boolean) => (b ? 2 : 1),
}));

vi.mock('../../protocol/file_transfer', () => ({
  FileTransferManager: vi.fn(function () {
    return mockFtm;
  }),
}));

function clearMockCalls(): void {
  mockSession.connect.mockClear();
  mockSession.close.mockClear();
  mockSession.sendMouse.mockClear();
  mockSession.sendKey.mockClear();
  mockSession.sendClipboard.mockClear();
  mockSession.sendImageQuality.mockClear();
  mockSession.sendCustomImageQuality.mockClear();
  mockSession.sendCodecPreference.mockClear();
  mockSession.sendSwitchDisplay.mockClear();
  mockSession.sendElevationRequest.mockClear();
  mockSession.sendElevationWithLogon.mockClear();
  mockSession.sendRestartRemoteDevice.mockClear();
  mockSession.sendOption.mockClear();
  mockSession.sendPrivacyMode.mockClear();
  mockSession.sendBlockInput.mockClear();
  mockSession.send2fa.mockClear();
  mockSession.sendFileAction.mockClear();
  mockSession.sendFileResponse.mockClear();
  mockSession.sendTerminalAction.mockClear();
  mockSession.sendMisc.mockClear();
  mockSession.sendRefresh.mockClear();
  mockSession.sendLoginWithPassword.mockClear();
  mockSession.setInitialOptions.mockClear();
  mockSession.getCodecAbilities.mockClear();
  mockSession.on.mockClear();
  mockFtm.readRemoteDir.mockClear();
  mockFtm.cancelTransfer.mockClear();
  mockFtm.uploadFile.mockClear();
  mockFtm.setCallbacks.mockClear();
  mockFtm.handleFileResponse.mockClear();
}

describe('dispatcher', () => {
  let ctx: BridgeContext;
  let setByName: (name: string, value?: string) => void;
  let getByName: (name: string, arg?: string) => string;

  beforeEach(() => {
    localStorage.clear();
    clearMockCalls();
    resetInit();
    ctx = new BridgeContext();
    const d = createDispatcher(ctx);
    setByName = d.setByName;
    getByName = d.getByName;
  });

  // ---- session lifecycle (3 keys) ----
  describe('session lifecycle', () => {
    it('session_add_sync creates a session and calls connect', () => {
      setByName('session_add_sync', JSON.stringify({ id: '123456', password: 'pw' }));
      expect(mockSession.connect).toHaveBeenCalledTimes(1);
      expect(ctx.getSession()).toBe(mockSession);
      expect(ctx.getConnStatus()).toBe('connecting');
    });


    it('session_close closes the session', () => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      setByName('session_close');
      expect(mockSession.close).toHaveBeenCalled();
      expect(ctx.getSession()).toBeNull();
      expect(ctx.getConnStatus()).toBe('disconnected');
    });

    it('session_add_sync with missing id warns and does not connect', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setByName('session_add_sync', '{}');
      expect(mockSession.connect).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  // ---- input routing (4 keys) ----
  describe('input routing', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('send_mouse calls session.sendMouse with Dart-format payload', () => {
      setByName('send_mouse', JSON.stringify({ type: 'down', buttons: 'left', x: 100, y: 200 }));
      expect(mockSession.sendMouse).toHaveBeenCalledWith(
        expect.objectContaining({ mask: 1 | (1 << 3), x: 100, y: 200 }),
      );
    });

    it('send_mouse converts move type with no button', () => {
      setByName('send_mouse', JSON.stringify({ type: 'move', buttons: '', x: 50, y: 60 }));
      expect(mockSession.sendMouse).toHaveBeenCalledWith(
        expect.objectContaining({ mask: 0, x: 50, y: 60 }),
      );
    });

    it('send_mouse converts wheel type with wheel button', () => {
      setByName('send_mouse', JSON.stringify({ type: 'wheel', buttons: 'wheel', x: 0, y: -3 }));
      expect(mockSession.sendMouse).toHaveBeenCalledWith(
        expect.objectContaining({ mask: 3 | (4 << 3), x: 0, y: -3 }),
      );
    });

    it('send_mouse includes modifiers from ctrl/shift/alt/command', () => {
      setByName('send_mouse', JSON.stringify({ type: 'down', buttons: 'right', x: 10, y: 20, ctrl: true, shift: true }));
      const call = mockSession.sendMouse.mock.calls[0][0];
      expect(call.modifiers).toContain(4);
      expect(call.modifiers).toContain(29);
    });

    it('input_key sends a control key', () => {
      setByName('input_key', JSON.stringify({ name: 'Return', down: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith(
        expect.objectContaining({ controlKey: 27, down: true }),
      );
    });

    it('input_key sends a character key', () => {
      setByName('input_key', JSON.stringify({ name: 'a', press: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith(
        expect.objectContaining({ chr: 97, press: true }),
      );
    });

    it('input_key handles VK_ prefix control keys', () => {
      setByName('input_key', JSON.stringify({ name: 'VK_CONTROL', down: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith(
        expect.objectContaining({ controlKey: 4, down: true }),
      );
    });

    it('input_key handles VK_ prefix character keys', () => {
      setByName('input_key', JSON.stringify({ name: 'VK_A', press: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith(
        expect.objectContaining({ chr: 97, press: true }),
      );
    });

    it('input_key handles VK_F1 function key', () => {
      setByName('input_key', JSON.stringify({ name: 'VK_F1', press: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith(
        expect.objectContaining({ controlKey: 9, press: true }),
      );
    });

    it('input_string sends entire string as a single seq key event', () => {
      setByName('input_string', 'ab');
      expect(mockSession.sendKey).toHaveBeenCalledTimes(1);
      expect(mockSession.sendKey).toHaveBeenCalledWith(
        expect.objectContaining({ seq: 'ab', press: true }),
      );
    });

    it('send_chat sends chat message via sendMisc', () => {
      setByName('send_chat', 'hello');
      expect(mockSession.sendMisc).toHaveBeenCalledWith(
        expect.objectContaining({ misc: { chatMessage: { text: 'hello' } } }),
      );
    });

    it('input_os_password sends entire password as a single seq key event', () => {
      setByName('input_os_password', 'pw');
      expect(mockSession.sendKey).toHaveBeenCalledTimes(1);
      expect(mockSession.sendKey).toHaveBeenCalledWith(
        expect.objectContaining({ seq: 'pw', press: true }),
      );
    });
  });

  // ---- quality / codec / fps (4 keys) ----
  describe('quality and codec', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('image_quality with named value calls sendImageQuality and stores option', () => {
      setByName('image_quality', 'best');
      expect(mockSession.sendImageQuality).toHaveBeenCalled();
      expect(ctx.getSessionOption('image_quality')).toBe('best');
    });

    it('image_quality with numeric value calls sendCustomImageQuality and stores option', () => {
      setByName('image_quality', '50');
      expect(mockSession.sendCustomImageQuality).toHaveBeenCalledWith(50);
      expect(ctx.getSessionOption('image_quality')).toBe('50');
    });

    it('custom-fps calls sendOption with customFps', () => {
      setByName('custom-fps', '30');
      expect(mockSession.sendOption).toHaveBeenCalledWith(
        expect.objectContaining({ customFps: 30 }),
      );
    });

    it('change_prefer_codec reads stored session option when no value passed', () => {
      setByName('option:session', JSON.stringify({ name: 'codec-preference', value: 'vp9' }));
      setByName('change_prefer_codec', '');
      expect(mockSession.sendCodecPreference).toHaveBeenCalled();
    });

    it('change_prefer_codec falls back to explicit value', () => {
      setByName('change_prefer_codec', 'h264');
      expect(mockSession.sendCodecPreference).toHaveBeenCalled();
    });
  });

  // ---- special keys (3 keys) ----
  describe('special keys', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('ctrl_alt_del sends key events', () => {
      setByName('ctrl_alt_del');
      expect(mockSession.sendKey).toHaveBeenCalled();
    });

    it('lock_screen sends key events', () => {
      setByName('lock_screen');
      expect(mockSession.sendKey).toHaveBeenCalled();
    });

    it('restart calls sendRestartRemoteDevice', () => {
      setByName('restart');
      expect(mockSession.sendRestartRemoteDevice).toHaveBeenCalled();
    });
  });

  // ---- elevation (2 keys) ----
  describe('elevation', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('elevate_direct calls sendElevationRequest(true)', () => {
      setByName('elevate_direct');
      expect(mockSession.sendElevationRequest).toHaveBeenCalledWith(true);
    });

    it('elevate_with_logon calls sendElevationWithLogon', () => {
      setByName('elevate_with_logon', JSON.stringify({ username: 'admin', password: 'pw' }));
      expect(mockSession.sendElevationWithLogon).toHaveBeenCalledWith('admin', 'pw');
    });
  });

  // ---- display selection (1 key) ----
  describe('display selection', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('selected_sid calls sendSwitchDisplay', () => {
      setByName('selected_sid', '2');
      expect(mockSession.sendSwitchDisplay).toHaveBeenCalledWith(2);
    });
  });

  // ---- options (4 keys) ----
  describe('options', () => {
    it('option sets a single option', () => {
      setByName('option', JSON.stringify({ name: 'key', value: 'val' }));
      expect(ctx.getOption('key')).toBe('val');
    });

    it('options sets all options', () => {
      setByName('options', JSON.stringify({ a: '1', b: '2' }));
      expect(ctx.getOption('a')).toBe('1');
      expect(ctx.getOption('b')).toBe('2');
    });

    it('option:local sets a local option', () => {
      setByName('option:local', JSON.stringify({ name: 'kb_layout', value: 'us' }));
      expect(ctx.getLocalOption('kb_layout')).toBe('us');
    });

    it('option:toggle toggles a boolean option', () => {
      setByName('option:toggle', 'show-remote-cursor');
      expect(ctx.getToggleOption('show-remote-cursor')).toBe(true);
      setByName('option:toggle', 'show-remote-cursor');
      expect(ctx.getToggleOption('show-remote-cursor')).toBe(false);
    });

    it('option:toggle view-only sends disableKeyboard and disableClipboard', () => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
      setByName('option:toggle', 'view-only');
      expect(mockSession.sendOption).toHaveBeenCalledWith(
        expect.objectContaining({ disableKeyboard: 2, disableClipboard: 2 }),
      );
    });

    it('option:toggle block-input sends blockInput Yes without local update', () => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
      setByName('option:toggle', 'block-input');
      expect(mockSession.sendOption).toHaveBeenCalledWith(
        expect.objectContaining({ blockInput: 2 }),
      );
      expect(ctx.getToggleOption('block-input')).toBe(false);
    });

    it('option:toggle unblock-input sends blockInput No', () => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
      setByName('option:toggle', 'unblock-input');
      expect(mockSession.sendOption).toHaveBeenCalledWith(
        expect.objectContaining({ blockInput: 1 }),
      );
    });

    it('option:toggle enable-file-copy-paste sends enableFileTransfer', () => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
      setByName('option:toggle', 'enable-file-copy-paste');
      expect(mockSession.sendOption).toHaveBeenCalledWith(
        expect.objectContaining({ enableFileTransfer: 2 }),
      );
    });

    it('option:toggle terminal-persistent sends terminalPersistent', () => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
      setByName('option:toggle', 'terminal-persistent');
      expect(mockSession.sendOption).toHaveBeenCalledWith(
        expect.objectContaining({ terminalPersistent: 2 }),
      );
    });

    it('option:toggle privacy-mode does not update local state immediately', () => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
      const before = ctx.getToggleOption('privacy-mode');
      setByName('option:toggle', 'privacy-mode');
      expect(ctx.getToggleOption('privacy-mode')).toBe(before);
      expect(mockSession.sendOption).toHaveBeenCalledWith(
        expect.objectContaining({ privacyMode: 2 }),
      );
    });

    it('option syncs custom-rendezvous-server to ctx.server', () => {
      setByName('option', JSON.stringify({ name: 'custom-rendezvous-server', value: 'my-server.example.com' }));
      expect(ctx.getServer().rendezvousHost).toBe('my-server.example.com');
      expect(getByName('is_using_public_server')).toBe('false');
    });

    it('option syncs relay-server to ctx.server', () => {
      setByName('option', JSON.stringify({ name: 'relay-server', value: 'relay.example.com' }));
      expect(ctx.getServer().relayHost).toBe('relay.example.com');
    });

    it('option syncs api-server to ctx.server and api_server getter returns it', () => {
      setByName('option', JSON.stringify({ name: 'api-server', value: 'https://api.example.com' }));
      expect(ctx.getServer().apiHost).toBe('https://api.example.com');
      expect(getByName('api_server')).toBe('https://api.example.com');
    });

    it('option syncs key to ctx.server', () => {
      setByName('option', JSON.stringify({ name: 'key', value: 'my-key-base64=' }));
      expect(ctx.getServer().key).toBe('my-key-base64=');
    });

    it('option api-server with http:// sets useWss to false', () => {
      setByName('option', JSON.stringify({ name: 'api-server', value: 'http://api.example.com' }));
      expect(ctx.getServer().useWss).toBe(false);
    });

    it('option api-server with https:// sets useWss to true', () => {
      setByName('option', JSON.stringify({ name: 'api-server', value: 'http://api.example.com' }));
      setByName('option', JSON.stringify({ name: 'api-server', value: 'https://api.example.com' }));
      expect(ctx.getServer().useWss).toBe(true);
    });

    it('options (bulk) syncs server keys to ctx.server', () => {
      setByName('options', JSON.stringify({
        'custom-rendezvous-server': 'bulk-server.example.com',
        'relay-server': 'bulk-relay.example.com',
        'api-server': 'https://bulk-api.example.com',
        'key': 'bulk-key=',
      }));
      const s = ctx.getServer();
      expect(s.rendezvousHost).toBe('bulk-server.example.com');
      expect(s.relayHost).toBe('bulk-relay.example.com');
      expect(s.apiHost).toBe('https://bulk-api.example.com');
      expect(s.key).toBe('bulk-key=');
    });

    it('non-server option does not change ctx.server', () => {
      const before = ctx.getServer();
      setByName('option', JSON.stringify({ name: 'theme', value: 'dark' }));
      expect(ctx.getServer()).toEqual(before);
    });
  });

  // ---- favorites (1 key) ----
  it('fav sets favorites', () => {
    setByName('fav', JSON.stringify(['1', '2']));
    expect(ctx.getFav()).toEqual(['1', '2']);
  });

  // ---- peers (1 key) ----
  describe('peers', () => {
    it('remove_peer removes a peer from local cache', () => {
      ctx.setPeers([{ id: '123' }, { id: '456' }]);
      setByName('remove_peer', '123');
      expect(ctx.peerExists('123')).toBe(false);
      expect(ctx.peerExists('456')).toBe(true);
    });
  });

  // ---- address book (4 keys) ----
  describe('address book', () => {
    it('save_ab / clear_ab', () => {
      setByName('save_ab', JSON.stringify({ peers: [] }));
      expect(ctx.getAddressBook()).toEqual({ peers: [] });
      setByName('clear_ab');
      expect(ctx.getAddressBook()).toBe('');
    });

    it('save_group / clear_group', () => {
      setByName('save_group', JSON.stringify({ name: 'g' }));
      expect(ctx.getGroup()).toEqual({ name: 'g' });
      setByName('clear_group');
      expect(ctx.getGroup()).toBe('');
    });

    it('load_ab calls onLoadAbFinished with cached data', () => {
      const cached = JSON.stringify({ access_token: 'tok', ab_entries: [] });
      ctx.setAddressBook(cached);
      const spy = vi.fn();
      (window as unknown as { onLoadAbFinished: (s: string) => void }).onLoadAbFinished = spy;
      setByName('load_ab');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(cached);
    });

    it('load_ab calls onLoadAbFinished with empty string when no cache', () => {
      const spy = vi.fn();
      (window as unknown as { onLoadAbFinished: (s: string) => void }).onLoadAbFinished = spy;
      setByName('load_ab');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('');
    });

    it('load_group calls onLoadGroupFinished with cached data', () => {
      const cached = JSON.stringify({ access_token: 'tok', device_groups: [] });
      ctx.setGroup(cached);
      const spy = vi.fn();
      (window as unknown as { onLoadGroupFinished: (s: string) => void }).onLoadGroupFinished = spy;
      setByName('load_group');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(cached);
    });

    it('load_group calls onLoadGroupFinished with empty string when no cache', () => {
      const spy = vi.fn();
      (window as unknown as { onLoadGroupFinished: (s: string) => void }).onLoadGroupFinished = spy;
      setByName('load_group');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('');
    });

  });

  // ---- audit (1 key) ----
  it('audit_guid sets the audit guid', () => {
    setByName('audit_guid', 'guid-abc');
    expect(ctx.getAuditGuid()).toBe('guid-abc');
  });

  // ---- envvar (1 key) ----
  it('envvar sets an env var', () => {
    setByName('envvar', JSON.stringify({ name: 'FOO', value: 'bar' }));
    expect(ctx.getEnvVar('FOO')).toBe('bar');
  });

  // ---- file transfer (2 keys) ----
  describe('file transfer', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('read_remote_dir calls ftm.readRemoteDir', () => {
      setByName('read_remote_dir', JSON.stringify({ path: '/home', include_hidden: true }));
      expect(mockFtm.readRemoteDir).toHaveBeenCalledWith('/home', true);
    });

    it('cancel_job calls ftm.cancelTransfer', () => {
      setByName('cancel_job', '42');
      expect(mockFtm.cancelTransfer).toHaveBeenCalledWith(42);
    });
  });

  // ---- getByName: identity (3 keys) ----
  describe('getByName identity', () => {
    it('my_id returns a 10-digit id', () => {
      expect(getByName('my_id')).toMatch(/^\d{10}$/);
    });

    it('my_name returns a name', () => {
      expect(getByName('my_name')).toMatch(/^Web-/);
    });

    it('uuid returns a uuid', () => {
      expect(getByName('uuid')).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  // ---- getByName: app metadata (5 keys) ----
  describe('getByName metadata', () => {
    it('version returns semver', () => {
      expect(getByName('version')).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('app-name returns the app name', () => {
      expect(getByName('app-name')).toBe('RustDesk Web');
    });

    it('platform returns "web"', () => {
      expect(getByName('platform')).toBe('web');
    });

    it('remember returns "true" or "false"', () => {
      const r = getByName('remember');
      expect(['true', 'false']).toContain(r);
    });

    it('get_version_number parses a semver string', () => {
      expect(getByName('get_version_number', '1.2.3')).toBe(String((1 << 16) | (2 << 8) | 3));
    });
  });

  // ---- getByName: options (5 keys) ----
  describe('getByName options', () => {
    it('option returns a stored option', () => {
      ctx.setOption('key', 'val');
      expect(getByName('option', 'key')).toBe('val');
    });

    it('options returns JSON of all options', () => {
      ctx.setOption('a', '1');
      expect(JSON.parse(getByName('options'))).toEqual({ a: '1' });
    });

    it('option:local returns a local option', () => {
      ctx.setLocalOption('kb_layout', 'us');
      expect(getByName('option:local', 'kb_layout')).toBe('us');
    });

    it('option:toggle returns "true" or "false"', () => {
      ctx.setToggleOption('x', true);
      expect(getByName('option:toggle', 'x')).toBe('true');
    });

    it('fav returns JSON of favorites', () => {
      ctx.setFav(['1', '2']);
      expect(JSON.parse(getByName('fav'))).toEqual(['1', '2']);
    });
  });

  // ---- getByName: server (2 keys) ----
  describe('getByName server', () => {
    it('api_server returns a URL', () => {
      expect(getByName('api_server')).toMatch(/^https?:\/\//);
    });

    it('api_server defaults to scheme + rendezvousHost', () => {
      const s = ctx.getServer();
      const expected = `${s.useWss ? 'https' : 'http'}://${s.rendezvousHost}`;
      expect(getByName('api_server')).toBe(expected);
    });

    it('api_server returns user-set api-server when set', () => {
      setByName('option', JSON.stringify({ name: 'api-server', value: 'https://custom-api.example.com' }));
      expect(getByName('api_server')).toBe('https://custom-api.example.com');
    });

    it('is_using_public_server returns "true" by default', () => {
      expect(getByName('is_using_public_server')).toBe('true');
    });

    it('is_using_public_server returns "false" after custom server set', () => {
      setByName('option', JSON.stringify({ name: 'custom-rendezvous-server', value: 'custom.example.com' }));
      expect(getByName('is_using_public_server')).toBe('false');
    });
  });

  // ---- getByName: connection / codecs / peers (5 keys) ----
  describe('getByName misc', () => {
    it('get_conn_status returns a status string', () => {
      expect(['disconnected', 'connecting', 'connected']).toContain(getByName('get_conn_status'));
    });

    it('alternative_codecs returns JSON', () => {
      const parsed = JSON.parse(getByName('alternative_codecs'));
      expect(parsed).toHaveProperty('vp9');
      expect(parsed).toHaveProperty('h264');
    });

    it('langs returns a JSON array of [code, name] pairs', () => {
      const parsed = JSON.parse(getByName('langs'));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(10);
      expect(parsed[0]).toEqual(['en', 'English']);
      const codes = parsed.map((p: [string, string]) => p[0]);
      expect(codes).toContain('zh-cn');
      expect(codes).toContain('ja');
      expect(codes).toContain('ko');
    });

    it('peer_exists returns "true" or "false"', () => {
      ctx.setPeers([{ id: '1' }]);
      expect(getByName('peer_exists', '1')).toBe('true');
      expect(getByName('peer_exists', '2')).toBe('false');
    });

    it('peer_has_password returns "true" or "false"', () => {
      ctx.setPeers([{ id: '1', password: 'x' }]);
      expect(getByName('peer_has_password', '1')).toBe('true');
    });

    it('translate returns empty string for empty text', () => {
      expect(getByName('translate', JSON.stringify({ locale: 'en', text: '' }))).toBe('');
    });

    it('translate returns empty string for missing text', () => {
      expect(getByName('translate', JSON.stringify({ locale: 'en' }))).toBe('');
    });

    it('translate returns translated text for non-empty input', () => {
      const result = getByName('translate', JSON.stringify({ locale: 'en', text: 'ID Server' }));
      expect(result).toBe('ID server');
    });

    it('translate falls back to English for unknown locale', () => {
      const result = getByName('translate', JSON.stringify({ locale: 'xx-XX', text: 'ID Server' }));
      expect(result).toBe('ID server');
    });

    it('translate resolves zh-CN locale to zh-cn', () => {
      const result = getByName('translate', JSON.stringify({ locale: 'zh-CN', text: 'ID Server' }));
      expect(result).toBe('ID 服务器');
    });

    it('translate resolves zh-TW locale to zh-tw', () => {
      const result = getByName('translate', JSON.stringify({ locale: 'zh-TW', text: 'ID Server' }));
      expect(result).toBe('ID 伺服器');
    });

    it('translate substitutes placeholders', () => {
      const result = getByName('translate', JSON.stringify({ locale: 'en', text: 'new-version-of-{}-tip' }));
      expect(result).not.toContain('{}');
    });

    it('translate uses stored lang local option over browser locale', () => {
      setByName('option:local', JSON.stringify({ name: 'lang', value: 'zh-cn' }));
      const result = getByName('translate', JSON.stringify({ locale: 'en', text: 'ID Server' }));
      expect(result).toBe('ID 服务器');
    });

    it('translate falls back to payload locale when no lang stored', () => {
      setByName('option:local', JSON.stringify({ name: 'lang', value: '' }));
      const result = getByName('translate', JSON.stringify({ locale: 'en', text: 'ID Server' }));
      expect(result).toBe('ID server');
    });
  });

  // ---- getByName: audit (3 keys) ----
  describe('getByName audit', () => {
    it('audit_guid returns the stored guid', () => {
      ctx.setAuditGuid('g1');
      expect(getByName('audit_guid')).toBe('g1');
    });

    it('last_audit_note returns the stored note', () => {
      ctx.setLastAuditNote('note1');
      expect(getByName('last_audit_note')).toBe('note1');
    });

    it('audit_server returns the server host', () => {
      expect(getByName('audit_server')).toBe('rs-ny.rustdesk.com');
    });
  });

  // ---- stub behavior (unknown keys) ----
  describe('stub behavior', () => {
    it('unknown setByName logs a warning and does not throw', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => setByName('totally_unknown_key', 'x')).not.toThrow();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('unknown getByName logs a warning and returns empty string', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(getByName('totally_unknown_key')).toBe('');
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

  });

  // ---- 2fa (1 key) ----
  describe('2fa and privacy', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('send_2fa calls session.send2fa', () => {
      setByName('send_2fa', JSON.stringify({ code: '123456' }));
      expect(mockSession.send2fa).toHaveBeenCalledWith('123456');
    });

    it('toggle_privacy_mode calls sendPrivacyMode with impl_key', () => {
      setByName('toggle_privacy_mode', JSON.stringify({ on: true, impl_key: 'test-impl' }));
      expect(mockSession.sendPrivacyMode).toHaveBeenCalledWith(true, 'test-impl');
    });

    it('toggle_privacy_mode defaults impl_key to empty string', () => {
      setByName('toggle_privacy_mode', JSON.stringify({ on: false }));
      expect(mockSession.sendPrivacyMode).toHaveBeenCalledWith(false, '');
    });
  });

  // ---- missing handlers from Issue #131 ----
  describe('file transfer handlers (missing)', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('remove_file sends fileAction with removeFile', () => {
      setByName('remove_file', JSON.stringify({ id: 1, path: '/test', file_num: 0, is_remote: true }));
      expect(mockSession.sendFileAction).toHaveBeenCalledWith({
        removeFile: { id: 1, path: '/test', fileNum: 0 },
      });
    });

    it('read_dir_to_remove_recursive sends fileAction with readDir', () => {
      setByName('read_dir_to_remove_recursive', JSON.stringify({ id: 2, path: '/dir', is_remote: true, show_hidden: true }));
      expect(mockSession.sendFileAction).toHaveBeenCalledWith({
        readDir: { id: 2, path: '/dir', includeHidden: true },
      });
    });

    it('remove_all_empty_dirs sends fileAction with removeDir', () => {
      setByName('remove_all_empty_dirs', JSON.stringify({ id: 3, path: '/dir', is_remote: true }));
      expect(mockSession.sendFileAction).toHaveBeenCalledWith({
        removeDir: { id: 3, path: '/dir', recursive: true },
      });
    });

    it('create_dir sends fileAction with create', () => {
      setByName('create_dir', JSON.stringify({ id: 4, path: '/newdir', is_remote: true }));
      expect(mockSession.sendFileAction).toHaveBeenCalledWith({
        create: { id: 4, path: '/newdir' },
      });
    });

    it('rename_file sends fileAction with rename', () => {
      setByName('rename_file', JSON.stringify({ id: 5, path: '/old', new_name: 'new', is_remote: true }));
      expect(mockSession.sendFileAction).toHaveBeenCalledWith({
        rename: { id: 5, path: '/old', newName: 'new' },
      });
    });
  });

  describe('flutter_key_event (missing)', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('sends control key for USB HID code with Translate mode', () => {
      // 0x28 = Enter → Return (27)
      setByName('flutter_key_event', JSON.stringify({ name: '', usb_hid: 0x28, lock_modes: 0, down: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith({
        down: true, controlKey: 27, modifiers: [], mode: 1,
      });
    });

    it('sends character code for single-char name with Translate mode', () => {
      setByName('flutter_key_event', JSON.stringify({ name: 'a', usb_hid: 0x04, lock_modes: 0, down: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith({
        down: true, chr: 97, modifiers: [], mode: 1,
      });
    });

    it('parses lock_modes for CapsLock modifier on letter keys only', () => {
      // lock_modes bit 1 = CapsLock (3), usb_hid 0x04 = 'a' (letter key)
      setByName('flutter_key_event', JSON.stringify({ name: 'a', usb_hid: 0x04, lock_modes: 2, down: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith({
        down: true, chr: 97, modifiers: [3], mode: 1,
      });
    });

    it('does not add CapsLock for non-letter keys', () => {
      // 0x28 = Enter, not a letter key — CapsLock should not be added
      setByName('flutter_key_event', JSON.stringify({ name: '', usb_hid: 0x28, lock_modes: 2, down: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith({
        down: true, controlKey: 27, modifiers: [], mode: 1,
      });
    });

    it('parses lock_modes for NumLock on numpad keys only', () => {
      // lock_modes bit 2 = NumLock (63), usb_hid 0x59 = Numpad 1
      setByName('flutter_key_event', JSON.stringify({ name: '', usb_hid: 0x59, lock_modes: 4, down: 'true' }));
      expect(mockSession.sendKey).toHaveBeenCalledWith({
        down: true, controlKey: 34, modifiers: [63], mode: 1,
      });
    });

    it('tracks modifier state from Ctrl key press', () => {
      // Press Left Ctrl (0xE0)
      setByName('flutter_key_event', JSON.stringify({ name: '', usb_hid: 0xE0, lock_modes: 0, down: 'true' }));
      // Press 'a' — should include Ctrl modifier (4)
      setByName('flutter_key_event', JSON.stringify({ name: 'a', usb_hid: 0x04, lock_modes: 0, down: 'true' }));
      const lastCall = mockSession.sendKey.mock.calls[mockSession.sendKey.mock.calls.length - 1][0];
      expect(lastCall.modifiers).toContain(4);
      expect(lastCall.mode).toBe(1);
    });
  });

  describe('display handlers (missing)', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('change_resolution sends misc message', () => {
      setByName('change_resolution', JSON.stringify({ display: 0, width: 1920, height: 1080 }));
      expect(mockSession.sendMisc).toHaveBeenCalledTimes(1);
      const msg = mockSession.sendMisc.mock.calls[0][0];
      expect(msg.misc.change_display_resolution).toEqual({
        display: 0, resolution: { width: 1920, height: 1080 },
      });
    });

    it('toggle_virtual_display sends misc message', () => {
      setByName('toggle_virtual_display', JSON.stringify({ index: 1, on: true }));
      expect(mockSession.sendMisc).toHaveBeenCalledTimes(1);
      const msg = mockSession.sendMisc.mock.calls[0][0];
      expect(msg.misc.toggle_virtual_display).toEqual({ display: 1, on: true });
    });
  });

  describe('option handlers (missing)', () => {
    it('option:peer set stores peer option', () => {
      setByName('option:peer', JSON.stringify({ id: '123', name: 'alias', value: 'my-pc' }));
      expect(ctx.getPeerOption('123', 'alias')).toBe('my-pc');
    });

    it('option:peer get retrieves peer option', () => {
      ctx.setPeerOption('456', 'info', 'test-info');
      expect(getByName('option:peer', JSON.stringify({ id: '456', name: 'info' }))).toBe('test-info');
    });

    it('option:user:default set stores user default option', () => {
      setByName('option:user:default', JSON.stringify({ name: 'theme', value: 'dark' }));
      expect(ctx.getUserDefaultOption('theme')).toBe('dark');
    });

    it('common set stores common option', () => {
      setByName('common', JSON.stringify({ name: 'key', value: 'val' }));
      expect(ctx.getCommon('key')).toBe('val');
    });
  });

  describe('terminal handlers (missing)', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('open_terminal sends terminalAction with open', () => {
      setByName('open_terminal', JSON.stringify({ terminal_id: 0, rows: 24, cols: 80 }));
      expect(mockSession.sendTerminalAction).toHaveBeenCalledWith({
        open: { terminalId: 0, rows: 24, cols: 80 },
      });
    });

    it('send_terminal_input sends terminalAction with data', () => {
      setByName('send_terminal_input', JSON.stringify({ terminal_id: 0, data: 'ls -la' }));
      expect(mockSession.sendTerminalAction).toHaveBeenCalledTimes(1);
      const action = mockSession.sendTerminalAction.mock.calls[0][0];
      expect(action.data.terminalId).toBe(0);
      expect(new TextDecoder().decode(action.data.data)).toBe('ls -la');
    });

    it('resize_terminal sends terminalAction with resize', () => {
      setByName('resize_terminal', JSON.stringify({ terminal_id: 0, rows: 30, cols: 100 }));
      expect(mockSession.sendTerminalAction).toHaveBeenCalledWith({
        resize: { terminalId: 0, rows: 30, cols: 100 },
      });
    });

    it('close_terminal sends terminalAction with close', () => {
      setByName('close_terminal', JSON.stringify({ terminal_id: 0 }));
      expect(mockSession.sendTerminalAction).toHaveBeenCalledWith({
        close: { terminalId: 0 },
      });
    });
  });

  describe('account_auth (missing)', () => {
    it('account_auth calls onAccountAuth callback', () => {
      const spy = vi.fn();
      (window as unknown as { onAccountAuth: (op: string, remember: boolean) => void }).onAccountAuth = spy;
      setByName('account_auth', JSON.stringify({ op: 'login', remember: true }));
      expect(spy).toHaveBeenCalledWith('login', true);
      expect(ctx.getRemember()).toBe(true);
    });

    it('account_auth_cancel calls onAccountAuthCancel callback', () => {
      const spy = vi.fn();
      (window as unknown as { onAccountAuthCancel: () => void }).onAccountAuthCancel = spy;
      setByName('account_auth_cancel');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ---- stub handlers from Issue #131 ----
  describe('refresh (stub fixed)', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('refresh calls sendRefresh', () => {
      setByName('refresh');
      expect(mockSession.sendRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconnect@connect (stub fixed)', () => {
    it('reconnect re-creates session and calls connect', () => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
      setByName('reconnect');
      expect(mockSession.connect).toHaveBeenCalledTimes(1);
      expect(ctx.getConnStatus()).toBe('connecting');
    });
  });

  describe('send_files (stub fixed)', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('download (is_remote=true) sends FileAction.send', () => {
      setByName('send_files', JSON.stringify({ id: 1, path: '/remote', to: '/local', file_num: 0, is_remote: true }));
      expect(mockSession.sendFileAction).toHaveBeenCalledWith({
        send: { id: 1, path: '/remote', includeHidden: false, fileNum: 0 },
      });
    });

    it('upload (is_remote=false) sends FileAction.receive', () => {
      setByName('send_files', JSON.stringify({ id: 2, path: '/local', to: '/remote', file_num: 0, is_remote: false }));
      expect(mockSession.sendFileAction).toHaveBeenCalledWith({
        receive: { id: 2, path: '/remote', fileNum: 0 },
      });
    });
  });

  describe('confirm_override_file (stub fixed)', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('need_override=true sends sendConfirm with offsetBlk=0', () => {
      setByName('confirm_override_file', JSON.stringify({ id: 1, file_num: 0, need_override: true, remember: false, is_upload: false }));
      expect(mockSession.sendFileAction).toHaveBeenCalledWith({
        sendConfirm: { id: 1, fileNum: 0, offsetBlk: 0 },
      });
    });

    it('need_override=false sends sendConfirm with skip=true', () => {
      setByName('confirm_override_file', JSON.stringify({ id: 2, file_num: 1, need_override: false, remember: false, is_upload: false }));
      expect(mockSession.sendFileAction).toHaveBeenCalledWith({
        sendConfirm: { id: 2, fileNum: 1, skip: true },
      });
    });

    it('is_upload=true does not send to peer', () => {
      setByName('confirm_override_file', JSON.stringify({ id: 3, file_num: 0, need_override: true, remember: false, is_upload: true }));
      expect(mockSession.sendFileAction).not.toHaveBeenCalled();
    });
  });

  describe('send_note (stub fixed)', () => {
    it('send_note stores last audit note', () => {
      setByName('send_note', 'my audit note');
      expect(ctx.getLastAuditNote()).toBe('my audit note');
    });
  });

  describe('login (stub fixed)', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('login with password calls sendLoginWithPassword', () => {
      setByName('login', JSON.stringify({ password: 'secret', remember: true }));
      expect(mockSession.sendLoginWithPassword).toHaveBeenCalledWith('secret', undefined, undefined);
      expect(ctx.getRemember()).toBe(true);
    });

    it('login with os credentials passes them through', () => {
      setByName('login', JSON.stringify({ os_username: 'admin', os_password: 'pw', password: 'secret' }));
      expect(mockSession.sendLoginWithPassword).toHaveBeenCalledWith('secret', 'admin', 'pw');
    });
  });

  describe('conn_session_id (stub fixed)', () => {
    it('returns session connSessionId when session exists', () => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      expect(getByName('conn_session_id')).toBe('test-session-id');
    });

    it('returns empty string when no session', () => {
      expect(getByName('conn_session_id')).toBe('');
    });
  });

  describe('query_onlines', () => {
    it('accepts peer ID array without throwing', () => {
      const spy = vi.fn();
      (window as unknown as { onGlobalEvent: (name: string, data: unknown) => void }).onGlobalEvent = spy;
      expect(() => setByName('query_onlines', JSON.stringify(['id1', 'id2']))).not.toThrow();
    });

    it('handles empty array gracefully', () => {
      expect(() => setByName('query_onlines', JSON.stringify([]))).not.toThrow();
    });

    it('handles invalid JSON gracefully', () => {
      expect(() => setByName('query_onlines', 'not-json')).not.toThrow();
    });
  });
});
