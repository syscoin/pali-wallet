import { expect, test } from '@playwright/test';

import { PaliWallet } from '../harness/pali';

type StoredVault = {
  accountAssets: Record<
    string,
    Record<string, { ethereum: any[]; syscoin: any[] }>
  >;
  accounts: Record<
    string,
    Record<string, { address?: string; label?: string }>
  >;
};

const getStoredVaults = async (wallet: PaliWallet) => {
  const worker = wallet.context.serviceWorkers()[0];
  if (!worker) throw new Error('Pali service worker is not available');

  return worker.evaluate(
    () =>
      new Promise<Record<string, StoredVault | undefined>>((resolve) => {
        chrome.storage.local.get(
          ['state-vault-57', 'state-vault-60'],
          (items) => resolve(items as Record<string, StoredVault | undefined>)
        );
      })
  );
};

const getBackgroundState = async (wallet: PaliWallet) =>
  wallet.page.evaluate(
    () =>
      new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: 'getCurrentState' }, resolve);
      })
  );

const controllerAction = async (
  wallet: PaliWallet,
  methods: string[],
  params: unknown[]
) => {
  const response = await wallet.page.evaluate(
    ({ actionMethods, actionParams }) =>
      new Promise<any>((resolve) => {
        chrome.runtime.sendMessage(
          {
            data: { methods: actionMethods, params: actionParams },
            type: 'CONTROLLER_ACTION',
          },
          resolve
        );
      }),
    { actionMethods: methods, actionParams: params }
  );

  if (response?.error) {
    throw new Error(
      typeof response.error === 'string'
        ? response.error
        : response.error.message || JSON.stringify(response.error)
    );
  }
  return response;
};

