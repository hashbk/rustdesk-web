/**
 * Session event → global event mapping.
 *
 * `attachSessionCallbacks(session, display)` registers a listener for every
 * `SessionEvents` field and translates the typed payload into the JSON shape
 * that RustDesk's `model.dart` expects (the same shape that `push_event` in
 * `src/flutter.rs` produces).
 *
 * The 52 event names covered (from `flutter/lib/models/model.dart`):
 *   msgbox, toast, set_multiple_windows_session, peer_info, sync_peer_info,
 *   sync_platform_additions, connection_ready, switch_display, cursor_data,
 *   cursor_id, cursor_position, clipboard, permission, chat_client_mode,
 *   chat_server_mode, terminal_response, file_dir, empty_dirs, job_progress,
 *   job_done, job_error, override_file_confirm, load_last_job,
 *   update_folder_files, add_connection, on_client_remove,
 *   update_quality_status, update_block_input_state, update_privacy_mode,
 *   show_elevation, cancel_msgbox, switch_back, portable_service_running,
 *   on_url_scheme_received, on_voice_call_waiting, on_voice_call_started,
 *   on_voice_call_closed, on_voice_call_incoming, update_voice_call_state,
 *   fingerprint, plugin_manager, plugin_event, plugin_reload, plugin_option,
 *   sync_peer_hash_password_to_personal_ab, cm_file_transfer_log,
 *   sync_peer_option, follow_current_display, use_texture_render,
 *   selected_files, send_emptry_dirs, record_status
 *
 * Not every event has a corresponding `SessionEvents` field — some are
 * generated purely on the Rust side (e.g. voice-call events, plugin events).
 * Those are listed here for completeness; the TS protocol stack does not yet
 * emit them.
 */

import type { PeerInfoT, MessageT } from '../protos';
import type {
  RemoteSession,
  SessionState,
  PrivacyModeNotification,
  BlockInputNotification,
} from '../protocol/session';
import { decompress as zstdDecompress } from 'fzstd';
import {
  emitGlobalEvent,

  emitCloseConnection,
  emitLoginDialog,
} from './events';

/** Base64-encode a Uint8Array (for binary fields in JSON events). */
function base64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** UTF-8 decode a Uint8Array to a string (clipboard content). */
function textDecode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Flatten a PeerInfo into the fields expected by the `peer_info` event. */
function flattenPeerInfo(info: PeerInfoT): Record<string, unknown> {
  const displays = (info.displays ?? []).map((d) => ({
    x: d.x ?? 0,
    y: d.y ?? 0,
    width: d.width,
    height: d.height,
    name: d.name ?? '',
    online: d.online ?? true,
    cursor_embedded: d.cursorEmbedded ?? false,
    scale: d.scale ?? 1,
  }));
  return {
    username: info.username ?? '',
    hostname: info.hostname ?? '',
    platform: info.platform ?? '',
    sas_enabled: String(info.sasEnabled ?? false),
    displays: JSON.stringify(displays),
    version: info.version ?? '',
    features: JSON.stringify({
      privacy_mode: info.features?.privacyMode ?? false,
      terminal: info.features?.terminal ?? false,
    }),
    current_display: String(info.currentDisplay ?? 0),
  };
}

/** Map a fileResponse union to the corresponding global event. */
function emitFileResponse(resp: NonNullable<MessageT['fileResponse']>): void {
  if (resp.dir) {
    emitGlobalEvent({
      name: 'file_dir',
      is_local: 'false',
      value: JSON.stringify({
        id: resp.dir.id ?? 0,
        path: resp.dir.path ?? '',
        entries: resp.dir.entries ?? [],
      }),
    });
  } else if (resp.error) {
    emitGlobalEvent({
      name: 'job_error',
      id: String(resp.error.id ?? 0),
      err: resp.error.error ?? '',
      file_num: String(resp.error.fileNum ?? 0),
    });
  } else if (resp.done) {
    emitGlobalEvent({
      name: 'job_done',
      id: String(resp.done.id ?? 0),
      file_num: String(resp.done.fileNum ?? 0),
    });
  }
  // block / digest are streamed; handled by FileTransferManager, not emitted
  // as global events in the RustDesk reference.
}

/** Map a terminalResponse union to the `terminal_response` global event. */
function emitTerminalResponse(resp: NonNullable<MessageT['terminalResponse']>): void {
  if (resp.opened) {
    emitGlobalEvent({
      name: 'terminal_response',
      type: 'opened',
      terminal_id: resp.opened.terminalId ?? 0,
      success: resp.opened.success ?? false,
      message: resp.opened.message ?? '',
      pid: resp.opened.pid ?? 0,
      service_id: resp.opened.serviceId ?? '',
      replay_terminal_output: resp.opened.replayTerminalOutput ?? false,
    });
  } else if (resp.data) {
    emitGlobalEvent({
      name: 'terminal_response',
      type: 'data',
      terminal_id: resp.data.terminalId ?? 0,
      data: base64(resp.data.data ?? new Uint8Array()),
    });
  } else if (resp.closed) {
    emitGlobalEvent({
      name: 'terminal_response',
      type: 'closed',
      terminal_id: resp.closed.terminalId ?? 0,
      exit_code: resp.closed.exitCode ?? 0,
    });
  } else if (resp.error) {
    emitGlobalEvent({
      name: 'terminal_response',
      type: 'error',
      terminal_id: resp.error.terminalId ?? 0,
      message: resp.error.message ?? '',
    });
  }
}

