import {
  createExtensionEvmNetworks,
  EVM_NETWORK_DEFINITIONS,
} from '../shared/evmNetworks';

import previous from './__fixtures__/defaultEvmNetworks.json';
import {
  PALI_NETWORKS_STATE,
  ROLLUX_DEFAULT_NETWORK,
  SYSCOIN_MAINNET_NETWORK,
  SYSCOIN_NEVM_TESTNET_NETWORK_5700,
  ZKSYS_TANENBAUM_TESTNET_NETWORK_57057,
} from './constants';

describe('shared built-in EVM registrations', () => {
  it('preserves every pre-extraction extension field and the public alias identities', () => {
    expect(PALI_NETWORKS_STATE.ethereum).toEqual(previous);
    expect(ROLLUX_DEFAULT_NETWORK.network).toBe(
      PALI_NETWORKS_STATE.ethereum[570]
    );
    expect(SYSCOIN_MAINNET_NETWORK).toBe(PALI_NETWORKS_STATE.ethereum[57]);
    expect(SYSCOIN_NEVM_TESTNET_NETWORK_5700).toBe(
      PALI_NETWORKS_STATE.ethereum[5700]
    );
    expect(ZKSYS_TANENBAUM_TESTNET_NETWORK_57057).toBe(
      PALI_NETWORKS_STATE.ethereum[57057]
    );
  });
  it('keeps host registration objects mutable and independent from shared immutable data', () => {
    const first = createExtensionEvmNetworks();
    const second = createExtensionEvmNetworks();
    (first[1] as { url: string }).url = 'https://example.invalid/host-owned';
    expect(second[1].url).toBe(previous['1'].url);
    expect(
      EVM_NETWORK_DEFINITIONS.find((network) => network.id === 'ethereum')!
        .network.url
    ).toBe(previous['1'].url);
    expect(Object.isFrozen(EVM_NETWORK_DEFINITIONS)).toBe(true);
    expect(
      EVM_NETWORK_DEFINITIONS.every((network) =>
        Object.isFrozen(network.network)
      )
    ).toBe(true);
  });
});
