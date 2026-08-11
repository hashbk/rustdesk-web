import { useEffect, useMemo, useRef, useState } from 'react';
import { type SessionConfig, CodecPreference, ImageQuality } from '../protocol/config';
import { useRemoteSession } from '../hooks/useRemoteSession';
import { RemoteScreen } from '../components/RemoteScreen';
import { checkWebCodecsSupport, type RenderStats } from '../media/renderer';

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
  const [viewOnly, setViewOnly] = useState(false);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const configRef = useRef(config);
  configRef.current = config;

  const codecSupport = useMemo(() => checkWebCodecsSupport(), []);

  useEffect(() => {
    session.connect(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session.state === 'closed' && !session.error && reconnectAttempt < 3) {
      const timer = setTimeout(() => {
        setReconnectAttempt((n) => n + 1);
        session.connect(configRef.current);
      }, 2000 * (reconnectAttempt + 1));
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.state, session.error, reconnectAttempt]);

  const connected = session.state === 'connected';
  const busy = ['connecting-rendezvous', 'connecting-relay', 'handshaking', 'logging-in'].includes(
    session.state,
  );

  if (!codecSupport.available && connected) {
    return (
      <div className="app-shell session-page">
        <header className="session-toolbar">
          <strong>{config.peerId}</strong>
          <span className="info">WebCodecs 不可用</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onExit}>返回</button>
        </header>
        <div className="session-stage">
          <div className="state-banner" style={{ color: 'var(--danger)' }}>
            当前浏览器不支持 WebCodecs VideoDecoder，无法解码远程视频。
            <br />
            缺少编解码器：{codecSupport.missing.join(', ') || '全部'}
            <br />
            请使用 Chrome 94+ / Edge 94+ 或其他支持 WebCodecs 的浏览器。
          </div>
        </div>
      </div>
    );
  }

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
        {stats && connected && (
          <span className="info">
            {stats.width}×{stats.height} · {stats.fps}fps · {stats.activeCodec ?? '?'}
            {stats.droppedFrames > 0 && ` · 丢${stats.droppedFrames}`}
          </span>
        )}
        {reconnectAttempt > 0 && session.state !== 'connected' && (
          <span className="info">重连中 ({reconnectAttempt}/3)</span>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        {connected && (
          <button
            className="btn"
            onClick={() => setViewOnly((v) => !v)}
            title="切换只读模式"
          >
            {viewOnly ? '只读' : '可控制'}
          </button>
        )}
        {connected && session.audioEnabled && (
          <button
            className="btn"
            onClick={() => session.setMuted(!session.muted)}
            title="静音/取消静音"
          >
            {session.muted ? '🔇' : '🔊'}
          </button>
        )}
        {connected && session.codecAbilities && (
          <select
            className="btn"
            value={session.codecPreference}
            onChange={(e) => session.setCodecPreference(Number(e.target.value) as CodecPreference)}
            title="编解码器偏好"
            style={{ padding: '4px 8px' }}
          >
            <option value={CodecPreference.Auto}>自动</option>
            <option value={CodecPreference.VP9} disabled={!session.codecAbilities.vp9}>VP9</option>
            <option value={CodecPreference.H264} disabled={!session.codecAbilities.h264}>H264</option>
            <option value={CodecPreference.H265} disabled={!session.codecAbilities.h265}>H265</option>
            <option value={CodecPreference.VP8} disabled={!session.codecAbilities.vp8}>VP8</option>
          </select>
        )}
        {connected && (
          <select
            className="btn"
            value={session.imageQuality}
            onChange={(e) => session.setImageQuality(Number(e.target.value) as ImageQuality)}
            title="图像质量"
            style={{ padding: '4px 8px' }}
          >
            <option value={ImageQuality.Best}>最佳</option>
            <option value={ImageQuality.Balanced}>平衡</option>
            <option value={ImageQuality.Low}>低</option>
          </select>
        )}
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
            cursorData={session.cursorData}
            cursorPosition={session.cursorPosition}
            viewOnly={viewOnly}
            sendMouse={session.sendMouse}
            sendKey={session.sendKey}
            onStats={setStats}
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
              <button className="btn" onClick={() => {
                setReconnectAttempt(0);
                session.connect(configRef.current);
              }}>
                重连
              </button>
              <button className="btn" style={{ marginLeft: 8 }} onClick={onExit}>
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