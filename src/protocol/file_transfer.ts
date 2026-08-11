import { decompress as zstdDecompress } from 'fzstd';
import type { MessageT, FileEntryT } from '../protos';

export interface TransferProgress {
  id: number;
  fileName: string;
  transferred: number;
  total: number;
  done: boolean;
  error?: string;
}

export interface RemoteDir {
  path: string;
  entries: FileEntryT[];
}

type ProgressCallback = (progress: TransferProgress) => void;
type DirCallback = (dir: RemoteDir) => void;

export class FileTransferManager {
  private nextId = 1;
  private downloads = new Map<number, { chunks: Uint8Array[]; progress: TransferProgress; onProgress: ProgressCallback }>();
  private onDir: DirCallback | null = null;
  private onProgress: ProgressCallback | null = null;

  constructor(
    private readonly sendAction: (action: NonNullable<MessageT['fileAction']>) => void,
    private readonly sendResponse: (resp: NonNullable<MessageT['fileResponse']>) => void,
  ) {}

  setCallbacks(onDir: DirCallback, onProgress: ProgressCallback): void {
    this.onDir = onDir;
    this.onProgress = onProgress;
  }

  readRemoteDir(path: string, includeHidden = false): void {
    const id = this.nextId++;
    this.sendAction({ readDir: { id, path, includeHidden } });
  }

  downloadFile(remotePath: string, fileName: string, fileSize: number): void {
    const id = this.nextId++;
    const progress: TransferProgress = {
      id,
      fileName,
      transferred: 0,
      total: fileSize,
      done: false,
    };
    this.downloads.set(id, { chunks: [], progress, onProgress: this.onProgress ?? (() => {}) });
    this.sendAction({ send: { id, path: remotePath, includeHidden: false, fileNum: 0 } });
  }

  async uploadFile(localFile: File, remotePath: string): Promise<void> {
    const id = this.nextId++;
    const fileName = localFile.name;
    const totalSize = localFile.size;
    const progress: TransferProgress = {
      id,
      fileName,
      transferred: 0,
      total: totalSize,
      done: false,
    };

    const entries = [{
      entryType: 4,
      name: fileName,
      isHidden: false,
      size: totalSize,
      modifiedTime: Math.floor(Date.now() / 1000),
    }];

    this.sendAction({
      receive: { id, path: remotePath, files: entries, fileNum: 0, totalSize },
    });

    const reader = localFile.stream().getReader();
    let fileNum = 0;
    let blkId = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      this.sendResponse({ block: { id, fileNum, data: value, compressed: false, blkId } });
      blkId++;
      progress.transferred += value.length;
      this.onProgress?.(progress);
    }

    this.sendResponse({ done: { id, fileNum } });
    progress.done = true;
    this.onProgress?.(progress);
  }

  cancelTransfer(id: number): void {
    this.sendAction({ cancel: { id } });
    this.downloads.delete(id);
  }

  handleFileResponse(resp: NonNullable<MessageT['fileResponse']>): void {
    if (resp.dir) {
      const dir: RemoteDir = {
        path: resp.dir.path ?? '',
        entries: resp.dir.entries ?? [],
      };
      this.onDir?.(dir);
      return;
    }

    if (resp.block) {
      const dl = this.downloads.get(resp.block.id ?? -1);
      if (!dl) return;
      let data = resp.block.data ?? new Uint8Array();
      if (resp.block.compressed) {
        try {
          data = zstdDecompress(data);
        } catch {
          return;
        }
      }
      dl.chunks.push(data);
      dl.progress.transferred += data.length;
      dl.onProgress(dl.progress);
      return;
    }

    if (resp.done) {
      const dl = this.downloads.get(resp.done.id ?? -1);
      if (!dl) return;
      const blob = new Blob(dl.chunks as BlobPart[]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = dl.progress.fileName;
      a.click();
      URL.revokeObjectURL(url);
      dl.progress.done = true;
      dl.onProgress(dl.progress);
      this.downloads.delete(resp.done.id ?? -1);
      return;
    }

    if (resp.error) {
      const dl = this.downloads.get(resp.error.id ?? -1);
      if (dl) {
        dl.progress.error = resp.error.error;
        dl.onProgress(dl.progress);
        this.downloads.delete(resp.error.id ?? -1);
      }
      return;
    }

    if (resp.digest) {
      this.sendAction({
        sendConfirm: {
          id: resp.digest.id,
          fileNum: resp.digest.fileNum,
          skip: false,
        },
      });
      return;
    }
  }
}
