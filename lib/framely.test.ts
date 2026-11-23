import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaceClusters,
  decodeStructuredCaption,
  encodeStructuredCaption,
  extractTimelineYears,
  formatBytes,
  getWindowedFilmstripIndices,
  groupMediaByDay,
  resolveRegionalPlace,
  sanitizeCaptionText,
  sanitizeFilename,
  scopeMediaByLibrary,
  TELEGRAM_MAX_FILE_BYTES,
  validateTelegramFileSize,
} from './utils/security';
import {
  base64ToBytes,
  bytesToBase64,
  decryptWithPassphrase,
  encryptWithPassphrase,
  PBKDF2_ITERATIONS,
} from './services/vaultService';
import { SEED_MEDIA_ITEMS } from './db/seedData';

test('AES-256-GCM vault encryption & decryption with 100k PBKDF2 rounds', async () => {
  const payload = JSON.stringify({ channelId: '-1002198472310', token: 'secret-session' });
  const passphrase = 'framely-master-passphrase';
  const envelope = await encryptWithPassphrase(payload, passphrase);

  assert.equal(envelope.iterations, PBKDF2_ITERATIONS);
  assert.equal(envelope.cipher, 'AES-256-GCM');
  assert.equal(base64ToBytes(envelope.salt).byteLength, 16);
  assert.equal(base64ToBytes(envelope.iv).byteLength, 12);

  const decrypted = await decryptWithPassphrase(envelope, passphrase);
  assert.equal(decrypted, payload);
});

test('Tampered ciphertext fails AES-256-GCM authentication loudly', async () => {
  const envelope = await encryptWithPassphrase('private-key-material', 'strong-pass-2026');
  const bytes = base64ToBytes(envelope.ciphertext);
  bytes[0] = bytes[0] ^ 0x01;

  await assert.rejects(
    async () =>
      decryptWithPassphrase(
        { ...envelope, ciphertext: bytesToBase64(bytes) },
        'strong-pass-2026'
      ),
    /authentication failed/i
  );
});

test('Incorrect passphrase is rejected by AES-256-GCM', async () => {
  const envelope = await encryptWithPassphrase('vault-secret', 'right-passphrase');
  await assert.rejects(
    async () => decryptWithPassphrase(envelope, 'wrong-passphrase'),
    /authentication failed/i
  );
});

test('Filename and caption sanitization neutralizes XSS and path traversal', () => {
  const cleanFile = sanitizeFilename('../../etc/passwd<script>alert(1)</script>.dng');
  assert.equal(cleanFile.includes('..'), false);
  assert.equal(cleanFile.includes('/'), false);
  assert.equal(cleanFile.includes('<'), false);

  const cleanCaption = sanitizeCaptionText('<img src=x onerror=x>Trip <script>evil()</script>javascript:run()');
  assert.equal(cleanCaption.includes('<script>'), false);
  assert.equal(cleanCaption.includes('<img'), false);
  assert.equal(cleanCaption.toLowerCase().includes('javascript:'), false);
  assert.ok(cleanCaption.includes('Trip'));
});

test('Telegram 2,048 MB file limit validation works at boundary', () => {
  assert.equal(validateTelegramFileSize(TELEGRAM_MAX_FILE_BYTES).valid, true);
  assert.equal(validateTelegramFileSize(TELEGRAM_MAX_FILE_BYTES + 1).valid, false);
  assert.equal(validateTelegramFileSize(0).valid, false);
  assert.equal(formatBytes(2048 * 1024 * 1024), '2.0 GB');
});

test('Structured caption schema v1 round-trips cleanly', () => {
  const sample = SEED_MEDIA_ITEMS[0];
  const encoded = encodeStructuredCaption(sample);
  const decoded = decodeStructuredCaption(encoded);
  assert.ok(decoded);
  assert.equal(decoded.v, 1);
  assert.equal(decoded.name, sample.filename);
  assert.equal(decoded.w, sample.width);
  assert.equal(decoded.fav, 1);
  assert.deepEqual(decoded.albums, sample.albums);
});

test('Account scoping isolates records strictly by libraryId', () => {
  const mixed = [
    { id: 1, libraryId: 'chan-A' },
    { id: 2, libraryId: 'chan-B' },
    { id: 3, libraryId: 'chan-A' },
  ];
  const scoped = scopeMediaByLibrary(mixed, 'chan-A');
  assert.equal(scoped.length, 2);
  assert.ok(scoped.every((x) => x.libraryId === 'chan-A'));
});

test('Local GPS clustering groups coordinates into named regional places', () => {
  const mumbai = resolveRegionalPlace(18.9438, 72.8231);
  assert.equal(mumbai?.name, 'Mumbai City & Harbor');

  const clusters = buildPlaceClusters(SEED_MEDIA_ITEMS);
  assert.ok(clusters.length >= 4);
  const names = clusters.map((c) => c.name);
  assert.ok(names.includes('Mumbai City & Harbor'));
  assert.ok(names.includes('Vasai & Virar Coast'));
  assert.ok(names.includes('Pune & Western Ghats'));
  assert.ok(names.includes('Kyoto & Arashiyama'));
});

