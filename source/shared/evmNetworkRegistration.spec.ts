import {
  EVM_NETWORK_DEFINITIONS,
  OPTIONAL_EVM_NETWORK_DEFINITIONS,
  findRegisteredEvmNetwork,
} from './evmNetworks';

it.each([...EVM_NETWORK_DEFINITIONS, ...OPTIONAL_EVM_NETWORK_DEFINITIONS])(
  'matches the exact canonical or explicitly added $id registration',
  (entry) => {
    const registered = {
      id: entry.id,
      chainId: String(entry.network.chainId),
      rpcUrl: entry.network.url,
    };
    expect(findRegisteredEvmNetwork(registered)).toBe(entry);
    expect(
      findRegisteredEvmNetwork({
        ...registered,
        id: `custom:${entry.network.chainId}`,
      })
    ).toBe(entry);
    expect(
      findRegisteredEvmNetwork({
        ...registered,
        rpcUrl: 'https://different.invalid',
      })
    ).toBeUndefined();
    expect(
      findRegisteredEvmNetwork({
        ...registered,
        chainId: String(entry.network.chainId + 1),
      })
    ).toBeUndefined();
    expect(
      findRegisteredEvmNetwork({ ...registered, id: 'custom:unrelated' })
    ).toBeUndefined();
  }
);
