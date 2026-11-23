#!/usr/bin/env node
/**
 * GramJS Browser Compatibility Patcher for Framely
 *
 * 1. Patches telegram/tl/generationHelpers.js serializeBytes() so cross-realm
 *    Buffer, Uint8Array, ArrayBuffer, and ArrayBufferView instances serialize
 *    cleanly without throwing "Bytes or str expected".
 * 2. Patches telegram/client/uploads.js (CustomBuffer, getFileBuffer, uploadFile,
 *    _fileToMedia, and fileToBuffer) so standard browser File and Blob objects
 *    are sliced directly into 128 KB chunks on demand instead of buffering entire
 *    multi-megabyte / 2 GB files into browser memory.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TG_DIR = path.join(ROOT, 'node_modules', 'telegram');

function patchGenerationHelpers() {
  const target = path.join(TG_DIR, 'tl', 'generationHelpers.js');
  if (!fs.existsSync(target)) {
    console.log('[patch-gramjs] telegram/tl/generationHelpers.js not found, skipping.');
    return;
  }

  let content = fs.readFileSync(target, 'utf8');
  if (content.includes('/* FRAMELY_SERIALIZE_BYTES_PATCH */')) {
    console.log('[patch-gramjs] generationHelpers.js already patched.');
    return;
  }

  const anchor = 'function serializeBytes(data) {';
  if (!content.includes(anchor)) {
    console.log('[patch-gramjs] serializeBytes anchor not found, skipping.');
    return;
  }

  const replacement = `function serializeBytes(data) {
    /* FRAMELY_SERIALIZE_BYTES_PATCH */
    if (data && !Buffer.isBuffer(data)) {
        if (data._isBuffer || data instanceof Uint8Array) {
            data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        } else if (data instanceof ArrayBuffer) {
            data = Buffer.from(new Uint8Array(data));
        } else if (ArrayBuffer.isView(data)) {
            data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        } else if (typeof data === 'string') {
            data = Buffer.from(data, 'utf8');
        }
    }`;

  content = content.replace(anchor, replacement);
  fs.writeFileSync(target, content, 'utf8');
  console.log('[patch-gramjs] Patched generationHelpers.js for cross-realm Buffer/Uint8Array serialization.');
}