test('Day grouping and windowed filmstrip math keep bounds exact', () => {
  const visible = SEED_MEDIA_ITEMS.filter((i) => !i.isLocked && !i.isArchived);
  const groups = groupMediaByDay(visible, new Date('2026-11-23T18:00:00.000Z'));
  assert.ok(groups[0].label.startsWith('Today —'));
  const years = extractTimelineYears(groups);
  assert.deepEqual(years, [2026, 2025, 2024, 2023]);

  const win = getWindowedFilmstripIndices(5000, 100, 18);
  assert.equal(win.start, 82);
  assert.equal(win.end, 119);
  assert.equal(win.end - win.start, 37);
});

test('Gallery keyboard shortcut resolver maps A, F, Delete, Escape and guards inputs/modals', async () => {
  const { isEditableElement, resolveGalleryShortcut } = await import('./utils/shortcuts');

  assert.equal(isEditableElement({ tagName: 'INPUT' } as unknown as EventTarget), true);
  assert.equal(isEditableElement({ tagName: 'TEXTAREA' } as unknown as EventTarget), true);
  assert.equal(isEditableElement({ tagName: 'SELECT' } as unknown as EventTarget), true);
  assert.equal(isEditableElement({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isEditableElement({ tagName: 'BUTTON' } as unknown as EventTarget), false);
  assert.equal(isEditableElement(null), false);

  const activeCtx = {
    hasSelection: true,
    isModalOpen: false,
    isLightboxOpen: false,
    isEditable: false,
  };

  assert.equal(resolveGalleryShortcut({ key: 'a' }, activeCtx), 'archive');
  assert.equal(resolveGalleryShortcut({ key: 'A' }, activeCtx), 'archive');
  assert.equal(resolveGalleryShortcut({ key: 'f' }, activeCtx), 'favorite');
  assert.equal(resolveGalleryShortcut({ key: 'F' }, activeCtx), 'favorite');
  assert.equal(resolveGalleryShortcut({ key: 'Delete' }, activeCtx), 'delete');
  assert.equal(resolveGalleryShortcut({ key: 'Backspace' }, activeCtx), 'delete');
  assert.equal(resolveGalleryShortcut({ key: 'Escape' }, activeCtx), 'clear-selection');

  // Guard conditions: no selection, editable element, modal open, lightbox open, modifier keys
  assert.equal(resolveGalleryShortcut({ key: 'a' }, { ...activeCtx, hasSelection: false }), null);
  assert.equal(resolveGalleryShortcut({ key: 'f' }, { ...activeCtx, isEditable: true }), null);
  assert.equal(resolveGalleryShortcut({ key: 'Delete' }, { ...activeCtx, isModalOpen: true }), null);
  assert.equal(resolveGalleryShortcut({ key: 'a' }, { ...activeCtx, isLightboxOpen: true }), null);
  assert.equal(resolveGalleryShortcut({ key: 'a', ctrlKey: true }, activeCtx), null);
  assert.equal(resolveGalleryShortcut({ key: 'f', metaKey: true }, activeCtx), null);
  assert.equal(resolveGalleryShortcut({ key: 'a', altKey: true }, activeCtx), null);
});

test('Patched GramJS uploads.js streams multi-megabyte browser Blob in <= 128 KB slices without full-file buffering', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const uploads = require('../node_modules/telegram/client/uploads.js');

  const CHUNK_LIMIT = 128 * 1024; // 128 KB
  const TOTAL_BYTES = 1_310_720 + 19_456; // 1.25 MB + odd tail (~1.27 MB, 11 chunks)
  const sourcePayload = Buffer.alloc(TOTAL_BYTES);
  for (let i = 0; i < TOTAL_BYTES; i++) {
    sourcePayload[i] = (i * 31 + 7) & 0xff;
  }

  const sliceWindows: Array<{ start: number; end: number; size: number }> = [];
  let rootArrayBufferCalled = false;

  // Browser File/Blob double that throws immediately if anything attempts to buffer the entire file in RAM
  const fakeDomFile = {
    name: 'DSC09412_RAW_Master.dng',
    type: 'image/x-adobe-dng',
    size: TOTAL_BYTES,
    arrayBuffer: async () => {
      rootArrayBufferCalled = true;
      throw new Error('MEMORY OVERFLOW GUARD: root File.arrayBuffer() must never be called');
    },
    slice: (start = 0, end = TOTAL_BYTES) => {
      const clampedStart = Math.max(0, start);
      const clampedEnd = Math.min(TOTAL_BYTES, end);
      const view = sourcePayload.subarray(clampedStart, clampedEnd);
      sliceWindows.push({ start: clampedStart, end: clampedEnd, size: view.byteLength });
      return {
        size: view.byteLength,
        arrayBuffer: async () =>
          view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
      };
    },
  };

  const sentParts: Array<{ partIndex: number; bytes: Buffer }> = [];
  const fakeClient = {
    session: { dcId: 5 },
    getSender: async () => ({
      isConnected: () => true,
      send: async (req: { filePart: number; bytes: Buffer }) => {
        sentParts.push({ partIndex: req.filePart, bytes: Buffer.from(req.bytes) });
        return true;
      },
    }),
  };

  const inputFile = await uploads.uploadFile(fakeClient, {
    file: fakeDomFile,
    workers: 4,
  });

  assert.equal(rootArrayBufferCalled, false, 'Root arrayBuffer() must never be invoked');
  assert.equal(inputFile.name, 'DSC09412_RAW_Master.dng');
  assert.equal(inputFile.parts, Math.ceil(TOTAL_BYTES / CHUNK_LIMIT));
  assert.equal(sentParts.length, Math.ceil(TOTAL_BYTES / CHUNK_LIMIT));
  assert.ok(
    sliceWindows.every((w) => w.size > 0 && w.size <= CHUNK_LIMIT),
    'Every Blob.slice window must be <= 128 KB'
  );
  assert.ok(
    sentParts.every((p) => p.bytes.byteLength > 0 && p.bytes.byteLength <= CHUNK_LIMIT),
    'Every MTProto SaveFilePart payload must be <= 128 KB'
  );

  // Reassemble in filePart order and verify bit-for-bit equality
  sentParts.sort((a, b) => a.partIndex - b.partIndex);
  const reassembled = Buffer.concat(sentParts.map((p) => p.bytes));
  assert.equal(reassembled.byteLength, TOTAL_BYTES);
  assert.equal(reassembled.equals(sourcePayload), true, 'Streamed chunks must match original bytes bit-for-bit');
});

test('Curated Memories engine surfaces date-based previous-year anniversaries and excludes locked/trashed items', async () => {
  const { buildCuratedMemories } = await import('./utils/timeline');

  const refDate = new Date('2026-11-23T12:00:00.000Z');
  const memories = buildCuratedMemories(SEED_MEDIA_ITEMS, refDate);

  assert.ok(memories.length >= 4, 'Should generate multi-year anniversary & spotlight memories');

  // Top memories must be descending previous-year anniversaries around Nov 23
  assert.equal(memories[0].id, 'anniversary-2025');
  assert.equal(memories[0].title, '1 year ago today');
  assert.equal(memories[0].badge, 'On This Day');
  assert.equal(memories[0].yearsAgo, 1);

  assert.equal(memories[1].id, 'anniversary-2024');
  assert.equal(memories[1].title, '2 years ago today');
  assert.equal(memories[1].badge, 'On This Day');
  assert.equal(memories[1].yearsAgo, 2);

  assert.equal(memories[2].id, 'anniversary-2023');
  assert.equal(memories[2].title, '3 years ago this week');
  assert.equal(memories[2].yearsAgo, 3);

  // Ensure locked items never leak into Memories
  for (const mem of memories) {
    assert.equal(mem.coverItem.isLocked, false);
    assert.ok(mem.items.every((item) => !item.isLocked && !item.trashedAt));
  }
});

test('Floating Date Scrubber Rail extracts descending years and months with exact firstDateKey anchors', async () => {
  const { extractTimelineYearMonths } = await import('./utils/timeline');

  const visible = SEED_MEDIA_ITEMS.filter((i) => !i.isLocked && !i.isArchived);
  const groups = groupMediaByDay(visible, new Date('2026-11-23T18:00:00.000Z'));
  const yearNodes = extractTimelineYearMonths(groups);

  assert.deepEqual(
    yearNodes.map((y) => y.year),
    [2026, 2025, 2024, 2023]
  );

  // 2026 has Nov, Sep, Aug
  assert.deepEqual(
    yearNodes[0].months.map((m) => m.shortLabel),
    ['Nov', 'Sep', 'Aug']
  );
  assert.equal(yearNodes[0].months[0].monthKey, '2026-11');
  assert.equal(yearNodes[0].months[0].firstDateKey, '2026-11-23');

  // 2025 has Nov, Oct, Jul
  assert.deepEqual(
    yearNodes[1].months.map((m) => m.shortLabel),
    ['Nov', 'Oct', 'Jul']
  );
  assert.equal(yearNodes[1].months[1].fullLabel, 'October 2025');
  assert.equal(yearNodes[1].months[1].firstDateKey, '2025-10-12');

  // 2024 has Nov, Jun
  assert.deepEqual(
    yearNodes[2].months.map((m) => m.shortLabel),
    ['Nov', 'Jun']
  );
  assert.equal(yearNodes[2].months[1].firstDateKey, '2024-06-16');

  // 2023 has Nov
  assert.deepEqual(
    yearNodes[3].months.map((m) => m.shortLabel),
    ['Nov']
  );
});


