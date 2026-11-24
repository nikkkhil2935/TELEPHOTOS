'use client';

import { Buffer } from 'buffer';

/**
 * Registers browser-only Buffer, cross-realm Buffer[Symbol.hasInstance], and RFC 4648
 * base64url support before GramJS loads.
 *
 * CRITICAL: Never executes on the Node.js server (SSR) and never calls Buffer.isBuffer()
 * inside Symbol.hasInstance (which would cause infinite recursion in Node.js / browser).
 */
let polyfillsInitialized = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBufferHasInstance(BufClass: any) {
  if (!BufClass || BufClass.__framelyHasInstancePatched) return;
  try {
    Object.defineProperty(BufClass, Symbol.hasInstance, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: function (instance: any) {
        if (!instance || typeof instance !== 'object') return false;
        if (instance._isBuffer === true) return true;
        if (
          typeof Uint8Array !== 'undefined' &&
          instance instanceof Uint8Array &&
          instance.constructor?.name === 'Buffer'
        ) {
          return true;
        }
        return false;
      },
      configurable: true,
    });
    BufClass.__framelyHasInstancePatched = true;
  } catch {
    // Ignore non-configurable environments
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBase64UrlPatch(BufClass: any) {
  if (!BufClass || !BufClass.prototype || BufClass.prototype.__framelyBase64UrlPatched) return;
  const origToString = BufClass.prototype.toString;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BufClass.prototype.toString = function (this: any, encoding?: string, start?: number, end?: number) {
    if (encoding === 'base64url') {
      const b64 = origToString.call(this, 'base64', start, end);
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    // eslint-disable-next-line prefer-rest-params
    return origToString.apply(this, arguments as unknown as [BufferEncoding?, number?, number?]);
  };
  BufClass.prototype.__framelyBase64UrlPatched = true;
}

export function initBrowserPolyfills(): void {
  // Never mutate Node.js native Buffer during Next.js SSR
  if (typeof window === 'undefined') return;
  if (polyfillsInitialized) return;
  polyfillsInitialized = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  win.Buffer = Buffer;
  win.global = window;
  if (!win.process) {
    win.process = {
      env: {},
      browser: true,
      version: '',
      nextTick: (fn: () => void) => Promise.resolve().then(fn),
    };
  }

  if (typeof globalThis !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    g.Buffer = Buffer;
    g.global = globalThis;
    if (!g.process) {
      g.process = win.process;
    }
  }

  applyBufferHasInstance(Buffer);
  applyBase64UrlPatch(Buffer);
}

initBrowserPolyfills();

export { Buffer };
