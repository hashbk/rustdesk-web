/**
 * window.init() — one-shot bootstrap for the bridge.
 *
 * Initializes the crypto subsystem and detects WebCodecs abilities so that
 * `alternative_codecs` and codec-preference routing have data to work with
 * before a session is started.  Safe to call multiple times; subsequent
 * calls are no-ops after the first successful init.
 */

import { initCrypto } from '../protocol/crypto';
import { detectCodecAbilities, type CodecAbilities } from '../media/renderer';
import type { BridgeContext } from './context';
import type { BridgeInitOptions } from './types';
import { emitInitFinished } from './events';

let initialized = false;
let cachedAbilities: CodecAbilities | null = null;

/**
 * Initialize the bridge.  Idempotent.
 *
 * @param ctx     BridgeContext to populate (defaults to the singleton).
 * @param options Optional overrides (server config, app name).
 */
export async function initBridge(
  ctx: BridgeContext,
  options?: BridgeInitOptions,
): Promise<void> {
  if (initialized) return;

  await initCrypto();

  try {
    cachedAbilities = await detectCodecAbilities();
  } catch {
    cachedAbilities = { vp8: false, vp9: false, av1: false, h264: false, h265: false };
  }

  if (options?.server) {
    ctx.setServer(options.server);
  }
  if (options?.appName) {
    ctx.setAppName(options.appName);
  }

  initialized = true;

  // Notify Flutter that the bridge is ready (mirrors `context["onInitFinished"]`
  // in flutter/lib/models/web_model.dart).
  emitInitFinished();
}

/** Return cached codec abilities (null before init). */
export function getCachedCodecAbilities(): CodecAbilities | null {
  return cachedAbilities;
}

/** Reset init state (tests use this to re-run init). */
export function resetInit(): void {
  initialized = false;
  cachedAbilities = null;
}