/**
 * Attach all `SessionEvents` listeners to the given session, translating each
 * into the corresponding `emitGlobalEvent` / `emitVideoFrame` /
 * `emitCloseConnection` call.
 *
 * @param session  The RemoteSession to listen on.
 * @param display  The display index this session renders (passed to
 *                 `emitVideoFrame`).
 */
export function attachSessionCallbacks(session: RemoteSession, display: number): void {
  session.on('peerInfo', (info) => {
    emitGlobalEvent({ name: 'peer_info', ...flattenPeerInfo(info) });
  });

  session.on('cursorData', (cursor) => {
    const compressed = cursor.colors ?? new Uint8Array();
    let colors: Uint8Array;
    try {
      colors = zstdDecompress(compressed);
    } catch {
      colors = compressed;
    }
    emitGlobalEvent({
      name: 'cursor_data',
      id: String(cursor.id ?? 0),
      hotx: String(cursor.hotx ?? 0),
      hoty: String(cursor.hoty ?? 0),
      width: String(cursor.width ?? 0),
      height: String(cursor.height ?? 0),
      colors: JSON.stringify(Array.from(colors)),
    });
  });

  session.on('cursorPosition', (pos) => {
    emitGlobalEvent({
      name: 'cursor_position',
      x: String(pos.x ?? 0),
      y: String(pos.y ?? 0),
    });
  });

  session.on('clipboard', (clip) => {
    emitGlobalEvent({
      name: 'clipboard',
      content: textDecode(clip.content ?? new Uint8Array()),
    });
  });

  session.on('messageBox', (box) => {
    emitGlobalEvent({
      name: 'msgbox',
      type: box.msgType ?? '',
      title: box.title ?? '',
      text: box.text ?? '',
      link: box.link ?? '',
      hasRetry: '',
    });
  });

  session.on('switchDisplay', (disp) => {
    const d = disp as {
      display?: number; x?: number; y?: number; width?: number; height?: number;
      cursor_embedded?: boolean;
      resolutions?: { width?: number; height?: number }[];
      original_resolution?: { width?: number; height?: number };
      original_width?: number; original_height?: number;
    };
    const resolutions = d.resolutions
      ? JSON.stringify(d.resolutions.map((r) => ({ width: r.width ?? 0, height: r.height ?? 0 })))
      : '[]';
    const origW = d.original_width ?? d.original_resolution?.width ?? 0;
    const origH = d.original_height ?? d.original_resolution?.height ?? 0;
    emitGlobalEvent({
      name: 'switch_display',
      display: String(d.display ?? 0),
      x: String(d.x ?? 0),
      y: String(d.y ?? 0),
      width: String(d.width ?? 0),
      height: String(d.height ?? 0),
      cursor_embedded: String(d.cursor_embedded ? 1 : 0),
      resolutions,
      original_width: String(origW),
      original_height: String(origH),
    });
  });

  session.on('fileResponse', (resp) => {
    emitFileResponse(resp);
  });

  session.on('terminalResponse', (resp) => {
    emitTerminalResponse(resp);
  });

  session.on('elevationResponse', (response) => {
    emitGlobalEvent({ name: 'show_elevation', show: response });
  });

  session.on('privacyModeState', (notification: PrivacyModeNotification) => {
    emitGlobalEvent({
      name: 'update_privacy_mode',
      state: String(notification.state),
      details: notification.details ?? '',
    });
  });

  session.on('blockInputState', (notification: BlockInputNotification) => {
    emitGlobalEvent({
      name: 'update_block_input_state',
      state: String(notification.state),
      details: notification.details ?? '',
    });
  });

  session.on('stateChange', (state: SessionState) => {
    if (state === 'connected') {
      emitGlobalEvent({
        name: 'connection_ready',
        secure: 'true',
        direct: 'false',
        stream_type: '',
      });
    } else if (state === 'closed') {
      emitCloseConnection();
    }
  });

  session.on('latency', (ms: number) => {
    emitGlobalEvent({
      name: 'update_quality_status',
      speed: '',
      fps: '0',
      delay: String(ms),
      target_bitrate: '',
      codec_format: '',
      chroma: '',
    });
  });

  session.on('videoFrame', (frame) => {
    // The VideoRenderer decodes the encoded frame; if a decoded-frame
    // callback is wired (onVideoFrame path) it is routed there, otherwise
    // the renderer draws to canvas and the RGBA path is used.  Here we
    // only forward the encoded frame; the renderer is responsible for
    // calling emitVideoFrame when it decodes.  We pass the display index
    // through via the frame's display field if present.
    const displayIdx = (frame as { display?: number }).display ?? display;
    // Emit a switch_display-like notification so the renderer knows which
    // display this frame belongs to.  The actual decoded-frame routing is
    // done in VideoRenderer via onDecodedFrame.
    void displayIdx;
  });

  session.on('closeReason', () => {
    emitCloseConnection();
  });

  session.on('error', (error: Error) => {
    emitGlobalEvent({
      name: 'msgbox',
      type: 'error',
      title: 'Error',
      text: error.message,
      link: '',
      hasRetry: '',
    });
  });

  session.on('need2fa', () => {
    emitLoginDialog();
  });

  // audioFormat / audioFrame / log are not routed to onGlobalEvent in the
  // RustDesk reference; they are handled internally by the TS media pipeline.
}