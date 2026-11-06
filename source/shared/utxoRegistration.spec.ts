import { getDefaultUTXONetworks } from '../utils/defaultNetworks';

import { createUtxoRegistrationPin } from './utxoRegistration';

it('keeps each preset tuple and its declared backend token', () => {
  for (const network of Object.values(getDefaultUTXONetworks())) {
    expect(
      createUtxoRegistrationPin({
        ...network,
        backendChain: network.utxoBackendChain,
      })
    ).toEqual({
      registration: { chainId: network.chainId, slip44: network.slip44 },
      backendChain: network.utxoBackendChain,
    });
  }
});

it('detaches a nondefault pin without deriving the token or collapsing the tuple', () => {
  const input = { chainId: 10001, slip44: 1, backendChain: 'Provider-Test_7' };
  const pin = createUtxoRegistrationPin(input);
  input.chainId = 5700;
  input.backendChain = 'test';
  expect(pin).toEqual({
    registration: { chainId: 10001, slip44: 1 },
    backendChain: 'Provider-Test_7',
  });
  expect(Object.isFrozen(pin)).toBe(true);
  expect(Object.isFrozen(pin.registration)).toBe(true);
});

it('requires an explicit backend token and safe numeric identity', () => {
  const valid = { chainId: 2, slip44: 2, backendChain: 'main' };
  for (const malformed of [
    { backendChain: undefined },
    { backendChain: 'main\n' },
    { backendChain: ' ' },
    { backendChain: 'a'.repeat(33) },
    { chainId: '2' },
    { chainId: -1 },
    { slip44: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    expect(() => createUtxoRegistrationPin({ ...valid, ...malformed })).toThrow(
      'Invalid UTXO registration verification'
    );
  }
});
