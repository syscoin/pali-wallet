import { coins } from '@sidhujag/sysweb3-network/cjs/coins.js';

import {
  projectUtxoChainCatalogue,
  utxoRegistrationDisplayName,
} from './utxoChainCatalogue';

it('preserves the explicit network identity separately from the derivation coin type', () => {
  const coin = coins.find(
    (entry) => entry.slip44 === 2 && entry.blockchainLink
  )!;
  const [explicit, fallback] = projectUtxoChainCatalogue([
    { ...coin, chainId: 0 },
    { ...coin, chainId: undefined },
  ]);
  expect(explicit).toMatchObject({ chainId: 0, networkId: 0, slip44: 2 });
  expect(fallback).toMatchObject({ chainId: 2, networkId: 2, slip44: 2 });
  expect(explicit.rpc).toEqual(fallback.rpc);
});

it('keeps the verified testnet name distinct from the ordinary coin name', () => {
  expect(utxoRegistrationDisplayName({ coinLabel: 'Syscoin Mainnet' })).toBe(
    'Syscoin'
  );
  expect(utxoRegistrationDisplayName({ coinLabel: 'Syscoin Testnet' })).toBe(
    'Syscoin Testnet'
  );
});
