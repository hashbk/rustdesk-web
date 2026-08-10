import { initCrypto, base64Decode, verifySigned, generateBoxKeypair, generateSecretKey, boxSeal, computePasswordHash } from './crypto';
import { WsStream } from './stream';
import {
  encodeRendezvous,
  decodeRendezvous,
  encodeMessage,
  decodeMessage,
  decodeIdPk,
  rendezvousUnionName,
  type RendezvousMessageT,
  type MessageT,
  type PeerInfoT,
  type VideoFrameT,
  type HashT,
} from '../protos';
import { ConnType, rendezvousWsUrl, relayWsUrl, type SessionConfig, type ServerConfig } from './config';

export type SessionState =
  | 'idle'
  | 'connecting-rendezvous'
  | 'connecting-relay'
  | 'handshaking'
  | 'logging-in'
  | 'connected'
  | 'need-2fa'
  | 'closed';

export interface SessionEvents {
  stateChange: (state: SessionState) => void;
  peerInfo: (info: PeerInfoT) => void;
  videoFrame: (frame: VideoFrameT) => void;
  cursorData: (cursor: NonNullable<MessageT['cursorData']>) => void;
  cursorPosition: (pos: NonNullable<MessageT['cursorPosition']>) => void;
  audioFormat: (fmt: NonNullable<MessageT['audioFormat']>) => void;
  audioFrame: (frame: NonNullable<MessageT['audioFrame']>) => void;
  clipboard: (clip: NonNullable<MessageT['clipboard']>) => void;
  need2fa: () => void;
  closeReason: (reason: string) => void;
  error: (error: Error) => void;
  log: (message: string) => void;
}

type Listener<K extends keyof SessionEvents> = SessionEvents[K];

const CLIENT_VERSION = '1.3.0';

class MessageQueue {
  private pending: Uint8Array[] = [];
  private waiters: Array<(data: Uint8Array) => void> = [];
  private done = false;

  push(data: Uint8Array): void {
    const w = this.waiters.shift();
    if (w) w(data);
    else this.pending.push(data);
  }

  async next(timeoutMs?: number): Promise<Uint8Array> {
    if (this.pending.length > 0) return this.pending.shift()!;
    if (this.done) throw new Error('stream closed');
    return new Promise<Uint8Array>((resolve, reject) => {
      this.waiters.push(resolve);
      if (timeoutMs) {
        setTimeout(() => {
          const idx = this.waiters.indexOf(resolve);
          if (idx > -1) {
            this.waiters.splice(idx, 1);
            reject(new Error('timeout waiting for message'));
          }
        }, timeoutMs);
      }
    });
  }

  close(): void {
    this.done = true;
    while (this.waiters.length) this.waiters.shift()!(new Uint8Array());
  }
}

export class RemoteSession {
  state: SessionState = 'idle';
  private listeners: { [K in keyof SessionEvents]?: Listener<K> } = {};
  private rendezvousStream: WsStream | null = null;
  private relayStream: WsStream | null = null;
  private relayQueue = new MessageQueue();
  private config: SessionConfig;
  private myId: string;
  private closed = false;

  constructor(config: SessionConfig) {
    this.config = config;
    this.myId = config.myId ?? generateWebId();
  }

  on<K extends keyof SessionEvents>(event: K, listener: Listener<K>): void {
    this.listeners[event] = listener;
  }

  private emit(event: keyof SessionEvents, ...args: unknown[]): void {
    const fn = this.listeners[event] as ((...a: unknown[]) => void) | undefined;
    fn?.(...args);
  }

  private log(msg: string): void {
    this.emit('log', msg);
  }

  private setState(state: SessionState): void {
    this.state = state;
    this.emit('stateChange', state);
  }

  async connect(): Promise<void> {
    try {
      await initCrypto();
      await this.connectViaRendezvous();
    } catch (err) {
      this.handleError(err);
    }
  }

  private async connectViaRendezvous(): Promise<void> {
    this.setState('connecting-rendezvous');
    const url = rendezvousWsUrl(this.config.server);
    this.log(`connecting rendezvous ${url}`);

    const queue = new MessageQueue();
    this.rendezvousStream = new WsStream(url, {
      onMessage: (data) => queue.push(data),
      onError: (e) => this.handleError(e),
      onClose: () => queue.close(),
    });
    await this.rendezvousStream.connect();

    const req: RendezvousMessageT = {
      punchHoleRequest: {
        id: this.config.peerId,
        natType: 0,
        licenceKey: this.config.server.key,
        connType: this.config.connType ?? ConnType.DEFAULT_CONN,
        token: this.config.accessToken ?? '',
        version: CLIENT_VERSION,
        forceRelay: true,
      },
    };
    this.rendezvousStream.send(encodeRendezvous(req));
    this.log('punch hole request sent (force_relay)');

    const relayInfo = await this.negotiateRelay(queue);
    this.rendezvousStream.close();
    this.rendezvousStream = null;

    await this.connectViaRelay(relayInfo);
  }

