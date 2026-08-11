import protobuf from 'protobufjs';
import rendezvousProto from './rendezvous.proto?raw';
import messageProto from './message.proto?raw';

const root = new protobuf.Root();
protobuf.parse(rendezvousProto, root);
protobuf.parse(messageProto, root);

export const RendezvousMessage = root.lookupType('hbb.RendezvousMessage');
export const Message = root.lookupType('hbb.Message');
export const IdPk = root.lookupType('hbb.IdPk');

export interface IdPkT {
  id: string;
  pk: Uint8Array;
}

export function decodeIdPk(bytes: Uint8Array): IdPkT {
  return IdPk.decode(bytes) as unknown as IdPkT;
}

export type RendezvousMessageT = {
  registerPeer?: { id: string; serial: number };
  registerPeerResponse?: { requestPk: boolean };
  punchHoleRequest?: {
    id: string;
    natType?: number;
    licenceKey?: string;
    connType?: number;
    token?: string;
    version?: string;
    udpPort?: number;
    forceRelay?: boolean;
    upnpPort?: number;
    socketAddrV6?: Uint8Array;
    switchCode?: string;
  };
  punchHole?: {
    socketAddr?: Uint8Array;
    relayServer?: string;
    natType?: number;
    udpPort?: number;
    forceRelay?: boolean;
    upnpPort?: number;
    socketAddrV6?: Uint8Array;
  };
  punchHoleSent?: {
    socketAddr?: Uint8Array;
    id?: string;
    relayServer?: string;
    natType?: number;
    version?: string;
    upnpPort?: number;
    socketAddrV6?: Uint8Array;
  };
  punchHoleResponse?: {
    socketAddr?: Uint8Array;
    pk?: Uint8Array;
    failure?: number;
    relayServer?: string;
    natType?: number;
    isLocal?: boolean;
    otherFailure?: string;
    feedback?: number;
    isUdp?: boolean;
    upnpPort?: number;
    socketAddrV6?: Uint8Array;
  };
  registerPk?: { id: string; uuid: Uint8Array; pk: Uint8Array; oldId?: string; noRegisterDevice?: boolean };
  registerPkResponse?: { result?: number; keepAlive?: number };
  requestRelay?: {
    id: string;
    uuid: string;
    socketAddr?: Uint8Array;
    relayServer: string;
    secure?: boolean;
    licenceKey?: string;
    connType?: number;
    token?: string;
    switchCode?: string;
  };
  relayResponse?: {
    socketAddr?: Uint8Array;
    uuid: string;
    relayServer: string;
    id?: string;
    pk?: Uint8Array;
    refuseReason?: string;
    version?: string;
    feedback?: number;
    socketAddrV6?: Uint8Array;
    upnpPort?: number;
  };
  keyExchange?: { keys: Uint8Array[] };
  testNatRequest?: { serial: number };
  testNatResponse?: { port?: number };
  configureUpdate?: { serial?: number; rendezvousServers?: string[] };
  fetchLocalAddr?: { socketAddr?: Uint8Array; relayServer?: string; socketAddrV6?: Uint8Array };
  localAddr?: { socketAddr?: Uint8Array; localAddr?: Uint8Array; relayServer?: string; id?: string; version?: string; socketAddrV6?: Uint8Array };
};

export type DisplayInfoT = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  name?: string;
  online?: boolean;
  cursorEmbedded?: boolean;
  scale?: number;
};

export type PeerInfoT = {
  username?: string;
  hostname?: string;
  platform?: string;
  displays: DisplayInfoT[];
  currentDisplay?: number;
  sasEnabled?: boolean;
  version?: string;
  features?: { privacyMode?: boolean; terminal?: boolean };
  encoding?: { h264?: boolean; h265?: boolean; vp8?: boolean; av1?: boolean };
};

export type HashT = { salt: string; challenge: string };

export type VideoFrameT = {
  vp9s?: { frames: { data: Uint8Array; key?: boolean; pts?: number | Long }[] };
  h264s?: { frames: { data: Uint8Array; key?: boolean; pts?: number | Long }[] };
  h265s?: { frames: { data: Uint8Array; key?: boolean; pts?: number | Long }[] };
  vp8s?: { frames: { data: Uint8Array; key?: boolean; pts?: number | Long }[] };
  av1s?: { frames: { data: Uint8Array; key?: boolean; pts?: number | Long }[] };
  rgb?: { compress?: boolean };
  yuv?: { compress?: boolean; stride?: number };
  display?: number;
};

