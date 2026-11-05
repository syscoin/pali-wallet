Object.assign(global, require('jest-chrome'));

// Node crypto dependencies and Buffer must share their Uint8Array realm in jsdom.
global.Uint8Array = Object.getPrototypeOf(
  require('buffer').Buffer.prototype
).constructor;

if (typeof self === 'undefined') {
  global.self = global; // Polyfill self for Jest environment
}

// Polyfill TextEncoder and TextDecoder for Node.js test environment
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}
