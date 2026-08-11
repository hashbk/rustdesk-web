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
 * Install `window.setByName`, `window.getByName`, and `window.init`.
 * Idempotent: calling twice overwrites with the same dispatcher.
 *
 * Also wires `window.onGlobalEvent` registration: when Flutter assigns a
 * function to `window.onGlobalEvent`, we intercept the assignment via a
 * property setter and call `setGlobalEventCallback` so the bounded event
 * queue is flushed.
 */
export function installBridge(ctx: BridgeContext = defaultContext): void {
  const d = createDispatcher(ctx);
  const w = window as unknown as Record<string, unknown>;
  w.setByName = (name: string, value?: string) => d.setByName(name, value);
  w.getByName = (name: string, arg?: string) => d.getByName(name, arg);
  w.init = (options?: BridgeInitOptions) => {
    void initBridge(ctx, options);
  };
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
  w.setByName = (name: string, value?: string) => dispatcher.setByName(name, value);
  w.getByName = (name: string, arg?: string) => dispatcher.getByName(name, arg);
  w.init = (options?: BridgeInitOptions) => {
    void initBridge(defaultContext, options);
  };
  wireGlobalEventCallback();
}