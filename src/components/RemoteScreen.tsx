import { useEffect, useRef } from 'react';
import { VideoRenderer } from '../media/renderer';
import { MouseAdapter } from '../input/mouse';
import { KeyboardAdapter } from '../input/keyboard';
import type { PeerInfoT, VideoFrameT, MessageT } from '../protos';

interface Props {
  peerInfo: PeerInfoT | null;
  videoFrame: { frame: VideoFrameT; seq: number } | null;
  sendMouse: (event: NonNullable<MessageT['mouseEvent']>) => void;
  sendKey: (event: NonNullable<MessageT['keyEvent']>) => void;
}

export function RemoteScreen({ peerInfo, videoFrame, sendMouse, sendKey }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<VideoRenderer | null>(null);
  const mouseRef = useRef<MouseAdapter | null>(null);
  const keyboardRef = useRef<KeyboardAdapter | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rendererRef.current = new VideoRenderer(canvas, (e) => console.error('[renderer]', e.message));
    keyboardRef.current = new KeyboardAdapter(sendKey);

    const kd = (e: KeyboardEvent) => {
      if (keyboardRef.current?.handle(e)) e.preventDefault();
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', kd);

    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', kd);
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [sendKey]);

  useEffect(() => {
    if (!peerInfo || !rendererRef.current) return;
    const display = peerInfo.displays?.[peerInfo.currentDisplay ?? 0];
    if (display) {
      rendererRef.current.setDisplaySize(display.width, display.height);
      mouseRef.current?.setDisplaySize(display.width, display.height);
    }
  }, [peerInfo]);

  useEffect(() => {
    if (!peerInfo || !canvasRef.current) return;
    const display = peerInfo.displays?.[peerInfo.currentDisplay ?? 0];
    if (!display) return;
    if (!mouseRef.current) {
      mouseRef.current = new MouseAdapter({
        displayWidth: display.width,
        displayHeight: display.height,
        send: sendMouse,
      });
    }
  }, [peerInfo, sendMouse]);

  useEffect(() => {
    if (videoFrame && rendererRef.current) {
      rendererRef.current.handleFrame(videoFrame.frame);
    }
  }, [videoFrame]);

  const handleMouse = (type: 'move' | 'down' | 'up' | 'wheel', e: React.MouseEvent | React.WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !mouseRef.current) return;
    const rect = canvas.getBoundingClientRect();
    if (type === 'wheel') {
      mouseRef.current.onWheel(e as React.WheelEvent as unknown as WheelEvent, rect);
    } else if (type === 'move') {
      mouseRef.current.onMove(e as unknown as MouseEvent, rect);
    } else if (type === 'down') {
      mouseRef.current.onDown(e as unknown as MouseEvent, rect);
    } else {
      mouseRef.current.onUp(e as unknown as MouseEvent, rect);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="remote-canvas"
      onMouseMove={(e) => handleMouse('move', e)}
      onMouseDown={(e) => {
        handleMouse('down', e);
        e.preventDefault();
      }}
      onMouseUp={(e) => handleMouse('up', e)}
      onWheel={(e) => handleMouse('wheel', e)}
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor: 'default' }}
    />
  );
}