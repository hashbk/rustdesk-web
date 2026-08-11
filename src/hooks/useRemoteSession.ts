import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteSession, type SessionState, type SessionEvents, PrivacyModeState, type PrivacyModeNotification, BlockInputState, type BlockInputNotification, type SessionOptionMessage, boolToOption } from '../protocol/session';
import { type SessionConfig, CodecPreference, ImageQuality } from '../protocol/config';
import type { PeerInfoT, VideoFrameT, MessageT } from '../protos';
import { AudioPlayer } from '../media/AudioPlayer';
import type { CodecAbilities } from '../media/renderer';
import { FileTransferManager, type TransferProgress, type RemoteDir } from '../protocol/file_transfer';

export interface CursorData {
  id: number;
  hotx: number;
  hoty: number;
  width: number;
  height: number;
  colors: Uint8Array;
}

export interface CursorPosition {
  x: number;
  y: number;
}

export interface MessageBoxData {
  msgType?: string;
  title?: string;
  text?: string;
  link?: string;
}

export interface RemoteSessionHook {
  state: SessionState;
  peerInfo: PeerInfoT | null;
  error: string | null;
  closeReason: string | null;
  logs: string[];
  videoFrame: { frame: VideoFrameT; seq: number } | null;
  cursorData: CursorData | null;
  cursorPosition: CursorPosition | null;
  latency: number | null;
  messageBox: MessageBoxData | null;
  muted: boolean;
  audioEnabled: boolean;
  codecPreference: CodecPreference;
  codecAbilities: CodecAbilities | null;
  imageQuality: ImageQuality;
  clipboardSync: boolean;
  connect: (config: SessionConfig) => void;
  send2fa: (code: string) => void;
  close: () => void;
  sendMouse: (event: NonNullable<MessageT['mouseEvent']>) => void;
  sendKey: (event: NonNullable<MessageT['keyEvent']>) => void;
  setMuted: (muted: boolean) => void;
  setCodecPreference: (prefer: CodecPreference) => void;
  setImageQuality: (quality: ImageQuality) => void;
  setCustomImageQuality: (quality: number) => void;
  setClipboardSync: (enabled: boolean) => void;
  sendClipboard: (text: string) => void;
  dismissMessageBox: () => void;
  sendSwitchDisplay: (display: number) => void;
  sendRestartRemoteDevice: () => void;
  readRemoteDir: (path: string) => void;
  uploadFile: (file: File, remotePath: string) => Promise<void>;
  cancelTransfer: (id: number) => void;
  remoteDir: RemoteDir | null;
  transfers: TransferProgress[];
  elevationResponse: string | null;
  sendElevationRequest: (direct: boolean) => void;
  sendElevationWithLogon: (username: string, password: string) => void;
  dismissElevationResponse: () => void;
  privacyMode: boolean;
  privacyModeMessage: string | null;
  togglePrivacyMode: () => void;
  dismissPrivacyModeMessage: () => void;
  blockInput: boolean;
  blockInputMessage: string | null;
  toggleBlockInput: () => void;
  dismissBlockInputMessage: () => void;
  showRemoteCursor: boolean;
  lockAfterSessionEnd: boolean;
  followRemoteCursor: boolean;
  followRemoteWindow: boolean;
  showMyCursor: boolean;
  disableAudio: boolean;
  disableClipboard: boolean;
  disableKeyboard: boolean;
  customFps: number;
  setShowRemoteCursor: (enabled: boolean) => void;
  setLockAfterSessionEnd: (enabled: boolean) => void;
  setFollowRemoteCursor: (enabled: boolean) => void;
  setFollowRemoteWindow: (enabled: boolean) => void;
  setShowMyCursor: (enabled: boolean) => void;
  setDisableAudio: (enabled: boolean) => void;
  setDisableClipboard: (enabled: boolean) => void;
  setDisableKeyboard: (enabled: boolean) => void;
  setCustomFps: (fps: number) => void;
}

