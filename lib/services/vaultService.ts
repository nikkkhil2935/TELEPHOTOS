import type { EncryptedVaultEnvelope, TelegramSessionPayload } from '../types';

export const VAULT_STORAGE_KEY = 'framely_encrypted_vault';
export const LOCKED_PASS_STORAGE_KEY = 'framely_locked_folder_envelope';
export const AUTO_LOCK_STORAGE_KEY = 'framely_auto_lock_minutes';
export const PBKDF2_ITERATIONS = 100_000;

function getSubtle(): SubtleCrypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error('Web Crypto API (crypto.subtle) is unavailable in this environment.');
}

function getRandomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array | string): Promise<string> {
  const subtle = getSubtle();
  const data =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await subtle.digest('SHA-256', data as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

async function deriveAesGcmKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  const keyMaterial = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts plaintext using PBKDF2 (100,000 SHA-256 iterations, 16-byte salt)
 * and AES-256-GCM (12-byte IV, 128-bit authentication tag).
 */
export async function encryptWithPassphrase(
  plaintext: string,
  passphrase: string
): Promise<EncryptedVaultEnvelope> {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('Passphrase must be at least 4 characters long.');
  }
  const subtle = getSubtle();
  const salt = getRandomBytes(16);
  const iv = getRandomBytes(12);
  const key = await deriveAesGcmKey(passphrase, salt);
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
    key,
    encoded
  );

  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Decrypts an AES-256-GCM envelope. Any flipped bit in ciphertext or wrong
 * passphrase throws an authenticated decryption error without leaking data.
 */
export async function decryptWithPassphrase(
  envelope: EncryptedVaultEnvelope,
  passphrase: string
): Promise<string> {
  const subtle = getSubtle();
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const key = await deriveAesGcmKey(passphrase, salt);

  try {
    const plainBuffer = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
      key,
      ciphertext as BufferSource
    );
    return new TextDecoder().decode(plainBuffer);
  } catch {
    throw new Error(
      'AES-256-GCM authentication failed: incorrect passphrase or tampered ciphertext.'
    );
  }
}

export async function saveEncryptedSessionVault(
  session: TelegramSessionPayload,
  passphrase: string
): Promise<EncryptedVaultEnvelope> {
  const envelope = await encryptWithPassphrase(JSON.stringify(session), passphrase);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(envelope));
  }
  return envelope;
}

export function loadEncryptedVaultEnvelope(): EncryptedVaultEnvelope | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EncryptedVaultEnvelope;
    if (parsed && parsed.v === 1 && parsed.cipher === 'AES-256-GCM') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function unlockSessionVault(passphrase: string): Promise<TelegramSessionPayload> {
  const envelope = loadEncryptedVaultEnvelope();
  if (!envelope) {
    throw new Error('No encrypted session vault found in local browser storage.');
  }
  const json = await decryptWithPassphrase(envelope, passphrase);
  return JSON.parse(json) as TelegramSessionPayload;
}

export function getAutoLockMinutes(): number {
  if (typeof window === 'undefined') return 15;
  const stored = Number(window.localStorage.getItem(AUTO_LOCK_STORAGE_KEY));
  return Number.isFinite(stored) && stored >= 0 ? stored : 15;
}

export function setAutoLockMinutes(minutes: number): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(minutes));
  }
}

/**
 * Generates an Emergency Recovery Kit text document with key salt, encrypted
 * payload, and human-readable cryptographic recovery instructions.
 */
export function buildEmergencyRecoveryKit(
  envelope: EncryptedVaultEnvelope,
  channelTitle: string
): string {
  return [
    '====================================================================',
    'FRAMELY ZERO-KNOWLEDGE EMERGENCY RECOVERY KIT',
    '====================================================================',
    `Generated:         ${new Date().toISOString()}`,
    `Vault Channel:     ${channelTitle}`,
    `Key Derivation:    ${envelope.kdf} (${envelope.iterations.toLocaleString()} iterations)`,
    `Cipher Suite:      ${envelope.cipher} (128-bit GCM authentication tag)`,
    '',
    'IMPORTANT: Store this document offline (printed or password manager).',
    'Framely operates with zero relay servers. Without your master passphrase,',
    'nobody can decrypt this envelope.',
    '',
    '--- CRYPTOGRAPHIC PARAMETERS ---',
    `SALT (Base64, 16B): ${envelope.salt}`,
    `IV   (Base64, 12B): ${envelope.iv}`,
    '',
    '--- ENCRYPTED VAULT PAYLOAD ---',
    envelope.ciphertext,
    '',
    '--- FULL ENVELOPE JSON ---',
    JSON.stringify(envelope, null, 2),
    '',
    '--- RECOVERY STEPS ---',
    '1. Open Framely in any modern browser supporting Web Crypto API.',
    '2. Open Settings -> Zero-Knowledge Vault -> Import Recovery Envelope.',
    '3. Enter your master passphrase to derive the 256-bit AES-GCM key locally.',
    '4. Your Telegram MTProto session & channel pointer will restore immediately.',
    '====================================================================',
  ].join('\n');
}

export function downloadTextFile(filename: string, content: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Panic Wipe: purges all Framely localStorage keys, session caches, and IndexedDB.
 */
export async function executePanicWipe(clearIndexedDb: () => Promise<void>): Promise<void> {
  await clearIndexedDb();
  if (typeof window !== 'undefined') {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('framely_')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));
    window.sessionStorage.clear();
  }
}
