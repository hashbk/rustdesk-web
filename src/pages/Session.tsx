import { useEffect, useState } from 'react';
import type { SessionConfig } from '../protocol/config';
import { useRemoteSession } from '../hooks/useRemoteSession';
import { RemoteScreen } from '../components/RemoteScreen';

interface Props {
  config: SessionConfig;
  onExit: () => void;
}

const STATE_LABEL: Record<string, string> = {
  idle: '空闲',
  'connecting-rendezvous': '连接 rendezvous…',
  'connecting-relay': '连接 relay…',
  handshaking: '加密握手…',
  'logging-in': '登录中…',
  connected: '已连接',
  'need-2fa': '需要二次验证',
  closed: '已断开',
};

export function SessionPage({ config, onExit }: Props) {
  const session = useRemoteSession();
  const [twoFa, setTwoFa] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    session.connect(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = session.state === 'connected';
  const busy = ['connecting-rendezvous', 'connecting-relay', 'handshaking', 'logging-in'].includes(
    session.state,
  );

  return (
    <div className="app-shell session-page">
      <header className="session-toolbar">
        <strong>{config.peerId}</strong>
        <span className="info">{STATE_LABEL[session.state] ?? session.state}</span>
        {session.peerInfo && (
          <span className="info">
            {session.peerInfo.hostname ?? ''} · {session.peerInfo.platform ?? ''}
          </span>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn" onClick={() => setShowLogs((v) => !v)}>
          {showLogs ? '隐藏日志' : '日志'}
        </button>
        <button className="btn btn-danger" onClick={() => { session.close(); onExit(); }}>
          断开
        </button>
      </header>

      <div className="session-stage">
        {connected && (
          <RemoteScreen
            peerInfo={session.peerInfo}
            videoFrame={session.videoFrame}
            sendMouse={session.sendMouse}
            sendKey={session.sendKey}
          />
        )}
        {busy && (
          <div className="state-banner">
            <span className="spinner" />
            {STATE_LABEL[session.state] ?? session.state}
          </div>
        )}
        {session.state === 'need-2fa' && (
          <div className="center-card" style={{ margin: 'auto' }}>
            <div className="field">
              <label>二次验证码 (2FA)</label>
              <input
                className="input"
                value={twoFa}
                onChange={(e) => setTwoFa(e.target.value)}
                placeholder="6 位验证码"
                autoFocus
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => session.send2fa(twoFa)}
            >
              提交
            </button>
          </div>
        )}
        {session.state === 'closed' && !connected && (
          <div className="state-banner">
            {session.closeReason ? `已断开：${session.closeReason}` : '连接已关闭'}
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={onExit}>
                返回
              </button>
            </div>
          </div>
        )}
        {session.error && session.state !== 'connected' && (
          <div className="state-banner" style={{ color: 'var(--danger)' }}>
            {session.error}
          </div>
        )}
      </div>

      {showLogs && (
        <div className="log-panel">
          {session.logs.map((line, i) => (
            <div key={i} className="line">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}