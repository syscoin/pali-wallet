import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { SPT_GUID, SPT_SYMBOL } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Only a narrow public projection crosses the extension -> runner boundary.
// No whole vault, mnemonic, xpub, encrypted/private key or session is returned.
async function projection(wallet: PaliWallet) {
  return wallet.page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) => {
          if (chrome.runtime.lastError || !state?.vault) {
            reject(new Error('Public vault projection unavailable'));
            return;
          }
          const vault = state.vault,
            ref = vault.activeAccount;
          const selected = vault.accounts?.[ref.type]?.[ref.id];
          if (!selected) {
            reject(new Error('Selected account unavailable'));
            return;
          }
          const accounts = Object.entries(vault.accounts || {}).flatMap(
            ([type, entries]) =>
              Object.values(entries || {}).map((account: any) => ({
                type,
                id: account.id,
                label: account.label,
                address: account.address,
                slip44: account.slip44,
              }))
          );
          if (accounts.length > 10) {
            reject(new Error('Fixture account bound exceeded'));
            return;
          }
          const assets = vault.accountAssets?.[ref.type]?.[ref.id];
          const token = (row: any) => ({
            guid: row.assetGuid ? String(row.assetGuid) : null,
            contract: row.contractAddress || null,
            chainId: row.chainId,
          });
          resolve({
            chainId: vault.activeNetwork.chainId,
            kind: vault.activeNetwork.kind,
            slip44: state.vaultGlobal.activeSlip44,
            selected: {
              type: ref.type,
              id: ref.id,
              address: selected.address,
              label: selected.label,
            },
            accounts,
            syscoin: (assets?.syscoin || []).map(token),
            ethereum: (assets?.ethereum || []).map(token),
            watchOnlyMetadata:
              ref.type === 'Imported' &&
              selected.isImported === true &&
              selected.xpub === selected.address &&
              selected.xprv === '',
            selectedHasPrivateMaterial:
              typeof selected.xprv === 'string' && selected.xprv.length > 0,
          });
        });
      })
  );
}

