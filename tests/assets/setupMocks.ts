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

// Mock ethers crypto functions
jest.mock('ethers', () => {
  const originalModule = jest.requireActual('ethers');
  return {
    ...originalModule,
    ethers: {
      ...originalModule.ethers,
      utils: {
        ...originalModule.ethers?.utils,
        keccak256: jest.fn(),
        solidityKeccak256: jest.fn(),
        arrayify: jest.fn(),
        hexlify: jest.fn(),
        isAddress: jest.fn(
          (address: string) =>
            typeof address === 'string' &&
            address.startsWith('0x') &&
            address.length === 42
        ),
        getAddress: jest.fn((address: string) => address),
        parseEther: jest.fn((value: string) => ({
          _hex: '0x' + (parseFloat(value) * 1e18).toString(16),
          toString: () => (parseFloat(value) * 1e18).toString(),
        })),
        parseUnits: jest.fn((value: string, decimals: number) => ({
          _hex:
            '0x' + (parseFloat(value) * Math.pow(10, decimals)).toString(16),
          toString: () =>
            (parseFloat(value) * Math.pow(10, decimals)).toString(),
        })),
        formatUnits: jest.fn((value: any, decimals: number) => {
          const val =
            typeof value === 'object' && value._hex
              ? BigInt(value._hex)
              : BigInt(value);
          return (Number(val) / Math.pow(10, decimals)).toString();
        }),
        Interface: jest.fn().mockImplementation(() => ({
          encodeFunctionData: jest.fn(() => '0xa9059cbb...'),
          decodeFunctionResult: jest.fn(() => ['result']),
        })),
      },
      BigNumber: {
        from: jest.fn((value: any) => ({
          _hex:
            typeof value === 'string' && value.startsWith('0x')
              ? value
              : '0x' + value,
          toString: () => {
            if (typeof value === 'string' && value.startsWith('0x')) {
              return BigInt(value).toString();
            }
            return value.toString();
          },
          gt: jest.fn(() => true),
          lt: jest.fn(() => false),
          eq: jest.fn(() => false),
          toNumber: jest.fn(() => parseInt(value)),
        })),
      },
      Contract: jest.fn(),
      providers: {
        JsonRpcProvider: jest.fn(),
        Web3Provider: jest.fn(),
      },
    },
  };
});

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
