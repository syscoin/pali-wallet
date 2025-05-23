import { saveState, setMigratedVersions } from 'state/paliStorage';
import { PALI_NETWORKS_STATE } from 'utils/constants';

type V3_4_4 = {
  dapp: any;
  price: any;
  vault: any;
};

const MigrateRunner = async (oldState: any) => {
  try {
    console.log(
      'Starting migration to v3.4.4 - fixing networks without kind property'
    );

    // Fix networks to ensure they all have kind properties
    const fixedNetworks = {
      syscoin: {},
      ethereum: {},
    };

    // Fix syscoin networks - ensure they have kind: 'utxo'
    if (oldState.vault.networks?.syscoin) {
      for (const [chainId, network] of Object.entries(
        oldState.vault.networks.syscoin
      )) {
        const networkObj = network as any;
        fixedNetworks.syscoin[chainId] = {
          ...networkObj,
          kind: 'utxo',
        };
      }
    }

    // Fix ethereum networks - ensure they have kind: 'evm'
    if (oldState.vault.networks?.ethereum) {
      for (const [chainId, network] of Object.entries(
        oldState.vault.networks.ethereum
      )) {
        const networkObj = network as any;
        fixedNetworks.ethereum[chainId] = {
          ...networkObj,
          kind: 'evm',
        };
      }
    }

    // Merge with PALI_NETWORKS_STATE to ensure we have all default networks with proper kind
    const mergedNetworks = {
      syscoin: {
        ...PALI_NETWORKS_STATE.syscoin,
        ...fixedNetworks.syscoin,
      },
      ethereum: {
        ...PALI_NETWORKS_STATE.ethereum,
        ...fixedNetworks.ethereum,
      },
    };

    // Fix activeNetwork to ensure it has kind property
    let fixedActiveNetwork = oldState.vault.activeNetwork;
    if (fixedActiveNetwork && !fixedActiveNetwork.kind) {
      // Determine kind based on which networks collection contains this network
      const isInSyscoin = Object.values(mergedNetworks.syscoin).some(
        (network: any) =>
          network.chainId === fixedActiveNetwork.chainId &&
          network.url === fixedActiveNetwork.url
      );

      fixedActiveNetwork = {
        ...fixedActiveNetwork,
        kind: isInSyscoin ? 'utxo' : 'evm',
      };
    }

    const newState: V3_4_4 = {
      ...oldState,
      vault: {
        ...oldState.vault,
        networks: mergedNetworks,
        activeNetwork: fixedActiveNetwork,
      },
    };

    await Promise.all([saveState(newState), setMigratedVersions('3.4.4')]);

    console.log(
      'Migrate to <v3.4.4> successfully! Fixed networks with kind properties.'
    );
  } catch (error) {
    console.log('<v3.4.4> Migration Error');
    console.log(error);
  }
};

export default MigrateRunner;
