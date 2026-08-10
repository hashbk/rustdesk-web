import nacl from 'tweetnacl';

export async function initCrypto(): Promise<void> {
  // tweetnacl is pure JS; Web Crypto is native. Nothing to initialize.
}

const BOX_NONCE = new Uint8Array(24);

export function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function verifySigned(signed: Uint8Array, signPk: Uint8Array): Uint8Array | null {
  return nacl.sign.open(signed, signPk);
}

export interface BoxKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateBoxKeypair(): BoxKeypair {
  return nacl.box.keyPair();
}

export function generateSecretKey(): Uint8Array {
  return nacl.randomBytes(32);
}

export function boxSeal(message: Uint8Array, theirPk: Uint8Array, mySk: Uint8Array): Uint8Array {
  return nacl.box(message, BOX_NONCE, theirPk, mySk);
}

export function boxOpen(sealed: Uint8Array, theirPk: Uint8Array, mySk: Uint8Array): Uint8Array | null {
  return nacl.box.open(sealed, BOX_NONCE, theirPk, mySk);
}

function nonceFromSeq(seq: number): Uint8Array {
  const nonce = new Uint8Array(24);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(seq), true);
  return nonce;
}

export class StreamCipher {
  private encSeq = 0;
  private decSeq = 0;

  constructor(private readonly key: Uint8Array) {}

  encrypt(data: Uint8Array): Uint8Array {
    this.encSeq += 1;
    return nacl.secretbox(data, nonceFromSeq(this.encSeq), this.key);
  }

  decrypt(data: Uint8Array): Uint8Array | null {
    if (data.length <= 1) return data;
    this.decSeq += 1;
    return nacl.secretbox.open(data, nonceFromSeq(this.decSeq), this.key);
  }
}

export async function computePasswordHash(
  password: string,
  salt: string,
  challenge: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const pwBytes = encoder.encode(password);
  const saltBytes = encoder.encode(salt);
  const challengeBytes = encoder.encode(challenge);
  const inner = await sha256(concatBytes(pwBytes, saltBytes));
  return sha256(concatBytes(inner, challengeBytes));
}
