// Setup for asset management tests
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill for crypto
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

// Mock crypto for Node.js environment
if (typeof global.crypto === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto');
  global.crypto = {
    getRandomValues: (arr: Uint8Array) => {
      const bytes = crypto.randomBytes(arr.length);
      arr.set(bytes);
      return arr;
    },
    subtle: {} as any,
  } as any;
}

// Mock window object
if (typeof window === 'undefined') {
  global.window = {
    crypto: global.crypto,
    open: jest.fn(),
  } as any;
}

// Mock chrome API
if (typeof chrome === 'undefined') {
  global.chrome = {
    runtime: {
      sendMessage: jest.fn(),
      onMessage: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      onConnect: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      onDisconnect: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      connect: jest.fn(() => ({
        postMessage: jest.fn(),
        onMessage: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
        onDisconnect: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
      })),
      id: 'test-extension-id',
    },
    storage: {
      local: {
        get: jest.fn(),
        set: jest.fn(),
      },
    },
  } as any;
}

// Mock fetch if not available
if (typeof fetch === 'undefined') {
  global.fetch = jest.fn();
}

// Mock browser API (same as chrome for testing)
if (typeof (global as any).browser === 'undefined') {
  (global as any).browser = global.chrome;
}

// Setup localStorage mock
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock as any;

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
