// Older TV WebViews (Chrome 8x–9x) lack these; the build target lowers syntax, not missing built-ins.
for (const C of [Array, String, Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) {
  if (!C.prototype.at) Object.defineProperty(C.prototype, 'at', { configurable: true, writable: true, value(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return n < 0 || n >= this.length ? undefined : this[n]; } });
}
if (!globalThis.structuredClone) globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
