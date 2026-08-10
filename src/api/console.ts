import type { ServerConfig } from '../protocol/config';
import type { ServerConfigResponse, PeersResponse, CurrentUserResponse, AddressBookPeer } from './types';

function baseUrl(): string {
  return (import.meta.env.VITE_CONSOLE_API as string | undefined) ?? '';
}

export class ConsoleApi {
  constructor(private token: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${baseUrl()}${path}`;
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) throw new Error(`console ${path}: ${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  }

  async verifyToken(): Promise<CurrentUserResponse> {
    return this.request<CurrentUserResponse>('/api/currentUser', { method: 'POST' });
  }

  async getServerConfig(): Promise<ServerConfig> {
    const data = await this.request<ServerConfigResponse>('/api/settings/server');
    return {
      rendezvousHost: data.rendezvous_host,
      relayHost: data.relay_host,
      key: data.key,
      useWss: data.use_wss,
    };
  }

  async getPeers(): Promise<AddressBookPeer[]> {
    const data = await this.request<PeersResponse | AddressBookPeer[]>('/api/ab/peers');
    return Array.isArray(data) ? data : data.peers ?? [];
  }
}

export function resolveToken(): string | null {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  const fromHash = params.get('token');
  if (fromHash) return fromHash;

  const query = new URLSearchParams(window.location.search);
  return query.get('token');
}

export function resolvePeerIdHint(): string | null {
  const query = new URLSearchParams(window.location.search);
  return query.get('id');
}

export function clearTokenFromUrl(): void {
  if (window.location.hash.includes('token=')) {
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.delete('token');
    const rest = params.toString();
    const newHash = rest ? `#${rest}` : '';
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${newHash}`);
  }
}