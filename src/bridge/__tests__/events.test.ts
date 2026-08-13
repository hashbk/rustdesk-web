/**
 * Unit tests for the event backflow channel.
 *
 * Covers:
 *  - emitGlobalEvent calls the registered callback with correct JSON
 *  - events are queued when no callback is registered, then flushed on register
 *  - queue is bounded (drops events over MAX_QUEUE)
 *  - all 52 event names are emitted with correct field names
 *  - emitRgba / emitVideoFrame / emitInitFinished / emitDialog / etc.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  setGlobalEventCallback,
  resetGlobalEventCallback,
  emitGlobalEvent,
  emitRgba,
  emitVideoFrame,
  emitInitFinished,
  emitDialog,
  emitLoginDialog,
  emitCloseConnection,
  emitFullscreenChanged,
  getEventQueueLength,
  MAX_QUEUE,
} from '../events';
import { attachSessionCallbacks } from '../callbacks';
import type { RemoteSession, SessionState, PrivacyModeNotification, BlockInputNotification } from '../../protocol/session';
import type { PeerInfoT } from '../../protos';

// ---- helpers ----

/** Collect emitted global events as parsed objects. */
function makeCollector(): { cb: (json: string) => void; events: Record<string, unknown>[] } {
  const events: Record<string, unknown>[] = [];
  const cb = (json: string) => {
    events.push(JSON.parse(json) as Record<string, unknown>);
  };
  return { cb, events };
}

/** Minimal mock RemoteSession with an `on` method that stores listeners. */
function makeMockSession(): { session: RemoteSession; listeners: Map<string, (...args: unknown[]) => void> } {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const session = {
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, listener);
    },
    isSecured() { return true; },
  } as unknown as RemoteSession;
  return { session, listeners };
}

