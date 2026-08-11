import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { type SessionConfig, CodecPreference, ImageQuality } from '../protocol/config';
import { useRemoteSession } from '../hooks/useRemoteSession';
import { RemoteScreen } from '../components/RemoteScreen';
import { FileManager } from '../components/FileManager';
import { TerminalPanel } from '../components/Terminal';
import { checkWebCodecsSupport, type RenderStats } from '../media/renderer';

type ScaleMode = 'fit' | 'original';

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
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showElevationDialog, setShowElevationDialog] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [elevationMode, setElevationMode] = useState<'direct' | 'logon'>('direct');
  const [elevationUsername, setElevationUsername] = useState('');
  const [elevationPassword, setElevationPassword] = useState('');
  const pageRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const codecSupport = useMemo(() => checkWebCodecsSupport(), []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      pageRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  useEffect(() => {
    if (!isFullscreen) {
      setToolbarVisible(true);
      return;
    }
    const stage = pageRef.current;
    if (!stage) return;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const onMove = (e: MouseEvent) => {
      if (e.clientY < 50) {
        setToolbarVisible(true);
      }
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (e.clientY >= 50) setToolbarVisible(false);
      }, 2000);
    };
    stage.addEventListener('mousemove', onMove);
    return () => {
      stage.removeEventListener('mousemove', onMove);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [isFullscreen]);

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

  useEffect(() => {
    if (!connected || !session.clipboardSync) return;
    const onCopy = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (text) session.sendClipboard(text);
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, session.clipboardSync]);

  if (!codecSupport.available && connected) {
    return (
    <div className="app-shell session-page" ref={pageRef}>
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
      <header className="session-toolbar" style={isFullscreen && !toolbarVisible ? { transform: 'translateY(-100%)' } : undefined}>
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
        {connected && session.latency !== null && (
          <span className="info" style={{
            color: session.latency < 50 ? 'var(--ok)' : session.latency < 150 ? 'var(--text-dim)' : 'var(--danger)',
          }}>
            {session.latency}ms
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
        {connected && session.peerInfo && (session.peerInfo.displays?.length ?? 0) > 1 && (
          <select
            className="btn"
            value={session.peerInfo.currentDisplay ?? 0}
            onChange={(e) => session.sendSwitchDisplay(Number(e.target.value))}
            title="显示器"
            style={{ padding: '4px 8px' }}
          >
            {session.peerInfo.displays?.map((d, i) => (
              <option key={i} value={i}>显示器{i + 1} ({d.width}×{d.height})</option>
            ))}
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
        {connected && (
          <select
            className="btn"
            value={scaleMode}
            onChange={(e) => setScaleMode(e.target.value as ScaleMode)}
            title="缩放模式"
            style={{ padding: '4px 8px' }}
          >
            <option value="fit">适应窗口</option>
            <option value="original">原始尺寸</option>
          </select>
        )}
        {connected && session.peerInfo?.platform === 'Windows' && (
          <button
            className="btn"
            onClick={() => setShowElevationDialog(true)}
            title="请求 UAC 提权"
          >
            提权
          </button>
        )}
        {connected && (
          <button
            className="btn"
            onClick={() => setShowFileManager((v) => !v)}
            title="文件传输"
          >
            文件
          </button>
        )}
        {connected && session.peerInfo?.features?.terminal && (
          <button
            className="btn"
            onClick={() => setShowTerminal((v) => !v)}
            title="终端"
          >
            终端
          </button>
        )}
        {connected && (
          <button
            className="btn"
            onClick={() => session.setClipboardSync(!session.clipboardSync)}
            title="剪贴板同步"
          >
            {session.clipboardSync ? '剪贴板✓' : '剪贴板'}
          </button>
        )}
        {connected && session.peerInfo?.features?.privacyMode && (
          <button
            className="btn"
            onClick={session.togglePrivacyMode}
            title="隐私模式 (隐藏远程屏幕)"
          >
            {session.privacyMode ? '隐私模式✓' : '隐私模式'}
          </button>
        )}
        {connected && (
          <button
            className="btn"
            onClick={() => setShowSettings((v) => !v)}
            title="会话选项"
          >
            设置
          </button>
        )}
        {connected && (
          <button
            className="btn"
            onClick={toggleFullscreen}
            title="全屏 (F11)"
          >
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
        )}
        {connected && session.peerInfo && ['Linux', 'Windows', 'Mac OS'].includes(session.peerInfo.platform ?? '') && (
          <button
            className="btn btn-danger"
            onClick={() => setShowRestartConfirm(true)}
            title="重启远程设备"
          >
            重启
          </button>
        )}
        <button className="btn" onClick={() => setShowLogs((v) => !v)}>
          {showLogs ? '隐藏日志' : '日志'}
        </button>
        <button className="btn btn-danger" onClick={() => { session.close(); onExit(); }}>
          断开
        </button>
      </header>

      <div className="session-stage" ref={stageRef}>
        {connected && (
          <RemoteScreen
            peerInfo={session.peerInfo}
            videoFrame={session.videoFrame}
            cursorData={session.cursorData}
            cursorPosition={session.cursorPosition}
            viewOnly={viewOnly}
            scaleMode={scaleMode}
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

      {session.messageBox && (
        <div className="modal-overlay" onClick={session.dismissMessageBox}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px' }}>
              {session.messageBox.title || '消息'}
            </h3>
            <p style={{ margin: '0 0 16px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {session.messageBox.text}
            </p>
            {session.messageBox.link && (
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--accent)' }}>
                {session.messageBox.link}
              </p>
            )}
            <button
              className="btn btn-primary"
              onClick={session.dismissMessageBox}
            >
              确定
            </button>
          </div>
        </div>
      )}

      {showElevationDialog && (
        <div className="modal-overlay" onClick={() => setShowElevationDialog(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>请求 UAC 提权</h3>
            <div className="field">
              <label>
                <input
                  type="radio"
                  checked={elevationMode === 'direct'}
                  onChange={() => setElevationMode('direct')}
                  style={{ marginRight: 8 }}
                />
                直接提权
              </label>
              <label style={{ marginTop: 8, display: 'block' }}>
                <input
                  type="radio"
                  checked={elevationMode === 'logon'}
                  onChange={() => setElevationMode('logon')}
                  style={{ marginRight: 8 }}
                />
                使用账号密码提权
              </label>
            </div>
            {elevationMode === 'logon' && (
              <>
                <div className="field">
                  <label>用户名</label>
                  <input
                    className="input"
                    value={elevationUsername}
                    onChange={(e) => setElevationUsername(e.target.value)}
                    placeholder="管理员用户名"
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>密码</label>
                  <input
                    className="input"
                    type="password"
                    value={elevationPassword}
                    onChange={(e) => setElevationPassword(e.target.value)}
                    placeholder="管理员密码"
                  />
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowElevationDialog(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (elevationMode === 'direct') {
                    session.sendElevationRequest(true);
                  } else {
                    if (!elevationUsername || !elevationPassword) return;
                    session.sendElevationWithLogon(elevationUsername, elevationPassword);
                  }
                  setShowElevationDialog(false);
                  setElevationUsername('');
                  setElevationPassword('');
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {session.elevationResponse !== null && (
        <div className="modal-overlay" onClick={session.dismissElevationResponse}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px' }}>
              {session.elevationResponse === '' ? '等待 UAC' : '提权错误'}
            </h3>
            <p style={{ margin: '0 0 16px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {session.elevationResponse === ''
                ? '请在远程主机上确认 UAC 提权请求…'
                : session.elevationResponse}
            </p>
            <button
              className="btn btn-primary"
              onClick={session.dismissElevationResponse}
            >
              确定
            </button>
          </div>
        </div>
      )}

      {session.privacyModeMessage !== null && (
        <div className="modal-overlay" onClick={session.dismissPrivacyModeMessage}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px' }}>隐私模式</h3>
            <p style={{ margin: '0 0 16px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {session.privacyModeMessage}
            </p>
            <button
              className="btn btn-primary"
              onClick={session.dismissPrivacyModeMessage}
            >
              确定
            </button>
          </div>
        </div>
      )}

      {showRestartConfirm && (
        <div className="modal-overlay" onClick={() => setShowRestartConfirm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px' }}>重启远程设备</h3>
            <p style={{ margin: '0 0 16px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              确定要重启远程设备吗？
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowRestartConfirm(false)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  session.sendRestartRemoteDevice();
                  setShowRestartConfirm(false);
                }}
              >
                重启
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && connected && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>会话选项</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {([
                { label: '显示远程光标', checked: session.showRemoteCursor, onChange: session.setShowRemoteCursor },
                { label: '断开后锁定远程', checked: session.lockAfterSessionEnd, onChange: session.setLockAfterSessionEnd },
                { label: '跟随远程光标', checked: session.followRemoteCursor, onChange: session.setFollowRemoteCursor },
                { label: '跟随远程窗口', checked: session.followRemoteWindow, onChange: session.setFollowRemoteWindow },
                { label: '显示我的光标', checked: session.showMyCursor, onChange: session.setShowMyCursor },
                { label: '禁用音频', checked: session.disableAudio, onChange: session.setDisableAudio },
                { label: '禁用剪贴板', checked: session.disableClipboard, onChange: session.setDisableClipboard },
                { label: '禁用键盘', checked: session.disableKeyboard, onChange: session.setDisableKeyboard },
              ]).map((opt) => (
                <label key={opt.label} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={opt.checked}
                    onChange={(e) => opt.onChange(e.target.checked)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <div className="field">
              <label>自定义 FPS (0 = 默认)</label>
              <input
                className="input"
                type="number"
                min={0}
                max={120}
                value={session.customFps}
                onChange={(e) => session.setCustomFps(Number(e.target.value))}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setShowSettings(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {showFileManager && connected && (
        <FileManager
          remoteDir={session.remoteDir}
          transfers={session.transfers}
          onReadDir={session.readRemoteDir}
          onUpload={session.uploadFile}
          onCancel={session.cancelTransfer}
          onClose={() => setShowFileManager(false)}
        />
      )}

      {showTerminal && connected && (
        <TerminalPanel
          config={config}
          onClose={() => setShowTerminal(false)}
        />
      )}
    </div>
  );
}