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

    it('send_mouse calls session.sendMouse with parsed payload', () => {
      setByName('send_mouse', JSON.stringify({ mask: 1, x: 100, y: 200 }));
      expect(mockSession.sendMouse).toHaveBeenCalledWith(
        expect.objectContaining({ mask: 1, x: 100, y: 200 }),
      );
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

    it('input_string sends each character as a key press', () => {
      setByName('input_string', 'ab');
      expect(mockSession.sendKey).toHaveBeenCalledTimes(2);
    });

    it('send_chat sends clipboard content', () => {
      setByName('send_chat', 'hello');
      expect(mockSession.sendClipboard).toHaveBeenCalledTimes(1);
    });

    it('input_os_password sends characters as key presses', () => {
      setByName('input_os_password', 'pw');
      expect(mockSession.sendKey).toHaveBeenCalledTimes(2);
    });
  });

  // ---- quality / codec / fps (4 keys) ----
  describe('quality and codec', () => {
    beforeEach(() => {
      setByName('session_add_sync', JSON.stringify({ id: '1' }));
      clearMockCalls();
    });

    it('image_quality with named value calls sendImageQuality', () => {
      setByName('image_quality', 'best');
      expect(mockSession.sendImageQuality).toHaveBeenCalled();
    });

    it('image_quality with numeric value calls sendCustomImageQuality', () => {
      setByName('image_quality', '50');
      expect(mockSession.sendCustomImageQuality).toHaveBeenCalledWith(50);
    });

    it('custom-fps calls sendOption with customFps', () => {
      setByName('custom-fps', '30');
      expect(mockSession.sendOption).toHaveBeenCalledWith(
        expect.objectContaining({ customFps: 30 }),
      );
    });

    it('change_prefer_codec calls sendCodecPreference', () => {
      setByName('change_prefer_codec', 'vp9');
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

    it('is_using_public_server returns "true" by default', () => {
      expect(getByName('is_using_public_server')).toBe('true');
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

    it('langs returns a JSON array', () => {
      const parsed = JSON.parse(getByName('langs'));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toContain('en');
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

    it('toggle_privacy_mode calls sendPrivacyMode', () => {
      setByName('toggle_privacy_mode', JSON.stringify({ on: true }));
      expect(mockSession.sendPrivacyMode).toHaveBeenCalledWith(true);
    });
  });
});
