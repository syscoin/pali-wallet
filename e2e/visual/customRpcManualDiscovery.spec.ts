import { expect, test, type Page } from '@playwright/test';
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

const scenarios = [
  {
    name: 'detected Bitcoin label and zero chain ID',
    coin: 'Bitcoin',
    chainId: 0,
    currency: 'btc',
    typedLabel: '',
    save: true,
  },
  {
    name: 'pretyped Bitcoin label',
    coin: 'Bitcoin',
    chainId: 0,
    currency: 'btc',
    typedLabel: 'My Bitcoin node',
    save: true,
  },
  {
    name: 'detected Syscoin label and positive chain ID',
    coin: 'Syscoin',
    chainId: 57,
    currency: 'sys',
    typedLabel: '',
    save: false,
  },
] as const;

const publicNetworkState = (page: Page, chainId: number) =>
  page.evaluate(async (id) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const stored = await chrome.storage.local.get('state');
    const project = (network: any) =>
      network
        ? {
            chainId: network.chainId,
            currency: network.currency,
            default: network.default,
            explorer: network.explorer,
            kind: network.kind,
            label: network.label,
            slip44: network.slip44,
            url: network.url,
          }
        : null;
    const ref = state.vault.activeAccount;
    return {
      account: {
        ...ref,
        address: state.vault.accounts[ref.type][ref.id].address,
      },
      active: project(state.vault.activeNetwork),
      live: project(state.vaultGlobal.networks.syscoin[id]),
      stored: project(stored.state?.vaultGlobal?.networks?.syscoin?.[id]),
    };
  }, chainId);

