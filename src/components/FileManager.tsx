import { useState, useEffect } from 'react';
import type { RemoteDir, TransferProgress } from '../protocol/file_transfer';
import type { FileEntryT } from '../protos';

interface Props {
  remoteDir: RemoteDir | null;
  transfers: TransferProgress[];
  onReadDir: (path: string) => void;
  onUpload: (file: File, remotePath: string) => Promise<void>;
  onCancel: (id: number) => void;
  onClose: () => void;
}


const FILE_TYPE_DIR = 0;

export function FileManager({ remoteDir, transfers, onReadDir, onUpload, onCancel, onClose }: Props) {
  const [path, setPath] = useState('');

  useEffect(() => {
    if (path) onReadDir(path);
  }, [path]);

  const navigate = (dir: string) => {
    setPath(dir);
  };

  const goUp = () => {
    if (!path) return;
    const parts = path.replace(/\\/g, '/').split('/');
    parts.pop();
    const parent = parts.join('/');
    setPath(parent || '/');
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      await onUpload(file, path);
    }
    e.target.value = '';
    if (path) onReadDir(path);
  };

  return (
    <div className="file-manager">
      <div className="fm-header">
        <strong>文件传输</strong>
        <button className="btn" onClick={onClose}>关闭</button>
      </div>

      <div className="fm-toolbar">
        <button className="btn" onClick={goUp} disabled={!path}>上级</button>
        <input
          className="fm-path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(path); }}
          placeholder="远程路径"
        />
        <button className="btn" onClick={() => navigate(path)}>前往</button>
        <label className="btn btn-primary">
          上传
          <input type="file" multiple style={{ display: 'none' }} onChange={handleUpload} />
        </label>
      </div>

      <div className="fm-list">
        {remoteDir?.entries.map((entry, i) => (
          <FileRow
            key={i}
            entry={entry}
            basePath={remoteDir.path}
            onNavigate={navigate}
          />
        ))}
        {(!remoteDir || remoteDir.entries.length === 0) && (
          <div className="fm-empty">空目录或未加载</div>
        )}
      </div>

      {transfers.length > 0 && (
        <div className="fm-transfers">
          <div className="fm-transfers-header">传输进度</div>
          {transfers.map((t) => (
            <TransferRow key={t.id} transfer={t} onCancel={onCancel} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ entry, basePath, onNavigate }: { entry: FileEntryT; basePath: string; onNavigate: (dir: string) => void }) {
  const isDir = entry.entryType === FILE_TYPE_DIR || entry.entryType === 2 || entry.entryType === 3;
  const sep = basePath.includes('\\') ? '\\' : '/';
  const fullPath = basePath.endsWith(sep) ? basePath + entry.name : basePath + sep + entry.name;
  const sizeStr = formatSize(entry.size ?? 0);

  return (
    <div
      className="fm-row"
      onDoubleClick={() => { if (isDir) onNavigate(fullPath); }}
      style={{ cursor: isDir ? 'pointer' : 'default' }}
    >
      <span className="fm-icon">{isDir ? '📁' : '📄'}</span>
      <span className="fm-name">{entry.name}</span>
      <span className="fm-size">{sizeStr}</span>
    </div>
  );
}

function TransferRow({ transfer, onCancel }: { transfer: TransferProgress; onCancel: (id: number) => void }) {
  const pct = transfer.total > 0 ? Math.round((transfer.transferred / transfer.total) * 100) : 0;
  return (
    <div className="fm-transfer">
      <span className="fm-transfer-name">{transfer.fileName}</span>
      <div className="fm-progress-bar">
        <div className="fm-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="fm-progress-text">
        {transfer.done ? '完成' : transfer.error ? transfer.error : `${pct}%`}
      </span>
      {!transfer.done && !transfer.error && (
        <button className="btn btn-danger fm-cancel" onClick={() => onCancel(transfer.id)}>取消</button>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}