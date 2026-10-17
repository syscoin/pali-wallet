import { INetworkType } from 'types/network';

import {
  getSentryNetwork,
  normalizeSentryServiceUrl,
  validateSentryFeeLimit,
} from './network';

it('accepts only known Syscoin UTXO networks, never an EVM chain-id collision', () => {
  expect(getSentryNetwork({ kind: INetworkType.Syscoin, chainId: 57 })).toBe(
    'mainnet'
  );
  expect(getSentryNetwork({ kind: INetworkType.Syscoin, chainId: 5700 })).toBe(
    'testnet'
  );
  expect(() =>
    getSentryNetwork({ kind: INetworkType.Ethereum, chainId: 5700 })
  ).toThrow();
  expect(() =>
    getSentryNetwork({ kind: INetworkType.Syscoin, chainId: 1 })
  ).toThrow();
});

it.each([
  'https://sysnode.info/path',
  'https://user:secret@sysnode.info',
  'http://sysnode.info',
  'https://sysnode.info/?rpc=evil',
  'https://sysnode.info/#rpc',
])('rejects an unsafe or ambiguous service endpoint %s', (url) => {
  expect(() => normalizeSentryServiceUrl(url)).toThrow();
});

it('permits HTTPS origins and explicit loopback development only', () => {
  expect(normalizeSentryServiceUrl('https://sysnode.info/')).toBe(
    'https://sysnode.info'
  );
  expect(normalizeSentryServiceUrl('http://127.0.0.1:8800')).toBe(
    'http://127.0.0.1:8800'
  );
  expect(() => normalizeSentryServiceUrl('http://[::1]:8800')).toThrow();
});

it.each(['0', '-1', '1e5', '1.2', '10000001', ' 1', 'Infinity'])(
  'rejects invalid fee bounds %s',
  (value) => {
    expect(() => validateSentryFeeLimit(value)).toThrow();
  }
);