for (const scenario of scenarios) {
  test(`manual UTXO discovery shows ${scenario.name}`, async ({}, info) => {
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
    const rpc = `https://${scenario.coin.toLowerCase()}-manual-discovery.synthetic.invalid`;
    const endpoint = `${rpc}/api/v2`;
    const label = scenario.typedLabel || scenario.coin;
    const wire = JSON.stringify({
      blockbook: { network: scenario.coin, coin: scenario.coin },
      backend: { chain: 'main' },
    });
    const previous = { ...E2E_CONFIG };
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let phase = 'onboarding';
    const reads: Array<{ method: string; phase: string; url: string }> = [];
    const unexpectedTargetRequests: Array<{ method: string; url: string }> = [];
    const attemptedWrites: string[] = [];
    const failedRequests: Array<{ method: string; url: string }> = [];
    const observations: Record<string, unknown> = {};
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'ManualUtxoDiscoverySynthetic!2026',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch(
        `manual-utxo-discovery-${scenario.chainId}-${
          scenario.typedLabel ? 'typed' : 'detected'
        }`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          failedRequests.push({ method: request.method(), url: request.url() });
      });
      wallet.context.on('request', (request) => {
        if (!/^https?:/.test(request.url())) return;
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          /* ordinary REST */
        }
        const calls = Array.isArray(payload) ? payload : [payload];
        if (
          /\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname) ||
          calls.some((call) =>
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
              call?.method || ''
            )
          )
        )
          attemptedWrites.push(request.url());
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      // This exact local response override does not change the shared fixture's
      // allowlists. The launch-time proxy never forwards to the synthetic host.
      // Pali's real controller and installed SDK parse this Blockbook response.
      await wallet.context.route(`${rpc}/**`, async (route) => {
        const request = route.request();
        if (request.method() !== 'GET' || request.url() !== endpoint) {
          unexpectedTargetRequests.push({
            method: request.method(),
            url: request.url(),
          });
          return route.abort('blockedbyclient');
        }
        reads.push({ method: request.method(), phase, url: request.url() });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: wire,
        });
      });
      await wallet.context.route(
        'https://chainlist.org/rpcs.json',
        async (route) => {
          if (route.request().method() !== 'GET') {
            unexpectedTargetRequests.push({
              method: route.request().method(),
              url: route.request().url(),
            });
            return route.abort('blockedbyclient');
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
          });
        }
      );
      const page = wallet.page;
      const trigger = page
        .getByRole('button')
        .filter({ has: page.locator('#network-settings-btn') });
      const labelInput = page.getByRole('combobox', {
        name: en.settings.label,
        exact: true,
      });
      const rpcInput = page.locator('input#rpc_url');
      const chainInput = page.locator('input#rpc_chainId');
      const symbolInput = page.locator('input#rpc_symbol');
      let before: Awaited<ReturnType<typeof publicNetworkState>>;
      await wallet.step(
        'open Add Custom RPC through the ordinary network menu',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          const onboarded = await publicNetworkState(page, scenario.chainId);
          expect(onboarded.active).toMatchObject({
            chainId: 5700,
            kind: 'syscoin',
          });
          observations.onboarded = onboarded;
          if (scenario.save) {
            // A normal wallet already registers Bitcoin. Remove only that
            // non-active registration through its ordinary confirmation UI,
            // rather than inventing an empty registry for the Add scenario.
            expect(onboarded.live).toEqual({
              chainId: 0,
              currency: 'btc',
              default: false,
              explorer: 'https://btc1.trezor.io/',
              kind: 'syscoin',
              label: 'Bitcoin',
              slip44: 0,
              url: 'https://btc1.trezor.io/',
            });
            expect(onboarded.stored).toEqual(onboarded.live);
            await trigger.click();
            await page
              .getByRole('menuitem', {
                name: en.networkMenu.manageNetworks,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
            const row = page.locator('li').filter({
              has: page.getByText('Bitcoin', { exact: true }),
            });
            await expect(row).toHaveCount(1);
            await expect(row.locator('button')).toHaveCount(2);
            const remove = row.locator('button').last();
            await expect(remove).toBeEnabled();
            await remove.click();
            const confirmation = page.getByRole('dialog', {
              name: en.settings.confirmRemoveNetwork.replace(
                '{{networkName}}',
                `Bitcoin (UTXO · ${en.settings.chainNumber.replace(
                  '{{chainId}}',
                  '0'
                )})`
              ),
              exact: true,
            });
            await expect(confirmation).toBeVisible();
            await confirmation
              .getByRole('button', { name: en.buttons.remove, exact: true })
              .click();
            await expect(confirmation).toHaveCount(0);
            await expect
              .poll(() => publicNetworkState(page, scenario.chainId))
              .toEqual({ ...onboarded, live: null, stored: null });
            await expect(row).toHaveCount(0);
            observations.afterRemoval = await publicNetworkState(
              page,
              scenario.chainId
            );
            // The loaded Manage Networks footer is the final Close button;
            // its native action returns to the same Home predecessor.
            await page
              .getByRole('button', { name: en.buttons.close, exact: true })
              .last()
              .click();
            await expect(page).toHaveURL(/#\/home$/);
          } else {
            expect(onboarded.live).toMatchObject({
              chainId: 57,
              kind: 'syscoin',
            });
            expect(onboarded.stored).toEqual(onboarded.live);
          }
          before = await publicNetworkState(page, scenario.chainId);
          expect(before).toEqual(
            scenario.save
              ? { ...onboarded, live: null, stored: null }
              : onboarded
          );
          observations.before = before;
          await trigger.click();
          await page
            .getByRole('menuitem', {
              name: en.networkMenu.customRpc,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
          const toggle = page.getByRole('switch', {
            name: en.settings.networkFamilyLabel.replace(
              '{{family}}',
              'Syscoin'
            ),
            exact: true,
          });
          await expect(toggle).toHaveAttribute('aria-checked', 'false');
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-checked', 'true');
          await expect(labelInput).toHaveValue('');
          await expect(chainInput).toHaveValue('');
          await expect(symbolInput).toHaveValue('');
        }
      );
      await wallet.step(
        'blur the manually entered Blockbook URL and show its real detected identity',
        async (capture) => {
          phase = 'manual-discovery';
          if (scenario.typedLabel) await labelInput.fill(scenario.typedLabel);
          await rpcInput.fill(rpc);
          await rpcInput.press('Tab');
          await expect
            .poll(() => reads.some((read) => read.phase === phase))
            .toBe(true);
          // No extra input interaction or rerender is needed to display the
          // asynchronously populated label and a legitimate numeric zero ID.
          await expect(labelInput).toHaveValue(label);
          await expect(chainInput).toHaveAttribute('readonly');
          await expect(chainInput).toHaveValue(String(scenario.chainId));
          await expect(symbolInput).toHaveValue(
            scenario.currency.toUpperCase()
          );
          await expect(rpcInput).toHaveValue(rpc);
          await expect(page.getByRole('listbox')).toBeHidden();
          expect(await publicNetworkState(page, scenario.chainId)).toEqual(
            before
          );
          observations.detected = {
            label: await labelInput.inputValue(),
            chainId: await chainInput.inputValue(),
            symbol: await symbolInput.inputValue(),
            url: await rpcInput.inputValue(),
            state: await publicNetworkState(page, scenario.chainId),
          };
          await capture(page);
        }
      );
      if (scenario.save) {
        const expected = {
          chainId: 0,
          currency: 'btc',
          default: false,
          explorer: rpc,
          kind: 'syscoin',
          label,
          slip44: 0,
          url: rpc,
        };
        await wallet.step(
          'save the detected Bitcoin registration through the real controller',
          async () => {
            phase = 'save';
            await page
              .getByRole('button', { name: en.buttons.save, exact: true })
              .click();
            await expect(page).toHaveURL(/#\/home$/);
            await expect
              .poll(() => publicNetworkState(page, scenario.chainId))
              .toEqual({ ...before, live: expected, stored: expected });
            observations.saved = await publicNetworkState(
              page,
              scenario.chainId
            );
          }
        );
        await wallet.step(
          'reload and reopen the persisted Bitcoin registration from Manage Networks',
          async (capture) => {
            phase = 'reopen';
            await page.reload();
            await wallet!.waitAppReady();
            if (await page.locator('#unlock-btn').isVisible())
              await wallet!.unlock();
            await wallet!.ensureOnHome();
            expect(await publicNetworkState(page, scenario.chainId)).toEqual(
              observations.saved
            );
            await trigger.click();
            await page
              .getByRole('menuitem', {
                name: en.networkMenu.manageNetworks,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
            const row = page
              .locator('li')
              .filter({ has: page.getByText(label, { exact: true }) });
            await expect(row).toHaveCount(1);
            await row.locator('button').first().click();
            await expect(rpcInput).toHaveValue(rpc);
            await expect(chainInput).toHaveValue('0');
            await expect(symbolInput).toHaveValue('BTC');
            await expect(page.locator('input#rpc_explorer')).toHaveValue(rpc);
            observations.reopened = await publicNetworkState(
              page,
              scenario.chainId
            );
            await capture(page);
          }
        );
      } else {
        // Syscoin mainnet is already a default registration. The healthy
        // nonzero discovery control must not replace it merely by inspecting
        // another endpoint, and this case deliberately does not click Save.
        expect(await publicNetworkState(page, scenario.chainId)).toEqual(
          before
        );
      }
      expect(reads.length).toBeGreaterThan(0);
      expect(
        reads.every((read) => read.method === 'GET' && read.url === endpoint)
      ).toBe(true);
      expect(unexpectedTargetRequests).toEqual([]);
      expect(attemptedWrites).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      expect(
        createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
      ).toBe(sourceSha256);
      status = 'passed';
    } finally {
      try {
        await info.attach('manual-utxo-discovery-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            scenario,
            runtime,
            sourceSha256,
            blockbookWireSha256: createHash('sha256')
              .update(wire)
              .digest('hex'),
            observations,
            reads,
            unexpectedTargetRequests,
            attemptedWrites,
            failedRequests,
            fixtureReads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            proxyBlocked: server?.blocked || [],
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            signingOrBroadcastRequested: false,
          }),
        });
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          try {
            await server?.close();
          } finally {
            Object.assign(E2E_CONFIG, previous);
          }
        }
      }
    }
  });
}
