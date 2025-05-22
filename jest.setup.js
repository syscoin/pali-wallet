Object.assign(global, require('jest-chrome'));

if (typeof self === 'undefined') {
  global.self = global; // Polyfill self for Jest environment
}
