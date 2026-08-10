import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteSession, type SessionState, type SessionEvents } from '../protocol/session';
import type { SessionConfig } from '../protocol/config';
import type { PeerInfoT, VideoFrameT } from '../protos';

export interface RemoteSessionHook {
  state: SessionState;
  peerInfo: PeerInfoT | null;
  error: string | null;
  closeReason: string | null;
  logs: string[];
  videoFrame: { frame: VideoFrameT; seq: number } | null;
  connect: (config: SessionConfig) => void;
  send2fa: (code: string) => void;
  close: () => void;
  sendMouse: (event: NonNullable<import('../protos').MessageT['mouseEvent']>) => void;
  sendKey: (event: NonNullable<import('../protos').MessageT['keyEvent']>) => void;
}

export function useRemoteSession(): RemoteSessionHook {
  const sessionRef = useRef<RemoteSession | null>(null);
  const [state, setState] = useState<SessionState>('idle');
  const [peerInfo, setPeerInfo] = useState<PeerInfoT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [videoFrame, setVideoFrame] = useState<{ frame: VideoFrameT; seq: number } | null>(null);
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

      const session = new RemoteSession(config);
      sessionRef.current = session;
      const handlers: Partial<SessionEvents> = {
        stateChange: setState,
        peerInfo: setPeerInfo,
        videoFrame: (frame) => {
          seqRef.current += 1;
          setVideoFrame({ frame, seq: seqRef.current });
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

  const sendMouse = useCallback((event: NonNullable<import('../protos').MessageT['mouseEvent']>) => {
    sessionRef.current?.sendMouse(event);
  }, []);

  const sendKey = useCallback((event: NonNullable<import('../protos').MessageT['keyEvent']>) => {
    sessionRef.current?.sendKey(event);
  }, []);

  useEffect(() => {
    return () => sessionRef.current?.close();
  }, []);

  return { state, peerInfo, error, closeReason, logs, videoFrame, connect, send2fa, close, sendMouse, sendKey };
}