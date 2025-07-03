module.exports = {
  displayName: 'Asset Management Tests',
  rootDir: '../../',
  testEnvironment: 'jsdom',
  testMatch: [
    '<rootDir>/tests/assets/**/*.test.ts',
    '<rootDir>/tests/assets/**/*.test.tsx',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    // Mock CSS imports
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',

    // Mock image imports
    '\\.(jpg|jpeg|png|gif|svg)$': '<rootDir>/tests/__mocks__/fileMock.js',

    // Path aliases
    '^@/(.*)$': '<rootDir>/source/$1',
    '^components/(.*)$': '<rootDir>/source/components/$1',
    '^hooks/(.*)$': '<rootDir>/source/hooks/$1',
    '^state/(.*)$': '<rootDir>/source/state/$1',
    '^types/(.*)$': '<rootDir>/source/types/$1',
    '^utils/(.*)$': '<rootDir>/source/utils/$1',
    '^scripts/(.*)$': '<rootDir>/source/scripts/$1',
    '^assets/(.*)$': '<rootDir>/source/assets/$1',
    '^constants/(.*)$': '<rootDir>/source/constants/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/assets/setupTests.ts'],
  collectCoverageFrom: [
    'source/scripts/Background/controllers/assets/**/*.{ts,tsx}',
    'source/scripts/Background/controllers/nfts/**/*.{ts,tsx}',
    'source/pages/Home/Panel/components/Assets/**/*.{ts,tsx}',
    'source/pages/Home/Panel/components/Nfts/**/*.{ts,tsx}',
    'source/state/vault/actions.ts',
    'source/state/vault/reducers.ts',
    'source/state/vault/selectors.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testTimeout: 30000,
  maxWorkers: '50%',
};
