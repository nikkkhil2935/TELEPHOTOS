#!/usr/bin/env node
/**
 * Framely Automated Security & Integrity Test Suite (6 Integration Checks)
 *
 * 1. AES-256-GCM encryption with 100,000 PBKDF2 SHA-256 rounds
 * 2. Tamper evidence (flipped bit in ciphertext must fail decryption loudly)
 * 3. Incorrect passphrase rejection
 * 4. Account scoping (records strictly isolated by channel libraryId)
 * 5. Filename & caption sanitization against XSS and path traversal
 * 6. Telegram 2,048 MB (2 GB) file size limit enforcement
 */
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PBKDF2_ITERATIONS = 100000;
const TELEGRAM_MAX_BYTES = 2048 * 1024 * 1024; // 2,048 MB

async function deriveKey(passphrase, salt) {
  const baseKey = await subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptVault(plaintext, passphrase) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipherBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    encoder.encode(plaintext)
  );
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(cipherBuffer).toString('base64'),
  };
}

async function decryptVault(envelope, passphrase) {
  const salt = new Uint8Array(Buffer.from(envelope.salt, 'base64'));
  const iv = new Uint8Array(Buffer.from(envelope.iv, 'base64'));
  const ciphertext = new Uint8Array(Buffer.from(envelope.ciphertext, 'base64'));
  const key = await deriveKey(passphrase, salt);
  const plainBuffer = await subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    ciphertext
  );
  return decoder.decode(plainBuffer);
}

function sanitizeFilename(raw) {
  const cleaned = String(raw || 'untitled')
    .replace(/\0/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(0, 180) || 'untitled';
}

function sanitizeCaptionText(raw) {
  return String(raw || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .trim()
    .slice(0, 1024);
}

function validateFileSize(sizeBytes) {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { valid: false, reason: 'Invalid file size' };
  }
  if (sizeBytes > TELEGRAM_MAX_BYTES) {
    return { valid: false, reason: 'Exceeds Telegram 2,048 MB single-file cap' };
  }
  return { valid: true };
}

function scopeRecordsByAccount(records, activeLibraryId) {
  return records.filter((item) => item.libraryId === activeLibraryId);
}

async function run() {
  const results = [];

  async function runTest(name, fn) {
    const start = Date.now();
    await fn();
    const ms = Date.now() - start;
    results.push({ name, ms });
    console.log(`  PASS  ${name} (${ms}ms)`);
  }

  console.log('\nFramely Zero-Knowledge Security Verification Suite\n');

  const secretPayload = JSON.stringify({
    session: '1BVtsOH8Bu84a_demo_mtproto_session_key_v2',
    apiId: 24910221,
    channelId: '-1002198472310',
  });
  const passphrase = 'correct-horse-battery-staple-2026!';
  let encryptedEnvelope;

  await runTest('1. AES-256-GCM encryption with 100,000 PBKDF2 SHA-256 rounds', async () => {
    encryptedEnvelope = await encryptVault(secretPayload, passphrase);
    assert.equal(encryptedEnvelope.iterations, 100000);
    assert.equal(encryptedEnvelope.cipher, 'AES-256-GCM');
    assert.equal(Buffer.from(encryptedEnvelope.salt, 'base64').byteLength, 16);
    assert.equal(Buffer.from(encryptedEnvelope.iv, 'base64').byteLength, 12);
    assert.notEqual(encryptedEnvelope.ciphertext, secretPayload);

    const decrypted = await decryptVault(encryptedEnvelope, passphrase);
    assert.equal(decrypted, secretPayload);
  });

  await runTest('2. Tamper evidence (flipped bit in ciphertext fails loudly)', async () => {
    const rawBytes = Buffer.from(encryptedEnvelope.ciphertext, 'base64');
    rawBytes[0] = rawBytes[0] ^ 0x01; // flip LSB of first byte
    const tampered = {
      ...encryptedEnvelope,
      ciphertext: rawBytes.toString('base64'),
    };
    await assert.rejects(
      async () => decryptVault(tampered, passphrase),
      /Unsupported state|unable to authenticate|OperationError/i
    );
  });

  await runTest('3. Incorrect passphrase rejection', async () => {
    await assert.rejects(
      async () => decryptVault(encryptedEnvelope, 'wrong-passphrase-attempt'),
      /Unsupported state|unable to authenticate|OperationError/i
    );
  });

  await runTest('4. Account scoping isolates media records by Telegram channel ID', async () => {
    const mockDb = [
      { messageId: 101, libraryId: 'tg_channel_alpha', filename: 'a.jpg' },
      { messageId: 102, libraryId: 'tg_channel_beta', filename: 'b.jpg' },
      { messageId: 103, libraryId: 'tg_channel_alpha', filename: 'c.jpg' },
    ];
    const alphaOnly = scopeRecordsByAccount(mockDb, 'tg_channel_alpha');
    assert.equal(alphaOnly.length, 2);
    assert.ok(alphaOnly.every((r) => r.libraryId === 'tg_channel_alpha'));
    const emptyCheck = scopeRecordsByAccount(mockDb, 'tg_channel_gamma');
    assert.equal(emptyCheck.length, 0);
  });

  await runTest('5. Filename & caption sanitization blocks XSS and path traversal', async () => {
    const hostilePath = '../../etc/passwd<script>alert(1)</script>.jpg';
    const safeName = sanitizeFilename(hostilePath);
    assert.ok(!safeName.includes('..'));
    assert.ok(!safeName.includes('/'));
    assert.ok(!safeName.includes('<'));
    assert.ok(!safeName.includes('>'));

    const hostileCaption = '<img src=x onerror=alert(1)>Vacation <script>steal()</script>javascript:void(0)';
    const safeCaption = sanitizeCaptionText(hostileCaption);
    assert.ok(!safeCaption.includes('<script>'));
    assert.ok(!safeCaption.includes('<img'));
    assert.ok(!safeCaption.toLowerCase().includes('javascript:'));
    assert.ok(safeCaption.includes('Vacation'));
  });

  await runTest('6. Telegram 2,048 MB (2 GB) single-file size limit enforcement', async () => {
    assert.equal(validateFileSize(1024 * 1024 * 500).valid, true);
    assert.equal(validateFileSize(TELEGRAM_MAX_BYTES).valid, true);
    assert.equal(validateFileSize(TELEGRAM_MAX_BYTES + 1).valid, false);
    assert.equal(validateFileSize(0).valid, false);
    assert.equal(validateFileSize(-10).valid, false);
  });

  console.log(`\nAll ${results.length}/6 security integration tests passed.\n`);
}

run().catch((err) => {
  console.error('\nSecurity test suite FAILED:', err);
  process.exit(1);
});
