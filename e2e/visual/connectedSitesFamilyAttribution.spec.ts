import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { ellipsis } from '../../source/utils/format';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
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

// Read only public identity and permission metadata, never another vault or
// the full persisted state. All mutations below use the ordinary wallet UI.
async function publicConnectionState(page: Page, host: string) {
  return page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const { activeAccount, activeNetwork, accounts } = state.vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id];
    const grant = (value: any) =>
      value
        ? {
            host: value.host,
            accountId: value.accountId,
            accountType: value.accountType,
            chain: value.chain,
            chainId: value.chainId,
          }
        : null;
    return {
      account: {
        id: activeAccount.id,
        type: activeAccount.type,
        address: account?.address,
        label: account?.label,
      },
      network: {
        kind: activeNetwork.kind,
        chainId: activeNetwork.chainId,
        url: activeNetwork.url,
      },
      liveGrant: grant(state.dapp.dapps[origin]),
      savedGrant: grant(saved.state?.dapp?.dapps[origin]),
    };
  }, host);
}

test('Connected Sites keeps a foreign-family grant separate from the current account and permits its removal', async ({}, info) => {
  test.setTimeout(150_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const origin = new URL(server.url).origin;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ConnectionFamilySyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('connected-sites-family-attribution', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (identity) => {
        observations.workerIdentity = identity;
      }
    );
    const page = wallet.page;
    const openConnectedSites = async () => {
      await expect(page).toHaveURL(/#\/home$/);
      await page
        .getByRole('button', { name: en.settings.connectedSites, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/networks\/connected-sites$/);
      await expect(page.getByTitle(origin, { exact: true })).toBeVisible();
    };
    const openReview = async () => {
      const row = page.getByRole('listitem').filter({
        has: page.getByTitle(origin, { exact: true }),
      });
      await expect(row.getByRole('button')).toHaveAccessibleName(
        `${en.settings.editConnection}: ${origin}`
      );
      await page
        .getByRole('button', {
          name: `${en.settings.editConnection}: ${origin}`,
          exact: true,
        })
        .click();
      const review = page.getByRole('dialog', {
        name: en.settings.editConnection,
        exact: true,
      });
      await expect(review).toBeVisible();
      return review;
    };
    await wallet.step('open the disposable EVM wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await expect(page).toHaveURL(/#\/home$/);
    });
    const dapp = await wallet.context.newPage();
    await dapp.goto(origin);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    let originalAddress = '';
    let original!: Awaited<ReturnType<typeof publicConnectionState>>;
    await wallet.step(
      'approve the synthetic EVM dapp connection',
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
        await expect
          .poll(
            async () => (await publicConnectionState(page, origin)).savedGrant
          )
          .not.toBeNull();
        original = await publicConnectionState(page, origin);
        expect(original.network.kind).toBe('ethereum');
        expect(original.account.address.toLowerCase()).toBe(
          originalAddress.toLowerCase()
        );
        expect(original.liveGrant).toEqual(original.savedGrant);
        expect(original.liveGrant).toMatchObject({
          host: origin,
          accountId: original.account.id,
          accountType: original.account.type,
          chain: 'ethereum',
        });
        observations.original = original;
      }
    );
    await wallet.step(
      'inspect the healthy same-family permission and close to Home',
      async () => {
        await openConnectedSites();
        const review = await openReview();
        await expect(
          review.getByText(ellipsis(original.account.address), { exact: true })
        ).toBeVisible();
        await expect(
          review.getByText(original.account.label, { exact: true })
        ).toBeVisible();
        await expect(
          review.getByText(en.settings.unavailable, { exact: true })
        ).toHaveCount(0);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
          originalAddress,
        ]);
        await review
          .locator('footer')
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await expect(review).toHaveCount(0);
        await page
          .locator('[data-page-action-footer]')
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home$/);
      }
    );
    const currentLabel = 'Current UTXO account';
    let switched!: Awaited<ReturnType<typeof publicConnectionState>>;
    await wallet.step(
      'switch through Home to UTXO and label its distinct current account',
      async () => {
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await page
          .getByRole('button', { name: en.buttons.edit, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/edit-account$/);
        await page
          .getByPlaceholder(en.settings.accountLabel, { exact: true })
          .fill(currentLabel);
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home$/);
        switched = await publicConnectionState(page, origin);
        expect(switched.network.kind).toBe('syscoin');
        expect(switched.account.address).not.toBe(originalAddress);
        expect(switched.account.label).toBe(currentLabel);
        expect(switched.account.id).toBe(original.account.id);
        expect(switched.account.type).toBe(original.account.type);
        expect(switched.liveGrant).toEqual(original.liveGrant);
        expect(switched.savedGrant).toEqual(original.savedGrant);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        observations.switched = switched;
      }
    );
    await wallet.step(
      'review the retained EVM grant without attributing the UTXO account',
      async (capture) => {
        await openConnectedSites();
        await expect(
          page.getByText(`Connected to: Account ${original.account.id + 1}`, {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          page.getByText(`Connected to: ${currentLabel}`, { exact: true })
        ).toHaveCount(0);
        const review = await openReview();
        await expect(review.getByText(origin, { exact: true })).toBeVisible();
        await expect(review.getByText('EVM', { exact: true })).toBeVisible();
        await expect(review.getByText('UTXO', { exact: true })).toHaveCount(0);
        await expect(
          review.getByText(en.settings.unavailable, { exact: true })
        ).toBeVisible();
        await expect(
          review.getByText(`Account ${original.account.id + 1}`, {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          review.getByText(currentLabel, { exact: true })
        ).toHaveCount(0);
        await expect(
          review.getByText(ellipsis(switched.account.address), { exact: true })
        ).toHaveCount(0);
        await expect(
          review.getByText(ellipsis(originalAddress), { exact: true })
        ).toHaveCount(0);
        await expect(
          review.getByRole('button', {
            name: en.settings.deleteConnected,
            exact: true,
          })
        ).toBeEnabled();
        expect(await publicConnectionState(page, origin)).toEqual(switched);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        await capture(page);
        await info.attach('foreign-evm-grant-modal', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        observations.foreignReview = {
          badge: 'EVM',
          account: `Account ${original.account.id + 1}`,
          address: en.settings.unavailable,
          wrongFamilyLabelAbsent: true,
          wrongFamilyAddressAbsent: true,
          providerAccounts: [],
        };
      }
    );
    await wallet.step(
      'remove the foreign grant through its native control and verify durable removal',
      async () => {
        await page
          .getByRole('dialog', {
            name: en.settings.editConnection,
            exact: true,
          })
          .getByRole('button', {
            name: en.settings.deleteConnected,
            exact: true,
          })
          .click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByTitle(origin, { exact: true })).toHaveCount(0);
        await expect(
          page.getByText('No sites are connected to Pali Wallet', {
            exact: true,
          })
        ).toBeVisible();
        await expect
          .poll(async () => {
            const state = await publicConnectionState(page, origin);
            return { liveGrant: state.liveGrant, savedGrant: state.savedGrant };
          })
          .toEqual({ liveGrant: null, savedGrant: null });
        const removed = await publicConnectionState(page, origin);
        expect(removed.account).toEqual(switched.account);
        expect(removed.network).toEqual(switched.network);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        observations.removed = removed;
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(testSourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('connected-sites-family-attribution-evidence', {
        body: JSON.stringify(
          {
            status,
            runtime,
            testSourceSha256,
            origin,
            observations,
            reads: routes?.reads ?? [],
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedMethods: server.blocked.slice(),
            syntheticHttpOnly: true,
            externalHttpRequestsFulfilled: 0,
            controllerOrApiReplaced: false,
            signaturesOrBroadcastsRequested: false,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