const createHdAccount = async (wallet: PaliWallet) => {
  await wallet.gotoRoute('#/settings/account/new');
  await wallet.page.locator('#create-btn').click();
  const okButton = wallet.page.getByRole('button', { name: /^ok$/i }).first();
  await expect(okButton).toBeVisible({ timeout: 60_000 });
  await okButton.click();
  await wallet.page.waitForURL(/#\/home/, { timeout: 30_000 });
};

const getHdAddresses = (vault: StoredVault | undefined) =>
  Object.values(vault?.accounts?.HDAccount || {}).map(({ address, label }) => ({
    address,
    label,
  }));

test('vaults keep UTXO and EVM accounts isolated while alternating networks', async () => {
  const wallet = await PaliWallet.launch('vault-isolation');

  try {
    await wallet.step('import fresh seed on Syscoin UTXO', () =>
      wallet.importSeedAndCreatePassword()
    );

    await wallet.step('import an SPT into the Syscoin vault', () =>
      controllerAction(
        wallet,
        ['wallet', 'saveTokenInfo'],
        [
          {
            assetGuid: '123456789',
            balance: 0,
            decimals: 8,
            description: '',
            symbol: 'E2ESPT',
          },
        ]
      )
    );

    await wallet.step(
      'switch to Rollux and create another EVM account',
      async () => {
        await wallet.switchNetwork('Rollux', 'EVM');
        await createHdAccount(wallet);
        await controllerAction(
          wallet,
          ['wallet', 'saveTokenInfo'],
          [
            {
              balance: 0,
              contractAddress: '0x00000000000000000000000000000000000000a1',
              decimals: 18,
              isNft: false,
              name: 'E2E Token',
              tokenSymbol: 'E2E',
            },
          ]
        );
      }
    );

    await wallet.step(
      'EVM switch activated only slip44 60 accounts',
      async () => {
        const state = await getBackgroundState(wallet);
        const vaults = await getStoredVaults(wallet);
        const activeAccounts = getHdAddresses(state.vault);
        const sysAccounts = getHdAddresses(vaults['state-vault-57']);
        const evmAccounts = getHdAddresses(vaults['state-vault-60']);

        expect({
          activeAccounts,
          activeNetwork: state.vault.activeNetwork,
          activeSlip44: state.vaultGlobal.activeSlip44,
          evmAccounts,
          sysAccounts,
        }).toEqual({
          activeAccounts: [
            expect.objectContaining({ address: expect.stringMatching(/^0x/) }),
            expect.objectContaining({ address: expect.stringMatching(/^0x/) }),
          ],
          activeNetwork: expect.objectContaining({ slip44: 60 }),
          activeSlip44: 60,
          evmAccounts: [
            expect.objectContaining({ address: expect.stringMatching(/^0x/) }),
            expect.objectContaining({ address: expect.stringMatching(/^0x/) }),
          ],
          sysAccounts: [
            expect.objectContaining({
              address: expect.not.stringMatching(/^0x/),
            }),
          ],
        });
        expect(
          vaults['state-vault-57']?.accountAssets.HDAccount['0'].syscoin
        ).toEqual([
          expect.objectContaining({ assetGuid: '123456789', chainId: 57 }),
        ]);
        expect(
          vaults['state-vault-60']?.accountAssets.HDAccount['1'].ethereum
        ).toEqual([
          expect.objectContaining({
            contractAddress: '0x00000000000000000000000000000000000000a1',
            chainId: 570,
          }),
        ]);
      }
    );

    await wallet.step('switch back to Syscoin', async () => {
      await wallet.switchNetwork('Syscoin Mainnet', 'UTXO');
    });

    await wallet.step(
      'UTXO switch restored only slip44 57 accounts',
      async () => {
        const state = await getBackgroundState(wallet);
        const vaults = await getStoredVaults(wallet);
        const activeAccounts = getHdAddresses(state.vault);
        const sysAccounts = getHdAddresses(vaults['state-vault-57']);
        const evmAccounts = getHdAddresses(vaults['state-vault-60']);

        expect({
          activeAccounts,
          activeNetwork: state.vault.activeNetwork,
          activeSlip44: state.vaultGlobal.activeSlip44,
          evmAccounts,
          sysAccounts,
        }).toEqual({
          activeAccounts: [
            expect.objectContaining({
              address: expect.not.stringMatching(/^0x/),
            }),
          ],
          activeNetwork: expect.objectContaining({ slip44: 57 }),
          activeSlip44: 57,
          evmAccounts: [
            expect.objectContaining({ address: expect.stringMatching(/^0x/) }),
            expect.objectContaining({ address: expect.stringMatching(/^0x/) }),
          ],
          sysAccounts: [
            expect.objectContaining({
              address: expect.not.stringMatching(/^0x/),
            }),
          ],
        });
        expect(state.vault.accountAssets.HDAccount['0'].syscoin).toEqual([
          expect.objectContaining({ assetGuid: '123456789', chainId: 57 }),
        ]);
        expect(
          vaults['state-vault-60']?.accountAssets.HDAccount['1'].ethereum
        ).toEqual([
          expect.objectContaining({
            contractAddress: '0x00000000000000000000000000000000000000a1',
            chainId: 570,
          }),
        ]);
      }
    );

    await wallet.step('create another Syscoin account', () =>
      createHdAccount(wallet)
    );

    await wallet.step(
      'persisted slip44 vaults contain one address family',
      async () => {
        const vaults = await getStoredVaults(wallet);
        const sysAccounts = getHdAddresses(vaults['state-vault-57']);
        const evmAccounts = getHdAddresses(vaults['state-vault-60']);

        expect(sysAccounts).toHaveLength(2);
        expect(evmAccounts).toHaveLength(2);
        expect(
          sysAccounts.every(({ address }) => !address?.startsWith('0x'))
        ).toBe(true);
        expect(
          evmAccounts.every(({ address }) => address?.startsWith('0x'))
        ).toBe(true);
        expect(sysAccounts.map(({ label }) => label)).toEqual([
          'SYS 1',
          'SYS 2',
        ]);
        expect(evmAccounts.map(({ label }) => label)).toEqual([
          'Account 1',
          'Account 2',
        ]);
        expect(
          vaults['state-vault-57']?.accountAssets.HDAccount['0'].syscoin
        ).toEqual([
          expect.objectContaining({ assetGuid: '123456789', chainId: 57 }),
        ]);
        expect(
          vaults['state-vault-60']?.accountAssets.HDAccount['1'].ethereum
        ).toEqual([
          expect.objectContaining({
            contractAddress: '0x00000000000000000000000000000000000000a1',
            chainId: 570,
          }),
        ]);
      }
    );

    await wallet.dispose('passed');
  } catch (error) {
    await wallet.dispose('failed');
    throw error;
  }
});
