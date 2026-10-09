import { INetwork, INetworkType } from 'types/network';
import { CHAIN_IDS, PALI_NETWORKS_STATE } from 'utils/constants';
import { chromeStorage } from 'utils/storageAPI';

import MigrationController from './MigrationController';

jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

const LEGACY_API = 'https://eth.blockscout.com/api';
const ROUTESCAN_API =
  'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
const DISABLED_APIS: [number, string][] = [
  [CHAIN_IDS.BASE_MAINNET, 'https://base.blockscout.com/api'],
  [CHAIN_IDS.ARBITRUM_ONE, 'https://arbitrum.blockscout.com/api'],
];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const builtInEthereum = (): INetwork => ({
  ...PALI_NETWORKS_STATE.ethereum[CHAIN_IDS.ETHEREUM_MAINNET],
  apiUrl: LEGACY_API,
  // A replacement of the API must retain customized RPC and display settings.
  url: 'https://user-rpc.example',
  label: 'My Ethereum',
});

describe('built-in explorer API upgrade', () => {
  let persisted: Map<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    persisted = new Map([
      ['4.0.0', 'migrated'],
      ['4.0.12', 'migrated'],
    ]);
    jest
      .mocked(chromeStorage.getItem)
      .mockImplementation(async (key) =>
        persisted.has(key) ? clone(persisted.get(key)) : null
      );
    jest
      .mocked(chromeStorage.setItem)
      .mockImplementation(async (key, value) => {
        persisted.set(key, clone(value));
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('updates every saved built-in Ethereum copy and preserves all other wallet data', async () => {
    const network = builtInEthereum();
    const base = {
      ...PALI_NETWORKS_STATE.ethereum[CHAIN_IDS.BASE_MAINNET],
      apiUrl: DISABLED_APIS[0][1],
    };
    const arbitrum = {
      ...PALI_NETWORKS_STATE.ethereum[CHAIN_IDS.ARBITRUM_ONE],
      apiUrl: DISABLED_APIS[1][1],
    };
    const vault = {
      activeNetwork: clone(network),
      accounts: {
        HDAccount: {
          0: { address: 'saved-address', balances: { ethereum: '12.5' } },
        },
      },
      accountAssets: { HDAccount: { 0: { ethereum: [{ symbol: 'SAVED' }] } } },
    };
    const state = {
      vaultGlobal: {
        networks: {
          ethereum: { 1: clone(network), 8453: base, 42161: arbitrum },
        },
        networkTarget: clone(network),
        activeSlip44: 60,
      },
      vault: clone(vault),
      dapp: { connected: ['saved-dapp'] },
    };
    persisted.set('state-vault-60', clone(vault));
    const original = clone(state);
    const expectedNetwork = { ...network, apiUrl: ROUTESCAN_API };
    const expectedBase = clone(base);
    const expectedArbitrum = clone(arbitrum);
    delete expectedBase.apiUrl;
    delete expectedArbitrum.apiUrl;

    await MigrationController(state);

    expect(state.vaultGlobal.networks.ethereum[1]).toEqual(expectedNetwork);
    expect(state.vaultGlobal.networkTarget).toEqual(expectedNetwork);
    expect(state.vault.activeNetwork).toEqual(expectedNetwork);
    expect(persisted.get('state-vault-60')).toEqual({
      ...vault,
      activeNetwork: expectedNetwork,
    });
    expect(persisted.get('state')).toEqual({
      vaultGlobal: {
        ...original.vaultGlobal,
        networks: {
          ethereum: {
            ...original.vaultGlobal.networks.ethereum,
            1: expectedNetwork,
            8453: expectedBase,
            42161: expectedArbitrum,
          },
        },
        networkTarget: expectedNetwork,
      },
      dapp: original.dapp,
    });
    expect(state.vault.accounts).toEqual(original.vault.accounts);
    expect(state.vault.accountAssets).toEqual(original.vault.accountAssets);
    expect(state.vaultGlobal.networks.ethereum[8453]).toEqual(expectedBase);
    expect(state.vaultGlobal.networks.ethereum[42161]).toEqual(
      expectedArbitrum
    );
    expect(persisted.get('4.0.71')).toBe('migrated');
  });

  it.each([
    ['custom network', { default: false }],
    ['network without built-in marker', { default: undefined }],
    ['API key', { apiUrl: `${LEGACY_API}?apikey=private-key` }],
    ['other API key spelling', { apiUrl: `${LEGACY_API}?apiKey=private-key` }],
    ['custom API query', { apiUrl: `${LEGACY_API}?foo=bar` }],
    ['custom API host', { apiUrl: 'https://custom-explorer.example/api' }],
    ['other chain', { chainId: CHAIN_IDS.BASE_MAINNET }],
  ])('preserves %s in global and active vault state', async (_, override) => {
    const network = { ...builtInEthereum(), ...override };
    const state = {
      vaultGlobal: {
        networks: { ethereum: { 1: clone(network) } },
        networkTarget: clone(network),
      },
      vault: { activeNetwork: clone(network) },
    };
    const original = clone(state);
    persisted.set('state-vault-60', { activeNetwork: clone(network) });

    await MigrationController(state);

    expect(state).toEqual(original);
    expect(persisted.get('state-vault-60')).toEqual({ activeNetwork: network });
    expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
    expect(chromeStorage.setItem).toHaveBeenCalledWith('4.0.71', 'migrated');
  });

  it('accepts the exact legacy API with a trailing slash', async () => {
    const state = {
      vaultGlobal: {
        networks: {
          ethereum: { 1: { ...builtInEthereum(), apiUrl: `${LEGACY_API}/` } },
        },
      },
    };

    await MigrationController(state);

    expect(state.vaultGlobal.networks.ethereum[1].apiUrl).toBe(ROUTESCAN_API);
  });

  it.each(
    DISABLED_APIS.flatMap(([chainId, apiUrl]) => [
      [chainId, apiUrl] as const,
      [chainId, `${apiUrl}/`] as const,
    ])
  )(
    'removes retired chain %s API %s from every saved built-in copy',
    async (chainId, apiUrl) => {
      const network = {
        ...PALI_NETWORKS_STATE.ethereum[chainId],
        apiUrl,
        url: 'https://custom-rpc.example',
        label: 'Customized built-in network',
      };
      const state = {
        vaultGlobal: {
          networks: { ethereum: { [chainId]: clone(network) } },
          networkTarget: clone(network),
        },
        vault: {
          activeNetwork: clone(network),
          accounts: { saved: 'account data' },
        },
      };
      persisted.set('state-vault-60', clone(state.vault));
      const expectedNetwork = clone(network);
      delete expectedNetwork.apiUrl;

      await MigrationController(state);

      expect(state.vaultGlobal.networks.ethereum[chainId]).toEqual(
        expectedNetwork
      );
      expect(state.vaultGlobal.networkTarget).toEqual(expectedNetwork);
      expect(state.vault.activeNetwork).toEqual(expectedNetwork);
      expect(persisted.get('state-vault-60')).toEqual({
        activeNetwork: expectedNetwork,
        accounts: { saved: 'account data' },
      });
    }
  );

  it.each(
    DISABLED_APIS.flatMap(
      ([chainId, legacyUrl]) =>
        [
          [chainId, { default: false, apiUrl: legacyUrl }],
          [chainId, { default: true, apiUrl: `${legacyUrl}?apikey=user-key` }],
          [chainId, { default: true, apiUrl: `${legacyUrl}?apiKey=user-key` }],
          [chainId, { default: true, apiUrl: `${legacyUrl}?custom=value` }],
          [
            chainId,
            { default: true, apiUrl: 'https://custom-explorer.example/api' },
          ],
        ] as const
    )
  )(
    'preserves customized chain %s API settings %p',
    async (chainId, overrides) => {
      const network = {
        ...PALI_NETWORKS_STATE.ethereum[chainId],
        ...overrides,
      };
      const state = {
        vaultGlobal: {
          networks: { ethereum: { [chainId]: clone(network) } },
          networkTarget: clone(network),
        },
        vault: { activeNetwork: clone(network) },
      };
      const original = clone(state);
      persisted.set('state-vault-60', clone(state.vault));

      await MigrationController(state);

      expect(state).toEqual(original);
      expect(persisted.get('state-vault-60')).toEqual(original.vault);
      expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
    }
  );

  it('migrates an inactive EVM vault even when the main state has no EVM network', async () => {
    const state = { vaultGlobal: { activeSlip44: 57 } };
    persisted.set('state-vault-60', {
      activeNetwork: builtInEthereum(),
      accounts: { HDAccount: { 0: { label: 'Saved' } } },
    });

    await MigrationController(state);

    expect(persisted.get('state-vault-60')).toMatchObject({
      activeNetwork: { apiUrl: ROUTESCAN_API, kind: INetworkType.Ethereum },
      accounts: { HDAccount: { 0: { label: 'Saved' } } },
    });
    expect(persisted.has('state')).toBe(false);
  });

  it('does not rerun after completion or create absent vault data', async () => {
    const state = { vaultGlobal: { networks: { ethereum: {} } } };
    await MigrationController(state);
    const writes = jest.mocked(chromeStorage.setItem).mock.calls.length;
    jest.mocked(chromeStorage.getItem).mockClear();

    await MigrationController(state);

    expect(chromeStorage.setItem).toHaveBeenCalledTimes(writes);
    expect(chromeStorage.getItem).not.toHaveBeenCalledWith('state-vault-60');
    expect(persisted.has('state-vault-60')).toBe(false);
  });
});
