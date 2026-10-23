import { expect, test, type Page, type Worker } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const SOURCE = 'Syscoin Testnet';
const TARGET = 'Syscoin NEVM Testnet';
const FAILURE = 'Synthetic target vault read refusal';

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const network = (value: any) =>
      value
        ? {
            chainId: value.chainId,
            kind: value.kind,
            label: value.label,
            slip44: value.slip44,
          }
        : null;
    return {
      active: network(state.vault.activeNetwork),
      target: network(state.vaultGlobal.networkTarget),
      activeSlip44: state.vaultGlobal.activeSlip44,
      status: state.vaultGlobal.networkStatus,
    };
  });

// The only injected fault is one platform storage-read refusal. Controller
// calls, reducers, target selection, and all other storage operations stay real.
async function installReadFault(worker: Worker) {
  return worker.evaluate(() => {
    const local = chrome.storage.local;
    const original = local.get;
    const probe = {
      failures: 0,
      restored: false,
      restore: () => {
        local.get = original;
        probe.restored = true;
      },
    };
    (globalThis as any).__chainErrorStorageRead = probe;
    local.get = ((...args: any[]) => {
      const keys = args[0];
      if (
        !probe.failures &&
        Array.isArray(keys) &&
        keys.length === 1 &&
        keys[0] === 'state-vault-60'
      ) {
        probe.failures += 1;
        // The real chromeStorage Promise executor rejects this synchronous
        // platform exception, taking the same branch as runtime.lastError.
        throw new Error('Synthetic target vault read refusal');
      }
      return (original as any).apply(local, args);
    }) as typeof local.get;
    return { failures: probe.failures, restored: probe.restored };
  });
}

test('a same-ID cross-family storage failure shows both networks and a healthy retry completes', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
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
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ChainErrorStorageSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let worker: Worker | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let storageFault: { failures: number; restored: boolean } | undefined;
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('chain-error-network-identity', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const page = wallet.page;
    await wallet.step(
      'prepare a new UTXO-only wallet without visiting the EVM vault',
      async () => {
        // Every launch owns a new profile and worker. No EVM selection occurs
        // before the fault, so the target vault cannot enter the worker cache.
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork(SOURCE, 'UTXO');
        await wallet!.ensureOnHome();
        const before = await publicState(page);
        expect(before).toEqual({
          active: { chainId: 5700, kind: 'syscoin', label: SOURCE, slip44: 1 },
          target: null,
          activeSlip44: 1,
          status: 'idle',
        });
        expect(
          await page.evaluate(async () => {
            const records = await chrome.storage.local.get('state-vault-60');
            return records['state-vault-60'] !== undefined;
          })
        ).toBe(false);
        observations.before = before;
        worker = wallet!.context
          .serviceWorkers()
          .find((candidate) =>
            candidate
              .url()
              .startsWith(`chrome-extension://${wallet!.extensionId}/`)
          );
        expect(worker).toBeDefined();
        expect(await installReadFault(worker!)).toEqual({
          failures: 0,
          restored: false,
        });
      }
    );
    await wallet.step(
      'refuse one target vault read and inspect both failed-switch identities',
      async (capture) => {
        await page
          .getByRole('button')
          .filter({ has: page.getByTitle(SOURCE, { exact: true }) })
          .click();
        const menu = page.getByRole('menu');
        const group = menu.getByRole('menuitem', {
          name: en.networkMenu.evmNetworks,
          exact: true,
        });
        if ((await group.getAttribute('aria-expanded')) !== 'true')
          await group.click();
        await menu.getByRole('menuitem', { name: TARGET, exact: true }).click();
        await expect
          .poll(async () => (await publicState(page)).status)
          .toBe('error');
        storageFault = await worker!.evaluate(() => {
          const probe = (globalThis as any).__chainErrorStorageRead;
          return { failures: probe.failures, restored: probe.restored };
        });
        expect(storageFault).toEqual({ failures: 1, restored: false });
        const failed = await publicState(page);
        expect(failed).toEqual({
          active: { chainId: 5700, kind: 'syscoin', label: SOURCE, slip44: 1 },
          target: {
            chainId: 5700,
            kind: 'ethereum',
            label: TARGET,
            slip44: 60,
          },
          activeSlip44: 1,
          status: 'error',
        });
        const errorDialog = page
          .getByRole('dialog')
          .filter({ hasText: FAILURE });
        await expect(errorDialog).toBeVisible();
        await errorDialog
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await expect(errorDialog).toBeHidden();
        await page
          .getByRole('button', {
            name: en.networkConnection.networkError,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/chain-fail-to-connect$/);
        const edit = page.getByRole('button', {
          name: en.chainError.editCurrentRpc,
          exact: true,
        });
        const card = edit.locator('xpath=../..');
        await expect(card.getByText(SOURCE, { exact: true })).toBeVisible();
        await expect(card.getByText(TARGET, { exact: true })).toBeVisible();
        // Both built-in test networks use the existing Syscoin SVG. Require
        // two rendered identities, not invented family-specific image bytes.
        const icons = card.locator('svg[viewBox="0 0 100 100"]');
        await expect(icons).toHaveCount(2);
        for (const icon of await icons.all())
          await expect(icon.locator('path[fill="#008DD0"]')).toHaveCount(2);
        await expect(edit).toBeEnabled();
        await expect(
          page.getByRole('button', {
            name: en.buttons.retryConnect,
            exact: true,
          })
        ).toBeEnabled();
        observations.failed = failed;
        observations.failure = FAILURE;
        await capture(page);
      }
    );
    await wallet.step(
      'restore native storage and retry into the EVM network',
      async () => {
        await worker!.evaluate(() =>
          (globalThis as any).__chainErrorStorageRead.restore()
        );
        await page
          .getByRole('button', { name: en.buttons.retryConnect, exact: true })
          .click();
        await expect
          .poll(() => publicState(page))
          .toEqual({
            active: {
              chainId: 5700,
              kind: 'ethereum',
              label: TARGET,
              slip44: 60,
            },
            target: null,
            activeSlip44: 60,
            status: 'idle',
          });
        await wallet!.ensureOnHome();
        await expect(page).toHaveURL(/#\/home$/);
        const header = page
          .getByRole('button')
          .filter({ has: page.getByTitle(TARGET, { exact: true }) });
        await expect(header).toBeVisible();
        await expect(header.locator('svg[viewBox="0 0 100 100"]')).toHaveCount(
          1
        );
        storageFault = await worker!.evaluate(() => {
          const probe = (globalThis as any).__chainErrorStorageRead;
          return { failures: probe.failures, restored: probe.restored };
        });
        expect(storageFault).toEqual({ failures: 1, restored: true });
        observations.recovered = await publicState(page);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      if (worker)
        storageFault = await worker.evaluate(() => {
          const probe = (globalThis as any).__chainErrorStorageRead;
          if (!probe) return undefined;
          probe.restore();
          const audit = { failures: probe.failures, restored: probe.restored };
          delete (globalThis as any).__chainErrorStorageRead;
          return audit;
        });
      await info.attach('chain-error-network-identity-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          storageFault,
          fixtureReads: routes?.reads,
          deniedWrites: routes?.deniedWrites,
          proxyDeniedRequests: server.blocked,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          platformStorageReadFaultInjected: true,
          signingOrBroadcastRequested: false,
        }),
      });
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