  private async negotiateRelay(queue: MessageQueue): Promise<{ uuid: string; relayServer: string; signedPk: Uint8Array }> {
    for (let i = 0; i < 5; i++) {
      const data = await queue.next(15000);
      if (data.length === 0) throw new Error('rendezvous closed');
      const msg = decodeRendezvous(data);
      const union = rendezvousUnionName(msg);

      if (union === 'relayResponse' && msg.relayResponse) {
        const rr = msg.relayResponse;
        if (rr.refuseReason) throw new Error(`relay refused: ${rr.refuseReason}`);
        this.log(`relay response: server=${rr.relayServer}, uuid=${rr.uuid}`);
        return { uuid: rr.uuid, relayServer: rr.relayServer, signedPk: rr.pk ?? new Uint8Array() };
      }

      if (union === 'punchHoleResponse' && msg.punchHoleResponse) {
        const ph = msg.punchHoleResponse;
        if (ph.otherFailure) throw new Error(ph.otherFailure);
        if (ph.failure && ph.failure !== 0) throw new Error(`punch hole failure: ${ph.failure}`);
        if (ph.relayServer) {
          this.log(`peer requests relay via ${ph.relayServer}`);
          const uuid = crypto.randomUUID();
          const relayReq: RendezvousMessageT = {
            requestRelay: {
              id: this.config.peerId,
              uuid,
              relayServer: ph.relayServer,
              secure: true,
              licenceKey: this.config.server.key,
              connType: this.config.connType ?? ConnType.DEFAULT_CONN,
              token: this.config.accessToken ?? '',
            },
          };
          this.rendezvousStream!.send(encodeRendezvous(relayReq));
          continue;
        }
        throw new Error('punch hole response without relay server');
      }

      this.log(`unexpected rendezvous message: ${union ?? 'unknown'}`);
    }
    throw new Error('failed to negotiate relay');
  }

  private async connectViaRelay(info: { uuid: string; relayServer: string; signedPk: Uint8Array }): Promise<void> {
    this.setState('connecting-relay');
    const url = relayWsUrl(this.config.server, info.relayServer);
    this.log(`connecting relay ${url}`);

    this.relayStream = new WsStream(url, {
      onMessage: (data) => this.relayQueue.push(data),
      onError: (e) => this.handleError(e),
      onClose: (_code, reason) => {
        this.relayQueue.close();
        if (!this.closed) this.emit('closeReason', reason || 'connection closed');
        this.setState('closed');
      },
    });
    await this.relayStream.connect();

    const relayReq: RendezvousMessageT = {
      requestRelay: {
        id: this.config.peerId,
        uuid: info.uuid,
        relayServer: info.relayServer,
        secure: true,
        licenceKey: this.config.server.key,
        connType: this.config.connType ?? ConnType.DEFAULT_CONN,
        token: this.config.accessToken ?? '',
      },
    };
    this.relayStream.send(encodeRendezvous(relayReq));
    this.log('relay request sent');

    await this.handshakeAndLogin(info.signedPk);
    this.runSteadyState();
  }

  private async handshakeAndLogin(signedPk: Uint8Array): Promise<void> {
    this.setState('handshaking');
    let peerSignPk: Uint8Array | null = null;

    if (signedPk.length > 0) {
      const rsPk = base64Decode(this.config.server.key || DEFAULT_RS_PUB_KEY);
      const unsigned = verifySigned(signedPk, rsPk);
      if (unsigned) {
        const idPk = decodeIdPk(unsigned);
        if (idPk.id === this.config.peerId) {
          peerSignPk = idPk.pk;
          this.log('verified server-signed peer id');
        }
      }
    }

    const first = decodeMessage(await this.relayQueue.next(15000));
    if (first.signedId && peerSignPk) {
      const unsigned = verifySigned(first.signedId.id, peerSignPk);
      if (!unsigned) throw new Error('failed to verify peer signed id');
      const idPk = decodeIdPk(unsigned);
      if (idPk.id !== this.config.peerId) throw new Error('peer id mismatch in handshake');
      const peerBoxPk = idPk.pk;

      const ourKp = generateBoxKeypair();
      const secretKey = generateSecretKey();
      const sealed = boxSeal(secretKey, peerBoxPk, ourKp.secretKey);
      this.relayStream!.send(
        encodeMessage({ publicKey: { asymmetricValue: ourKp.publicKey, symmetricValue: sealed } }),
      );
      this.relayStream!.setKey(secretKey);
      this.log('secure channel established');
    } else {
      this.relayStream!.send(encodeMessage({}));
      this.log('non-secure channel (no peer sign key)');
    }

    await this.handleLogin();
  }

