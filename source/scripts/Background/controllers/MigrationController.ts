/* eslint-disable camelcase */
import paliData from '../../../../package.json';
import { getIsMigratedVersion } from 'state/paliStorage';
import { INetwork, INetworkType } from 'types/network';
import { CHAIN_IDS, PALI_NETWORKS_STATE } from 'utils/constants';
import { chromeStorage } from 'utils/storageAPI';

const isLegacyBuiltInPolygonNetwork = (network?: INetwork) =>
  network?.chainId === 137 &&
  network.default === true &&
  network.label === 'Polygon Mainnet' &&
  network.currency === 'matic' &&
  network.url === 'https://polygon-rpc.com' &&
  network.explorer === 'https://polygonscan.com' &&
  network.apiUrl === 'https://polygon.blockscout.com/api' &&
  network.coingeckoId === 'matic-network' &&
  network.coingeckoPlatformId === 'polygon-pos';

const isLegacyBuiltInEthereumNetwork = (network?: INetwork) =>
  network?.chainId === CHAIN_IDS.ETHEREUM_MAINNET &&
  network.default === true &&
  network.label === 'Ethereum Mainnet' &&
  network.currency === 'eth' &&
  network.url === 'https://eth.llamarpc.com' &&
  network.explorer === 'https://etherscan.io/' &&
  network.apiUrl === 'https://eth.blockscout.com/api' &&
  network.coingeckoId === 'ethereum' &&
  network.coingeckoPlatformId === 'ethereum';

const migrateDefaultEvmNetworks = (networks: any) => {
  if (!networks?.ethereum) return false;

  let changed = false;

  if (isLegacyBuiltInPolygonNetwork(networks.ethereum[137])) {
    delete networks.ethereum[137];
    changed = true;
  }

  if (
    isLegacyBuiltInEthereumNetwork(
      networks.ethereum[CHAIN_IDS.ETHEREUM_MAINNET]
    )
  ) {
    networks.ethereum[CHAIN_IDS.ETHEREUM_MAINNET] =
      PALI_NETWORKS_STATE.ethereum[CHAIN_IDS.ETHEREUM_MAINNET];
    changed = true;
  }

  [CHAIN_IDS.BASE_MAINNET, CHAIN_IDS.ARBITRUM_ONE].forEach((chainId) => {
    if (!networks.ethereum[chainId]) {
      networks.ethereum[chainId] = PALI_NETWORKS_STATE.ethereum[chainId];
      changed = true;
    }
  });

  return changed;
};

const clearVaultAccountBalances = (vaultState: any) => {
  Object.values(vaultState?.accounts || {}).forEach((accountsById: any) => {
    Object.values(accountsById || {}).forEach((account: any) => {
      if (account?.balances) {
        account.balances = {
          [INetworkType.Syscoin]: -1,
          [INetworkType.Ethereum]: -1,
        };
      }
    });
  });
};

const migratePolygonActiveNetworkToBase = (vaultState: any) => {
  if (!isLegacyBuiltInPolygonNetwork(vaultState?.activeNetwork)) return false;

  const activeNetwork = PALI_NETWORKS_STATE.ethereum[CHAIN_IDS.BASE_MAINNET];
  vaultState.activeChain = activeNetwork.kind;
  vaultState.activeNetwork = activeNetwork;
  vaultState.isBitcoinBased = false;
  clearVaultAccountBalances(vaultState);
  return true;
};

const getMainStateForStorage = (state: any) => {
  if (!state?.vault) return state;

  const { vault: _vault, ...mainState } = state;
  void _vault; // Keep legacy vault data out of the main state storage key.
  return mainState;
};

// Define migration entries in order
const migrations: Array<{
  description: string;
  handler: (state: any) => Promise<void>;
  version: string;
}> = [
  // Clean up vault data from main state storage
  {
    version: '4.0.0',
    description: 'Clean up vault data from main state',
    handler: async (state: any) => {
      console.log('[Migration 4.0.0] Running migration checks...');

      // Detect legacy vault-keys format so upgrade flows can handle it.
      // The actual migration happens during unlock inside sysweb3-keyring.
      try {
        const vaultKeys = await chromeStorage.getItem('sysweb3-vault-keys');
        if (vaultKeys && vaultKeys.currentSessionSalt) {
          console.log(
            '[Migration 4.0.0] Detected legacy vault-keys with currentSessionSalt; will migrate on unlock'
          );
        }
      } catch (error) {
        console.error('[Migration 4.0.0] Error checking vault-keys:', error);
      }

      // Clean up vault data from main state storage
      if (state && state.vault) {
        console.log(
          '[Migration 4.0.0] Found vault data in main state, cleaning up...'
        );

        // Save cleaned state
        await chromeStorage.setItem('state', getMainStateForStorage(state));

        console.log('[Migration 4.0.0] Vault data removed from main state');
      } else {
        console.log('[Migration 4.0.0] No vault data found in main state');
      }
    },
  },
  {
    version: '4.0.12',
    description: 'Replace built-in Polygon default with Base and Arbitrum',
    handler: async (state: any) => {
      console.log('[Migration 4.0.12] Updating built-in EVM defaults...');

      let stateChanged = false;

      if (migrateDefaultEvmNetworks(state?.vaultGlobal?.networks)) {
        stateChanged = true;
      }

      if (isLegacyBuiltInPolygonNetwork(state?.vaultGlobal?.networkTarget)) {
        state.vaultGlobal.networkTarget =
          PALI_NETWORKS_STATE.ethereum[CHAIN_IDS.BASE_MAINNET];
        stateChanged = true;
      }

      if (migratePolygonActiveNetworkToBase(state?.vault)) {
        stateChanged = true;
      }

      if (stateChanged) {
        await chromeStorage.setItem('state', getMainStateForStorage(state));
      }

      const evmVaultState = await chromeStorage.getItem('state-vault-60');
      if (migratePolygonActiveNetworkToBase(evmVaultState)) {
        await chromeStorage.setItem('state-vault-60', evmVaultState);
      }

      console.log('[Migration 4.0.12] Built-in EVM defaults updated');
    },
  },
];

// Compare versions: returns 1 if a > b, -1 if a < b, 0 if equal
const compareVersions = (a: string, b: string): number => {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;

    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }

  return 0;
};

const MigrationController = async (state: any) => {
  const currentPaliVersion = paliData.version;

  if (!state) {
    console.warn('[MigrationController] No state found in chrome storage');
    return;
  }

  console.log(
    `[MigrationController] Current Pali version: ${currentPaliVersion}`
  );

  // Run all migrations that haven't been applied yet
  for (const migration of migrations) {
    const isMigrated = await getIsMigratedVersion(migration.version);

    if (!isMigrated) {
      // Run migration if:
      // 1. Current version is greater than or equal to migration version
      // 2. Migration hasn't been applied yet
      if (compareVersions(currentPaliVersion, migration.version) >= 0) {
        console.log(
          `[MigrationController] Running migration ${migration.version}: ${migration.description}`
        );
        try {
          await migration.handler(state);
          console.log(
            `[MigrationController] Migration ${migration.version} completed successfully`
          );
          // Mark migration as completed
          await chromeStorage.setItem(migration.version, 'migrated');
        } catch (error) {
          console.error(
            `[MigrationController] Migration ${migration.version} failed:`,
            error
          );
          // Continue with other migrations even if one fails
        }
      }
    }
  }
};

export default MigrationController;
