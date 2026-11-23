// Browser-compatible `util` shim required by GramJS (telegram/inspect.js)
export function inspect(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function format(...args) {
  return args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg))).join(' ');
}

export function deprecate(fn) {
  return fn;
}

export function inherits(ctor, superCtor) {
  if (!ctor || !superCtor) return;
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true,
    },
  });
}

export const types = {
  isUint8Array: (val) => val instanceof Uint8Array,
  isArrayBuffer: (val) => val instanceof ArrayBuffer,
  isDate: (val) => val instanceof Date,
  isRegExp: (val) => val instanceof RegExp,
};

const utilShim = {
  inspect,
  format,
  deprecate,
  inherits,
  types,
};

export default utilShim;
