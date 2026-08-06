import { INetwork, INetworkType, KeyringAccountType } from 'types/network';

import { isAccountCompatibleWithNetwork } from './accountCompatibility';

const evmNetwork = {
  chainId: 570,
  kind: INetworkType.Ethereum,
  slip44: 60,
} as INetwork;
const utxoNetwork = {
  chainId: 5700,
  kind: INetworkType.Syscoin,
  slip44: 1,
} as INetwork;
const syscoinMainnet = {
  chainId: 57,
  kind: INetworkType.Syscoin,
  slip44: 57,
} as INetwork;
const bitcoinMainnet = {
  chainId: 0,
  kind: INetworkType.Syscoin,
  slip44: 0,
} as INetwork;

describe('isAccountCompatibleWithNetwork', () => {
  const evmAccount = {
    address: '0x940000000000000000000000000000000000052e',
  } as any;
  const utxoAccount = {
    address: 'tsys1qexampleaddress',
    slip44: 1,
  } as any;

  it('keeps UTXO accounts out of EVM account selection', () => {
    expect(
      isAccountCompatibleWithNetwork(
        evmAccount,
        KeyringAccountType.HDAccount,
        evmNetwork
      )
    ).toBe(true);
    expect(
      isAccountCompatibleWithNetwork(
        utxoAccount,
        KeyringAccountType.HDAccount,
        evmNetwork
      )
    ).toBe(false);
  });

  it('keeps EVM accounts out of UTXO account selection', () => {
    expect(
      isAccountCompatibleWithNetwork(
        utxoAccount,
        KeyringAccountType.HDAccount,
        utxoNetwork
      )
    ).toBe(true);
    expect(
      isAccountCompatibleWithNetwork(
        evmAccount,
        KeyringAccountType.HDAccount,
        utxoNetwork
      )
    ).toBe(false);
  });

  it('only exposes smart accounts on their EVM chain', () => {
    const smartAccount = {
      ...evmAccount,
      smartAccount: { chainId: evmNetwork.chainId },
    } as any;

    expect(
      isAccountCompatibleWithNetwork(
        smartAccount,
        KeyringAccountType.SmartAccount,
        evmNetwork
      )
    ).toBe(true);
    expect(
      isAccountCompatibleWithNetwork(
        smartAccount,
        KeyringAccountType.SmartAccount,
        { ...evmNetwork, chainId: 1 }
      )
    ).toBe(false);
    expect(
      isAccountCompatibleWithNetwork(
        smartAccount,
        KeyringAccountType.SmartAccount,
        utxoNetwork
      )
    ).toBe(false);
  });

  it('keeps accounts isolated between exact UTXO networks', () => {
    const syscoinAccount = {
      address: 'sys1qexampleaddress',
      slip44: 57,
    } as any;
    const bitcoinAccount = {
      address: 'bc1qexampleaddress',
      slip44: 0,
    } as any;

    expect(
      isAccountCompatibleWithNetwork(
        syscoinAccount,
        KeyringAccountType.HDAccount,
        syscoinMainnet
      )
    ).toBe(true);
    expect(
      isAccountCompatibleWithNetwork(
        bitcoinAccount,
        KeyringAccountType.HDAccount,
        syscoinMainnet
      )
    ).toBe(false);
    expect(
      isAccountCompatibleWithNetwork(
        bitcoinAccount,
        KeyringAccountType.HDAccount,
        bitcoinMainnet
      )
    ).toBe(true);
    expect(
      isAccountCompatibleWithNetwork(
        syscoinAccount,
        KeyringAccountType.HDAccount,
        bitcoinMainnet
      )
    ).toBe(false);
  });
});
