import { expect, test, type Locator, type Page } from '@playwright/test';
import { HDNodeWallet } from 'ethers';
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

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const LABELS = ['Travel', 'TreasuryAccountForBusinessOperations2026'] as const;

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get([key, 'state']);
    const project = (vault: any) =>
      Object.values(vault?.accounts?.HDAccount || {})
        .map((account: any) => ({
          id: account.id,
          label: account.label,
          address: account.address,
          xpub: account.xpub,
        }))
        .sort((a, b) => a.id - b.id);
    return {
      active: state.vault.activeAccount,
      savedActive: disk[key]?.activeAccount,
      live: project(state.vault),
      saved: project(disk[key]),
      grants: Object.keys(state.dapp?.dapps || {}).sort(),
      savedGrants: Object.keys(disk.state?.dapp?.dapps || {}).sort(),
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
      },
    };
  });

const measure = (label: Locator) =>
  label.evaluate((element) => {
    const plain = (rect: DOMRect) => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
    });
    const body = element.parentElement!;
    const bounds = body.getBoundingClientRect();
    const style = getComputedStyle(body);
    const left = bounds.left + parseFloat(style.paddingLeft);
    const right = bounds.right - parseFloat(style.paddingRight);
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines = [...range.getClientRects()].map(plain);
    return {
      text: element.textContent,
      viewport: { width: innerWidth, height: innerHeight },
      element: plain(element.getBoundingClientRect()),
      body: plain(bounds),
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      lines,
      allTextInsideContent: lines.every(
        (line) => line.x >= left - 0.5 && line.right <= right + 0.5
      ),
      hasHorizontalOverflow: body.scrollWidth > body.clientWidth + 1,
    };
  });

test('account creation success preserves long labels without horizontal clipping', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(LABELS[1]).toHaveLength(40);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountLabelSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const records: unknown[] = [];
  const pageErrors: string[] = [];
  try {
    wallet = await PaliWallet.launch('account-created-label-observation', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    wallet.page.on('pageerror', (error) => pageErrors.push(error.message));
    await wallet.step(
      'label observation onboards a real disposable wallet and chooses EVM',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
      }
    );
    for (const [index, label] of LABELS.entries()) {
      const kind = index === 0 ? 'short' : 'forty';
      const id = index + 1;
      // Derive only the expected public address; never attach private material.
      const expectedAddress = HDNodeWallet.fromPhrase(
        UTXO_FIXTURE_SEED,
        undefined,
        `m/44'/60'/0'/0/${id}`
      ).address;
      const baseline = await publicState(wallet.page);
      await wallet.step(
        `${kind} label ordinary Create persists its independently derived public account`,
        async () => {
          await wallet!.page.setViewportSize({ width: 400, height: 620 });
          await wallet!.ensureOnHome();
          await wallet!.page
            .locator('#general-settings-button')
            .locator('..')
            .click();
          await wallet!.page
            .getByRole('menuitem', {
              name: en.accountMenu.createNewAccount,
              exact: true,
            })
            .click();
          const input = wallet!.page.locator('#account-name-input');
          const maxlength = await input.getAttribute('maxlength');
          expect(maxlength === null || Number(maxlength) >= label.length).toBe(
            true
          );
          await input.fill(label);
          await expect(input).toHaveValue(label);
          await wallet!.page.locator('#create-btn').click();
          const dialog = wallet!.page.getByRole('dialog', {
            name: en.settings.yourNewAccount,
            exact: true,
          });
          await expect(dialog).toBeVisible();
          await expect(dialog.getByText(label, { exact: true })).toHaveCount(1);
          await expect(
            dialog.getByText(expectedAddress, { exact: true })
          ).toHaveCount(1);
          await expect
            .poll(() => publicState(wallet!.page))
            .toMatchObject({
              active: { id, type: 'HDAccount' },
              savedActive: { id, type: 'HDAccount' },
            });
          const accepted = await publicState(wallet!.page);
          expect(accepted.live).toEqual(accepted.saved);
          expect(accepted.live.slice(0, -1)).toEqual(baseline.live);
          expect(accepted.live.at(-1)).toMatchObject({
            id,
            label,
            address: expectedAddress,
          });
          expect(accepted.grants).toEqual(baseline.grants);
          expect(accepted.savedGrants).toEqual(baseline.savedGrants);
          expect(accepted.network).toEqual(baseline.network);
          records.push({ kind, accepted });
        }
      );
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        await wallet.step(
          `${kind} label success sheet at ${viewport.width} records literal wrapping and controls`,
          async () => {
            const page = wallet!.page;
            await page.setViewportSize(viewport);
            await page.evaluate(async () => {
              await document.fonts.ready;
              await Promise.all(
                document
                  .getAnimations()
                  .filter(
                    (a) => a.effect?.getComputedTiming().iterations !== Infinity
                  )
                  .map((a) => a.finished.catch(() => undefined))
              );
            });
            const dialog = page.getByRole('dialog', {
              name: en.settings.yourNewAccount,
              exact: true,
            });
            const observation = await measure(
              dialog.getByText(label, { exact: true })
            );
            const buttons = [];
            for (const name of [en.buttons.close, en.buttons.ok]) {
              const control = dialog.getByRole('button', { name, exact: true });
              await expect(control).toBeEnabled();
              const box = (await control.boundingBox())!;
              expect(box.width).toBeGreaterThanOrEqual(44);
              expect(box.height).toBeGreaterThanOrEqual(44);
              expect(box.x).toBeGreaterThanOrEqual(0);
              expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
              expect(box.y).toBeGreaterThanOrEqual(0);
              expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
              buttons.push({ name, box });
            }
            records.push({ kind, observation, buttons });
            await info.attach(`account-created-${kind}-${viewport.width}`, {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
            expect(observation.allTextInsideContent).toBe(true);
            expect(observation.hasHorizontalOverflow).toBe(false);
          }
        );
      }
      await wallet.step(
        `${kind} label OK and reload preserve the accepted public account`,
        async () => {
          const accepted = await publicState(wallet!.page);
          await wallet!.page
            .getByRole('dialog', {
              name: en.settings.yourNewAccount,
              exact: true,
            })
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await wallet!.ensureOnHome();
          expect(await publicState(wallet!.page)).toEqual(accepted);
          await wallet!.page.reload();
          await wallet!.waitAppReady();
          await wallet!.ensureOnHome();
          expect(await publicState(wallet!.page)).toEqual(accepted);
        }
      );
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
    status = 'passed';
  } finally {
    await info.attach('account-created-label-observation-evidence', {
      body: JSON.stringify({
        runtime,

        status,
        controllerStateReplaced: false,
        controllerResultsReplaced: false,
        records,
        deniedWrites: routes?.deniedWrites,
        pageErrors,
      }),
      contentType: 'application/json',
    });
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
});
