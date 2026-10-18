import { expect, test } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  providerRequest,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('connection settings follow external revocation and reconnection without reloading', async ({}, info) => {
  test.setTimeout(150_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const origin = new URL(server.url).origin;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ConnectionLifecycleSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('connected-sites-reconnection', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.step('open the disposable EVM wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet!.ensureOnHome();
    });
    const dapp = await wallet.context.newPage();
    await dapp.goto(origin);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    let originalAddress = '';
    await wallet.step(
      'approve the original provider connection',
      async (capture) => {
        const id = await startRequest(dapp, 'eth_requestAccounts');
        const popup = await popupFor(wallet!.context, dapp, id);
        try {
          const response = await approve(wallet!.context, dapp, id, capture);
          expect(response.result).toHaveLength(1);
          originalAddress = response.result[0];
        } finally {
          if (!popup.isClosed()) await capture(popup);
        }
      }
    );
    const page = wallet.page;
    await wallet.step(
      'inspect the live connection without changing its page',
      async () => {
        await wallet!.gotoRoute('#/settings/networks/connected-sites');
        await expect(page.getByText(origin, { exact: true })).toBeVisible();
        await expect(
          page.getByText('1 site is connected to Pali Wallet', { exact: true })
        ).toBeVisible();
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
          originalAddress,
        ]);
      }
    );
    const documentStart = await page.evaluate(() => performance.timeOrigin);
    await wallet.step(
      'discard an obsolete open review after provider-side permission revocation',
      async () => {
        await page
          .getByRole('button', {
            name: en.settings.editConnection,
            exact: true,
          })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(
          await providerRequest(dapp, 'wallet_revokePermissions', [
            { eth_accounts: {} },
          ])
        ).toBeNull();
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(
          documentStart
        );
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByText(origin, { exact: true })).toHaveCount(0);
      }
    );
    await wallet.step(
      'restore the connection through a new ordinary approval',
      async (capture) => {
        const id = await startRequest(dapp, 'eth_requestAccounts');
        const popup = await popupFor(wallet!.context, dapp, id);
        try {
          const response = await approve(wallet!.context, dapp, id, capture);
          expect(response.result).toEqual([originalAddress]);
        } finally {
          if (!popup.isClosed()) await capture(popup);
        }
        await expect(page.getByText(origin, { exact: true })).toBeVisible();
      }
    );
    await wallet.step(
      'disconnect through the ordinary settings confirmation',
      async () => {
        await page
          .getByRole('button', {
            name: en.settings.editConnection,
            exact: true,
          })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page
          .getByRole('dialog')
          .getByRole('button', {
            name: en.settings.deleteConnected,
            exact: true,
          })
          .click();
        await expect(page.getByText(origin, { exact: true })).toHaveCount(0);
        await expect(
          page.getByText('No sites are connected to Pali Wallet', {
            exact: true,
          })
        ).toBeVisible();
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
      }
    );
    await wallet.step(
      'approve reconnection while the settings document remains open',
      async (capture) => {
        const id = await startRequest(dapp, 'eth_requestAccounts');
        const popup = await popupFor(wallet!.context, dapp, id);
        try {
          const response = await approve(wallet!.context, dapp, id, capture);
          expect(response.result).toEqual([originalAddress]);
        } finally {
          if (!popup.isClosed()) await capture(popup);
        }
      }
    );
    await wallet.step(
      'show and inspect the newly connected permission without reloading',
      async () => {
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(
          documentStart
        );
        await expect(page).toHaveURL(/#\/settings\/networks\/connected-sites$/);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
          originalAddress,
        ]);
        await expect(page.getByText(origin, { exact: true })).toBeVisible();
        await expect(
          page.getByText('1 site is connected to Pali Wallet', { exact: true })
        ).toBeVisible();
        const edit = page.getByRole('button', {
          name: en.settings.editConnection,
          exact: true,
        });
        await expect(edit).toBeEnabled();
        await edit.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(
          page.getByRole('dialog').getByText(origin, { exact: true })
        ).toBeVisible();
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('connection-lifecycle-evidence', {
      body: JSON.stringify(
        {
          ...extensionEvidence(),
          origin,
          originalAddress,
          providerPermissionSettlementTested: true,
          connectionListDocumentReloaded: false,
          controllerStateReplaced: false,
          deniedWrites: routes.deniedWrites,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
