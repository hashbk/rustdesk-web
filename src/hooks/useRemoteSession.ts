import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteSession, type SessionState, type SessionEvents } from '../protocol/session';
import type { SessionConfig } from '../protocol/config';
import type { PeerInfoT, VideoFrameT, MessageT } from '../protos';

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

export interface RemoteSessionHook {
  state: SessionState;
  peerInfo: PeerInfoT | null;
  error: string | null;
  closeReason: string | null;
  logs: string[];
  videoFrame: { frame: VideoFrameT; seq: number } | null;
  cursorData: CursorData | null;
  cursorPosition: CursorPosition | null;
  connect: (config: SessionConfig) => void;
  send2fa: (code: string) => void;
  close: () => void;
  sendMouse: (event: NonNullable<MessageT['mouseEvent']>) => void;
  sendKey: (event: NonNullable<MessageT['keyEvent']>) => void;
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
  const seqRef = useRef(0);

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

      const session = new RemoteSession(config);
      sessionRef.current = session;
      const handlers: Partial<SessionEvents> = {
        stateChange: setState,
        peerInfo: setPeerInfo,
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
        error: (e) => {
          setError(e.message);
          pushLog(`error: ${e.message}`);
        },
        closeReason: (reason) => setCloseReason(reason),
        log: pushLog,
      };
      for (const [k, fn] of Object.entries(handlers)) {
        session.on(k as keyof SessionEvents, fn as never);
      }
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

  useEffect(() => {
    return () => sessionRef.current?.close();
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
    connect,
    send2fa,
    close,
    sendMouse,
    sendKey,
  };
}
