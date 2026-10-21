import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createSptFixture,
  installSptFixtureRoutes,
  SPT_GUID,
  SPT_ORIGIN_CONTRACT,
  SPT_SYMBOL,
} from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const publicAssetState = (page: Page) =>
  page.evaluate(async (guid) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const selected = state.vault.activeAccount;
    const account = state.vault.accounts[selected.type][selected.id];
    const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = await chrome.storage.local.get(storageKey);
    const network = state.vault.activeNetwork;
    const asset = (assets: any) => {
      const match = assets?.[selected.type]?.[selected.id]?.syscoin?.find(
        (entry: any) =>
          String(entry.assetGuid) === guid && entry.chainId === network.chainId
      );
      return match
        ? {
            guid: String(match.assetGuid),
            chainId: match.chainId,
            contract: match.contract,
            symbol: match.symbol,
            decimals: match.decimals,
            balance: String(match.balance),
          }
        : null;
    };
    return {
      account: { ...selected, address: account.address },
      network: {
        chainId: network.chainId,
        kind: network.kind,
        label: network.label,
        url: network.url,
        explorer: network.explorer,
      },
      live: asset(state.vault.accountAssets),
      saved: asset(saved[storageKey]?.accountAssets),
    };
  }, SPT_GUID);

test('a bridged SPT on built-in Syscoin testnet links only to the Tanenbaum contract explorer', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const fixture = createSptFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SptBridgeExplorerSynthetic!2026',
    rpcUrl: server.url,
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
  });
  let wallet: PaliWallet | undefined;
  let routes: Awaited<ReturnType<typeof installSptFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('spt-testnet-bridge-explorer', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installSptFixtureRoutes(wallet.context, fixture, server.url);
    const page = wallet.page;
    let imported: Awaited<ReturnType<typeof publicAssetState>>;
    await wallet.step(
      'testnet bridge: import the real HTTP-produced synthetic SPT through its ordinary token row',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        const before = await publicAssetState(page);
        expect(before.network).toMatchObject({
          chainId: 5700,
          kind: 'syscoin',
          label: 'Syscoin Testnet',
          url: 'https://blockbook-dev.syscoin.org/',
        });
        expect(before.live).toBeNull();
        expect(before.saved).toBeNull();
        observations.beforeImport = before;
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        const importToken = page.getByRole('button', {
          name: `Import ${SPT_SYMBOL} token`,
          exact: true,
        });
        await expect(importToken).toBeEnabled();
        await importToken.click();
        await expect(importToken).toBeDisabled();
        await expect
          .poll(() => publicAssetState(page))
          .toMatchObject({
            account: before.account,
            network: before.network,
            live: {
              guid: SPT_GUID,
              chainId: 5700,
              contract: SPT_ORIGIN_CONTRACT,
              symbol: SPT_SYMBOL,
              decimals: 8,
            },
            saved: {
              guid: SPT_GUID,
              chainId: 5700,
              contract: SPT_ORIGIN_CONTRACT,
              symbol: SPT_SYMBOL,
              decimals: 8,
            },
          });
        imported = await publicAssetState(page);
        expect(imported.live).toEqual(imported.saved);
        observations.imported = imported;
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet!.ensureOnHome();
      }
    );
    await wallet.step(
      'testnet bridge: open native asset Details and inspect the exact Tanenbaum link without visiting it',
      async (capture) => {
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', {
            name: `View details for ${SPT_SYMBOL} token`,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/home\/details/);
        const bridge = page.getByRole('link', {
          name: 'View on Tanenbaum Explorer',
          exact: true,
        });
        await expect(bridge).toHaveCount(1);
        await expect(bridge).toHaveAttribute(
          'href',
          `https://explorer.tanenbaum.io/token/${SPT_ORIGIN_CONTRACT}`
        );
        await expect(bridge).toHaveAttribute('target', '_blank');
        await expect(bridge).toHaveAttribute('rel', /noreferrer/);
        await expect(
          page.getByRole('link', { name: 'View on NEVM Explorer', exact: true })
        ).toHaveCount(0);
        await expect(
          page.locator('a[href^="https://explorer.syscoin.org/token/"]')
        ).toHaveCount(0);
        // Healthy companion: the ordinary UTXO asset explorer remains local
        // to testnet. Neither this link nor the bridge link is clicked.
        await expect(
          page.getByRole('link', {
            name: 'View on Syscoin Explorer',
            exact: true,
          })
        ).toHaveAttribute(
          'href',
          `https://explorer-blockbook-dev.syscoin.org/asset/${SPT_GUID}`
        );
        expect(await publicAssetState(page)).toEqual(imported!);
        observations.details = {
          bridgeHref: await bridge.getAttribute('href'),
          bridgeLabel: await bridge.textContent(),
          publicState: await publicAssetState(page),
        };
        await bridge.scrollIntoViewIfNeeded();
        await expect(bridge).toBeVisible();
        await capture(page);
      }
    );
    expect(
      routes.reads.some((entry) => entry.startsWith('/api/v2/xpub/'))
    ).toBe(true);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('spt-testnet-bridge-explorer-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          fixtureReads: routes?.reads ?? [],
          deniedWrites: routes?.deniedWrites ?? [],
          deniedUnknown: routes?.deniedUnknown ?? [],
          proxyDeniedConnections: server.blocked.length,
          fixtureMetadata: {
            guid: SPT_GUID,
            contract: SPT_ORIGIN_CONTRACT,
            origin: 'synthetic SPT HTTP fixture; not live-chain provenance',
          },
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          chromeApiReplaced: false,
          externalLinkVisited: false,
          signingOrBroadcastRequested: false,
          mainnetCoverage: 'native companion only; browser remains on testnet',
        }),
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
