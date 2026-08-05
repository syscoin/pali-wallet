import { INetwork, INetworkType } from 'types/network';

import { getInitialNetworkSelection } from './networkSelection';

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