export type MouseEventT = {
  mask?: number;
  x?: number;
  y?: number;
  modifiers?: number[];
};

export type KeyEventT = {
  down?: boolean;
  press?: boolean;
  controlKey?: number;
  chr?: number;
  unicode?: number;
  seq?: string;
  win2winHotkey?: number;
  modifiers?: number[];
  mode?: number;
};

export type MessageT = {
  signedId?: { id: Uint8Array; pk?: Uint8Array };
  publicKey?: { asymmetricValue?: Uint8Array; symmetricValue?: Uint8Array };
  testDelay?: { fromClient?: boolean; lastDelay?: number; targetBitrate?: number };
  hash?: HashT;
  loginRequest?: {
    username?: string;
    password?: Uint8Array;
    myId?: string;
    myName?: string;
    option?: Record<string, unknown>;
    videoAckRequired?: boolean;
    sessionId?: number | Long;
    version?: string;
    myPlatform?: string;
    hwid?: Uint8Array;
    avatar?: string;
  };
  loginResponse?: { error?: string; peerInfo?: PeerInfoT; enableTrustedDevices?: boolean };
  peerInfo?: PeerInfoT;
  videoFrame?: VideoFrameT;
  mouseEvent?: MouseEventT;
  keyEvent?: KeyEventT;
  cursorData?: {
    id?: number;
    hotx?: number;
    hoty?: number;
    width?: number;
    height?: number;
    colors?: Uint8Array;
  };
  cursorPosition?: { x?: number; y?: number };
  position?: { x?: number; y?: number };
  clipboard?: { compress?: boolean; content?: Uint8Array };
  audioFormat?: { sampleRate?: number; channels?: number; msecPerPacket?: number };
  audioFrame?: { timestamp?: number | Long; data?: Uint8Array };
  misc?: { audioSeeds?: number[] } & Record<string, unknown>;
  option?: Record<string, unknown>;
  closeReason?: string;
  refresh?: boolean;
  auth2fa?: { code: string; hwid?: Uint8Array };
  messageBox?: { msgType?: string; title?: string; text?: string; link?: string };
  fileAction?: {
    readDir?: { id?: number; path?: string; includeHidden?: boolean };
    send?: { id?: number; path?: string; includeHidden?: boolean; fileNum?: number };
    receive?: { id?: number; path?: string; files?: unknown[]; fileNum?: number; totalSize?: number };
    cancel?: { id?: number };
    sendConfirm?: { id?: number; fileNum?: number; skip?: boolean; offsetBlk?: number };
  };
  fileResponse?: {
    dir?: { id?: number; path?: string; entries?: FileEntryT[] };
    block?: { id?: number; fileNum?: number; data?: Uint8Array; compressed?: boolean; blkId?: number };
    error?: { id?: number; error?: string; fileNum?: number };
    done?: { id?: number; fileNum?: number };
    digest?: { id?: number; fileNum?: number; lastModified?: number; fileSize?: number; isUpload?: boolean; isIdentical?: boolean; transferredSize?: number; isResume?: boolean };
  };
};

export type FileEntryT = {
  entryType?: number;
  name?: string;
  isHidden?: boolean;
  size?: number;
  modifiedTime?: number;
};

export type Long = { low: number; high: number; unsigned: boolean };

export function encodeRendezvous(msg: RendezvousMessageT): Uint8Array {
  return RendezvousMessage.encode(RendezvousMessage.create(msg as never)).finish() as Uint8Array;
}

export function decodeRendezvous(bytes: Uint8Array): RendezvousMessageT {
  return RendezvousMessage.decode(bytes) as unknown as RendezvousMessageT;
}

export function encodeMessage(msg: MessageT): Uint8Array {
  return Message.encode(Message.create(msg as never)).finish() as Uint8Array;
}

export function decodeMessage(bytes: Uint8Array): MessageT {
  return Message.decode(bytes) as unknown as MessageT;
}

export function messageUnionName(decoded: unknown): string | undefined {
  const m = decoded as { union?: string };
  return m.union;
}

export function rendezvousUnionName(decoded: unknown): string | undefined {
  const m = decoded as { union?: string };
  return m.union;
}