export function useRemoteSession(): RemoteSessionHook {
  const sessionRef = useRef<RemoteSession | null>(null);
  const [state, setState] = useState<SessionState>('idle');
  const [peerInfo, setPeerInfo] = useState<PeerInfoT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [videoFrame, setVideoFrame] = useState<{ frame: VideoFrameT; seq: number } | null>(null);
  const [cursorData, setCursorData] = useState<CursorData | null>(null);
  const [cursorPosition, setCursorPosition] = useState<CursorPosition | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [messageBox, setMessageBox] = useState<MessageBoxData | null>(null);
  const [muted, setMutedState] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [codecPreference, setCodecPreferenceState] = useState<CodecPreference>(CodecPreference.Auto);
  const [codecAbilities, setCodecAbilities] = useState<CodecAbilities | null>(null);
  const [imageQuality, setImageQualityState] = useState<ImageQuality>(ImageQuality.Balanced);
  const [clipboardSync, setClipboardSyncState] = useState(false);
  const seqRef = useRef(0);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const mutedRef = useRef(false);
  const ftmRef = useRef<FileTransferManager | null>(null);
  const [remoteDir, setRemoteDir] = useState<RemoteDir | null>(null);
  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  const [elevationResponse, setElevationResponse] = useState<string | null>(null);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [privacyModeMessage, setPrivacyModeMessage] = useState<string | null>(null);
  const [blockInput, setBlockInput] = useState(false);
  const [blockInputMessage, setBlockInputMessage] = useState<string | null>(null);
  const clipboardSyncRef = useRef(false);
  const [showRemoteCursor, setShowRemoteCursorState] = useState(false);
  const [lockAfterSessionEnd, setLockAfterSessionEndState] = useState(false);
  const [followRemoteCursor, setFollowRemoteCursorState] = useState(false);
  const [followRemoteWindow, setFollowRemoteWindowState] = useState(false);
  const [showMyCursor, setShowMyCursorState] = useState(false);
  const [disableAudio, setDisableAudioState] = useState(false);
  const [disableClipboard, setDisableClipboardState] = useState(false);
  const [disableKeyboard, setDisableKeyboardState] = useState(false);
  const [customFps, setCustomFpsState] = useState(0);
  const sessionOptionsRef = useRef<SessionOptionMessage>({});

  const pushLog = useCallback((msg: string) => {
    setLogs((prev) => (prev.length > 200 ? [...prev.slice(-199), msg] : [...prev, msg]));
  }, []);

  const connect = useCallback(
    (config: SessionConfig) => {
      if (sessionRef.current) sessionRef.current.close();
      setError(null);
      setCloseReason(null);
      setPeerInfo(null);
      setLogs([]);
      setCursorData(null);
      setCursorPosition(null);
      setLatency(null);
      setMessageBox(null);
      setElevationResponse(null);
      setPrivacyMode(false);
      setPrivacyModeMessage(null);
      setBlockInput(false);
      setBlockInputMessage(null);

      const session = new RemoteSession(config);
      session.setInitialOptions(sessionOptionsRef.current);
      sessionRef.current = session;
      const handlers: Partial<SessionEvents> = {
        stateChange: setState,
        peerInfo: (info) => {
          setPeerInfo(info);
          setCodecAbilities(sessionRef.current?.getCodecAbilities() ?? null);
        },
        videoFrame: (frame) => {
          seqRef.current += 1;
          setVideoFrame({ frame, seq: seqRef.current });
        },
        cursorData: (cd) => {
          setCursorData({
            id: cd.id ?? 0,
            hotx: cd.hotx ?? 0,
            hoty: cd.hoty ?? 0,
            width: cd.width ?? 0,
            height: cd.height ?? 0,
            colors: cd.colors ?? new Uint8Array(),
          });
        },
        cursorPosition: (pos) => {
          setCursorPosition({ x: pos.x ?? 0, y: pos.y ?? 0 });
        },
        latency: (ms) => setLatency(ms),
        messageBox: (box) => {
          setMessageBox({
            msgType: box.msgType,
            title: box.title,
            text: box.text,
            link: box.link,
          });
        },
        fileResponse: (resp) => {
          ftmRef.current?.handleFileResponse(resp);
        },
        audioFormat: async (fmt) => {
          const sr = fmt.sampleRate ?? 48000;
          const ch = fmt.channels ?? 2;
          if (!audioPlayerRef.current) {
            audioPlayerRef.current = new AudioPlayer((e) => pushLog(`audio: ${e.message}`));
          }
          const ok = await audioPlayerRef.current.configure(sr, ch);
          setAudioEnabled(ok);
          if (ok) audioPlayerRef.current.setMuted(mutedRef.current);
        },
        audioFrame: (frame) => {
          audioPlayerRef.current?.handleFrame(frame.data ?? new Uint8Array());
        },
        clipboard: (clip) => {
          if (!clipboardSyncRef.current) return;
          if (clip.compress) return;
          const content = clip.content ?? new Uint8Array();
          if (content.length === 0) return;
          const text = new TextDecoder().decode(content);
          navigator.clipboard?.writeText(text).catch(() => {});
        },
        error: (e) => {
          setError(e.message);
          pushLog(`error: ${e.message}`);
        },
        closeReason: (reason) => setCloseReason(reason),
        elevationResponse: (resp) => setElevationResponse(resp),
        privacyModeState: (notification: PrivacyModeNotification) => {
          const msg = privacyModeMessageText(notification);
          setPrivacyModeMessage(msg);
          if (notification.state === PrivacyModeState.PrvOnSucceeded) {
            setPrivacyMode(true);
          } else if (
            notification.state === PrivacyModeState.PrvOffSucceeded ||
            notification.state === PrivacyModeState.PrvOffByPeer ||
            notification.state === PrivacyModeState.PrvNotSupported ||
            notification.state === PrivacyModeState.PrvOnFailedDenied ||
            notification.state === PrivacyModeState.PrvOnFailedPlugin ||
            notification.state === PrivacyModeState.PrvOnFailed ||
            notification.state === PrivacyModeState.PrvOffFailed
          ) {
            setPrivacyMode(false);
          }
        },
        blockInputState: (notification: BlockInputNotification) => {
          const msg = blockInputMessageText(notification);
          setBlockInputMessage(msg);
          if (notification.state === BlockInputState.BlkOnSucceeded) {
            setBlockInput(true);
          } else if (
            notification.state === BlockInputState.BlkOffSucceeded ||
            notification.state === BlockInputState.BlkOnFailed ||
            notification.state === BlockInputState.BlkOffFailed
          ) {
            setBlockInput(false);
          }
        },
        log: pushLog,
      };
      for (const [k, fn] of Object.entries(handlers)) {
        session.on(k as keyof SessionEvents, fn as never);
      }
      ftmRef.current = new FileTransferManager(
        (a) => session.sendFileAction(a),
        (r) => session.sendFileResponse(r),
      );
      ftmRef.current.setCallbacks(
        (dir) => setRemoteDir(dir),
        (p) => setTransfers((prev) => {
          const idx = prev.findIndex((t) => t.id === p.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = p;
            return next;
          }
          return [...prev, p];
        }),
      );
      void session.connect();
    },
    [pushLog],
  );

  const send2fa = useCallback((code: string) => {
    void sessionRef.current?.send2fa(code);
  }, []);

  const close = useCallback(() => {
    sessionRef.current?.close();
  }, []);

  const sendMouse = useCallback((event: NonNullable<MessageT['mouseEvent']>) => {
    sessionRef.current?.sendMouse(event);
  }, []);

  const sendKey = useCallback((event: NonNullable<MessageT['keyEvent']>) => {
    sessionRef.current?.sendKey(event);
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    mutedRef.current = m;
    audioPlayerRef.current?.setMuted(m);
  }, []);

  const setCodecPreference = useCallback((prefer: CodecPreference) => {
    setCodecPreferenceState(prefer);
    sessionRef.current?.sendCodecPreference(prefer);
  }, []);

  const setImageQuality = useCallback((quality: ImageQuality) => {
    setImageQualityState(quality);
    sessionRef.current?.sendImageQuality(quality);
  }, []);

  const setCustomImageQuality = useCallback((quality: number) => {
    setImageQualityState(ImageQuality.NotSet);
    sessionRef.current?.sendCustomImageQuality(quality);
  }, []);

  const setClipboardSync = useCallback((enabled: boolean) => {
    setClipboardSyncState(enabled);
    clipboardSyncRef.current = enabled;
  }, []);

  const sendClipboard = useCallback((text: string) => {
    if (!clipboardSyncRef.current) return;
    const content = new TextEncoder().encode(text);
    sessionRef.current?.sendClipboard(content);
  }, []);

  const dismissMessageBox = useCallback(() => setMessageBox(null), []);

  const sendSwitchDisplay = useCallback((display: number) => {
    sessionRef.current?.sendSwitchDisplay(display);
  }, []);

  const sendRestartRemoteDevice = useCallback(() => {
    sessionRef.current?.sendRestartRemoteDevice();
  }, []);

  const readRemoteDir = useCallback((path: string) => {
    ftmRef.current?.readRemoteDir(path);
  }, []);

  const uploadFile = useCallback(async (file: File, remotePath: string) => {
    await ftmRef.current?.uploadFile(file, remotePath);
  }, []);

  const cancelTransfer = useCallback((id: number) => {
    ftmRef.current?.cancelTransfer(id);
  }, []);

  const sendElevationRequest = useCallback((direct: boolean) => {
    sessionRef.current?.sendElevationRequest(direct);
  }, []);

  const sendElevationWithLogon = useCallback((username: string, password: string) => {
    sessionRef.current?.sendElevationWithLogon(username, password);
  }, []);

  const dismissElevationResponse = useCallback(() => setElevationResponse(null), []);

  const togglePrivacyMode = useCallback(() => {
    setPrivacyModeMessage(null);
    sessionRef.current?.sendPrivacyMode(!privacyMode);
  }, [privacyMode]);

  const dismissPrivacyModeMessage = useCallback(() => setPrivacyModeMessage(null), []);

  const toggleBlockInput = useCallback(() => {
    setBlockInputMessage(null);
    sessionRef.current?.sendBlockInput(!blockInput);
  }, [blockInput]);

  const dismissBlockInputMessage = useCallback(() => setBlockInputMessage(null), []);

  const toggleBoolOption = useCallback(
    (key: keyof SessionOptionMessage, enabled: boolean): void => {
      const value = boolToOption(enabled);
      sessionOptionsRef.current = { ...sessionOptionsRef.current, [key]: value };
      sessionRef.current?.sendOption({ [key]: value } as SessionOptionMessage);
    },
    [],
  );

  const setShowRemoteCursor = useCallback((enabled: boolean) => {
    setShowRemoteCursorState(enabled);
    toggleBoolOption('showRemoteCursor', enabled);
  }, [toggleBoolOption]);

  const setLockAfterSessionEnd = useCallback((enabled: boolean) => {
    setLockAfterSessionEndState(enabled);
    toggleBoolOption('lockAfterSessionEnd', enabled);
  }, [toggleBoolOption]);

  const setFollowRemoteCursor = useCallback((enabled: boolean) => {
    setFollowRemoteCursorState(enabled);
    toggleBoolOption('followRemoteCursor', enabled);
  }, [toggleBoolOption]);

  const setFollowRemoteWindow = useCallback((enabled: boolean) => {
    setFollowRemoteWindowState(enabled);
    toggleBoolOption('followRemoteWindow', enabled);
  }, [toggleBoolOption]);

  const setShowMyCursor = useCallback((enabled: boolean) => {
    setShowMyCursorState(enabled);
    toggleBoolOption('showMyCursor', enabled);
  }, [toggleBoolOption]);

  const setDisableAudio = useCallback((enabled: boolean) => {
    setDisableAudioState(enabled);
    toggleBoolOption('disableAudio', enabled);
  }, [toggleBoolOption]);

  const setDisableClipboard = useCallback((enabled: boolean) => {
    setDisableClipboardState(enabled);
    toggleBoolOption('disableClipboard', enabled);
  }, [toggleBoolOption]);

  const setDisableKeyboard = useCallback((enabled: boolean) => {
    setDisableKeyboardState(enabled);
    toggleBoolOption('disableKeyboard', enabled);
  }, [toggleBoolOption]);

  const setCustomFps = useCallback((fps: number) => {
    const value = Math.max(0, Math.floor(fps));
    setCustomFpsState(value);
    sessionOptionsRef.current = { ...sessionOptionsRef.current, customFps: value };
    sessionRef.current?.sendOption({ customFps: value });
  }, []);


  useEffect(() => {
    return () => {
      sessionRef.current?.close();
      audioPlayerRef.current?.destroy();
    };
  }, []);

  return {
    state,
    peerInfo,
    error,
    closeReason,
    logs,
    videoFrame,
    cursorData,
    cursorPosition,
    latency,
    messageBox,
    muted,
    audioEnabled,
    codecPreference,
    codecAbilities,
    imageQuality,
    clipboardSync,
    connect,
    send2fa,
    close,
    sendMouse,
    sendKey,
    setMuted,
    setCodecPreference,
    setImageQuality,
    setCustomImageQuality,
    setClipboardSync,
    sendClipboard,
    dismissMessageBox,
    sendSwitchDisplay,
    sendRestartRemoteDevice,
    readRemoteDir,
    uploadFile,
    cancelTransfer,
    remoteDir,
    transfers,
    elevationResponse,
    sendElevationRequest,
    sendElevationWithLogon,
    dismissElevationResponse,
    privacyMode,
    privacyModeMessage,
    togglePrivacyMode,
    dismissPrivacyModeMessage,
    blockInput,
    blockInputMessage,
    toggleBlockInput,
    dismissBlockInputMessage,
    showRemoteCursor,
    lockAfterSessionEnd,
    followRemoteCursor,
    followRemoteWindow,
    showMyCursor,
    disableAudio,
    disableClipboard,
    disableKeyboard,
    customFps,
    setShowRemoteCursor,
    setLockAfterSessionEnd,
    setFollowRemoteCursor,
    setFollowRemoteWindow,
    setShowMyCursor,
    setDisableAudio,
    setDisableClipboard,
    setDisableKeyboard,
    setCustomFps,
  };
}

