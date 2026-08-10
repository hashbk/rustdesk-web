/// <reference types="vite/client" />

declare module 'tweetnacl' {
  export interface KeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }
  export const sign: {
    open(signed: Uint8Array, publicKey: Uint8Array): Uint8Array | null;
    detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
    keyPair(): KeyPair;
  };
  export const box: {
    keyPair(): KeyPair;
    (message: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array;
    open(
      box: Uint8Array,
      nonce: Uint8Array,
      publicKey: Uint8Array,
      secretKey: Uint8Array,
    ): Uint8Array | null;
  };
  export const secretbox: {
    (message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
    open(box: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null;
  };
  export function randomBytes(length: number): Uint8Array;
  export function hash(message: Uint8Array): Uint8Array;
}
