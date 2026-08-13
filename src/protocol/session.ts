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
import { ConnType, rendezvousWsUrl, relayWsUrl, type SessionConfig, type ServerConfig, CodecPreference, ImageQuality } from './config';
import { detectCodecAbilities } from '../media/renderer';

/** Compare two semver-like version strings. Returns -1, 0, or 1. */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

export type SessionState =
  | 'idle'
  | 'connecting-rendezvous'
  | 'connecting-relay'
  | 'handshaking'
  | 'logging-in'
  | 'connected'
  | 'need-2fa'
  | 'closed';

export enum PrivacyModeState {
  PrvStateUnknown = 0,
  PrvOnByOther = 2,
  PrvNotSupported = 3,
  PrvOnSucceeded = 4,
  PrvOnFailedDenied = 5,
  PrvOnFailedPlugin = 6,
  PrvOnFailed = 7,
  PrvOffSucceeded = 8,
  PrvOffByPeer = 9,
  PrvOffFailed = 10,
  PrvOffUnknown = 11,
}

export enum BlockInputState {
  BlkStateUnknown = 0,
  BlkOnSucceeded = 2,
  BlkOnFailed = 3,
  BlkOffSucceeded = 4,
  BlkOffFailed = 5,
}

export enum BoolOption {
  NotSet = 0,
  No = 1,
  Yes = 2,
}

export interface PrivacyModeNotification {
  state: PrivacyModeState;
  details?: string;
}

export interface BlockInputNotification {
  state: BlockInputState;
  details?: string;
}

export interface SessionOptionMessage {
  imageQuality?: ImageQuality;
  customImageQuality?: number;
  lockAfterSessionEnd?: BoolOption;
  showRemoteCursor?: BoolOption;
  privacyMode?: BoolOption;
  disableAudio?: BoolOption;
  disableClipboard?: BoolOption;
  disableKeyboard?: BoolOption;
  customFps?: number;
  followRemoteCursor?: BoolOption;
  followRemoteWindow?: BoolOption;
  showMyCursor?: BoolOption;
  supportedDecoding?: Record<string, unknown>;
  blockInput?: BoolOption;
  enableFileTransfer?: BoolOption;
  terminalPersistent?: BoolOption;
}

export interface SessionEvents {
  stateChange: (state: SessionState) => void;
  peerInfo: (info: PeerInfoT) => void;
  videoFrame: (frame: VideoFrameT) => void;
  cursorData: (cursor: NonNullable<MessageT['cursorData']>) => void;
  cursorPosition: (pos: NonNullable<MessageT['cursorPosition']>) => void;
  audioFormat: (fmt: NonNullable<MessageT['audioFormat']>) => void;
  audioFrame: (frame: NonNullable<MessageT['audioFrame']>) => void;
  clipboard: (clip: NonNullable<MessageT['clipboard']>) => void;
  latency: (info: { delay: number; targetBitrate?: number }) => void;
  messageBox: (box: NonNullable<MessageT['messageBox']>) => void;
  switchDisplay: (display: unknown) => void;
  fileResponse: (resp: NonNullable<MessageT['fileResponse']>) => void;
  terminalResponse: (resp: NonNullable<MessageT['terminalResponse']>) => void;
  elevationResponse: (response: string) => void;
  privacyModeState: (notification: PrivacyModeNotification) => void;
  blockInputState: (notification: BlockInputNotification) => void;
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
  connSessionId = '';
  private listeners: { [K in keyof SessionEvents]?: Listener<K> } = {};
  private rendezvousStream: WsStream | null = null;
  private relayStream: WsStream | null = null;
  private relayQueue = new MessageQueue();
  private config: SessionConfig;
  private myId: string;
  private closed = false;
  private codecAbilities: { vp8: boolean; vp9: boolean; av1: boolean; h264: boolean; h265: boolean } | null = null;
  private initialOptions: SessionOptionMessage = {};
  private pendingHash: HashT | null = null;
  private peerVersion: string = '';

