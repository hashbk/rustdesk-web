export interface ServerConfig {
  rendezvousHost: string;
  relayHost?: string;
  key: string;
  useWss: boolean;
}

export interface SessionConfig {
  peerId: string;
  password?: string;
  accessToken?: string;
  connType?: ConnType;
  myId?: string;
  myName?: string;
  version?: string;
  server: ServerConfig;
  codecPreference?: CodecPreference;
  imageQuality?: ImageQuality;
}

export enum CodecPreference {
  Auto = 0,
  VP9 = 1,
  H264 = 2,
  H265 = 3,
  VP8 = 4,
  AV1 = 5,
}

export enum ImageQuality {
  NotSet = 0,
  Low = 2,
  Balanced = 3,
  Best = 4,
}

export enum ConnType {
  DEFAULT_CONN = 0,
  FILE_TRANSFER = 1,
  PORT_FORWARD = 2,
  RDP = 3,
  VIEW_CAMERA = 4,
  TERMINAL = 5,
}

const RENDEZVOUS_PORT = 21116;
const RELAY_PORT = 21117;
const WS_RENDEZVOUS_PORT = 21118;
const WS_RELAY_PORT = 21119;

interface HostParts {
  host: string;
  isIp: boolean;
  port: number | null;
}

function parseHost(input: string): HostParts {
  const trimmed = input.trim();
  const bracket = trimmed.indexOf('[');
  if (bracket === 0) {
    const close = trimmed.indexOf(']');
    const host = trimmed.slice(1, close);
    const rest = trimmed.slice(close + 1);
    const port = rest.startsWith(':') ? parseInt(rest.slice(1), 10) : null;
    return { host, isIp: true, port };
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon > -1 && /^\d+$/.test(trimmed.slice(colon + 1))) {
    const host = trimmed.slice(0, colon);
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
    return { host, isIp, port: parseInt(trimmed.slice(colon + 1), 10) };
  }
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed);
  return { host: trimmed, isIp, port: null };
}

function wsScheme(useWss: boolean): string {
  return useWss ? 'wss' : 'ws';
}

export function rendezvousWsUrl(server: ServerConfig): string {
  const { host, isIp, port } = parseHost(server.rendezvousHost);
  if (isIp) {
    const p = port ?? WS_RENDEZVOUS_PORT;
    return `${wsScheme(server.useWss)}://${host}:${p}`;
  }
  return `${wsScheme(server.useWss)}://${host}/ws/id`;
}

export function relayWsUrl(server: ServerConfig, relayServerFromResponse?: string): string {
  const source = relayServerFromResponse ?? server.relayHost ?? server.rendezvousHost;
  const { host, isIp, port } = parseHost(source);
  if (isIp) {
    const p = port ? port + 2 : WS_RELAY_PORT;
    return `${wsScheme(server.useWss)}://${host}:${p}`;
  }
  return `${wsScheme(server.useWss)}://${host}/ws/relay`;
}

export const DEFAULT_PORTS = { RENDEZVOUS_PORT, RELAY_PORT, WS_RENDEZVOUS_PORT, WS_RELAY_PORT };