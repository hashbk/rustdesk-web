/**
 * Event backflow channel — JS → Dart callbacks.
 *
 * Flutter registers global callbacks on `window` (e.g. `window.onGlobalEvent`,
 * `window.onRgba`, `window.onVideoFrame`).  When the TS protocol stack
 * receives events from the peer, we translate them into the JSON shape that
 * RustDesk's `model.dart` expects and invoke the registered callback.
 *
 * Startup race: Flutter may not have registered `onGlobalEvent` yet when the
 * first events arrive (e.g. `peer_info` fires very early).  We buffer up to
 * `MAX_QUEUE` events and flush them when `setGlobalEventCallback` is called.
 *
 * The 52 event names mirror `flutter/lib/models/model.dart` and
 * `src/flutter.rs` `push_event` calls in the RustDesk reference client.
 */

/** Callback invoked with a JSON-stringified event object. */
type GlobalEventCallback = (json: string) => void;

/** Callback invoked with a display index and raw RGBA bytes. */
type RgbaCallback = (display: number, rgba: Uint8Array) => void;

/** Callback invoked with a display index and a decoded VideoFrame. */
type VideoFrameCallback = (display: number, frame: VideoFrame) => void;

/** Callback invoked with no arguments. */
type VoidCallback = () => void;

/** Callback invoked with (type, title, text) for a dialog. */
type DialogCallback = (type: string, title: string, text: string) => void;

/** Callback invoked with a boolean. */
type BoolCallback = (value: boolean) => void;

/** Maximum number of events to buffer before the callback is registered. */
export const MAX_QUEUE = 200;

const eventQueue: string[] = [];
let globalEventCb: GlobalEventCallback | null = null;

/**
 * Register the global event callback.  Immediately flushes any queued events
 * (in order) so nothing is lost during the startup race.
 */
export function setGlobalEventCallback(cb: GlobalEventCallback): void {
  globalEventCb = cb;
  while (eventQueue.length > 0) {
    cb(eventQueue.shift()!);
  }
}

/** Clear the callback and drop the queue (tests use this). */
export function resetGlobalEventCallback(): void {
  globalEventCb = null;
  eventQueue.length = 0;
}

/** Return the current queue length (tests / diagnostics). */
export function getEventQueueLength(): number {
  return eventQueue.length;
}

/**
 * Emit a global event.  If a callback is registered the event is delivered
 * immediately; otherwise it is appended to the bounded queue (dropped when
 * full to avoid unbounded memory growth).
 */
export function emitGlobalEvent(evt: Record<string, unknown>): void {
  const json = JSON.stringify(evt);
  if (globalEventCb) {
    globalEventCb(json);
  } else if (eventQueue.length < MAX_QUEUE) {
    eventQueue.push(json);
  }
}

/** Emit raw RGBA pixels for a display (soft-render fallback path). */
export function emitRgba(display: number, rgba: Uint8Array): void {
  const cb = (window as unknown as { onRgba?: RgbaCallback }).onRgba;
  cb?.(display, rgba);
}

/** Emit a decoded VideoFrame for a display (zero-readback GPU path). */
export function emitVideoFrame(display: number, frame: VideoFrame): void {
  const cb = (window as unknown as { onVideoFrame?: VideoFrameCallback }).onVideoFrame;
  cb?.(display, frame);
}

/** Notify Flutter that bridge init has completed. */
export function emitInitFinished(): void {
  const cb = (window as unknown as { onInitFinished?: VoidCallback }).onInitFinished;
  cb?.();
}

/** Show a simple dialog (type, title, text). */
export function emitDialog(type: string, title: string, text: string): void {
  const cb = (window as unknown as { dialog?: DialogCallback }).dialog;
  cb?.(type, title, text);
}

/** Show the login dialog (e.g. when 2FA is required). */
export function emitLoginDialog(): void {
  const cb = (window as unknown as { loginDialog?: VoidCallback }).loginDialog;
  cb?.();
}

/** Close the current connection (dismiss all dialogs + teardown). */
export function emitCloseConnection(): void {
  const cb = (window as unknown as { closeConnection?: VoidCallback }).closeConnection;
  cb?.();
}

/** Notify Flutter that the fullscreen state changed. */
export function emitFullscreenChanged(fullscreen: boolean): void {
  const cb = (window as unknown as { onFullscreenChanged?: BoolCallback }).onFullscreenChanged;
  cb?.(fullscreen);
}