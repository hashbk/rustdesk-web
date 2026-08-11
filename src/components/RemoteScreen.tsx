import { useEffect, useRef, useState } from 'react';
import { VideoRenderer, type RenderStats } from '../media/renderer';
import { MouseAdapter } from '../input/mouse';
import { KeyboardAdapter } from '../input/keyboard';
import type { PeerInfoT, VideoFrameT, MessageT } from '../protos';
import type { CursorData, CursorPosition } from '../hooks/useRemoteSession';

interface Props {
  peerInfo: PeerInfoT | null;
  videoFrame: { frame: VideoFrameT; seq: number } | null;
  cursorData: CursorData | null;
  cursorPosition: CursorPosition | null;
  viewOnly: boolean;
  sendMouse: (event: NonNullable<MessageT['mouseEvent']>) => void;
  sendKey: (event: NonNullable<MessageT['keyEvent']>) => void;
  onStats?: (stats: RenderStats) => void;
}

export function RemoteScreen({
  peerInfo,
  videoFrame,
  cursorData,
  cursorPosition,
  viewOnly,
  sendMouse,
  sendKey,
  onStats,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<VideoRenderer | null>(null);
  const mouseRef = useRef<MouseAdapter | null>(null);
  const keyboardRef = useRef<KeyboardAdapter | null>(null);
  const [cursorUrl, setCursorUrl] = useState<string | null>(null);
  const cursorUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rendererRef.current = new VideoRenderer(
      canvas,
      (e) => console.error('[renderer]', e.message),
      onStats,
    );
    if (!viewOnly) {
      keyboardRef.current = new KeyboardAdapter(sendKey);
    }

    const kd = (e: KeyboardEvent) => {
      if (viewOnly) return;
      if (keyboardRef.current?.handle(e)) e.preventDefault();
    };
    const ce = (e: CompositionEvent) => {
      if (viewOnly) return;
      if (keyboardRef.current?.handleCompositionEnd(e)) e.preventDefault();
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', kd);
    window.addEventListener('compositionend', ce);

    const onBlur = () => {
      mouseRef.current?.releaseAll();
      keyboardRef.current?.releaseAll();
    };
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', kd);
      window.removeEventListener('compositionend', ce);
      window.removeEventListener('blur', onBlur);
      rendererRef.current?.destroy();
      rendererRef.current = null;
      if (cursorUrlRef.current) URL.revokeObjectURL(cursorUrlRef.current);
    };
  }, [sendKey, viewOnly, onStats]);

  useEffect(() => {
    if (!peerInfo || !rendererRef.current) return;
    const display = peerInfo.displays?.[peerInfo.currentDisplay ?? 0];
    if (display) {
      rendererRef.current.setDisplaySize(display.width, display.height);
      mouseRef.current?.setDisplaySize(display.width, display.height);
    }
  }, [peerInfo]);

  useEffect(() => {
    if (!peerInfo || !canvasRef.current || viewOnly) return;
    const display = peerInfo.displays?.[peerInfo.currentDisplay ?? 0];
    if (!display) return;
    if (!mouseRef.current) {
      mouseRef.current = new MouseAdapter({
        displayWidth: display.width,
        displayHeight: display.height,
        send: sendMouse,
      });
    }
  }, [peerInfo, sendMouse, viewOnly]);

  useEffect(() => {
    if (videoFrame && rendererRef.current) {
      rendererRef.current.handleFrame(videoFrame.frame);
    }
  }, [videoFrame]);

  useEffect(() => {
    if (!cursorData || cursorData.width <= 0 || cursorData.height <= 0) return;
    const { colors, width, height, hotx, hoty } = cursorData;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < colors.length && j < rgba.length; i += 4, j += 4) {
      rgba[j] = colors[i + 2];
      rgba[j + 1] = colors[i + 1];
      rgba[j + 2] = colors[i];
      rgba[j + 3] = colors[i + 3];
    }
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    off.getContext('2d')?.putImageData(new ImageData(rgba, width, height), 0, 0);
    off.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      if (cursorUrlRef.current) URL.revokeObjectURL(cursorUrlRef.current);
      cursorUrlRef.current = url;
      setCursorUrl(`url(${url}) ${hotx} ${hoty}, default`);
    });
  }, [cursorData]);

  const cursorStyle = cursorUrl ?? (viewOnly ? 'not-allowed' : 'default');

  const handleMouse = (type: 'move' | 'down' | 'up' | 'wheel', e: React.MouseEvent | React.WheelEvent) => {
    if (viewOnly) return;
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
    <div className="remote-screen-wrapper" style={{ position: 'relative', width: '100%', height: '100%' }}>
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
        style={{ cursor: cursorStyle }}
      />

      {cursorPosition && !cursorUrl && (
        <CursorDot position={cursorPosition} displayWidth={peerInfo?.displays?.[peerInfo.currentDisplay ?? 0]?.width ?? 1} displayHeight={peerInfo?.displays?.[peerInfo.currentDisplay ?? 0]?.height ?? 1} canvasRef={canvasRef} />
      )}
    </div>
  );
}

function CursorDot({ position, displayWidth, displayHeight, canvasRef }: { position: CursorPosition; displayWidth: number; displayHeight: number; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const canvas = canvasRef.current;
  const rect = canvas?.getBoundingClientRect();
  if (!rect) return null;
  const x = (position.x / displayWidth) * rect.width;
  const y = (position.y / displayHeight) * rect.height;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.8)',
        border: '1px solid rgba(0,0,0,0.5)',
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)',
      }}
    />
  );
}