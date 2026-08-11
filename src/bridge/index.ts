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
import type { BridgeInitOptions } from './types';

export { defaultContext, BridgeContext } from './context';
export { createDispatcher } from './dispatcher';
export { initBridge, resetInit, getCachedCodecAbilities } from './init';
export type * from './types';

const dispatcher = createDispatcher(defaultContext);

/**
 * Install `window.setByName`, `window.getByName`, and `window.init`.
 * Idempotent: calling twice overwrites with the same dispatcher.
 */
export function installBridge(ctx: BridgeContext = defaultContext): void {
  const d = createDispatcher(ctx);
  const w = window as unknown as Record<string, unknown>;
  w.setByName = (name: string, value?: string) => d.setByName(name, value);
  w.getByName = (name: string, arg?: string) => d.getByName(name, arg);
  w.init = (options?: BridgeInitOptions) => {
    void initBridge(ctx, options);
  };
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
}