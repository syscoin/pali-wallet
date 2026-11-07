import { INetworkType } from 'types/network';

import { withPinnedUtxoBackendChain } from './networkRegistration';

const active = Object.freeze({
  kind: INetworkType.Syscoin,
  chainId: 57,
  slip44: 57,
  currency: 'sys',
  url: 'https://selected.invalid/wallet',
  label: 'Syscoin',
  explorer: 'https://selected.invalid',
});
const registered = { ...active, utxoBackendChain: 'independently-verified' };

it('projects only the exact registered backend pin into a cold active copy', () => {
  expect(withPinnedUtxoBackendChain(active, registered)).toEqual(registered);
  expect(active).not.toHaveProperty('utxoBackendChain');
  expect(withPinnedUtxoBackendChain(registered, registered)).toBe(registered);
});

it('does not infer a pin or borrow one from a different active registration', () => {
  for (const other of [
    undefined,
    active,
    { ...registered, url: 'https://different.invalid/wallet' },
    { ...registered, slip44: 1 },
    { ...registered, chainId: 5700 },
    { ...registered, currency: 'btc' },
    { ...registered, kind: INetworkType.Ethereum },
  ])
    expect(withPinnedUtxoBackendChain(active, other)).toBe(active);
  const conflicting = { ...active, utxoBackendChain: 'different-pin' };
  expect(withPinnedUtxoBackendChain(conflicting, registered)).toBe(conflicting);
});
