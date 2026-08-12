/**
 * Wire the bridge dispatcher to `window.setByName`, `window.getByName`,
 * and `window.init`.
 *
 * Importing this module has the side effect of installing the globals.
 * The bridge build entry (`src/bridge/main.ts`) imports this so that
 * Flutter Web can load `dist/bridge.js` via a `<script>` tag and immediately
 * call `window.setByName(...)` etc.
 *
 * The React app may also import this to expose the same globals in dev.
 */

import { defaultContext, type BridgeContext } from './context';
import { createDispatcher } from './dispatcher';
import { initBridge } from './init';
import { setGlobalEventCallback } from './events';
import type { BridgeInitOptions } from './types';

export { defaultContext, BridgeContext } from './context';
export { createDispatcher } from './dispatcher';
export { initBridge, resetInit, getCachedCodecAbilities } from './init';
export {
  setGlobalEventCallback,
  emitGlobalEvent,
  emitRgba,
  emitVideoFrame,
  emitInitFinished,
  emitDialog,
  emitLoginDialog,
  emitCloseConnection,
  emitFullscreenChanged,
  resetGlobalEventCallback,
  getEventQueueLength,
  MAX_QUEUE,
} from './events';
export { attachSessionCallbacks } from './callbacks';
export type * from './types';

const dispatcher = createDispatcher(defaultContext);

/**
 * Detect whether the current browser is on a mobile device.
 *
 * RustDesk's Dart side calls `window.isMobile()` via `js.context.callMethod`
 * (`flutter/lib/web/common.dart`) to determine `isWebDesktop_`.  The bridge
 * must therefore expose this global before Flutter accesses it, otherwise
 * `Cannot read properties of undefined (reading 'apply')` is thrown and the
 * app never renders.
 */
function isMobile(): boolean {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

/**
 * Wrap a dispatcher's setByName to handle 3-argument calls from Dart.
 *
 * RustDesk's `sessionSetEdgeScrollEdgeThickness` calls
 * `setByName('option:session', 'edge-scroll-edge-thickness', value)` with
 * 3 positional args.  The TS handler expects a JSON `{name, value}` string,
 * so we combine arg2+arg3 into that shape when a third arg is present.
 */
function wrapSetByName(
  fn: (name: string, value?: string) => void,
): (name: string, value?: string, extra?: string) => void {
  return (name: string, value?: string, extra?: string) => {
    if (extra !== undefined && value !== undefined) {
      fn(name, JSON.stringify({ name: value, value: extra }));
    } else {
      fn(name, value);
    }
  };
}

/**
 * Install `window.setByName`, `window.getByName`, `window.init`, and
 * `window.isMobile`.  Idempotent: calling twice overwrites with the same
 * dispatcher.
 *
 * Also wires `window.onGlobalEvent` registration: when Flutter assigns a
 * function to `window.onGlobalEvent`, we intercept the assignment via a
 * property setter and call `setGlobalEventCallback` so the bounded event
 * queue is flushed.
 */
export function installBridge(ctx: BridgeContext = defaultContext): void {
  const d = createDispatcher(ctx);
  const w = window as unknown as Record<string, unknown>;
  w.setByName = wrapSetByName(d.setByName);
  w.getByName = (name: string, arg?: string) => d.getByName(name, arg);
  w.init = (options?: BridgeInitOptions) => {
    void initBridge(ctx, options);
  };
  w.isMobile = isMobile;
  wireGlobalEventCallback();
}

/**
 * Intercept assignments to `window.onGlobalEvent` so that when Flutter
 * registers its callback we can flush the queued events.  Uses a getter/setter
 * pair defined with `Object.defineProperty`; the original function is stored
 * in a closure variable.
 */
function wireGlobalEventCallback(): void {
  let stored: ((json: string) => void) | null = null;
  try {
    Object.defineProperty(window, 'onGlobalEvent', {
      configurable: true,
      get(): ((json: string) => void) | null {
        return stored;
      },
      set(fn: ((json: string) => void) | null) {
        stored = fn;
        if (typeof fn === 'function') {
          setGlobalEventCallback(fn);
        }
      },
    });
  } catch {
    // Some environments (e.g. jsdom in tests) may not allow redefining;
    // fall back to a plain property.  Flutter can still call
    // setGlobalEventCallback directly via the exported bridge.
  }
}

// Auto-install on import (side effect).  Safe in browsers; in tests the
// test file imports `createDispatcher` directly instead.
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.setByName = wrapSetByName(dispatcher.setByName);
  w.getByName = (name: string, arg?: string) => dispatcher.getByName(name, arg);
  w.init = (options?: BridgeInitOptions) => {
    void initBridge(defaultContext, options);
  };
  w.isMobile = isMobile;
  wireGlobalEventCallback();
}