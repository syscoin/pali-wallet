Object.assign(global, require('jest-chrome'));

if (typeof self === 'undefined') {
  global.self = global; // Polyfill self for Jest environment
}

// Polyfill TextEncoder and TextDecoder for Node.js test environment
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}