function privacyModeMessageText(notification: PrivacyModeNotification): string {
  switch (notification.state) {
    case PrivacyModeState.PrvOnByOther:
      return 'Someone turns on privacy mode, exit';
    case PrivacyModeState.PrvNotSupported:
      return 'Privacy mode is not supported on the remote side';
    case PrivacyModeState.PrvOnSucceeded:
      return 'Enter privacy mode';
    case PrivacyModeState.PrvOnFailedDenied:
      return 'Privacy mode was denied';
    case PrivacyModeState.PrvOnFailedPlugin:
      return 'Privacy mode plugin not found';
    case PrivacyModeState.PrvOnFailed:
      return notification.details || 'Privacy mode failed to turn on';
    case PrivacyModeState.PrvOffSucceeded:
      return 'Exit privacy mode';
    case PrivacyModeState.PrvOffByPeer:
      return 'Privacy mode off by peer';
    case PrivacyModeState.PrvOffFailed:
      return notification.details || 'Privacy mode failed to turn off';
    case PrivacyModeState.PrvOffUnknown:
      return 'Privacy mode off (unknown state)';
    default:
      return 'Privacy mode state unknown';
  }
}

function blockInputMessageText(notification: BlockInputNotification): string {
  switch (notification.state) {
    case BlockInputState.BlkOnSucceeded:
      return 'Block input succeeded';
    case BlockInputState.BlkOnFailed:
      return notification.details || 'Block input failed to turn on';
    case BlockInputState.BlkOffSucceeded:
      return 'Unblock input succeeded';
    case BlockInputState.BlkOffFailed:
      return notification.details || 'Block input failed to turn off';
    default:
      return 'Block input state unknown';
  }
}