test('offline vault isolation: normal account UI, token separation and watch-only reload', async () => {
  test.setTimeout(240000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG },
    fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  const snapshots: any[] = [];
  try {
    wallet = await PaliWallet.launch('offline-vault-isolation', {
      offlineHttpProxy: server.url,
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    const menu = () => page.locator('#general-settings-button').click();
    const assertSelected = async (
      family: 'utxo' | 'evm',
      type: string,
      id: number,
      address: string,
      spt: boolean
    ) => {
      await wallet!.ensureOnHome();
      await expect
        .poll(async () => {
          const value = await projection(wallet!);
          return [
            value.slip44,
            value.selected.type,
            value.selected.id,
            value.selected.address,
          ];
        })
        .toEqual([family === 'utxo' ? 1 : 60, type, id, address]);
      const value = await projection(wallet!);
      expect(value.kind).toBe(family === 'utxo' ? 'syscoin' : 'ethereum');
      expect(value.chainId).toBe(5700); // The two families intentionally share this numeric chain id.
      expect(
        value.accounts.every((account: any) =>
          family === 'evm'
            ? /^0x[0-9a-fA-F]{40}$/.test(account.address)
            : !account.address.startsWith('0x') && account.slip44 === 1
        )
      ).toBe(true);
      expect(value.ethereum).toEqual([]);
      expect(value.syscoin.map((token: any) => token.guid)).toEqual(
        spt ? [SPT_GUID] : []
      );
      if (spt) expect(value.syscoin[0].chainId).toBe(5700);
      await expect(
        page.locator('[id="active-account-label items-center"]')
      ).toContainText(value.selected.label);
      expect(routes.deniedWrites).toEqual([]);
      snapshots.push(value);
      return value;
    };
    const createHd = async (label: string) => {
      await menu();
      await page
        .getByText(en.accountMenu.createNewAccount, { exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/account\/new$/);
      await page.locator('#account-name-input').fill(label);
      await page.locator('#create-btn').click();
      const ok = page.getByRole('button', { name: /^ok$/i }).first();
      await expect(ok).toBeVisible();
      await ok.click();
      await wallet!.ensureOnHome();
    };
    const select = async (type: string, index: number) => {
      await menu();
      await page.locator(`#account-${type}-${index}`).click();
    };
    await wallet.step(
      'import synthetic wallet and import its SPT through the normal token UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await assertSelected(
          'utxo',
          'HDAccount',
          0,
          fixture.utxo.userAddress,
          false
        );
        await page.locator('#assets-btn').click();
        await page.getByText('Import Token', { exact: true }).click();
        const button = page.getByRole('button', {
          name: `Import ${SPT_SYMBOL} token`,
          exact: true,
        });
        await button.click();
        await expect(button).toBeDisabled();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await assertSelected(
          'utxo',
          'HDAccount',
          0,
          fixture.utxo.userAddress,
          true
        );
      }
    );
    await wallet.step(
      'create and select a second UTXO account without inheriting its sibling token',
      async () => {
        await createHd('UTXO isolation 2');
        await assertSelected(
          'utxo',
          'HDAccount',
          1,
          fixture.secondUtxo.address,
          false
        );
        await select('HDAccount', 0);
        await assertSelected(
          'utxo',
          'HDAccount',
          0,
          fixture.utxo.userAddress,
          true
        );
      }
    );
    await wallet.step(
      'create an independent EVM account family using the normal network and account UI',
      async () => {
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await assertSelected(
          'evm',
          'HDAccount',
          0,
          fixture.evmAddresses[0],
          false
        );
        await createHd('EVM isolation 2');
        await assertSelected(
          'evm',
          'HDAccount',
          1,
          fixture.evmAddresses[1],
          false
        );
      }
    );
    await wallet.step(
      'alternating families restores each selected account and account-scoped token state',
      async () => {
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await assertSelected(
          'utxo',
          'HDAccount',
          0,
          fixture.utxo.userAddress,
          true
        );
        await select('HDAccount', 1);
        await assertSelected(
          'utxo',
          'HDAccount',
          1,
          fixture.secondUtxo.address,
          false
        );
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await assertSelected(
          'evm',
          'HDAccount',
          1,
          fixture.evmAddresses[1],
          false
        );
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await assertSelected(
          'utxo',
          'HDAccount',
          1,
          fixture.secondUtxo.address,
          false
        );
      }
    );
    await wallet.step(
      'normal watch-only import persists a public identity without signing material',
      async () => {
        await menu();
        await page
          .getByText(en.accountMenu.importAccount, { exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/account\/import$/);
        await page.getByRole('checkbox').check();
        await page
          .getByPlaceholder(`${en.settings.label} (${en.settings.optional})`, {
            exact: true,
          })
          .fill('Watch isolation');
        await page
          .getByPlaceholder('Address / XPUB / Descriptor', { exact: true })
          .fill(fixture.watchAddress);
        await page
          .getByRole('button', { name: en.buttons.import, exact: true })
          .click();
        const ok = page.getByRole('button', { name: /^ok$/i }).first();
        await expect(ok).toBeVisible();
        await ok.click();
        const value = await assertSelected(
          'utxo',
          'Imported',
          0,
          fixture.watchAddress,
          false
        );
        expect(value.watchOnlyMetadata).toBe(true);
        expect(value.selectedHasPrivateMaterial).toBe(false);
      }
    );
    await wallet.step(
      'document reload and alternating networks retain watch-only selection without token leakage',
      async () => {
        await page.goto('about:blank');
        await wallet!.gotoRoute('#/');
        if (await page.locator('#password').isVisible()) await wallet!.unlock();
        const value = await assertSelected(
          'utxo',
          'Imported',
          0,
          fixture.watchAddress,
          false
        );
        expect(value.watchOnlyMetadata).toBe(true);
        expect(value.selectedHasPrivateMaterial).toBe(false);
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        const evm = await assertSelected(
          'evm',
          'HDAccount',
          1,
          fixture.evmAddresses[1],
          false
        );
        expect(
          evm.accounts.some((account: any) => account.type === 'Imported')
        ).toBe(false);
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await assertSelected(
          'utxo',
          'Imported',
          0,
          fixture.watchAddress,
          false
        );
        await select('HDAccount', 0);
        await assertSelected(
          'utxo',
          'HDAccount',
          0,
          fixture.utxo.userAddress,
          true
        );
      }
    );
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'offline-vault-isolation.json'),
      JSON.stringify(
        {
          ...evidence,
          simulated: true,
          liveNetworkTested: false,
          signingAttempted: false,
          watchOnlySigningRejectionTested: false,
          snapshots,
          fixtureReads: routes.reads,
          deniedWrites: routes.deniedWrites,
          proxyDeniedConnections: server.blocked.length,
          limitations:
            'Normal UI and public state projection only. Watch-only empty signing-material metadata is checked, not a signature attempt. No real device or cold browser-process restart qualification.',
        },
        null,
        2
      )
    );
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    throw error;
  } finally {
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
