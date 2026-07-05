// Comprehensive mocks for crypto dependencies that block our asset tests

// Mock tiny-secp256k1 to avoid ecc library errors
jest.mock('tiny-secp256k1', () => ({
  pointFromScalar: jest.fn(),
  isPoint: jest.fn().mockReturnValue(true),
  isPrivate: jest.fn().mockReturnValue(true),
  pointAddScalar: jest.fn(),
  privateAdd: jest.fn(),
  sign: jest.fn(),
  verify: jest.fn().mockReturnValue(true),
}));

// Mock syscoinjs-lib to avoid crypto dependencies
jest.mock('syscoinjs-lib', () => ({
  networks: {
    syscoin: { messagePrefix: '\x18Syscoin Signed Message:\n' },
    bitcoin: { messagePrefix: '\x18Bitcoin Signed Message:\n' },
  },
  crypto: {
    hash256: jest.fn(),
    hash160: jest.fn(),
  },
  script: {
    compile: jest.fn(),
    decompile: jest.fn(),
  },
  address: {
    toBase58Check: jest.fn(),
    fromBase58Check: jest.fn(),
  },
  Transaction: jest.fn(),
  Psbt: jest.fn(),
}));

// Mock browser crypto API
Object.defineProperty(global, 'crypto', {
  value: {
    getRandomValues: jest.fn((arr: any) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    }),
    subtle: {
      generateKey: jest.fn(),
      exportKey: jest.fn(),
      importKey: jest.fn(),
      encrypt: jest.fn(),
      decrypt: jest.fn(),
    },
  },
});

// Mock Chrome extension APIs
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    },
  },
} as any;

export {};
