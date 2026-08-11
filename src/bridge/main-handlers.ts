/**
 * main_* global method handlers.
 *
 * Implements all 154 `main_*` methods from RustDesk's
 * `flutter/lib/web/bridge.dart`.  Each method is exposed via the dispatcher
 * under a snake_case key (e.g. `main_get_option`, `main_set_option`).
 *
 * Categories:
 *  - CORE — Config/Options (localStorage-backed)
 *  - CORE — Identity/App Info
 *  - CORE — Address Book/Peers (localStorage-backed)
 *  - CORE — Password
 *  - CORE — Service Status
 *  - CORE — Favorites
 *  - CORE — Theme/Language
 *  - CORE — Codec/Display
 *  - STUB — Non-essential for web (return empty/no-op)
 *
 * All handlers share a uniform signature `(arg: string) => string` so the
 * dispatcher can route them through the same setByName/getByName path.
 * Setter methods that need multiple arguments receive a JSON string; getter
 * methods receive the key (or a JSON string for multi-arg getters).
 */

import { BridgeContext } from './context';
import { getCachedCodecAbilities } from './init';

/** A main_* handler: receives a raw string arg and returns a string. */
export type MainHandler = (arg: string) => string;

/** Registry of main_* key → handler. */
export type MainHandlerRegistry = Record<string, MainHandler>;

function parseJson<T>(value: string): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Available languages (mirrors the existing `langs` getByName handler). */
const AVAILABLE_LANGS = ['en', 'zh-cn', 'zh-tw', 'de', 'fr', 'es', 'ja', 'ko', 'ru', 'pt'];

/**
 * Detect hardware codec support via the WebCodecs API.
 * Returns a JSON string mapping codec name → boolean.
 */
function detectHwcodecSupport(): string {
  const cached = getCachedCodecAbilities();
  const ab = cached ?? { vp8: false, vp9: false, av1: false, h264: false, h265: false };
  return JSON.stringify(ab);
}

/** Check whether any hardware codec is available. */
function hasHwcodec(): boolean {
  const cached = getCachedCodecAbilities();
  if (!cached) return false;
  return cached.h264 || cached.h265;
}

/**
 * Create the registry of all 154 main_* handlers bound to the given context.
 */
