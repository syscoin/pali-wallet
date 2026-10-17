import { INetwork, INetworkType } from 'types/network';

import {
  getInitialNetworkSelection,
  isSameNetworkSelection,
} from './networkSelection';

const activeNetwork: INetwork = {
  chainId: 57,
  currency: 'sys',
  default: true,
  explorer: 'https://explorer.example',
  kind: INetworkType.Syscoin,
  label: 'Syscoin',
  slip44: 57,
  url: 'https://rpc.example',
};

describe('getInitialNetworkSelection', () => {
  it('requires an explicit target selection for forced type switches', () => {
    expect(getInitialNetworkSelection(activeNetwork, true)).toBeNull();
  });

  it('preselects the active network for regular network navigation', () => {
    expect(getInitialNetworkSelection(activeNetwork, false)).toEqual({
      current: activeNetwork,
    });
  });

  it('does not create a selection before the active network is available', () => {
    expect(getInitialNetworkSelection(undefined, false)).toBeNull();
  });
});

describe('network selection identity', () => {
  it('recognizes the same endpoint even when its display label changes', () => {
    expect(
      isSameNetworkSelection(activeNetwork, {
        ...activeNetwork,
        label: 'Renamed display label',
      })
    ).toBe(true);
  });

  it('does not select another chain or endpoint sharing the display label', () => {
    expect(
      isSameNetworkSelection(activeNetwork, { ...activeNetwork, chainId: 5700 })
    ).toBe(false);
    expect(
      isSameNetworkSelection(activeNetwork, {
        ...activeNetwork,
        url: 'https://different-rpc.example',
      })
    ).toBe(false);
  });

  it('does not conflate UTXO and EVM networks or a missing selection', () => {
    expect(
      isSameNetworkSelection(activeNetwork, {
        ...activeNetwork,
        kind: INetworkType.Ethereum,
      })
    ).toBe(false);
    expect(isSameNetworkSelection(undefined, activeNetwork)).toBe(false);
  });
});
