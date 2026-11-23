// Browser Web Crypto shim for GramJS (replaces Node `crypto` in client webpack bundle)
// Implements randomBytes, createHash (sha1/sha256), pbkdf2Sync (sha512), and AES-CTR.
import AES from '@cryptography/aes';
import { Buffer } from 'buffer';
import { ab2i, i2ab } from 'telegram/crypto/converters';
import { getWords } from 'telegram/crypto/words';

function getWebCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  if (typeof self !== 'undefined' && self.crypto) {
    return self.crypto;
  }
  throw new Error('Web Crypto API is not available in this environment.');
}

export class Counter {
  constructor(initialValue) {
    this._counter = Buffer.from(initialValue);
  }

  increment() {
    for (let i = 15; i >= 0; i--) {
      if (this._counter[i] === 255) {
        this._counter[i] = 0;
      } else {
        this._counter[i]++;
        break;
      }
    }
  }
}

export class CTR {
  constructor(key, counter) {
    if (!(counter instanceof Counter)) {
      counter = new Counter(counter);
    }
    this._counter = counter;
    this._remainingCounter = undefined;
    this._remainingCounterIndex = 16;
    this._aes = new AES(getWords(key));
  }

  update(plainText) {
    return this.encrypt(plainText);
  }

  encrypt(plainText) {
    const encrypted = Buffer.from(plainText);
    for (let i = 0; i < encrypted.length; i++) {
      if (this._remainingCounterIndex === 16) {
        this._remainingCounter = Buffer.from(
          i2ab(this._aes.encrypt(ab2i(this._counter._counter)))
        );
        this._remainingCounterIndex = 0;
        this._counter.increment();
      }
      if (this._remainingCounter) {
        encrypted[i] ^= this._remainingCounter[this._remainingCounterIndex++];
      }
    }
    return encrypted;
  }
}

export function createDecipheriv(algorithm, key, iv) {
  if (String(algorithm).includes('ECB')) {
    throw new Error('ECB mode is not supported in browser crypto shim');
  }
  return new CTR(key, iv);
}

export function createCipheriv(algorithm, key, iv) {
  if (String(algorithm).includes('ECB')) {
    throw new Error('ECB mode is not supported in browser crypto shim');
  }
  return new CTR(key, iv);
}

export function randomBytes(count) {
  const bytes = new Uint8Array(count);
  getWebCrypto().getRandomValues(bytes);
  return Buffer.from(bytes);
}

export class Hash {
  constructor(algorithm) {
    this.algorithm = String(algorithm).toLowerCase();
    this.chunks = [];
  }

  update(data) {
    if (typeof data === 'string') {
      this.chunks.push(Buffer.from(data, 'utf8'));
    } else if (data) {
      this.chunks.push(Buffer.from(data));
    }
    return this;
  }

  async digest() {
    const combined =
      this.chunks.length === 0
        ? new Uint8Array(0)
        : new Uint8Array(Buffer.concat(this.chunks));
    const subtle = getWebCrypto().subtle;
    if (this.algorithm === 'sha1' || this.algorithm === 'sha-1') {
      return Buffer.from(await subtle.digest('SHA-1', combined));
    }
    if (this.algorithm === 'sha256' || this.algorithm === 'sha-256') {
      return Buffer.from(await subtle.digest('SHA-256', combined));
    }
    if (this.algorithm === 'sha512' || this.algorithm === 'sha-512') {
      return Buffer.from(await subtle.digest('SHA-512', combined));
    }
    return Buffer.alloc(0);
  }
}

export function createHash(algorithm) {
  return new Hash(algorithm);
}

export async function pbkdf2Sync(password, salt, iterations, keylen = 64, digest = 'sha512') {
  const subtle = getWebCrypto().subtle;
  const passBytes =
    typeof password === 'string'
      ? new TextEncoder().encode(password)
      : new Uint8Array(password);
  const saltBytes =
    typeof salt === 'string'
      ? new TextEncoder().encode(salt)
      : new Uint8Array(salt);
  const hashAlgo =
    String(digest).toLowerCase() === 'sha256' ? 'SHA-256' : 'SHA-512';
  const passwordKey = await subtle.importKey(
    'raw',
    passBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: hashAlgo,
      salt: saltBytes,
      iterations,
    },
    passwordKey,
    keylen * 8
  );
  return Buffer.from(bits);
}

const cryptoShim = {
  Counter,
  CTR,
  Hash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  pbkdf2Sync,
};

export default cryptoShim;
