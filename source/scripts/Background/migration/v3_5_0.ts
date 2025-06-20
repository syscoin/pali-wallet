import { INetworkType } from '@pollum-io/sysweb3-network';

import { saveState, setMigratedVersions } from 'state/paliStorage';
import { PALI_NETWORKS_STATE } from 'utils/constants';

type V3_5_0 = {
  dapp: any;
  price: any;
  vault: any;
};

const MigrateRunner = async (oldState: any) => {
  try {
    console.log(
      'Starting migration to v3.5.0 - replacing networks with correct configurations'
    );

    // Instead of patching individual properties, completely replace networks
    // with the correct configurations from PALI_NETWORKS_STATE
    // This ensures ALL properties are correct: kind, slip44, apiUrl, explorer, etc.

    // Preserve any custom networks that users may have added
    const preservedCustomNetworks = {
      syscoin: {},
      ethereum: {},
    };

    // Check for custom networks in syscoin
    if (oldState.vault.networks?.syscoin) {
      for (const [chainId, network] of Object.entries(
        oldState.vault.networks.syscoin
      )) {
        // If it's not in our default networks, preserve it (it's custom)
        if (!PALI_NETWORKS_STATE.syscoin[chainId]) {
          preservedCustomNetworks.syscoin[chainId] = {
            ...(network as any),
            kind: INetworkType.Syscoin, // Ensure custom syscoin networks have correct kind
            slip44: (network as any).slip44 || 57, // Default to Syscoin slip44 for UTXO
          };
          console.log(`Preserved custom Syscoin network: chainId ${chainId}`);
        }
      }
    }

    // Check for custom networks in ethereum
    if (oldState.vault.networks?.ethereum) {
      for (const [chainId, network] of Object.entries(
        oldState.vault.networks.ethereum
      )) {
        // If it's not in our default networks, preserve it (it's custom)
        if (!PALI_NETWORKS_STATE.ethereum[chainId]) {
          preservedCustomNetworks.ethereum[chainId] = {
            ...(network as any),
            kind: INetworkType.Ethereum, // Ensure custom ethereum networks have correct kind
            slip44: 60, // All EVM networks use Ethereum's slip44
          };
          console.log(`Preserved custom Ethereum network: chainId ${chainId}`);
        }
      }
    }

    // Use the correct networks from PALI_NETWORKS_STATE and add any custom ones
    const correctNetworks = {
      syscoin: {
        ...PALI_NETWORKS_STATE.syscoin,
        ...preservedCustomNetworks.syscoin,
      },
      ethereum: {
        ...PALI_NETWORKS_STATE.ethereum,
        ...preservedCustomNetworks.ethereum,
      },
    };

    // Fix activeNetwork - find the correct one from our networks or recreate it
    let fixedActiveNetwork = oldState.vault.activeNetwork;
    if (fixedActiveNetwork) {
      // Try to find the network in our correct networks
      const foundInSyscoin = Object.values(correctNetworks.syscoin).find(
        (network: any) => network.chainId === fixedActiveNetwork.chainId
      );
      const foundInEthereum = Object.values(correctNetworks.ethereum).find(
        (network: any) => network.chainId === fixedActiveNetwork.chainId
      );

      if (foundInSyscoin) {
        fixedActiveNetwork = foundInSyscoin;
        console.log(
          `Updated activeNetwork to correct Syscoin config for chainId ${fixedActiveNetwork.chainId}`
        );
      } else if (foundInEthereum) {
        fixedActiveNetwork = foundInEthereum;
        console.log(
          `Updated activeNetwork to correct Ethereum config for chainId ${fixedActiveNetwork.chainId}`
        );
      } else {
        // If not found, add kind property based on existing network
        fixedActiveNetwork = {
          ...fixedActiveNetwork,
          kind: fixedActiveNetwork.kind || INetworkType.Ethereum, // Default to evm if unknown
        };
        console.log(
          `Preserved custom activeNetwork with kind for chainId ${fixedActiveNetwork.chainId}`
        );
      }
    }

    const newState: V3_5_0 = {
      ...oldState,
      vault: {
        ...oldState.vault,
        networks: correctNetworks,
        activeNetwork: fixedActiveNetwork,
      },
    };

    await Promise.all([saveState(newState), setMigratedVersions('3.5.0')]);

    console.log(
      'Migrate to <v3.5.0> successfully! Replaced networks with correct configurations (kind, slip44, API URLs) while preserving custom networks.'
    );
  } catch (error) {
    console.log('<v3.5.0> Migration Error');
    console.log(error);
  }
};

export default MigrateRunner;
