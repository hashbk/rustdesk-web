/**
 * Unit tests for main_* global method handlers.
 *
 * Covers core methods: config, identity, address book, password, favorites,
 * theme/language, codec detection, and stubbed methods.  Tests exercise the
 * handlers through the dispatcher's setByName/getByName to verify end-to-end
 * routing of main_* keys.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeContext } from '../context';
import { createDispatcher } from '../dispatcher';
import { createMainHandlers } from '../main-handlers';
import { resetInit } from '../init';

// ---- mock RemoteSession (same pattern as dispatcher.test.ts) ----

const { mockSession, mockFtm } = vi.hoisted(() => {
  const mockSession = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    sendMouse: vi.fn(),
    sendKey: vi.fn(),
    sendClipboard: vi.fn(),
    sendImageQuality: vi.fn(),
    sendCustomImageQuality: vi.fn(),
    sendCodecPreference: vi.fn(),
    sendSwitchDisplay: vi.fn(),
    sendElevationRequest: vi.fn(),
    sendElevationWithLogon: vi.fn(),
    sendRestartRemoteDevice: vi.fn(),
    sendOption: vi.fn(),
    sendPrivacyMode: vi.fn(),
    sendBlockInput: vi.fn(),
    send2fa: vi.fn().mockResolvedValue(undefined),
    setInitialOptions: vi.fn(),
    getCodecAbilities: vi.fn().mockReturnValue(null),
    on: vi.fn(),
    state: 'idle',
  };
  const mockFtm = {
    readRemoteDir: vi.fn(),
    cancelTransfer: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    setCallbacks: vi.fn(),
    handleFileResponse: vi.fn(),
  };
  return { mockSession, mockFtm };
});

vi.mock('../../protocol/session', () => ({
  RemoteSession: vi.fn(function () {
    return mockSession;
  }),
  BoolOption: { NotSet: 0, No: 1, Yes: 2 },
  boolToOption: (b: boolean) => (b ? 2 : 1),
}));

vi.mock('../../protocol/file_transfer', () => ({
  FileTransferManager: vi.fn(function () {
    return mockFtm;
  }),
}));

describe('main-handlers', () => {
  let ctx: BridgeContext;
  let setByName: (name: string, value?: string) => void;
  let getByName: (name: string, arg?: string) => string;

  beforeEach(() => {
    localStorage.clear();
    resetInit();
    ctx = new BridgeContext();
    const d = createDispatcher(ctx);
    setByName = d.setByName;
    getByName = d.getByName;
  });

  // ---- handler count ----
  describe('registry', () => {
    it('has exactly 154 main_* handlers', () => {
      const handlers = createMainHandlers(ctx);
      expect(Object.keys(handlers).length).toBe(154);
    });

    it('all handler keys start with main_', () => {
      const handlers = createMainHandlers(ctx);
      for (const key of Object.keys(handlers)) {
        expect(key.startsWith('main_')).toBe(true);
      }
    });
  });

  // ---- Config/Options ----
  describe('config options', () => {
    it('main_get_option / main_set_option round-trips', () => {
      setByName('main_set_option', JSON.stringify({ key: 'theme', value: 'dark' }));
      expect(getByName('main_get_option', 'theme')).toBe('dark');
    });

    it('main_get_option_sync returns the same as main_get_option', () => {
      setByName('main_set_option', JSON.stringify({ key: 'lang', value: 'en' }));
      expect(getByName('main_get_option_sync', 'lang')).toBe('en');
    });

    it('main_get_options returns JSON of all options', () => {
      setByName('main_set_option', JSON.stringify({ key: 'a', value: '1' }));
      setByName('main_set_option', JSON.stringify({ key: 'b', value: '2' }));
      const opts = JSON.parse(getByName('main_get_options'));
      expect(opts.a).toBe('1');
      expect(opts.b).toBe('2');
    });

    it('main_set_options replaces all options', () => {
      setByName('main_set_options', JSON.stringify({ x: '10', y: '20' }));
      expect(getByName('main_get_option', 'x')).toBe('10');
      expect(getByName('main_get_option', 'y')).toBe('20');
    });

    it('main_get_options_sync matches main_get_options', () => {
      setByName('main_set_option', JSON.stringify({ key: 'k', value: 'v' }));
      expect(getByName('main_get_options_sync')).toBe(getByName('main_get_options'));
    });

    it('main_get_local_option / main_set_local_option round-trips', () => {
      setByName('main_set_local_option', JSON.stringify({ key: 'kb', value: 'us' }));
      expect(getByName('main_get_local_option', 'kb')).toBe('us');
    });

    it('main_get_buildin_option returns local option', () => {
      setByName('main_set_local_option', JSON.stringify({ key: 'default-view', value: 'original' }));
      expect(getByName('main_get_buildin_option', 'default-view')).toBe('original');
    });

    it('main_get_hard_option returns local option', () => {
      setByName('main_set_local_option', JSON.stringify({ key: 'disable-ab', value: 'Y' }));
      expect(getByName('main_get_hard_option', 'disable-ab')).toBe('Y');
    });

    it('main_show_option returns "true"', () => {
      expect(getByName('main_show_option', 'any-key')).toBe('true');
    });

    it('main_is_option_fixed returns "false"', () => {
      expect(getByName('main_is_option_fixed', 'any-key')).toBe('false');
    });
  });

  // ---- Peer options ----
  describe('peer options', () => {
    it('main_get_peer_option / main_set_peer_option round-trips', () => {
      setByName('main_set_peer_option', JSON.stringify({ id: '123', key: 'alias', value: 'My PC' }));
      expect(getByName('main_get_peer_option', JSON.stringify({ id: '123', key: 'alias' }))).toBe('My PC');
    });

    it('main_get_peer_option_sync matches async variant', () => {
      setByName('main_set_peer_option', JSON.stringify({ id: '456', key: 'k', value: 'v' }));
      expect(getByName('main_get_peer_option_sync', JSON.stringify({ id: '456', key: 'k' }))).toBe('v');
    });

    it('main_set_peer_option_sync returns "true"', () => {
      const result = getByName('main_set_peer_option_sync', JSON.stringify({ id: '1', key: 'k', value: 'v' }));
      expect(result).toBe('true');
    });

    it('main_get_peer_flutter_option_sync / main_set_peer_flutter_option_sync round-trips', () => {
      setByName('main_set_peer_flutter_option_sync', JSON.stringify({ id: '1', k: 'tab', v: 'true' }));
      expect(getByName('main_get_peer_flutter_option_sync', JSON.stringify({ id: '1', k: 'tab' }))).toBe('true');
    });

    it('main_get_user_default_option / main_set_user_default_option round-trips', () => {
      setByName('main_set_user_default_option', JSON.stringify({ key: 'codec', value: 'vp9' }));
      expect(getByName('main_get_user_default_option', 'codec')).toBe('vp9');
    });
  });

  // ---- Common options ----
  describe('common options', () => {
    it('main_get_common / main_set_common round-trips', () => {
      setByName('main_set_common', JSON.stringify({ key: 'size', value: '100' }));
      expect(getByName('main_get_common', 'size')).toBe('100');
    });

    it('main_get_common_sync matches main_get_common', () => {
      setByName('main_set_common', JSON.stringify({ key: 'x', value: 'y' }));
      expect(getByName('main_get_common_sync', 'x')).toBe('y');
    });
  });

  // ---- Identity/App Info ----
  describe('identity and app info', () => {
    it('main_get_my_id returns a 10-digit id', () => {
      expect(getByName('main_get_my_id')).toMatch(/^\d{10}$/);
    });

    it('main_get_uuid returns a uuid', () => {
      expect(getByName('main_get_uuid')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('main_device_id returns a non-empty string', () => {
      expect(getByName('main_device_id')).not.toBe('');
    });

    it('main_device_name returns a name starting with Web-', () => {
      expect(getByName('main_device_name')).toMatch(/^Web-/);
    });

    it('main_get_app_name returns "RustDesk Web"', () => {
      expect(getByName('main_get_app_name')).toBe('RustDesk Web');
    });

    it('main_get_app_name_sync returns "RustDesk Web"', () => {
      expect(getByName('main_get_app_name_sync')).toBe('RustDesk Web');
    });

    it('main_get_version returns a semver string', () => {
      expect(getByName('main_get_version')).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('main_get_new_version returns the same version', () => {
      expect(getByName('main_get_new_version')).toBe(getByName('main_get_version'));
    });

    it('main_get_build_date returns a string', () => {
      // Build date is injected by Vite; in tests it's 'test-build-date'.
      expect(typeof getByName('main_get_build_date')).toBe('string');
    });

    it('main_get_api_server returns a URL', () => {
      expect(getByName('main_get_api_server')).toMatch(/^https?:\/\//);
    });

    it('main_is_using_public_server returns "true" by default', () => {
      expect(getByName('main_is_using_public_server')).toBe('true');
    });
  });

  // ---- Address Book/Peers ----
  describe('address book and peers', () => {
    it('main_save_ab / main_load_ab round-trips', () => {
      setByName('main_save_ab', JSON.stringify({ peers: [{ id: '1' }] }));
      const loaded = JSON.parse(getByName('main_load_ab'));
      expect(loaded.peers).toEqual([{ id: '1' }]);
    });

    it('main_clear_ab clears the address book', () => {
      setByName('main_save_ab', JSON.stringify({ peers: [] }));
      setByName('main_clear_ab');
      expect(getByName('main_load_ab')).toBe('');
    });

    it('main_save_group / main_load_group round-trips', () => {
      setByName('main_save_group', JSON.stringify({ name: 'g1' }));
      const loaded = JSON.parse(getByName('main_load_group'));
      expect(loaded.name).toBe('g1');
    });

    it('main_clear_group clears the group', () => {
      setByName('main_save_group', JSON.stringify({ name: 'g' }));
      setByName('main_clear_group');
      expect(getByName('main_load_group')).toBe('');
    });

    it('main_load_fav_peers returns JSON array', () => {
      ctx.setPeers([{ id: '1' }, { id: '2' }]);
      ctx.setFav(['1']);
      const favs = JSON.parse(getByName('main_load_fav_peers'));
      expect(favs).toHaveLength(1);
      expect(favs[0].id).toBe('1');
    });

    it('main_load_recent_peers returns JSON array', () => {
      ctx.setRecentPeers([{ id: '99' }]);
      const recent = JSON.parse(getByName('main_load_recent_peers'));
      expect(recent[0].id).toBe('99');
    });

    it('main_load_recent_peers_sync matches main_load_recent_peers', () => {
      ctx.setRecentPeers([{ id: '42' }]);
      expect(getByName('main_load_recent_peers_sync')).toBe(getByName('main_load_recent_peers'));
    });

    it('main_load_lan_peers returns "{}"', () => {
      expect(getByName('main_load_lan_peers')).toBe('{}');
    });

    it('main_load_lan_peers_sync returns "{}"', () => {
      expect(getByName('main_load_lan_peers_sync')).toBe('{}');
    });

    it('main_remove_peer removes a peer', () => {
      ctx.setPeers([{ id: '1' }, { id: '2' }]);
      setByName('main_remove_peer', '1');
      expect(ctx.peerExists('1')).toBe(false);
      expect(ctx.peerExists('2')).toBe(true);
    });

    it('main_set_peer_alias sets the alias', () => {
      ctx.setPeers([{ id: '1' }]);
      setByName('main_set_peer_alias', JSON.stringify({ id: '1', alias: 'Alice' }));
      expect(ctx.getPeer('1')?.alias).toBe('Alice');
    });

    it('main_peer_exists returns "true"/"false"', () => {
      ctx.setPeers([{ id: '1' }]);
      expect(getByName('main_peer_exists', '1')).toBe('true');
      expect(getByName('main_peer_exists', '2')).toBe('false');
    });

    it('main_peer_has_password returns "true"/"false"', () => {
      ctx.setPeers([{ id: '1', password: 'x' }]);
      expect(getByName('main_peer_has_password', '1')).toBe('true');
      expect(getByName('main_peer_has_password', '2')).toBe('false');
    });

    it('main_forget_password clears the password', () => {
      ctx.setPeers([{ id: '1', password: 'secret' }]);
      setByName('main_forget_password', '1');
      expect(ctx.peerHasPassword('1')).toBe(false);
    });

    it('main_get_last_remote_id returns last remote id', () => {
      ctx.setLocalOption('last_remote_id', '12345');
      expect(getByName('main_get_last_remote_id')).toBe('12345');
    });
  });

  // ---- Password management ----
  describe('password management', () => {
    it('main_get_temporary_password / main_update_temporary_password round-trips', () => {
      setByName('main_update_temporary_password', 'mypassword');
      expect(getByName('main_get_temporary_password')).toBe('mypassword');
    });

    it('main_set_permanent_password_with_result returns "true"', () => {
      const result = getByName('main_set_permanent_password_with_result', 'perm123');
      expect(result).toBe('true');
    });
  });

  // ---- Service status ----
  describe('service status', () => {
    it('main_get_connect_status returns a status string', () => {
      expect(['disconnected', 'connecting', 'connected']).toContain(getByName('main_get_connect_status'));
    });

    it('main_check_connect_status does not throw', () => {
      expect(() => setByName('main_check_connect_status')).not.toThrow();
    });

    it('main_start_service does not throw', () => {
      expect(() => setByName('main_start_service')).not.toThrow();
    });

    it('main_stop_service does not throw', () => {
      expect(() => setByName('main_stop_service')).not.toThrow();
    });
  });

  // ---- Favorites ----
  describe('favorites', () => {
    it('main_get_fav / main_store_fav round-trips', () => {
      setByName('main_store_fav', JSON.stringify(['1', '2', '3']));
      const favs = JSON.parse(getByName('main_get_fav'));
      expect(favs).toEqual(['1', '2', '3']);
    });
  });

  // ---- Theme/Language ----
  describe('theme and language', () => {
    it('main_change_theme saves the theme', () => {
      setByName('main_change_theme', 'dark');
      expect(ctx.getTheme()).toBe('dark');
    });

    it('main_change_language saves the language', () => {
      setByName('main_change_language', 'zh-cn');
      expect(ctx.getLanguage()).toBe('zh-cn');
    });

    it('main_get_langs returns a JSON array with "en"', () => {
      const langs = JSON.parse(getByName('main_get_langs'));
      expect(Array.isArray(langs)).toBe(true);
      expect(langs).toContain('en');
    });
  });

  // ---- Codec/Display ----
  describe('codec and display', () => {
    it('main_check_hwcodec returns JSON', () => {
      const result = getByName('main_check_hwcodec');
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('vp9');
      expect(parsed).toHaveProperty('h264');
    });

    it('main_has_hwcodec returns "true" or "false"', () => {
      const result = getByName('main_has_hwcodec');
      expect(['true', 'false']).toContain(result);
    });

    it('main_supported_hwdecodings returns JSON', () => {
      const result = getByName('main_supported_hwdecodings');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('main_supported_privacy_mode_impls returns "[]"', () => {
      expect(getByName('main_supported_privacy_mode_impls')).toBe('[]');
    });

    it('main_default_privacy_mode_impl returns empty', () => {
      expect(getByName('main_default_privacy_mode_impl')).toBe('');
    });

    it('main_get_use_texture_render returns "false"', () => {
      expect(getByName('main_get_use_texture_render')).toBe('false');
    });

    it('main_has_gpu_texture_render returns "false"', () => {
      expect(getByName('main_has_gpu_texture_render')).toBe('false');
    });

    it('main_has_vram returns "false"', () => {
      expect(getByName('main_has_vram')).toBe('false');
    });

    it('main_get_main_display returns "0"', () => {
      expect(getByName('main_get_main_display')).toBe('0');
    });

    it('main_get_displays returns JSON', () => {
      const displays = JSON.parse(getByName('main_get_displays'));
      expect(Array.isArray(displays)).toBe(true);
      expect(displays.length).toBeGreaterThan(0);
    });
  });

  // ---- Stubbed methods (account, audit, hardware, OS) ----
  describe('stubbed methods do not throw', () => {
    const stubbedGetters = [
      'main_account_auth_result',
      'main_has_valid2_fa_sync',
      'main_has_valid_bot_sync',
      'main_current_is_wayland',
      'main_is_login_wayland',
      'main_is_installed',
      'main_is_installed_daemon',
      'main_is_root',
      'main_is_share_rdp',
      'main_get_async_status',
      'main_get_error',
      'main_get_socks',
      'main_get_proxy_status',
      'main_get_license',
      'main_get_fingerprint',
      'main_get_home_dir',
      'main_get_printer_names',
      'main_audio_support_loopback',
      'main_has_file_clipboard',
      'main_max_encrypt_len',
      'main_get_trusted_devices',
    ];

    for (const key of stubbedGetters) {
      it(`getByName("${key}") does not throw`, () => {
        expect(() => getByName(key)).not.toThrow();
      });
    }

    const stubbedSetters = [
      'main_account_auth',
      'main_account_auth_cancel',
      'main_generate2_fa',
      'main_verify2_fa',
      'main_verify_bot',
      'main_deploy_device',
      'main_update_me',
      'main_clip_cursor',
      'main_set_cursor_position',
      'main_check_mouse_time',
      'main_get_mouse_time',
      'main_check_super_user_permission',
      'main_set_share_rdp',
      'main_create_shortcut',
      'main_hide_dock',
      'main_support_remove_wallpaper',
      'main_test_wallpaper',
      'main_start_dbus_server',
      'main_start_ipc_url_server',
      'main_on_main_window_close',
      'main_goto_install',
      'main_wol',
      'main_discover',
      'main_remove_discovered',
      'main_set_unlock_pin',
      'main_get_unlock_pin',
      'main_clear_trusted_devices',
      'main_remove_trusted_devices',
      'main_http_request',
      'main_post_request',
      'main_change_id',
      'main_init',
      'main_set_socks',
      'main_set_home_dir',
      'main_stop_service',
      'main_start_service',
    ];

    for (const key of stubbedSetters) {
      it(`setByName("${key}") does not throw`, () => {
        expect(() => setByName(key, 'test')).not.toThrow();
      });
    }
  });

  // ---- Env vars ----
  describe('environment variables', () => {
    it('main_get_env / main_set_env round-trips', () => {
      setByName('main_set_env', JSON.stringify({ key: 'FOO', value: 'bar' }));
      expect(getByName('main_get_env', 'FOO')).toBe('bar');
    });
  });

  // ---- Input source ----
  describe('input source', () => {
    it('main_get_input_source returns default "Input source 1"', () => {
      expect(getByName('main_get_input_source')).toBe('Input source 1');
    });

    it('main_set_input_source / main_get_input_source round-trips', () => {
      setByName('main_set_input_source', JSON.stringify({ value: 'Input source 2' }));
      expect(getByName('main_get_input_source')).toBe('Input source 2');
    });

    it('main_supported_input_source returns JSON array', () => {
      const sources = JSON.parse(getByName('main_supported_input_source'));
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBe(2);
    });
  });

  // ---- Login device info ----
  describe('login device info', () => {
    it('main_get_login_device_info returns JSON with os, type, name', () => {
      const info = JSON.parse(getByName('main_get_login_device_info'));
      expect(info).toHaveProperty('os');
      expect(info).toHaveProperty('type');
      expect(info).toHaveProperty('name');
      expect(info.type).toBe('Web client');
    });
  });

  // ---- Handle relay ID ----
  describe('handle relay id', () => {
    it('main_handle_relay_id strips trailing \\r', () => {
      expect(getByName('main_handle_relay_id', '123456\\r')).toBe('123456');
    });

    it('main_handle_relay_id strips trailing /r', () => {
      expect(getByName('main_handle_relay_id', '123456/r')).toBe('123456');
    });

    it('main_handle_relay_id returns id unchanged without relay suffix', () => {
      expect(getByName('main_handle_relay_id', '123456')).toBe('123456');
    });
  });

  // ---- Unknown main_* key ----
  describe('unknown main_* key', () => {
    it('unknown main_* setByName warns but does not throw', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => setByName('main_totally_unknown', 'x')).not.toThrow();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('unknown main_* getByName warns and returns empty', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(getByName('main_totally_unknown')).toBe('');
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});