  private async handleLogin(): Promise<void> {
    this.setState('logging-in');
    const data = await this.relayQueue.next(15000);
    const msg = decodeMessage(data);

    if (!msg.hash) {
      if (msg.loginResponse?.error) throw new Error(`login error: ${msg.loginResponse.error}`);
      throw new Error('expected hash before login');
    }
    await this.sendLogin(msg.hash);
  }

  private async sendLogin(hash: HashT): Promise<void> {
    if (!this.config.password) {
      this.emit('error', new Error('password required but not provided'));
      return;
    }
    const passwordHash = await computePasswordHash(this.config.password, hash.salt, hash.challenge);
    const loginMsg: MessageT = {
      loginRequest: {
        username: '',
        password: passwordHash,
        myId: this.myId,
        myName: this.config.myName ?? 'RustDesk Web',
        videoAckRequired: false,
        version: CLIENT_VERSION,
        myPlatform: 'Web',
        option: {
          imageQuality: 3,
          supportedDecoding: {
            abilityVp9: 1,
            abilityH264: 1,
            abilityH265: 1,
            abilityVp8: 1,
            abilityAv1: 1,
            prefer: 0,
          },
        },
      },
    };
    this.relayStream!.send(encodeMessage(loginMsg));
    this.log('login request sent');

    const resp = decodeMessage(await this.relayQueue.next(15000));
    if (!resp.loginResponse) throw new Error('expected login response');

    if (resp.loginResponse.error) {
      if (resp.loginResponse.error === 'REQUIRE_2FA') {
        this.setState('need-2fa');
        this.emit('need2fa');
        return;
      }
      throw new Error(`login rejected: ${resp.loginResponse.error}`);
    }

    if (resp.loginResponse.peerInfo) {
      this.emit('peerInfo', resp.loginResponse.peerInfo);
      this.setState('connected');
      this.log('connected');
    } else {
      throw new Error('login response without peer info');
    }
  }

  async send2fa(code: string): Promise<void> {
    if (this.state !== 'need-2fa') return;
    this.relayStream!.send(encodeMessage({ auth2fa: { code } } as MessageT));
    this.log('2fa code sent');
    try {
      const resp = decodeMessage(await this.relayQueue.next(15000));
      if (resp.loginResponse?.error) throw new Error(`2fa failed: ${resp.loginResponse.error}`);
      if (resp.loginResponse?.peerInfo) {
        this.emit('peerInfo', resp.loginResponse.peerInfo);
        this.setState('connected');
        this.log('connected after 2fa');
      }
    } catch (err) {
      this.handleError(err);
    }
  }

  private async runSteadyState(): Promise<void> {
    while (!this.closed) {
      let data: Uint8Array;
      try {
        data = await this.relayQueue.next();
      } catch {
        break;
      }
      if (data.length === 0) break;
      const msg = decodeMessage(data);
      if (msg.videoFrame) this.emit('videoFrame', msg.videoFrame);
      else if (msg.cursorData) this.emit('cursorData', msg.cursorData);
      else if (msg.cursorPosition) this.emit('cursorPosition', msg.cursorPosition);
      else if (msg.audioFormat) this.emit('audioFormat', msg.audioFormat);
      else if (msg.audioFrame) this.emit('audioFrame', msg.audioFrame);
      else if (msg.clipboard) this.emit('clipboard', msg.clipboard);
      else if (msg.closeReason) {
        this.emit('closeReason', msg.closeReason);
        break;
      }
    }
    this.setState('closed');
  }

  sendMouse(event: NonNullable<MessageT['mouseEvent']>): void {
    if (this.state !== 'connected') return;
    this.relayStream?.send(encodeMessage({ mouseEvent: event }));
  }

  sendKey(event: NonNullable<MessageT['keyEvent']>): void {
    if (this.state !== 'connected') return;
    this.relayStream?.send(encodeMessage({ keyEvent: event }));
  }

  sendClipboard(content: Uint8Array): void {
    if (this.state !== 'connected') return;
    this.relayStream?.send(encodeMessage({ clipboard: { content } }));
  }

  close(): void {
    this.closed = true;
    this.relayQueue.close();
    this.relayStream?.close();
    this.rendezvousStream?.close();
    this.setState('closed');
  }

  private handleError(err: unknown): void {
    if (this.closed) return;
    const error = err instanceof Error ? err : new Error(String(err));
    this.log(`error: ${error.message}`);
    this.emit('error', error);
    this.close();
  }
}

export const DEFAULT_RS_PUB_KEY = 'OeVuKk5nlHiXp+APNn0Y3pC1Iwpwn44JGqrQCsWqmBw=';

function generateWebId(): string {
  const n = Math.floor(1_000_000_000 + Math.random() * 9_000_000_000);
  return n.toString();
}

export type { ServerConfig, SessionConfig };