function patchUploads() {
  const target = path.join(TG_DIR, 'client', 'uploads.js');
  if (!fs.existsSync(target)) {
    console.log('[patch-gramjs] telegram/client/uploads.js not found, skipping.');
    return;
  }

  let content = fs.readFileSync(target, 'utf8');
  if (content.includes('/* FRAMELY_DOM_FILE_STREAM_PATCH_V2 */')) {
    console.log('[patch-gramjs] uploads.js V2 128KB DOM File/Blob streaming patch already applied.');
    return;
  }

  // Strip legacy V1 header if present so upgrade is clean and idempotent
  content = content.replace(
    /^\s*\/\* FRAMELY_DOM_FILE_STREAM_PATCH \*\/[\s\S]*?return Buffer\.from\(ab\);\s*\}\s*/m,
    ''
  );

  // 1. Inject 128KB DOM File/Blob detection & bounded chunk-slicing helpers after "use strict";
  const helperBlock = `
/* FRAMELY_DOM_FILE_STREAM_PATCH_V2 */
const FRAMELY_STREAM_CHUNK_BYTES = 128 * 1024; // 128 KB MTProto-aligned slice
function framelyIsDomFileOrBlob(value) {
    if (!value || typeof value !== "object") return false;
    if (typeof File !== "undefined" && value instanceof File) return true;
    if (typeof Blob !== "undefined" && value instanceof Blob) return true;
    return (
        typeof value.size === "number" &&
        typeof value.slice === "function" &&
        typeof value.arrayBuffer === "function" &&
        !Buffer.isBuffer(value)
    );
}
async function framelyReadBlobRange(blob, begin, end) {
    const safeBegin = Math.max(0, begin);
    const safeEnd = Math.min(blob.size, end);
    if (safeEnd <= safeBegin) return Buffer.alloc(0);
    const total = safeEnd - safeBegin;
    if (total <= FRAMELY_STREAM_CHUNK_BYTES) {
        const slice = blob.slice(safeBegin, safeEnd);
        const ab = await slice.arrayBuffer();
        return Buffer.from(ab);
    }
    const chunks = [];
    for (let cursor = safeBegin; cursor < safeEnd; cursor += FRAMELY_STREAM_CHUNK_BYTES) {
        const next = Math.min(safeEnd, cursor + FRAMELY_STREAM_CHUNK_BYTES);
        const slice = blob.slice(cursor, next);
        const ab = await slice.arrayBuffer();
        chunks.push(Buffer.from(ab));
    }
    return Buffer.concat(chunks);
}
`;

  if (content.includes('"use strict";')) {
    content = content.replace('"use strict";', '"use strict";\n' + helperBlock);
  } else {
    content = helperBlock + '\n' + content;
  }

  // 2. Patch CustomBuffer to accept `options.blob` and stream slices without buffering whole File/Blob
  const customBufferRegex = /class CustomBuffer \{[\s\S]*?\n\}/;
  if (!customBufferRegex.test(content)) {
    throw new Error('[patch-gramjs] Could not locate CustomBuffer class in uploads.js');
  }
  content = content.replace(
    customBufferRegex,
    `class CustomBuffer {
    constructor(options) {
        this.options = options;
        if (!options.buffer && !options.filePath && !options.blob) {
            throw new Error("Either one of \`buffer\`, \`filePath\`, or \`blob\` should be specified");
        }
    }
    async slice(begin, end) {
        const { buffer, filePath, blob } = this.options;
        if (blob) {
            return framelyReadBlobRange(blob, begin, end);
        }
        else if (buffer) {
            return buffer.slice(begin, end);
        }
        else if (filePath) {
            const buffSize = end - begin;
            const buff = Buffer.alloc(buffSize);
            const fHandle = await fs_1.promises.open(filePath, "r");
            await fHandle.read(buff, 0, buffSize, begin);
            await fHandle.close();
            return Buffer.from(buff);
        }
        return Buffer.alloc(0);
    }
}`
  );

  // 3. Patch getFileBuffer to keep browser File/Blob lazy-sliced instead of calling fileToBuffer(file)
  const getFileBufferRegex = /async function getFileBuffer\(file, fileSize, maxBufferSize\) \{[\s\S]*?\n\}/;
  if (!getFileBufferRegex.test(content)) {
    throw new Error('[patch-gramjs] Could not locate getFileBuffer() in uploads.js');
  }
  content = content.replace(
    getFileBufferRegex,
    `async function getFileBuffer(file, fileSize, maxBufferSize) {
    const options = {};
    if (framelyIsDomFileOrBlob(file)) {
        options.blob = file;
    }
    else if (fileSize > maxBufferSize && file instanceof CustomFile) {
        options.filePath = file.path;
    }
    else {
        options.buffer = Buffer.from(await fileToBuffer(file));
    }
    return new CustomBuffer(options);
}`
  );

  // 4. Patch uploadFile so Blob/File objects get safe fallback names and strict 128 KB partSize slicing
  const uploadFileDestructure = 'const { name, size } = file;';
  if (!content.includes(uploadFileDestructure)) {
    throw new Error('[patch-gramjs] Could not locate uploadFile file destructuring in uploads.js');
  }
  content = content.replace(
    uploadFileDestructure,
    'const name = file.name || "blob.bin";\n    const size = file.size;'
  );

  const partSizeLine =
    'const partSize = (0, Utils_1.getAppropriatedPartSize)((0, big_integer_1.default)(size)) * KB_TO_BYTES;';
  if (!content.includes(partSizeLine)) {
    throw new Error('[patch-gramjs] Could not locate partSize calculation in uploads.js');
  }
  content = content.replace(
    partSizeLine,
    `const computedPartSize = (0, Utils_1.getAppropriatedPartSize)((0, big_integer_1.default)(size)) * KB_TO_BYTES;
    const partSize = framelyIsDomFileOrBlob(file)
        ? Math.min(computedPartSize, FRAMELY_STREAM_CHUNK_BYTES)
        : computedPartSize;`
  );

  // 5. Patch _fileToMedia so browser File and Blob objects are not swallowed by getInputMedia()
  const inputMediaGuard = '!("read" in file)) {';
  if (content.includes(inputMediaGuard)) {
    content = content.replace(
      inputMediaGuard,
      '!("read" in file) &&\n        !framelyIsDomFileOrBlob(file)) {'
    );
  }

  content = content.replace(
    'else if ((typeof File !== "undefined" && file instanceof File) ||\n            file instanceof CustomFile) {',
    'else if (framelyIsDomFileOrBlob(file) ||\n            file instanceof CustomFile) {'
  );

  content = content.replace(
    'else if (typeof File !== "undefined" && thumb instanceof File) {',
    'else if (framelyIsDomFileOrBlob(thumb)) {'
  );

  // 6. Patch fileToBuffer fallback to recognize Blob in addition to File
  content = content.replace(
    'if (typeof File !== "undefined" && file instanceof File) {\n        return new Response(file).arrayBuffer();\n    }',
    'if (framelyIsDomFileOrBlob(file)) {\n        return file.arrayBuffer();\n    }'
  );

  // Guard cross-realm Buffer checks
  content = content.replace(
    /if\s*\(\s*file\s+instanceof\s+Buffer\s*\)/g,
    'if (Buffer.isBuffer(file) || (file && file._isBuffer))'
  );

  fs.writeFileSync(target, content, 'utf8');
  console.log('[patch-gramjs] Patched uploads.js V2: browser File/Blob objects now stream in 128 KB chunks via CustomBuffer.');
}

try {
  if (fs.existsSync(TG_DIR)) {
    patchGenerationHelpers();
    patchUploads();
  } else {
    console.log('[patch-gramjs] telegram package not installed yet, skipping.');
  }
} catch (err) {
  console.error('[patch-gramjs] Patch error:', err.message);
  process.exitCode = 1;
}
