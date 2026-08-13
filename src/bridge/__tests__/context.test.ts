/**
 * Unit tests for BridgeContext — localStorage-backed state and identity.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { BridgeContext, DEFAULT_SERVER } from '../context';

describe('BridgeContext', () => {
  let ctx: BridgeContext;

  beforeEach(() => {
    localStorage.clear();
    ctx = new BridgeContext();
  });

  describe('identity', () => {
    it('getMyId generates and persists a 10-digit id', () => {
      const id = ctx.getMyId();
      expect(id).toMatch(/^\d{10}$/);
      // Persists across instances.
      const ctx2 = new BridgeContext();
      expect(ctx2.getMyId()).toBe(id);
    });

    it('getUuid generates and persists a uuid', () => {
      const uuid = ctx.getUuid();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const ctx2 = new BridgeContext();
      expect(ctx2.getUuid()).toBe(uuid);
    });

    it('getMyName derives a name from the id', () => {
      const name = ctx.getMyName();
      expect(name).toMatch(/^Web-\d{6}$/);
    });

    it('setMyName / getMyName round-trips', () => {
      ctx.setMyName('alice');
      expect(ctx.getMyName()).toBe('alice');
    });
  });

  describe('options', () => {
    it('setOption / getOption round-trips', () => {
      ctx.setOption('key', 'value');
      expect(ctx.getOption('key')).toBe('value');
    });

    it('getOption returns empty string for missing key', () => {
      expect(ctx.getOption('missing')).toBe('');
    });

    it('setOptions replaces all options', () => {
      ctx.setOption('a', '1');
      ctx.setOptions({ b: '2' });
      expect(ctx.getOption('a')).toBe('');
      expect(ctx.getOption('b')).toBe('2');
    });
  });

  describe('local options', () => {
    it('setLocalOption / getLocalOption round-trips', () => {
      ctx.setLocalOption('kb_layout', 'us');
      expect(ctx.getLocalOption('kb_layout')).toBe('us');
    });
  });

  describe('session options', () => {
    it('setSessionOption / getSessionOption round-trips', () => {
      ctx.setSessionOption('view_style', 'original');
      expect(ctx.getSessionOption('view_style')).toBe('original');
    });
  });

  describe('server config auto-load', () => {
    it('loadServerFromOptions restores server config from localStorage', () => {
      ctx.setOption('custom-rendezvous-server', 'my-server.example.com');
      ctx.setOption('relay-server', 'my-relay.example.com');
      ctx.setOption('api-server', 'https://my-api.example.com');
      ctx.setOption('key', 'my-key=');
      ctx.loadServerFromOptions();
      const s = ctx.getServer();
      expect(s.rendezvousHost).toBe('my-server.example.com');
      expect(s.relayHost).toBe('my-relay.example.com');
      expect(s.apiHost).toBe('https://my-api.example.com');
      expect(s.key).toBe('my-key=');
      expect(s.useWss).toBe(true);
    });

    it('loadServerFromOptions does not override when options empty', () => {
      const before = ctx.getServer();
      ctx.loadServerFromOptions();
      expect(ctx.getServer()).toEqual(before);
    });
  });

  describe('toggle options', () => {
    it('setToggleOption / getToggleOption round-trips', () => {
      ctx.setToggleOption('show-remote-cursor', true);
      expect(ctx.getToggleOption('show-remote-cursor')).toBe(true);
      ctx.setToggleOption('show-remote-cursor', false);
      expect(ctx.getToggleOption('show-remote-cursor')).toBe(false);
    });
  });

  describe('favorites', () => {
    it('setFav / getFav round-trips', () => {
      ctx.setFav(['1', '2', '3']);
      expect(ctx.getFav()).toEqual(['1', '2', '3']);
    });

    it('getFav returns empty array by default', () => {
      expect(ctx.getFav()).toEqual([]);
    });
  });

  describe('env vars', () => {
    it('setEnvVar / getEnvVar round-trips', () => {
      ctx.setEnvVar('RUSTDESK_SERVER', 'example.com');
      expect(ctx.getEnvVar('RUSTDESK_SERVER')).toBe('example.com');
    });
  });

  describe('peers', () => {
    it('peerExists / peerHasPassword / removePeer', () => {
      ctx.setPeers([
        { id: '123', password: 'secret' },
        { id: '456' },
      ]);
      expect(ctx.peerExists('123')).toBe(true);
      expect(ctx.peerExists('999')).toBe(false);
      expect(ctx.peerHasPassword('123')).toBe(true);
      expect(ctx.peerHasPassword('456')).toBe(false);
      ctx.removePeer('123');
      expect(ctx.peerExists('123')).toBe(false);
      expect(ctx.peerExists('456')).toBe(true);
    });
  });

  describe('remember', () => {
    it('setRemember / getRemember round-trips', () => {
      ctx.setRemember(true);
      expect(ctx.getRemember()).toBe(true);
      ctx.setRemember(false);
      expect(ctx.getRemember()).toBe(false);
    });
  });

  describe('server config', () => {
    it('defaults to public server', () => {
      expect(ctx.isUsingPublicServer()).toBe(true);
    });

    it('custom server is not public', () => {
      ctx.setServer({ rendezvousHost: 'custom.example.com', key: 'abc', useWss: true });
      expect(ctx.isUsingPublicServer()).toBe(false);
    });

    it('DEFAULT_SERVER has expected host', () => {
      expect(DEFAULT_SERVER.rendezvousHost).toBe('rs-ny.rustdesk.com');
    });
  });

  describe('app metadata', () => {
    it('getAppVersion returns semver', () => {
      expect(ctx.getAppVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('setAppName / getAppName round-trips', () => {
      ctx.setAppName('Custom');
      expect(ctx.getAppName()).toBe('Custom');
    });
  });

  describe('audit', () => {
    it('audit guid round-trips', () => {
      ctx.setAuditGuid('guid-123');
      expect(ctx.getAuditGuid()).toBe('guid-123');
    });

    it('last audit note round-trips', () => {
      ctx.setLastAuditNote('note');
      expect(ctx.getLastAuditNote()).toBe('note');
    });
  });

  describe('address book / group', () => {
    it('address book round-trips', () => {
      ctx.setAddressBook({ peers: [] });
      expect(ctx.getAddressBook()).toEqual({ peers: [] });
      ctx.clearAddressBook();
      expect(ctx.getAddressBook()).toBe('');
    });

    it('group round-trips', () => {
      ctx.setGroup({ name: 'g1' });
      expect(ctx.getGroup()).toEqual({ name: 'g1' });
      ctx.clearGroup();
      expect(ctx.getGroup()).toBe('');
    });
  });

  describe('session lifecycle', () => {
    it('starts disconnected', () => {
      expect(ctx.getConnStatus()).toBe('disconnected');
      expect(ctx.getSession()).toBeNull();
      expect(ctx.getFileTransferManager()).toBeNull();
    });

    it('closeSession resets state', () => {
      ctx.closeSession();
      expect(ctx.getConnStatus()).toBe('disconnected');
      expect(ctx.getSession()).toBeNull();
    });
  });
});