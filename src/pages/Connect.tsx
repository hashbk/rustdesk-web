import { useEffect, useMemo, useState } from 'react';
import type { SessionConfig, ServerConfig } from '../protocol/config';
import { ConsoleApi, resolveToken, resolvePeerIdHint, clearTokenFromUrl } from '../api/console';
import type { AddressBookPeer } from '../api/types';
import { DEFAULT_RS_PUB_KEY } from '../protocol/session';

interface Props {
  onConnect: (config: SessionConfig) => void;
}

function fallbackServerConfig(): ServerConfig | null {
  const host = import.meta.env.VITE_FALLBACK_RENDEZVOUS_HOST as string | undefined;
  if (!host) return null;
  return {
    rendezvousHost: host,
    relayHost: (import.meta.env.VITE_FALLBACK_RELAY_HOST as string | undefined) ?? undefined,
    key: (import.meta.env.VITE_FALLBACK_KEY as string | undefined) ?? '',
    useWss: ((import.meta.env.VITE_FALLBACK_USE_WSS as string | undefined) ?? 'true') !== 'false',
  };
}

export function ConnectPage({ onConnect }: Props) {
  const token = useMemo(() => resolveToken(), []);
  const [peers, setPeers] = useState<AddressBookPeer[]>([]);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [peerId, setPeerId] = useState(resolvePeerIdHint() ?? '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);

  useEffect(() => {
    if (token) clearTokenFromUrl();
    const api = token ? new ConsoleApi(token) : null;
    let cancelled = false;

    async function load() {
      if (api) {
        try {
          const user = await api.verifyToken();
          if (!cancelled) setTokenValid(true);
          void user;
        } catch (e) {
          if (!cancelled) {
            setTokenValid(false);
            setConfigError(`console token 验证失败：${(e as Error).message}`);
          }
        }
        try {
          const cfg = await api.getServerConfig();
          if (!cancelled) setServerConfig(cfg);
        } catch (e) {
          if (!cancelled) setConfigError(`无法从 console 获取服务器配置：${(e as Error).message}`);
        }
        try {
          const list = await api.getPeers();
          if (!cancelled) setPeers(list);
        } catch {
          /* address book optional */
        }
      }
      if (!serverConfig && !cancelled) {
        const fb = fallbackServerConfig();
        if (fb) setServerConfig(fb);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token, serverConfig]);

  function doConnect(id: string, pw: string) {
    if (!id.trim()) return;
    const server = serverConfig ?? fallbackServerConfig();
    if (!server) {
      setConfigError('缺少 rendezvous 服务器配置。请接入 console 或设置 VITE_FALLBACK_* 环境变量。');
      return;
    }
    setLoading(true);
    onConnect({
      peerId: id.trim(),
      password: pw,
      server,
      myName: 'RustDesk Web',
    });
  }

  const effectiveKey = serverConfig?.key || DEFAULT_RS_PUB_KEY;
  const usingFallback = !serverConfig;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>RustDesk Web · 远程协助</h1>
        <span className="spacer" />
        <span className="tag">{token ? (tokenValid === false ? 'token 无效' : '已登录 console') : '未携带 token'}</span>
        <span className="tag">{usingFallback ? '回退配置' : 'console 配置'}</span>
      </header>
      <div className="page">
        <div className="center-card">
          {configError && <div className="error-box">{configError}</div>}
          {peers.length > 0 && (
            <>
              <div className="field">
                <label>地址簿设备</label>
                <div className="peer-list">
                  {peers.map((p) => (
                    <div
                      key={p.id}
                      className="peer-row"
                      onClick={() => {
                        setPeerId(p.id);
                        setPassword(p.password ?? '');
                      }}
                    >
                      <span className="id">{p.id}</span>
                      <span className="alias">{p.alias ?? p.hostname ?? ''}</span>
                      <span className="meta">{p.platform ?? ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="field">
            <label>设备 ID</label>
            <input
              className="input"
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
              placeholder="例如 123456789"
              autoFocus
            />
          </div>
          <div className="field">
            <label>密码</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="连接密码"
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={!peerId.trim() || loading}
            onClick={() => doConnect(peerId, password)}
          >
            连接
          </button>
          <div className="hint">
            浏览器远程控制通过 WebSocket + Relay 连接 RustDesk hbbs/hbbr，不支持 UDP 打洞。
            {effectiveKey === DEFAULT_RS_PUB_KEY && ' 当前使用公共服务器公钥。'}
          </div>
        </div>
      </div>
    </div>
  );
}