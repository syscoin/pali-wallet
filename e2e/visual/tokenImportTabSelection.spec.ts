import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Native import-tab semantics in the sole fenced browser worker. The known isolated
// fixture supplies ordinary UTXO/SPT and NEVM reads. The launch-time proxy never
// forwards unknown traffic. No DOM attributes, Redux state, selected state,
// controller response or account metadata are changed by this test.
const names = [en.tokens.yourTokens, en.tokens.addCustomTab];

async function nativeTabState(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'button',
    });
    const result: Record<
      string,
      {
        name: string;
        pressed: unknown;
        role: string;
        selected: unknown;
      }
    > = {};
    // The tab strip is before the scrollable content. The empty-discovery
    // convenience button may share Add Custom's name, so keep the first native
    // button with each exact name, matching the Playwright locators below.
    for (const nodeId of nodeIds) {
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
        nodeId,
        fetchRelatives: false,
      });
      const node = nodes.find(
        (item) =>
          item.role?.value === 'button' &&
          !item.ignored &&
          names.includes(item.name?.value) &&
          !result[item.name?.value]
      );
      if (!node) continue;
      result[node.name!.value] = {
        role: node.role!.value,
        name: node.name!.value,
        pressed:
          node.properties?.find((value) => value.name === 'pressed')?.value
            ?.value ?? null,
        selected:
          node.properties?.find((value) => value.name === 'selected')?.value
            ?.value ?? null,
      };
    }
    for (const name of names)
      expect(result[name], `Native tab: ${name}`).toBeDefined();
    return result;
  } finally {
    await cdp.detach();
  }
}

test('token import tabs expose native selected state across UTXO and EVM views', async ({}, info) => {
  test.setTimeout(180_000);
  expect(process.version).toBe('v23.11.1');
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
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ImportTabSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = { runtime, sourceSha256 };
  const pageErrors: string[] = [];
  const forbiddenRequests: string[] = [];
  try {
    wallet = await PaliWallet.launch('token-import-tab-selection', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (value) => {
        observations.workerIdentity = value;
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('request', (request) => {
      if (/\/sendtx(?:\/|$)/i.test(request.url()))
        forbiddenRequests.push('sendtx');
      try {
        const body = request.postDataJSON();
        for (const call of Array.isArray(body) ? body : [body])
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
            forbiddenRequests.push(call.method);
      } catch {
        /* ordinary GET */
      }
    });
    await wallet.step(
      'onboard the public synthetic wallet behind the launch-time deny proxy',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('0.001');
      }
    );

    for (const scenario of [
      {
        key: 'utxo',
        label: 'Syscoin Testnet',
        family: 'UTXO',
        input: '#custom-spt-guid',
      },
      {
        key: 'evm',
        label: 'Syscoin NEVM Testnet',
        family: 'EVM',
        input: '#custom-token-contract',
      },
    ] as const) {
      await wallet.step(
        `${scenario.key}: open ordinary Import Token from Assets`,
        async () => {
          await wallet!.switchNetwork(scenario.label, scenario.family);
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/tokens\/add(?:\?.*)?$/);
          await expect(
            page.getByRole('button', { name: names[0], exact: true }).first()
          ).toBeVisible();
          await expect(
            page.getByRole('button', { name: names[1], exact: true }).first()
          ).toBeVisible();
        }
      );
      await wallet.step(
        `${scenario.key}: read native selected state and healthy click transitions`,
        async () => {
          const owned = page
            .getByRole('button', { name: names[0], exact: true })
            .first();
          const custom = page
            .getByRole('button', { name: names[1], exact: true })
            .first();
          await owned.click();
          await expect(page.locator(scenario.input)).toHaveCount(0);
          const ownedState = await nativeTabState(wallet!.context, page);
          await custom.click();
          await expect(page).toHaveURL(/#\/tokens\/add\?[^#]*tab=custom/);
          await expect(page.locator(scenario.input)).toBeVisible();
          const customState = await nativeTabState(wallet!.context, page);
          await owned.click();
          await expect(page).toHaveURL(/#\/tokens\/add\?[^#]*tab=owned/);
          await expect(page.locator(scenario.input)).toHaveCount(0);
          const returnedState = await nativeTabState(wallet!.context, page);
          observations[scenario.key] = {
            ownedState,
            customState,
            returnedState,
          };
          // Soft assertions deliberately retain all UTXO and healthy EVM
          // observations in a baseline run, without manufacturing selected state.
          for (const [phase, state, ownedPressed] of [
            ['owned', ownedState, true],
            ['custom', customState, false],
            ['returned', returnedState, true],
          ] as const) {
            expect
              .soft(
                String(state[names[0]].pressed),
                `${scenario.key} ${phase}: Your Tokens AX pressed`
              )
              .toBe(String(ownedPressed));
            expect
              .soft(
                String(state[names[1]].pressed),
                `${scenario.key} ${phase}: Add Custom AX pressed`
              )
              .toBe(String(!ownedPressed));
          }
          expect(forbiddenRequests).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
        }
      );
      await page
        .getByRole('button', { name: en.buttons.back, exact: true })
        .click();
      await wallet!.ensureOnHome();
    }
    expect(pageErrors).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
    await info.attach('token-import-tab-selection-evidence', {
      body: Buffer.from(
        JSON.stringify(
          {
            ...observations,
            pageErrors,
            forbiddenRequests,
            deniedWrites: routes?.deniedWrites,
            readCount: routes?.reads.length ?? 0,
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });
    try {
      await wallet?.dispose(status);
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, before);
      }
    }
  }
});