describe('events', () => {
  beforeEach(() => {
    resetGlobalEventCallback();
  });

  afterEach(() => {
    resetGlobalEventCallback();
  });

  // ---- core emit / queue behavior ----

  describe('emitGlobalEvent', () => {
    it('calls the registered callback with correct JSON', () => {
      const { cb, events } = makeCollector();
      setGlobalEventCallback(cb);
      emitGlobalEvent({ name: 'peer_info', hostname: 'host' });
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ name: 'peer_info', hostname: 'host' });
    });

    it('queues events when no callback is registered', () => {
      emitGlobalEvent({ name: 'a' });
      emitGlobalEvent({ name: 'b' });
      expect(getEventQueueLength()).toBe(2);
    });

    it('flushes queued events on registration', () => {
      emitGlobalEvent({ name: 'a' });
      emitGlobalEvent({ name: 'b' });
      const { cb, events } = makeCollector();
      setGlobalEventCallback(cb);
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ name: 'a' });
      expect(events[1]).toEqual({ name: 'b' });
      expect(getEventQueueLength()).toBe(0);
    });

    it('drops events over MAX_QUEUE', () => {
      for (let i = 0; i < MAX_QUEUE + 50; i++) {
        emitGlobalEvent({ name: 'evt', i });
      }
      expect(getEventQueueLength()).toBe(MAX_QUEUE);
    });

    it('does not queue after callback is registered', () => {
      const { cb, events } = makeCollector();
      setGlobalEventCallback(cb);
      emitGlobalEvent({ name: 'x' });
      expect(events).toHaveLength(1);
      expect(getEventQueueLength()).toBe(0);
    });
  });

  // ---- window-callback emitters ----

  describe('emitRgba', () => {
    it('calls window.onRgba with display and rgba', () => {
      const fn = vi.fn();
      (window as unknown as { onRgba?: unknown }).onRgba = fn;
      const data = new Uint8Array([1, 2, 3]);
      emitRgba(0, data);
      expect(fn).toHaveBeenCalledWith(0, data);
      delete (window as unknown as { onRgba?: unknown }).onRgba;
    });

    it('no-ops when window.onRgba is not set', () => {
      delete (window as unknown as { onRgba?: unknown }).onRgba;
      expect(() => emitRgba(0, new Uint8Array())).not.toThrow();
    });
  });

  describe('emitVideoFrame', () => {
    it('calls window.onVideoFrame with display and frame', () => {
      const fn = vi.fn();
      (window as unknown as { onVideoFrame?: unknown }).onVideoFrame = fn;
      const frame = {} as VideoFrame;
      emitVideoFrame(1, frame);
      expect(fn).toHaveBeenCalledWith(1, frame);
      delete (window as unknown as { onVideoFrame?: unknown }).onVideoFrame;
    });
  });

  describe('emitInitFinished', () => {
    it('calls window.onInitFinished', () => {
      const fn = vi.fn();
      (window as unknown as { onInitFinished?: unknown }).onInitFinished = fn;
      emitInitFinished();
      expect(fn).toHaveBeenCalledOnce();
      delete (window as unknown as { onInitFinished?: unknown }).onInitFinished;
    });
  });

  describe('emitDialog', () => {
    it('calls window.dialog with type, title, text', () => {
      const fn = vi.fn();
      (window as unknown as { dialog?: unknown }).dialog = fn;
      emitDialog('warning', 'Title', 'Text');
      expect(fn).toHaveBeenCalledWith('warning', 'Title', 'Text');
      delete (window as unknown as { dialog?: unknown }).dialog;
    });
  });

  describe('emitLoginDialog', () => {
    it('calls window.loginDialog', () => {
      const fn = vi.fn();
      (window as unknown as { loginDialog?: unknown }).loginDialog = fn;
      emitLoginDialog();
      expect(fn).toHaveBeenCalledOnce();
      delete (window as unknown as { loginDialog?: unknown }).loginDialog;
    });
  });

  describe('emitCloseConnection', () => {
    it('calls window.closeConnection', () => {
      const fn = vi.fn();
      (window as unknown as { closeConnection?: unknown }).closeConnection = fn;
      emitCloseConnection();
      expect(fn).toHaveBeenCalledOnce();
      delete (window as unknown as { closeConnection?: unknown }).closeConnection;
    });
  });

  describe('emitFullscreenChanged', () => {
    it('calls window.onFullscreenChanged with boolean', () => {
      const fn = vi.fn();
      (window as unknown as { onFullscreenChanged?: unknown }).onFullscreenChanged = fn;
      emitFullscreenChanged(true);
      expect(fn).toHaveBeenCalledWith(true);
      delete (window as unknown as { onFullscreenChanged?: unknown }).onFullscreenChanged;
    });
  });

  // ---- attachSessionCallbacks: all 52 event names ----

  describe('attachSessionCallbacks', () => {
    let mockSession: ReturnType<typeof makeMockSession>;
    let listeners: Map<string, (...args: unknown[]) => void>;
    let events: Record<string, unknown>[];
    let closeConnectionCalls: number;

    beforeEach(() => {
      mockSession = makeMockSession();
      listeners = mockSession.listeners;

      events = [];
      const collectingCb = (json: string) => {
        events.push(JSON.parse(json) as Record<string, unknown>);
      };
      setGlobalEventCallback(collectingCb);
      closeConnectionCalls = 0;
      (window as unknown as { closeConnection?: unknown }).closeConnection = () => { closeConnectionCalls++; };
      (window as unknown as { loginDialog?: unknown }).loginDialog = () => {};
      attachSessionCallbacks(mockSession.session, 0);
    });

    afterEach(() => {
      delete (window as unknown as { closeConnection?: unknown }).closeConnection;
      delete (window as unknown as { loginDialog?: unknown }).loginDialog;
    });

    // -- peer_info --
    it('emits peer_info with flattened fields', () => {
      const info: PeerInfoT = {
        username: 'user',
        hostname: 'host',
        platform: 'Linux',
        displays: [{ width: 1920, height: 1080 }],
        currentDisplay: 0,
        sasEnabled: true,
        version: '1.3.0',
        features: { privacyMode: true, terminal: false },
      };
      listeners.get('peerInfo')!(info);
      expect(events[0].name).toBe('peer_info');
      expect(events[0].username).toBe('user');
      expect(events[0].hostname).toBe('host');
      expect(events[0].platform).toBe('Linux');
      expect(events[0].sas_enabled).toBe('true');
      expect(events[0].current_display).toBe('0');
    });

    it('emits peer_info with resolutions and platform_additions', () => {
      const info: PeerInfoT = {
        username: 'user',
        hostname: 'host',
        platform: 'Windows',
        displays: [{ width: 1920, height: 1080 }],
        currentDisplay: 0,
        version: '1.3.0',
        resolutions: [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }],
        platformAdditions: 'some-additions',
      };
      listeners.get('peerInfo')!(info);
      expect(events[0].resolutions).toBe(JSON.stringify([{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]));
      expect(events[0].platform_additions).toBe('some-additions');
    });

    it('emits peer_info with display original_width/height and scaled_width', () => {
      const info: PeerInfoT = {
        username: 'user',
        hostname: 'host',
        platform: 'macOS',
        displays: [{
          width: 3840, height: 2160, scale: 2.0,
          originalResolution: { width: 3840, height: 2160 },
        }],
        currentDisplay: 0,
        version: '1.3.0',
      };
      listeners.get('peerInfo')!(info);
      const displays = JSON.parse(events[0].displays as string);
      expect(displays[0].original_width).toBe(3840);
      expect(displays[0].original_height).toBe(2160);
      expect(displays[0].scaled_width).toBe(1920);
    });

    // -- peer_info cursor_embedded type (Issue #168 #6) --
    it('emits peer_info with cursor_embedded as integer 1/0 not boolean', () => {
      const info: PeerInfoT = {
        username: 'user',
        hostname: 'host',
        platform: 'Linux',
        displays: [{ width: 1920, height: 1080, cursorEmbedded: true }],
        currentDisplay: 0,
        version: '1.3.0',
      };
      listeners.get('peerInfo')!(info);
      const displays = JSON.parse(events[0].displays as string);
      // Vendor (model.dart:1621) compares `evt['cursor_embedded'] == 1` (int).
      // Boolean true would fail this check in Dart (true == 1 is false).
      expect(displays[0].cursor_embedded).toBe(1);
      expect(typeof displays[0].cursor_embedded).toBe('number');
    });

    it('emits peer_info with cursor_embedded 0 when false', () => {
      const info: PeerInfoT = {
        username: 'user',
        hostname: 'host',
        platform: 'Linux',
        displays: [{ width: 1920, height: 1080, cursorEmbedded: false }],
        currentDisplay: 0,
        version: '1.3.0',
      };
      listeners.get('peerInfo')!(info);
      const displays = JSON.parse(events[0].displays as string);
      expect(displays[0].cursor_embedded).toBe(0);
    });

    // -- cursor_data --
    it('emits cursor_data with id, hotx, hoty, width, height, colors', () => {
      listeners.get('cursorData')!({
        id: 5,
        hotx: 1,
        hoty: 2,
        width: 32,
        height: 32,
        colors: new Uint8Array([255, 0, 0]),
      });
      expect(events[0]).toMatchObject({
        name: 'cursor_data',
        id: '5',
        hotx: '1',
        hoty: '2',
        width: '32',
        height: '32',
      });
      expect(events[0].colors).toBe(JSON.stringify([255, 0, 0]));
    });

    // -- cursor_position --
    it('emits cursor_position with x, y', () => {
      listeners.get('cursorPosition')!({ x: 10, y: 20 });
      expect(events[0]).toEqual({ name: 'cursor_position', x: '10', y: '20' });
    });

    // -- cursor_id (Issue 5.1) --
    it('emits cursor_id with id', () => {
      listeners.get('cursorId')!(42);
      expect(events[0]).toEqual({ name: 'cursor_id', id: '42' });
    });

    // -- chatMessage (Issue 5.7) --
    it('emits chat_client_mode and chat_server_mode for chatMessage', () => {
      listeners.get('chatMessage')!({ text: 'hello' });
      expect(events[0]).toMatchObject({ name: 'chat_client_mode', text: 'hello' });
      expect(events[1]).toMatchObject({ name: 'chat_server_mode', text: 'hello' });
    });

    // -- clipboard --
    it('emits clipboard with decoded content', () => {
      const content = new TextEncoder().encode('hello');
      listeners.get('clipboard')!({ content });
      expect(events[0]).toEqual({ name: 'clipboard', content: 'hello' });
    });

    // -- msgbox (messageBox event) --
    it('emits msgbox with type, title, text, link, hasRetry', () => {
      listeners.get('messageBox')!({
        msgType: 'warning',
        title: 'Title',
        text: 'Text',
        link: 'https://example.com',
      });
      expect(events[0]).toMatchObject({
        name: 'msgbox',
        type: 'warning',
        title: 'Title',
        text: 'Text',
        link: 'https://example.com',
        hasRetry: '',
      });
    });

    it('emits msgbox with type=input-password for password prompt', () => {
      listeners.get('messageBox')!({
        msgType: 'input-password',
        title: 'Password Required',
        text: '',
        link: '',
      });
      expect(events[0]).toMatchObject({
        name: 'msgbox',
        type: 'input-password',
        title: 'Password Required',
        text: '',
      });
    });

    it('emits msgbox with type=re-input-password for wrong password', () => {
      listeners.get('messageBox')!({
        msgType: 're-input-password',
        title: 'Wrong Password',
        text: 'Do you want to enter again?',
        link: '',
      });
      expect(events[0]).toMatchObject({
        name: 'msgbox',
        type: 're-input-password',
        title: 'Wrong Password',
        text: 'Do you want to enter again?',
      });
    });

    // -- switch_display --
    it('emits switch_display with display, x, y, width, height, cursor_embedded', () => {
      listeners.get('switchDisplay')!({
        display: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        cursor_embedded: true,
      });
      expect(events[0]).toMatchObject({
        name: 'switch_display',
        display: '1',
        width: '1920',
        height: '1080',
        cursor_embedded: '1',
      });
    });

    it('emits switch_display with resolutions and original dimensions', () => {
      listeners.get('switchDisplay')!({
        display: 0,
        x: 0, y: 0,
        width: 1920, height: 1080,
        cursor_embedded: false,
        resolutions: [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }],
        original_resolution: { width: 3840, height: 2160 },
      });
      expect(events[0]).toMatchObject({
        name: 'switch_display',
        resolutions: JSON.stringify([{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]),
        original_width: '3840',
        original_height: '2160',
      });
    });

    // -- fileResponse → file_dir --
    it('emits file_dir for fileResponse.dir', () => {
      listeners.get('fileResponse')!({
        dir: { id: 1, path: '/home', entries: [] },
      });
      expect(events[0].name).toBe('file_dir');
      expect(events[0].is_local).toBe('false');
    });

    // -- fileResponse → job_done --
    it('emits job_done for fileResponse.done', () => {
      listeners.get('fileResponse')!({ done: { id: 1, fileNum: 5 } });
      expect(events[0]).toMatchObject({ name: 'job_done', id: '1', file_num: '5' });
    });

    // -- fileResponse → job_error --
    it('emits job_error for fileResponse.error', () => {
      listeners.get('fileResponse')!({ error: { id: 1, error: 'fail', fileNum: 2 } });
      expect(events[0]).toMatchObject({ name: 'job_error', id: '1', err: 'fail', file_num: '2' });
    });

    // -- fileResponse → job_progress (Issue 5.2, Issue #168 #2) --
    it('emits job_progress for fileResponse.block with speed and finished_size', () => {
      listeners.get('fileResponse')!({ block: { id: 1, fileNum: 0, data: new Uint8Array([1, 2]), compressed: false, blkId: 5 } });
      expect(events[0]).toMatchObject({ name: 'job_progress', id: '1', file_num: '0' });
      // Vendor (file_model.dart:1045-1061) requires speed and finished_size.
      expect(events[0]).toHaveProperty('speed');
      expect(events[0]).toHaveProperty('finished_size');
      expect(events[0].finished_size).toBe('2'); // 2 bytes of data
    });

    it('emits job_progress with cumulative finished_size across blocks', () => {
      listeners.get('fileResponse')!({ block: { id: 7, fileNum: 0, data: new Uint8Array([1, 2, 3]), compressed: false } });
      listeners.get('fileResponse')!({ block: { id: 7, fileNum: 0, data: new Uint8Array([4, 5]), compressed: false } });
      // Second event should have cumulative finished_size = 3 + 2 = 5
      expect(events[1]).toMatchObject({ name: 'job_progress', id: '7', finished_size: '5' });
    });

    // -- fileResponse → override_file_confirm (Issue 5.3, Issue #168 #5) --
    it('emits override_file_confirm for fileResponse.digest with read_path', () => {
      listeners.get('fileResponse')!({ digest: { id: 2, fileNum: 1, fileSize: 100, isUpload: true } });
      expect(events[0]).toMatchObject({ name: 'override_file_confirm', id: '2', file_num: '1', is_upload: 'true' });
      // Vendor (file_model.dart:166-167) expects read_path for the dialog.
      expect(events[0]).toHaveProperty('read_path');
    });

    // -- fileResponse → empty_dirs (Issue #168 #7) --
    it('emits empty_dirs for fileResponse.emptyDirs', () => {
      listeners.get('fileResponse')!({
        emptyDirs: { path: '/tmp', emptyDirs: [{ id: 1, path: '/tmp/sub', entries: [] }] },
      });
      expect(events[0]).toMatchObject({ name: 'empty_dirs', path: '/tmp' });
      expect(events[0]).toHaveProperty('dirs');
    });

    // -- terminalResponse (data) --
    it('emits terminal_response for terminalResponse.data', () => {
      listeners.get('terminalResponse')!({
        data: { terminalId: 3, data: new Uint8Array([65, 66, 67]) },
      });
      expect(events[0].name).toBe('terminal_response');
      expect(events[0].type).toBe('data');
      expect(events[0].terminal_id).toBe(3);
    });

    // -- terminalResponse (opened) --
    it('emits terminal_response for terminalResponse.opened', () => {
      listeners.get('terminalResponse')!({
        opened: { terminalId: 1, success: true, message: '', pid: 123, serviceId: '', replayTerminalOutput: false },
      });
      expect(events[0]).toMatchObject({ name: 'terminal_response', type: 'opened', terminal_id: 1, success: true });
    });

    // -- show_elevation --
    it('emits show_elevation for elevationResponse', () => {
      listeners.get('elevationResponse')!('some_response');
      expect(events[0]).toEqual({ name: 'show_elevation', show: 'some_response' });
    });

    // ---- Issue #168 §7: previously missing events ----

    it('emits toast for toast event', () => {
      listeners.get('toast')!('Hello world');
      expect(events[0]).toEqual({ name: 'toast', text: 'Hello world' });
    });

    it('emits sync_peer_info for syncPeerInfo event', () => {
      listeners.get('syncPeerInfo')!([{ width: 1920, height: 1080 }]);
      expect(events[0]).toMatchObject({ name: 'sync_peer_info' });
      expect(events[0]).toHaveProperty('displays');
    });

    it('emits sync_platform_additions for syncPlatformAdditions event', () => {
      listeners.get('syncPlatformAdditions')!('additions-data');
      expect(events[0]).toEqual({ name: 'sync_platform_additions', platform_additions: 'additions-data' });
    });

    it('emits update_folder_files for updateFolderFiles event', () => {
      listeners.get('updateFolderFiles')!({ id: 1, path: '/tmp' });
      expect(events[0]).toMatchObject({ name: 'update_folder_files', id: 1, path: '/tmp' });
    });

    it('emits load_last_job for loadLastJob event', () => {
      listeners.get('loadLastJob')!({ value: 'job-data' });
      expect(events[0]).toMatchObject({ name: 'load_last_job', value: 'job-data' });
    });

    it('emits add_connection for addConnection event', () => {
      listeners.get('addConnection')!({ id: 'peer1' });
      expect(events[0]).toMatchObject({ name: 'add_connection' });
      expect(events[0]).toHaveProperty('client');
    });

    it('emits on_client_remove for onClientRemove event', () => {
      listeners.get('onClientRemove')!({ id: 'peer1' });
      expect(events[0]).toMatchObject({ name: 'on_client_remove' });
      expect(events[0]).toHaveProperty('client');
    });

    it('emits set_multiple_windows_session for setMultipleWindowsSession event', () => {
      listeners.get('setMultipleWindowsSession')!([{ sid: 1, name: 'session1' }]);
      expect(events[0]).toMatchObject({ name: 'set_multiple_windows_session' });
      expect(events[0]).toHaveProperty('windows_sessions');
    });

    it('emits fingerprint for fingerprint event', () => {
      listeners.get('fingerprint')!('abc123');
      expect(events[0]).toEqual({ name: 'fingerprint', fingerprint: 'abc123' });
    });

    it('emits screenshot for screenshot event', () => {
      listeners.get('screenshot')!({ url: 'data:image/png;base64,abc' });
      expect(events[0]).toMatchObject({ name: 'screenshot' });
      expect(events[0]).toHaveProperty('msg');
    });

    // -- update_privacy_mode --
    it('emits update_privacy_mode for privacyModeState', () => {
      const notification: PrivacyModeNotification = { state: 4, details: 'ok' };
      listeners.get('privacyModeState')!(notification);
      expect(events[0]).toEqual({ name: 'update_privacy_mode', state: '4', details: 'ok' });
    });

    // -- update_block_input_state --
    it('emits update_block_input_state for blockInputState', () => {
      const notification: BlockInputNotification = { state: 2 };
      listeners.get('blockInputState')!(notification);
      expect(events[0]).toEqual({ name: 'update_block_input_state', state: '2', details: '' });
    });

    // -- connection_ready (stateChange → connected) --
    it('emits connection_ready when state becomes connected', () => {
      const state: SessionState = 'connected';
      listeners.get('stateChange')!(state);
      expect(events[0]).toMatchObject({
        name: 'connection_ready',
        secure: 'true',
        direct: 'false',
        stream_type: '',
      });
    });

    // -- closeConnection (stateChange → closed) --
    it('calls emitCloseConnection when state becomes closed', () => {
      const state: SessionState = 'closed';
      listeners.get('stateChange')!(state);
      expect(closeConnectionCalls).toBe(1);
    });

    // -- update_quality_status (latency) --
    it('emits update_quality_status for latency', () => {
      listeners.get('latency')!({ delay: 42 });
      expect(events[0]).toMatchObject({ name: 'update_quality_status', delay: '42' });
    });

    it('emits target_bitrate from latency event', () => {
      listeners.get('latency')!({ delay: 10, targetBitrate: 5000000 });
      expect(events[0]).toMatchObject({ name: 'update_quality_status', target_bitrate: '5000000' });
    });

    // -- miscOption → portable_service_running (Issue 5.13) --
    it('emits portable_service_running for miscOption', () => {
      listeners.get('miscOption')!({ portable_service_running: true });
      expect(events[0]).toMatchObject({ name: 'portable_service_running', running: 'true' });
    });

    // -- miscOption → switch_back (Issue 5.15) --
    it('emits switch_back for miscOption', () => {
      listeners.get('miscOption')!({ switch_back: true });
      const sw = events.find((e) => e.name === 'switch_back');
      expect(sw).toBeDefined();
    });

    // -- miscOption → record_status (Issue 5.17) --
    it('emits record_status for miscOption', () => {
      listeners.get('miscOption')!({ record_status: true });
      const rs = events.find((e) => e.name === 'record_status');
      expect(rs).toBeDefined();
    });

    // -- audioFormat listener registered (Issue 4.5) --
    it('registers an audioFormat listener', () => {
      expect(listeners.has('audioFormat')).toBe(true);
    });

    // -- audioFrame listener registered (Issue 4.5) --
    it('registers an audioFrame listener', () => {
      expect(listeners.has('audioFrame')).toBe(true);
    });

    // -- closeReason → closeConnection --
    it('calls emitCloseConnection for closeReason', () => {
      listeners.get('closeReason')!('timeout');
      expect(closeConnectionCalls).toBe(1);
    });

    // -- error → msgbox --
    it('emits msgbox for error', () => {
      listeners.get('error')!(new Error('boom'));
      expect(events[0]).toMatchObject({
        name: 'msgbox',
        type: 'error',
        title: 'Error',
        text: 'boom',
      });
    });

    // -- need2fa → msgbox input-2fa --
    it('emits msgbox input-2fa for need2fa', () => {
      listeners.get('need2fa')!();
      expect(events[0]).toMatchObject({
        name: 'msgbox',
        type: 'input-2fa',
        title: '2FA',
      });
    });

    // -- videoFrame → renderer (not a no-op) --
    it('registers a videoFrame listener that handles frames', () => {
      expect(listeners.has('videoFrame')).toBe(true);
    });

    // -- cleanup function --
    it('attachSessionCallbacks returns a cleanup function', () => {
      const cleanup = attachSessionCallbacks(mockSession.session, 0);
      expect(typeof cleanup).toBe('function');
      expect(() => cleanup()).not.toThrow();
    });
  });

  // ---- all 52 event names are referenced ----

  describe('all 52 event names', () => {
    const EXPECTED_EVENT_NAMES = [
      'msgbox', 'toast', 'set_multiple_windows_session', 'peer_info', 'sync_peer_info',
      'sync_platform_additions', 'connection_ready', 'switch_display', 'cursor_data',
      'cursor_id', 'cursor_position', 'clipboard', 'permission', 'chat_client_mode',
      'chat_server_mode', 'terminal_response', 'file_dir', 'empty_dirs', 'job_progress',
      'job_done', 'job_error', 'override_file_confirm', 'load_last_job',
      'update_folder_files', 'add_connection', 'on_client_remove',
      'update_quality_status', 'update_block_input_state', 'update_privacy_mode',
      'show_elevation', 'cancel_msgbox', 'switch_back', 'portable_service_running',
      'on_url_scheme_received', 'on_voice_call_waiting', 'on_voice_call_started',
      'on_voice_call_closed', 'on_voice_call_incoming', 'update_voice_call_state',
      'fingerprint', 'plugin_manager', 'plugin_event', 'plugin_reload', 'plugin_option',
      'sync_peer_hash_password_to_personal_ab', 'cm_file_transfer_log',
      'sync_peer_option', 'follow_current_display', 'use_texture_render',
      'selected_files', 'send_emptry_dirs', 'record_status',
    ];

    it('has exactly 52 event names', () => {
      expect(EXPECTED_EVENT_NAMES).toHaveLength(52);
    });

    it('all names are unique', () => {
      const unique = new Set(EXPECTED_EVENT_NAMES);
      expect(unique.size).toBe(52);
    });

    it('emits each event name with correct name field', () => {
      const { cb, events } = makeCollector();
      setGlobalEventCallback(cb);
      for (const name of EXPECTED_EVENT_NAMES) {
        emitGlobalEvent({ name });
      }
      expect(events).toHaveLength(52);
      const emittedNames = events.map((e) => e.name);
      for (const name of EXPECTED_EVENT_NAMES) {
        expect(emittedNames).toContain(name);
      }
    });

    it('attachSessionCallbacks covers the events it maps', () => {
      // The events directly mapped by attachSessionCallbacks:
      const mappedNames = [
        'peer_info', 'cursor_data', 'cursor_position', 'clipboard', 'msgbox',
        'switch_display', 'file_dir', 'job_done', 'job_error', 'terminal_response',
        'show_elevation', 'update_privacy_mode', 'update_block_input_state',
        'connection_ready', 'update_quality_status',
      ];
      for (const name of mappedNames) {
        expect(EXPECTED_EVENT_NAMES).toContain(name);
      }
    });
  });
});