  constructor(config: SessionConfig) {
    this.config = config;
    this.myId = config.myId ?? generateWebId();
    this.connSessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
    if (this.state === 'connected') {
      this.runSteadyState();
    }
  }

  private async nextMessage(timeoutMs?: number): Promise<MessageT> {
    for (let i = 0; i < 20; i++) {
      const data = await this.relayQueue.next(timeoutMs);
      if (data.length === 0) throw new Error('stream closed');
      const msg = decodeMessage(data);
      if (msg.testDelay) {
        if (!msg.testDelay.fromClient) {
          this.relayStream?.send(encodeMessage({ testDelay: msg.testDelay }));
        }
        continue;
      }
      return msg;
    }
    throw new Error('too many test_delay messages while waiting for response');
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

    const first = await this.nextMessage(15000);
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
    const msg = await this.nextMessage(15000);

    if (!msg.hash) {
      if (msg.loginResponse?.error) throw new Error(`login error: ${msg.loginResponse.error}`);
      throw new Error('expected hash before login');
    }
    await this.sendLogin(msg.hash);
  }

  private async sendLogin(hash: HashT): Promise<void> {
    if (!this.config.password) {
      this.pendingHash = hash;
      this.emit('messageBox', {
        msgType: 'input-password',
        title: 'Password Required',
        text: '',
        link: '',
      });
      return;
    }
    const passwordHash = await computePasswordHash(this.config.password, hash.salt, hash.challenge);
    const abilities = await detectCodecAbilities();
    this.codecAbilities = abilities;
    this.log(`codec support: vp9=${abilities.vp9} h264=${abilities.h264} h265=${abilities.h265} av1=${abilities.av1} vp8=${abilities.vp8}`);
    const prefer = this.config.codecPreference ?? CodecPreference.Auto;
    const loginMsg: MessageT = {
      loginRequest: {
        username: this.config.peerId,
        password: passwordHash,
        myId: this.myId,
        myName: this.config.myName ?? 'RustDesk Web',
        videoAckRequired: false,
        version: CLIENT_VERSION,
        myPlatform: 'Web',
        option: {
          imageQuality: this.config.imageQuality ?? ImageQuality.Balanced,
          supportedDecoding: {
            abilityVp9: abilities.vp9 ? 1 : 0,
            abilityH264: abilities.h264 ? 1 : 0,
            abilityH265: abilities.h265 ? 1 : 0,
            abilityVp8: abilities.vp8 ? 1 : 0,
            abilityAv1: abilities.av1 ? 1 : 0,
            prefer,
          },
          ...this.initialOptions,
        },
      },
    };
    this.relayStream!.send(encodeMessage(loginMsg));
    this.log('login request sent');

    const resp = await this.nextMessage(15000);
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
      this.peerVersion = resp.loginResponse.peerInfo.version ?? '';
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
      const resp = await this.nextMessage(15000);
      if (resp.loginResponse?.error) throw new Error(`2fa failed: ${resp.loginResponse.error}`);
      if (resp.loginResponse?.peerInfo) {
        this.peerVersion = resp.loginResponse.peerInfo.version ?? '';
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
      else if (msg.testDelay) {
        if (!msg.testDelay.fromClient) {
          if (msg.testDelay.lastDelay !== undefined && msg.testDelay.lastDelay > 0) {
            this.emit('latency', {
              delay: msg.testDelay.lastDelay,
              targetBitrate: msg.testDelay.targetBitrate,
            });
          }
          this.relayStream?.send(encodeMessage({ testDelay: msg.testDelay }));
        }
      }
      else if (msg.messageBox) this.emit('messageBox', msg.messageBox);
      else if (msg.fileResponse) this.emit('fileResponse', msg.fileResponse);
      else if (msg.terminalResponse) this.emit('terminalResponse', msg.terminalResponse);
      else if (msg.misc) this.handleMisc(msg.misc);
      else if (msg.option) this.log('server option update received');
      else if (msg.refresh) this.handleRefresh();
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

  sendFileAction(action: NonNullable<MessageT['fileAction']>): void {
    if (this.state !== 'connected') return;
    this.relayStream?.send(encodeMessage({ fileAction: action }));
  }

  sendFileResponse(resp: NonNullable<MessageT['fileResponse']>): void {
    if (this.state !== 'connected') return;
    this.relayStream?.send(encodeMessage({ fileResponse: resp }));
  }

  sendTerminalAction(action: NonNullable<MessageT['terminalAction']>): void {
    if (this.state !== 'connected') return;
    this.relayStream?.send(encodeMessage({ terminalAction: action }));
  }

  sendMisc(msg: MessageT): void {
    if (this.state !== 'connected') return;
    this.relayStream?.send(encodeMessage(msg));
  }

  sendRefresh(): void {
    if (this.state !== 'connected') return;
    if (this.supportsMultiUiSession()) {
      const msg: MessageT = { misc: { refreshVideoDisplay: 0 } };
      this.relayStream?.send(encodeMessage(msg));
    } else {
      const msg: MessageT = { misc: { refresh_video: true } };
      this.relayStream?.send(encodeMessage(msg));
    }
  }

  sendRefreshDisplay(display: number): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = { misc: { refreshVideoDisplay: display } };
    this.relayStream?.send(encodeMessage(msg));
  }

  /** Check if peer version supports multi-ui-session (>= 1.2.4). */
  private supportsMultiUiSession(): boolean {
    return compareVersion(this.peerVersion, '1.2.4') >= 0;
  }

  async sendLoginWithPassword(password: string, _osUsername?: string, _osPassword?: string): Promise<void> {
    if (this.state !== 'connected' && this.state !== 'logging-in') return;
    const hash = this.pendingHash;
    if (!hash) {
      this.emit('error', new Error('no pending hash for password login'));
      return;
    }
    this.pendingHash = null;
    const passwordHash = await computePasswordHash(password, hash.salt, hash.challenge);
    const abilities = await detectCodecAbilities();
    this.codecAbilities = abilities;
    const prefer = this.config.codecPreference ?? CodecPreference.Auto;
    const loginMsg: MessageT = {
      loginRequest: {
        username: this.config.peerId,
        password: passwordHash,
        myId: this.myId,
        myName: this.config.myName ?? 'RustDesk Web',
        videoAckRequired: false,
        version: CLIENT_VERSION,
        myPlatform: 'Web',
        option: {
          imageQuality: this.config.imageQuality ?? ImageQuality.Balanced,
          supportedDecoding: {
            abilityVp9: abilities.vp9 ? 1 : 0,
            abilityH264: abilities.h264 ? 1 : 0,
            abilityH265: abilities.h265 ? 1 : 0,
            abilityVp8: abilities.vp8 ? 1 : 0,
            abilityAv1: abilities.av1 ? 1 : 0,
            prefer,
          },
          ...this.initialOptions,
        },
      },
    };
    this.relayStream!.send(encodeMessage(loginMsg));
    this.log('login with password sent');

    try {
      const resp = await this.nextMessage(15000);
      if (!resp.loginResponse) throw new Error('expected login response');
      if (resp.loginResponse.error) {
        if (resp.loginResponse.error === 'REQUIRE_2FA') {
          this.setState('need-2fa');
          this.emit('need2fa');
          return;
        }
        this.pendingHash = hash;
        this.emit('messageBox', {
          msgType: 're-input-password',
          title: resp.loginResponse.error,
          text: 'Do you want to enter again?',
          link: '',
        });
        return;
      }
      if (resp.loginResponse.peerInfo) {
        this.peerVersion = resp.loginResponse.peerInfo.version ?? '';
        this.emit('peerInfo', resp.loginResponse.peerInfo);
        this.setState('connected');
        this.log('connected');
        this.runSteadyState();
      } else {
        throw new Error('login response without peer info');
      }
    } catch (err) {
      this.handleError(err);
    }
  }


  sendSwitchDisplay(display: number): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = {
      misc: { switchDisplay: { display, width: 0, height: 0 } },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log(`switched to display ${display}`);
  }

  sendElevationRequest(direct: boolean): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = {
      misc: { elevation_request: { direct } },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log(`elevation request sent (direct=${direct})`);
  }

  sendElevationWithLogon(username: string, password: string): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = {
      misc: { elevation_request: { logon: { username, password } } },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log('elevation request sent (with logon)');
  }

  sendCodecPreference(prefer: CodecPreference): void {
    if (this.state !== 'connected' || !this.codecAbilities) return;
    const a = this.codecAbilities;
    const msg: MessageT = {
      misc: {
        option: {
          supportedDecoding: {
            abilityVp9: a.vp9 ? 1 : 0,
            abilityH264: a.h264 ? 1 : 0,
            abilityH265: a.h265 ? 1 : 0,
            abilityVp8: a.vp8 ? 1 : 0,
            abilityAv1: a.av1 ? 1 : 0,
            prefer,
          },
        },
      },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log(`codec preference updated: ${CodecPreference[prefer] ?? prefer}`);
  }

  getCodecAbilities() {
    return this.codecAbilities;
  }

  isSecured(): boolean {
    return this.relayStream?.isSecured() ?? false;
  }

  sendPrivacyMode(enabled: boolean, implKey: string = ''): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = {
      misc: { togglePrivacyMode: { implKey, on: enabled } },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log(`privacy mode toggle: ${enabled ? 'on' : 'off'} (implKey=${implKey})`);
  }

  sendBlockInput(enabled: boolean): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = {
      misc: { option: { blockInput: enabled ? BoolOption.Yes : BoolOption.No } },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log(`block input: ${enabled ? 'on' : 'off'}`);
  }

  sendRestartRemoteDevice(): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = {
      misc: { restartRemoteDevice: true },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log('restart remote device requested');
  }

  sendImageQuality(quality: ImageQuality): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = {
      misc: { option: { imageQuality: quality } },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log(`image quality set: ${ImageQuality[quality] ?? quality}`);
  }

  sendCustomImageQuality(quality: number): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = {
      misc: { option: { customImageQuality: quality << 8 } },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log(`custom image quality set: ${quality}`);
  }

  setInitialOptions(options: SessionOptionMessage): void {
    this.initialOptions = { ...options };
  }

  sendOption(options: SessionOptionMessage): void {
    if (this.state !== 'connected') return;
    const msg: MessageT = {
      misc: { option: options },
    };
    this.relayStream?.send(encodeMessage(msg));
    this.log(`option update sent: ${Object.keys(options).join(', ') || '(empty)'}`);
  }

  private handleMisc(misc: NonNullable<MessageT['misc']>): void {
    if (misc.audioFormat) this.emit('audioFormat', misc.audioFormat as NonNullable<MessageT['audioFormat']>);
    if (misc.closeReason) {
      this.emit('closeReason', misc.closeReason as string);
    }
    if (misc.switchDisplay) this.emit('switchDisplay', misc.switchDisplay);
    if (misc.refreshVideo) this.log('peer requested video refresh');
    if (misc.backNotification) {
      const bn = misc.backNotification as { privacyModeState?: number; blockInputState?: number; details?: string };
      if (bn.privacyModeState !== undefined && bn.privacyModeState !== null) {
        this.emit('privacyModeState', {
          state: bn.privacyModeState as PrivacyModeState,
          details: bn.details,
        });
      }
      if (bn.blockInputState !== undefined && bn.blockInputState !== null) {
        this.emit('blockInputState', {
          state: bn.blockInputState as BlockInputState,
          details: bn.details,
        });
      }
      this.log(`back notification received: privacyModeState=${bn.privacyModeState ?? 'n/a'} blockInputState=${bn.blockInputState ?? 'n/a'}`);
    }
    if (misc.elevation_response !== undefined) {
      this.emit('elevationResponse', misc.elevation_response as string);
    }
  }

  private handleRefresh(): void {
    this.log('peer requested state refresh');
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

export function boolToOption(b: boolean): BoolOption {
  return b ? BoolOption.Yes : BoolOption.No;
}

export type { ServerConfig, SessionConfig };