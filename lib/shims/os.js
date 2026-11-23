// Browser-compatible `os` shim required by GramJS (telegram/client/os.js)
export function type() {
  return 'Browser';
}

export function release() {
  return typeof navigator !== 'undefined' && navigator.userAgent
    ? 'Web'
    : '1.0';
}

export function platform() {
  return 'browser';
}

export function arch() {
  return 'wasm';
}

export function hostname() {
  return 'framely-client';
}

export function tmpdir() {
  return '/tmp';
}

export const EOL = '\n';

const osShim = {
  type,
  release,
  platform,
  arch,
  hostname,
  tmpdir,
  EOL,
};

export default osShim;
