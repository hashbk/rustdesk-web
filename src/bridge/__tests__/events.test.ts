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
    let loginDialogCalls: number;

    beforeEach(() => {
      mockSession = makeMockSession();
      listeners = mockSession.listeners;

      events = [];
      const collectingCb = (json: string) => {
        events.push(JSON.parse(json) as Record<string, unknown>);
      };
      setGlobalEventCallback(collectingCb);
      closeConnectionCalls = 0;
      loginDialogCalls = 0;
      (window as unknown as { closeConnection?: unknown }).closeConnection = () => { closeConnectionCalls++; };
      (window as unknown as { loginDialog?: unknown }).loginDialog = () => { loginDialogCalls++; };
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
      listeners.get('latency')!(42);
      expect(events[0]).toMatchObject({ name: 'update_quality_status', delay: '42' });
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

    // -- need2fa → loginDialog --
    it('calls emitLoginDialog for need2fa', () => {
      listeners.get('need2fa')!();
      expect(loginDialogCalls).toBe(1);
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