export function createMainHandlers(ctx: BridgeContext): MainHandlerRegistry {
  return {
    // ================================================================
    // CORE — Config/Options (~24 methods)
    // ================================================================

    /** mainGetOption(key) — generic config get. */
    main_get_option: (key: string) => ctx.getOption(key),

    /** mainSetOption(key, value) — generic config set. */
    main_set_option: (arg: string) => {
      const p = parseJson<{ key: string; value: string }>(arg);
      if (p?.key != null) ctx.setOption(p.key, p.value ?? '');
      return '';
    },

    /** mainGetOptionSync(key) — sync variant of getOption. */
    main_get_option_sync: (key: string) => ctx.getOption(key),

    /** mainGetOptions() — all options as JSON. */
    main_get_options: () => JSON.stringify(ctx.getOptions()),

    /** mainSetOptions(json) — set all options from JSON. */
    main_set_options: (arg: string) => {
      const opts = parseJson<Record<string, string>>(arg);
      if (opts && typeof opts === 'object') ctx.setOptions(opts);
      return '';
    },

    /** mainGetOptionsSync() — sync variant of getOptions. */
    main_get_options_sync: () => JSON.stringify(ctx.getOptions()),

    /** mainGetLocalOption(key) — local-only option get. */
    main_get_local_option: (key: string) => ctx.getLocalOption(key),

    /** mainSetLocalOption(key, value) — local-only option set. */
    main_set_local_option: (arg: string) => {
      const p = parseJson<{ key: string; value: string }>(arg);
      if (p?.key != null) ctx.setLocalOption(p.key, p.value ?? '');
      return '';
    },

    /** mainGetBuildinOption(key) — builtin/default options (return local as per bridge.dart). */
    main_get_buildin_option: (key: string) => ctx.getLocalOption(key),

    /** mainGetPeerOption(peerId, key) — per-peer option get. */
    main_get_peer_option: (arg: string) => {
      const p = parseJson<{ id: string; key: string }>(arg);
      if (p?.id != null && p.key != null) return ctx.getPeerOption(p.id, p.key);
      return '';
    },

    /** mainSetPeerOption(peerId, key, value) — per-peer option set. */
    main_set_peer_option: (arg: string) => {
      const p = parseJson<{ id: string; key: string; value: string }>(arg);
      if (p?.id != null && p.key != null) ctx.setPeerOption(p.id, p.key, p.value ?? '');
      return '';
    },

    /** mainGetPeerOptionSync(peerId, key) — sync variant. */
    main_get_peer_option_sync: (arg: string) => {
      const p = parseJson<{ id: string; key: string }>(arg);
      if (p?.id != null && p.key != null) return ctx.getPeerOption(p.id, p.key);
      return '';
    },

    /** mainSetPeerOptionSync(peerId, key, value) — sync variant. */
    main_set_peer_option_sync: (arg: string) => {
      const p = parseJson<{ id: string; key: string; value: string }>(arg);
      if (p?.id != null && p.key != null) ctx.setPeerOption(p.id, p.key, p.value ?? '');
      return 'true';
    },

    /** mainGetPeerFlutterOptionSync(peerId, key) — flutter per-peer option get. */
    main_get_peer_flutter_option_sync: (arg: string) => {
      const p = parseJson<{ id: string; k: string }>(arg);
      if (p?.k != null) return ctx.getFlutterPeerOption(p.k);
      return '';
    },

    /** mainSetPeerFlutterOptionSync(peerId, key, value) — flutter per-peer option set. */
    main_set_peer_flutter_option_sync: (arg: string) => {
      const p = parseJson<{ id: string; k: string; v: string }>(arg);
      if (p?.k != null) ctx.setFlutterPeerOption(p.k, p.v ?? '');
      return '';
    },

    /** mainGetUserDefaultOption(key) — user default option get. */
    main_get_user_default_option: (key: string) => ctx.getUserDefaultOption(key),

    /** mainSetUserDefaultOption(key, value) — user default option set. */
    main_set_user_default_option: (arg: string) => {
      const p = parseJson<{ key: string; value: string }>(arg);
      if (p?.key != null) ctx.setUserDefaultOption(p.key, p.value ?? '');
      return '';
    },

    /** mainGetCommon(key) — common option get. */
    main_get_common: (key: string) => ctx.getCommon(key),

    /** mainSetCommon(key, value) — common option set. */
    main_set_common: (arg: string) => {
      const p = parseJson<{ key: string; value: string }>(arg);
      if (p?.key != null) ctx.setCommon(p.key, p.value ?? '');
      return '';
    },

    /** mainGetCommonSync(key) — sync variant of getCommon. */
    main_get_common_sync: (key: string) => ctx.getCommon(key),

    /** mainGetHardOption(key) — hardware-specific option (stub, return local as per bridge.dart). */
    main_get_hard_option: (key: string) => ctx.getLocalOption(key),

    /** mainShowOption(key) — return option display info (show all on web). */
    main_show_option: (_key: string) => 'true',

    /** mainIsOptionFixed(key) — return "false" (no fixed options on web). */
    main_is_option_fixed: (_key: string) => 'false',

    // ================================================================
    // CORE — Identity/App Info (~11 methods)
    // ================================================================

    /** mainGetMyId() — return persisted web peer ID. */
    main_get_my_id: () => ctx.getMyId(),

    /** mainGetUuid() — return persisted UUID. */
    main_get_uuid: () => ctx.getUuid(),

    /** mainDeviceId() — return device ID (use browser info / myId).
     *  Note: bridge.dart defines mainDeviceId as a setter (takes id), but
     *  on web we treat it as a getter returning the device ID. */
    main_device_id: () => ctx.getDeviceId(),

    /** mainDeviceName() — return device name (use browser info / myName).
     *  Note: bridge.dart defines mainDeviceName as a setter (takes name), but
     *  on web we treat it as a getter returning the device name. */
    main_device_name: () => ctx.getDeviceName(),

    /** mainGetAppName() — return "RustDesk Web". */
    main_get_app_name: () => ctx.getAppName(),

    /** mainGetAppNameSync() — sync variant of getAppName. */
    main_get_app_name_sync: () => ctx.getAppName(),

    /** mainGetVersion() — return version from package.json. */
    main_get_version: () => ctx.getAppVersion(),

    /** mainGetNewVersion() — return same version (no update check on web). */
    main_get_new_version: () => ctx.getNewVersion(),

    /** mainGetBuildDate() — return build date. */
    main_get_build_date: () => ctx.getBuildDate(),

    /** mainGetApiServer() — return configured API server. */
    main_get_api_server: () => {
      const s = ctx.getServer();
      const scheme = s.useWss ? 'https' : 'http';
      return `${scheme}://${s.rendezvousHost}`;
    },

    /** mainIsUsingPublicServer() — return "true" (default public server). */
    main_is_using_public_server: () => (ctx.isUsingPublicServer() ? 'true' : 'false'),

    // ================================================================
    // CORE — Address Book/Peers (~20 methods, localStorage-backed)
    // ================================================================

    /** mainLoadAb() — return address book JSON from localStorage. */
    main_load_ab: () => {
      const ab = ctx.getAddressBook();
      return typeof ab === 'string' ? ab : JSON.stringify(ab);
    },

    /** mainSaveAb(json) — save address book to localStorage. */
    main_save_ab: (arg: string) => {
      const data = parseJson(arg) ?? arg;
      ctx.setAddressBook(data);
      return '';
    },

    /** mainClearAb() — clear address book. */
    main_clear_ab: () => {
      ctx.clearAddressBook();
      return '';
    },

    /** mainLoadGroup() — return group JSON from localStorage. */
    main_load_group: () => {
      const g = ctx.getGroup();
      return typeof g === 'string' ? g : JSON.stringify(g);
    },

    /** mainSaveGroup(json) — save group to localStorage. */
    main_save_group: (arg: string) => {
      const data = parseJson(arg) ?? arg;
      ctx.setGroup(data);
      return '';
    },

    /** mainClearGroup() — clear group. */
    main_clear_group: () => {
      ctx.clearGroup();
      return '';
    },

    /** mainLoadFavPeers() — return favorite peers. */
    main_load_fav_peers: () => JSON.stringify(ctx.getFavPeers()),

    /** mainLoadRecentPeers() — return recent peers. */
    main_load_recent_peers: () => JSON.stringify(ctx.getRecentPeers()),

    /** mainLoadRecentPeersSync() — sync variant. */
    main_load_recent_peers_sync: () => JSON.stringify(ctx.getRecentPeers()),

    /** mainLoadRecentPeersForAb(filter) — return recent peers for address book. */
    main_load_recent_peers_for_ab: () => JSON.stringify(ctx.getRecentPeers()),

    /** mainLoadLanPeers() — return LAN peers (empty on web). */
    main_load_lan_peers: () => '{}',

    /** mainLoadLanPeersSync() — sync variant (empty on web). */
    main_load_lan_peers_sync: () => '{}',

    /** mainGetLanPeers() — return LAN peers (empty on web). */
    main_get_lan_peers: () => '{}',

    /** mainGetNewStoredPeers() — return stored peers. */
    main_get_new_stored_peers: () => JSON.stringify(ctx.getPeers()),

    /** mainRemovePeer(id) — remove peer from address book. */
    main_remove_peer: (id: string) => {
      ctx.removePeer(id);
      return '';
    },

    /** mainSetPeerAlias(peerId, alias) — set peer alias. */
    main_set_peer_alias: (arg: string) => {
      const p = parseJson<{ id: string; alias: string }>(arg);
      if (p?.id != null) {
        const peers = ctx.getPeers();
        const idx = peers.findIndex((pr) => pr.id === p.id);
        if (idx >= 0) {
          peers[idx] = { ...peers[idx], alias: p.alias };
          ctx.setPeers(peers);
        }
        ctx.setPeerOption(p.id, 'alias', p.alias ?? '');
      }
      return '';
    },

    /** mainPeerExists(peerId) — return "true"/"false". */
    main_peer_exists: (id: string) => (ctx.peerExists(id) ? 'true' : 'false'),

    /** mainPeerHasPassword(peerId) — return "true"/"false". */
    main_peer_has_password: (id: string) => (ctx.peerHasPassword(id) ? 'true' : 'false'),

    /** mainResolveAvatarUrl(peerId) — return empty string (no avatars on web). */
    main_resolve_avatar_url: (avatar: string) => ctx.resolveAvatarUrl(avatar),

    /** mainForgetPassword(peerId) — clear stored password for peer. */
    main_forget_password: (id: string) => {
      ctx.setPeerOption(id, 'password', '');
      const peers = ctx.getPeers();
      const idx = peers.findIndex((p) => p.id === id);
      if (idx >= 0) {
        peers[idx] = { ...peers[idx], password: undefined, hash: undefined };
        ctx.setPeers(peers);
      }
      return '';
    },

    /** mainGetLastRemoteId() — return last connected peer ID. */
    main_get_last_remote_id: () => ctx.getLocalOption('last_remote_id'),

    /** mainGetPeerSync(id) — return peer record as JSON. */
    main_get_peer_sync: (id: string) => {
      const peer = ctx.getPeer(id);
      return peer ? JSON.stringify(peer) : '';
    },

    // ================================================================
    // CORE — Password (~3 methods)
    // ================================================================

    /** mainGetTemporaryPassword() — return temporary password. */
    main_get_temporary_password: () => ctx.getTemporaryPassword(),

    /** mainUpdateTemporaryPassword(pwd) — update temporary password. */
    main_update_temporary_password: (pwd: string) => {
      ctx.setTemporaryPassword(pwd);
      return '';
    },

    /** mainSetPermanentPasswordWithResult(pwd) — set permanent password. */
    main_set_permanent_password_with_result: (pwd: string) => {
      ctx.setPermanentPassword(pwd);
      return 'true';
    },

    // ================================================================
    // CORE — Service Status (~5 methods)
    // ================================================================

    /** mainGetConnectStatus() — return connection status. */
    main_get_connect_status: () => ctx.getConnStatus(),

    /** mainCheckConnectStatus() — trigger status check (no-op on web). */
    main_check_connect_status: () => '',

    /** mainGetHttpStatus(url) — return HTTP status (stub on web). */
    main_get_http_status: (_url: string) => '',

    /** mainStartService() — no-op on web (service always "running"). */
    main_start_service: () => '',

    /** mainStopService() — no-op on web. */
    main_stop_service: () => '',

    // ================================================================
    // CORE — Favorites (~2 methods)
    // ================================================================

    /** mainGetFav() — return favorites JSON. */
    main_get_fav: () => JSON.stringify(ctx.getFav()),

    /** mainStoreFav(json) — store favorites. */
    main_store_fav: (arg: string) => {
      const favs = parseJson<string[]>(arg);
      if (Array.isArray(favs)) ctx.setFav(favs.map(String));
      return '';
    },

    // ================================================================
    // CORE — Theme/Language (~3 methods)
    // ================================================================

    /** mainChangeTheme(theme) — save theme to localStorage. */
    main_change_theme: (theme: string) => {
      ctx.setTheme(theme);
      return '';
    },

    /** mainChangeLanguage(lang) — save language to localStorage. */
    main_change_language: (lang: string) => {
      ctx.setLanguage(lang);
      return '';
    },

    /** mainGetLangs() — return available languages JSON. */
    main_get_langs: () => JSON.stringify(AVAILABLE_LANGS),

    // ================================================================
    // CORE — Codec/Display (~8 methods)
    // ================================================================

    /** mainCheckHwcodec() — check hardware codec support (use WebCodecs API). */
    main_check_hwcodec: () => detectHwcodecSupport(),

    /** mainHasHwcodec() — return "true"/"false" based on WebCodecs support. */
    main_has_hwcodec: () => (hasHwcodec() ? 'true' : 'false'),

    /** mainSupportedHwdecodings() — return supported hardware decodings. */
    main_supported_hwdecodings: () => detectHwcodecSupport(),

    /** mainSupportedPrivacyModeImpls() — return empty (no privacy mode impls on web). */
    main_supported_privacy_mode_impls: () => '[]',

    /** mainDefaultPrivacyModeImpl() — return empty. */
    main_default_privacy_mode_impl: () => '',

    /** mainGetUseTextureRender() — return "false" (use RGBA on web). */
    main_get_use_texture_render: () => 'false',

    /** mainHasGpuTextureRender() — return "false". */
    main_has_gpu_texture_render: () => 'false',

    /** mainHasVram() — return "false". */
    main_has_vram: () => 'false',

    // ================================================================
    // CORE — Display (~2 methods)
    // ================================================================

    /** mainGetMainDisplay() — return main display index. */
    main_get_main_display: () => '0',

    /** mainGetDisplays() — return displays JSON (stub, single display on web). */
    main_get_displays: () => JSON.stringify([{ id: 0, name: 'Display 1' }]),

    // ================================================================
    // STUB — Account auth (~8 methods)
    // ================================================================

    main_account_auth: () => '',
    main_account_auth_cancel: () => '',
    main_account_auth_result: () => '',
    main_generate2_fa: () => '',
    main_verify2_fa: () => '',
    main_has_valid2_fa_sync: () => 'false',
    main_verify_bot: () => '',
    main_has_valid_bot_sync: () => 'false',

    // ================================================================
    // STUB — Audit/Deploy (~2 methods)
    // ================================================================

    main_deploy_device: () => '',
    main_update_me: () => '',

    // ================================================================
    // STUB — Hardware/OS (~40 methods)
    // ================================================================

    main_current_is_wayland: () => 'false',
    main_is_login_wayland: () => 'false',
    main_clip_cursor: () => 'false',
    main_set_cursor_position: () => 'false',
    main_check_mouse_time: () => '',
    main_get_mouse_time: () => '0',
    main_check_super_user_permission: () => 'false',
    main_is_can_input_monitoring: () => 'true',
    main_is_can_screen_recording: () => 'true',
    main_is_installed: () => 'false',
    main_is_installed_daemon: () => 'false',
    main_is_installed_lower_version: () => 'false',
    main_is_process_trusted: () => 'true',
    main_is_root: () => 'false',
    main_is_share_rdp: () => 'false',
    main_set_share_rdp: () => '',
    main_create_shortcut: () => '',
    main_hide_dock: () => 'false',
    main_support_remove_wallpaper: () => 'false',
    main_test_wallpaper: () => '',
    main_start_dbus_server: () => '',
    main_start_ipc_url_server: () => '',
    main_on_main_window_close: () => '',
    main_goto_install: () => 'false',
    main_wol: () => '',
    main_discover: () => '',
    main_remove_discovered: () => '',
    main_set_unlock_pin: () => '',
    main_get_unlock_pin: () => '',
    main_clear_trusted_devices: () => '',
    main_get_trusted_devices: () => '[]',
    main_remove_trusted_devices: () => '',
    main_handle_wayland_screencast_restore_token: () => '',
    main_get_async_status: () => '',
    main_get_error: () => '',
    main_http_request: () => '',
    main_post_request: () => '',
    main_change_id: () => '',
    main_init: () => '',

    // ================================================================
    // STUB — Misc (~30 methods)
    // ================================================================

    main_get_env: (key: string) => ctx.getEnvVar(key),
    main_set_env: (arg: string) => {
      const p = parseJson<{ key: string; value?: string }>(arg);
      if (p?.key != null) ctx.setEnvVar(p.key, p.value ?? '');
      return '';
    },
    main_get_socks: () => JSON.stringify([]),
    main_set_socks: () => '',
    main_get_proxy_status: () => 'false',
    main_get_software_update_url: () => ctx.getSoftwareUpdateUrl(),
    main_get_license: () => '',
    main_get_fingerprint: () => ctx.getFingerprint(),
    main_get_input_source: () => {
      const src = ctx.getLocalOption('input-source');
      return src !== '' ? src : 'Input source 1';
    },
    main_set_input_source: (arg: string) => {
      const p = parseJson<{ value: string }>(arg);
      if (p?.value != null) ctx.setLocalOption('input-source', p.value);
      return '';
    },
    main_supported_input_source: () =>
      JSON.stringify([
        ['Input source 1', 'input_source_1_tip'],
        ['Input source 2', 'input_source_2_tip'],
      ]),
    main_init_input_source: () => '',
    main_get_sound_inputs: () => JSON.stringify([]),
    main_get_default_sound_input: () => '',
    main_audio_support_loopback: () => 'false',
    main_get_printer_names: () => '',
    main_video_save_directory: () => '',
    main_get_data_dir_ios: () => '',
    main_get_home_dir: () => ctx.getHomeDir(),
    main_set_home_dir: () => '',
    main_get_login_device_info: () => {
      const info = {
        os: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        type: 'Web client',
        name: ctx.getMyName(),
      };
      return JSON.stringify(info);
    },
    main_uri_prefix_sync: () => '',
    main_max_encrypt_len: () => '0',
    main_has_file_clipboard: () => 'false',
    main_test_if_valid_server: () => '',
    main_handle_relay_id: (id: string) => {
      if (id.endsWith('\\r') || id.endsWith('/r')) {
        return id.substring(0, id.length - 2);
      }
      return id;
    },
  };
}

/**
 * Convert a camelCase main_* method name to its snake_case dispatcher key.
 * e.g. `mainGetOption` → `main_get_option`.
 */
export function camelToSnakeMain(name: string): string {
  // Insert underscore before each uppercase letter, then lowercase.
  const snake = name.replace(/([A-Z])/g, '_$1').toLowerCase();
  // Ensure it starts with "main_"
  return snake.startsWith('main_') ? snake : 'main_' + snake;
}

/** Total count of main_* handlers (should be 154). */
export function getMainHandlerCount(registry: MainHandlerRegistry): number {
  return Object.keys(registry).length;
}