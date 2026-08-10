/// <reference types="vite/client" />

declare module 'tweetnacl' {
  export interface KeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }
  interface Nacl {
    sign: {
      open(signed: Uint8Array, publicKey: Uint8Array): Uint8Array | null;
      detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
      keyPair(): KeyPair;
    };
    box: {
      keyPair(): KeyPair;
      (message: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array;
      open(
        box: Uint8Array,
        nonce: Uint8Array,
        publicKey: Uint8Array,
        secretKey: Uint8Array,
      ): Uint8Array | null;
    };
    secretbox: {
      (message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
      open(box: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null;
    };
    randomBytes(length: number): Uint8Array;
    hash(message: Uint8Array): Uint8Array;
  }
  const nacl: Nacl;
  export default nacl;
}
