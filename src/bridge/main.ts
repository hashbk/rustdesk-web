/**
 * Bridge build entry — separate from the React `src/main.tsx`.
 *
 * This file is the entry point for `vite build --config vite.bridge.config.ts`
 * and produces `dist/bridge.js` as a single IIFE bundle that Flutter Web
 * loads via `<script src="bridge.js"></script>`.  After loading, the globals
 * `window.setByName`, `window.getByName`, and `window.init` are available.
 *
 * No React is imported here, keeping the bundle small.
 */

import { installBridge } from './index';

installBridge();

// Re-export for direct ESM consumers (e.g. the React app in dev).
export { installBridge } from './index';