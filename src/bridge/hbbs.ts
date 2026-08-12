/**
 * HBBS API client for address book / group synchronisation.
 *
 * Mirrors the Dart-side HTTP calls in `flutter/lib/models/ab_model.dart`
 * and `flutter/lib/models/group_model.dart`.  All requests use Bearer token
 * authentication (stored in `option:local` → `access_token`).
 *
 * Two modes:
 *  - Legacy:  GET/POST /api/ab  (single JSON blob)
 *  - New:     /api/ab/personal, /api/ab/peers, /api/ab/tags, etc.
 *
 * The legacy mode is tried first; a 404 on /api/ab/personal triggers the
 * fallback.  This matches the Dart `AbModel._loadLegacy` / `_loadCurrent`
 * branching.
 */

import type { ServerConfigLike } from './types';

/** A peer entry in the address book (matches Dart `Peer.fromJson`). */
export interface AbPeer {
  id: string;
  username?: string;
  hostname?: string;
  platform?: string;
  alias?: string;
  tags?: string[];
  hash?: string;
  password?: string;
  note?: string;
  forceAlwaysRelay?: string;
  rdpPort?: string;
  rdpUsername?: string;
  loginName?: string;
  device_group_name?: string;
}

/** Legacy address book JSON shape (tags + peers + tag_colors). */
export interface AbLegacyData {
  tags: string[];
  peers: AbPeer[];
  tag_colors?: string;
}

/** Group cache JSON shape (saved/loaded via save_group/load_group). */
export interface GroupCacheData {
  access_token?: string;
  device_groups?: { name: string }[];
  users?: { name: string; display_name?: string }[];
  peers?: AbPeer[];
}

/** Address book cache JSON shape (saved/loaded via save_ab/load_ab). */
export interface AbCacheData {
  access_token?: string;
  ab_entries?: {
    guid: string;
    name: string;
    tags?: string[];
    peers: AbPeer[];
    tag_colors?: string;
  }[];
}

const PAGE_SIZE = 100;

export class HbbsClient {
  constructor(
    private server: ServerConfigLike,
    private getToken: () => string,
  ) {}

  private get baseUrl(): string {
    const scheme = this.server.useWss ? 'https' : 'http';
    return `${scheme}://${this.server.rendezvousHost}`;
  }

  private get authHeaders(): Record<string, string> {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.authHeaders, ...(init.headers as Record<string, string>) },
    });
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status}`);
    return res.json() as Promise<T>;
  }

  // ---- legacy address book ----

  /** GET /api/ab → returns the raw JSON string of the address book. */
  async getLegacyAb(): Promise<string> {
    const data = await this.request<{ data?: string; licensed_devices?: number }>(
      '/api/ab',
    );
    return data.data ?? '';
  }

  /** POST /api/ab ← push the raw JSON string. */
  async setLegacyAb(json: string): Promise<void> {
    await this.request('/api/ab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: json }),
    });
  }

  // ---- new address book ----

  /** POST /api/ab/personal → personal address book GUID. */
  async getPersonalAbGuid(): Promise<string | null> {
    try {
      const data = await this.request<{ guid?: string }>('/api/ab/personal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '0' },
      });
      return data.guid ?? null;
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return null;
      throw err;
    }
  }

  /** POST /api/ab/settings → max peers per address book. */
  async getAbSettings(): Promise<{ max_peer_one_ab: number }> {
    return this.request<{ max_peer_one_ab: number }>('/api/ab/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '0' },
    });
  }

  /** POST /api/ab/peers?current=N&pageSize=N&ab=<guid> → paginated peers. */
  async getAbPeers(guid: string): Promise<AbPeer[]> {
    const results: AbPeer[] = [];
    let current = 1;
    let total = Infinity;
    while (results.length < total) {
      const data = await this.request<{ total: number; data: AbPeer[] }>(
        `/api/ab/peers?current=${current}&pageSize=${PAGE_SIZE}&ab=${guid}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '0' } },
      );
      total = data.total ?? results.length;
      results.push(...(data.data ?? []));
      current++;
    }
    return results;
  }

  /** POST /api/ab/tags/<guid> → tags for the address book. */
  async getAbTags(guid: string): Promise<{ name: string; color: number }[]> {
    return this.request<{ name: string; color: number }[]>(
      `/api/ab/tags/${guid}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '0' } },
    );
  }

  /** POST /api/ab/peer/add/<guid> ← add a peer. */
  async addPeer(guid: string, peer: Partial<AbPeer>): Promise<void> {
    await this.request(`/api/ab/peer/add/${guid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(peer),
    });
  }

  /** PUT /api/ab/peer/update/<guid> ← update a peer. */
  async updatePeer(guid: string, updates: Record<string, unknown>): Promise<void> {
    await this.request(`/api/ab/peer/update/${guid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  }

  /** DELETE /api/ab/peer/<guid> ← delete peers by IDs. */
  async deletePeers(guid: string, ids: string[]): Promise<void> {
    await this.request(`/api/ab/peer/${guid}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids),
    });
  }

  // ---- groups / accessible resources ----

  /** GET /api/device-group/accessible → paginated device groups. */
  async getDeviceGroups(): Promise<{ name: string }[]> {
    return this.getPaginated('/api/device-group/accessible');
  }

  /** GET /api/users?accessible=&status=1 → paginated users. */
  async getUsers(): Promise<{ name: string; display_name?: string }[]> {
    return this.getPaginated('/api/users?accessible=&status=1');
  }

  /** GET /api/peers?accessible=&status=1 → paginated accessible peers. */
  async getAccessiblePeers(): Promise<AbPeer[]> {
    return this.getPaginated('/api/peers?accessible=&status=1');
  }

  private async getPaginated<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let current = 1;
    let total = Infinity;
    while (results.length < total) {
      const sep = path.includes('?') ? '&' : '?';
      const data = await this.request<{ total: number; data: T[] }>(
        `${path}${sep}current=${current}&pageSize=${PAGE_SIZE}`,
      );
      total = data.total ?? results.length;
      results.push(...(data.data ?? []));
      current++;
    }
    return results;
  }

  // ---- high-level sync ----

  /**
   * Load the address book from the server.
   *
   * Tries the new API first (personal GUID → peers + tags), falls back to
   * the legacy GET /api/ab on 404.  Returns the JSON string to pass to
   * `onLoadAbFinished` (matches Dart `AbModel.pullAb`).
   */
  async loadAb(): Promise<string> {
    const guid = await this.getPersonalAbGuid();
    if (guid) {
      const [peers, tags] = await Promise.all([
        this.getAbPeers(guid),
        this.getAbTags(guid).catch(() => []),
      ]);
      const data: AbCacheData = {
        ab_entries: [{
          guid,
          name: 'My address book',
          tags: tags.map((t) => t.name),
          peers,
          tag_colors: JSON.stringify(
            Object.fromEntries(tags.map((t) => [t.name, t.color])),
          ),
        }],
      };
      return JSON.stringify(data);
    }
    // Legacy fallback
    return this.getLegacyAb();
  }

  /**
   * Load groups / accessible resources from the server.
   *
   * Returns the JSON string to pass to `onLoadGroupFinished`.
   */
  async loadGroup(): Promise<string> {
    const [deviceGroups, users, peers] = await Promise.all([
      this.getDeviceGroups().catch(() => []),
      this.getUsers().catch(() => []),
      this.getAccessiblePeers().catch(() => []),
    ]);
    const data: GroupCacheData = { device_groups: deviceGroups, users, peers };
    return JSON.stringify(data);
  }
}