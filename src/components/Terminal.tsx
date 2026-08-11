import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RemoteSession } from '../protocol/session';
import { ConnType, type SessionConfig } from '../protocol/config';
import { decompress } from 'fzstd';

interface Props {
  config: SessionConfig;
  onClose: () => void;
}

const TERMINAL_ID = 0;

type TermState = 'connecting' | 'open' | 'closed' | 'error';

export function TerminalPanel({ config, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<RemoteSession | null>(null);
  const openedRef = useRef(false);
  const [termState, setTermState] = useState<TermState>('connecting');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'monospace',
      cols: 80,
      rows: 24,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    if (containerRef.current) {
      term.open(containerRef.current);
      try { fit.fit(); } catch { /* ignore */ }
    }

    const termConfig: SessionConfig = {
      ...config,
      connType: ConnType.TERMINAL,
    };
    const session = new RemoteSession(termConfig);
    sessionRef.current = session;

    session.on('log', (msg: string) => {
      if (msg.includes('error') || msg.includes('connected')) {
        term.writeln(`\x1b[90m[${msg}]\x1b[0m`);
      }
    });

    session.on('stateChange', (state) => {
      if (state === 'connected' && !openedRef.current) {
        openedRef.current = true;
        const dims = fit.proposeDimensions();
        const rows = dims?.rows ?? 24;
        const cols = dims?.cols ?? 80;
        session.sendTerminalAction({
          open: { terminalId: TERMINAL_ID, rows, cols },
        });
      }
      if (state === 'closed' && termState !== 'error') {
        setTermState('closed');
      }
    });

    session.on('terminalResponse', (resp) => {
      if (resp.opened) {
        if (resp.opened.success === false) {
          setErrorMsg(resp.opened.message ?? 'failed to open terminal');
          setTermState('error');
          term.writeln(`\x1b[31m${resp.opened.message ?? 'failed to open terminal'}\x1b[0m`);
          return;
        }
        setTermState('open');
        if (resp.opened.message) {
          term.writeln(`\x1b[90m${resp.opened.message}\x1b[0m`);
        }
      }
      if (resp.data) {
        const raw = resp.data.data ?? new Uint8Array();
        const bytes = resp.data.compressed ? decompress(raw) : raw;
        term.write(new Uint8Array(bytes));
      }
      if (resp.closed) {
        setTermState('closed');
        term.writeln(`\x1b[90m[terminal exited with code ${resp.closed.exitCode ?? 0}]\x1b[0m`);
      }
      if (resp.error) {
        setErrorMsg(resp.error.message ?? 'terminal error');
        setTermState('error');
        term.writeln(`\x1b[31m${resp.error.message ?? 'terminal error'}\x1b[0m`);
      }
    });

    session.on('error', (err: Error) => {
      setErrorMsg(err.message);
      setTermState('error');
      term.writeln(`\x1b[31m${err.message}\x1b[0m`);
    });

    session.on('closeReason', (reason: string) => {
      setTermState('closed');
      term.writeln(`\x1b[90m[connection closed: ${reason}]\x1b[0m`);
    });

    const onData = (data: string) => {
      if (session.state !== 'connected') return;
      session.sendTerminalAction({
        data: { terminalId: TERMINAL_ID, data: new TextEncoder().encode(data) },
      });
    };
    term.onData(onData);

    const onResize = () => {
      try { fit.fit(); } catch { /* ignore */ }
      if (session.state !== 'connected' || !openedRef.current) return;
      const dims = fit.proposeDimensions();
      if (!dims) return;
      session.sendTerminalAction({
        resize: { terminalId: TERMINAL_ID, rows: dims.rows, cols: dims.cols },
      });
    };
    const resizeObserver = new ResizeObserver(onResize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    session.connect();

    return () => {
      resizeObserver.disconnect();
      if (session.state === 'connected') {
        session.sendTerminalAction({ close: { terminalId: TERMINAL_ID } });
      }
      session.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span className="terminal-title">终端</span>
        <span className="terminal-status">
          {termState === 'connecting' && '连接中…'}
          {termState === 'open' && '已连接'}
          {termState === 'closed' && '已关闭'}
          {termState === 'error' && `错误: ${errorMsg}`}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>关闭</button>
      </div>
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
}