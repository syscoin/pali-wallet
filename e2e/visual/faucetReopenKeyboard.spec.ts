import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { getAddress } from 'ethers';
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

const NETWORK = 'Syscoin NEVM Testnet';
const RPC = 'https://rpc.tanenbaum.io/';
const BANNER = en.faucet.grabTextTwo.replace('{{token}}', 'TSYS');
const FIRST_ACCESS = en.faucet.firstAccessTitle
  .replace('{{token}}', 'TSYS')
  .replace('{{network}}', NETWORK);

// Read only the public fields that establish eligibility and target identity.
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const current = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const { activeAccount, activeNetwork, accounts } = current.vault;
    const account = accounts[activeAccount.type][activeAccount.id];
    return {
      account: { ...activeAccount, address: account.address },
      balance: account.balances?.ethereum,
      chainId: activeNetwork.chainId,
      kind: activeNetwork.kind,
      url: activeNetwork.url,
      status: current.vaultGlobal.networkStatus,
      loading: current.vaultGlobal.isPostNetworkSwitchLoading,
      switching: current.vaultGlobal.isSwitchingAccount,
      firstAccess: Boolean(
        current.vault.shouldShowFaucetModal?.[activeNetwork.chainId]
      ),
    };
  });

async function tabTo(page: Page, target: Locator) {
  // No focus() or synthetic key handler: traverse the real page tab order.
  for (
    let index = 0;
    index < 32 &&
    !(await target.evaluate((element) => element === document.activeElement));
    index++
  )
    await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
}

test('the dismissed Home faucet banner reopens by Tab with Enter and Space', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
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
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  const zeroBalanceReads: Array<{ address: string; block: string }> = [];
  const deniedBalanceReads: unknown[] = [];
  const forbiddenRequests: string[] = [];
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'FaucetKeyboardSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('faucet-reopen-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    wallet.context.on('request', (request) => {
      let body: any;
      try {
        body = request.postDataJSON();
      } catch {
        body = null;
      }
      const calls = Array.isArray(body) ? body : [body];
      if (
        new URL(request.url()).pathname.startsWith('/api/faucet/claim') ||
        calls.some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      )
        forbiddenRequests.push(request.url());
    });
    // This exact read endpoint supplies zero, not a state/controller override.
    // All other traffic retains the existing deny-by-default fixture policy.
    await wallet.context.route(RPC, async (route) => {
      let payload: any;
      try {
        payload = route.request().postDataJSON();
      } catch {
        return route.fallback();
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (!calls.some((call) => call?.method === 'eth_getBalance'))
        return route.fallback();
      const replies = calls.map((call) => {
        if (
          route.request().method() !== 'POST' ||
          call?.jsonrpc !== '2.0' ||
          call.method !== 'eth_getBalance' ||
          !Array.isArray(call.params) ||
          call.params.length !== 2 ||
          !fixture.evmAddresses.some(
            (address) =>
              address.toLowerCase() === String(call.params[0]).toLowerCase()
          ) ||
          call.params[1] !== 'latest'
        )
          return undefined;
        zeroBalanceReads.push({
          address: call.params[0],
          block: call.params[1],
        });
        return { jsonrpc: '2.0', id: call.id, result: '0x0' };
      });
      if (!calls.length || replies.some((reply) => !reply)) {
        deniedBalanceReads.push(payload);
        return route.abort('blockedbyclient');
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    const banner = page.getByRole('button', { name: BANNER, exact: true });
    const prompt = page.getByRole('dialog', {
      name: FIRST_ACCESS,
      exact: true,
    });
    const back = page.getByRole('button', {
      name: en.buttons.back,
      exact: true,
    });
    const requestNow = page.getByRole('button', {
      name: en.faucet.requestNow,
      exact: true,
    });
    const assertFaucet = async () => {
      await expect(page).toHaveURL(/#\/faucet$/);
      await expect(requestNow).toBeVisible();
      await expect(requestNow).toBeEnabled();
      expect(await publicState(page)).toEqual(observations.eligible);
      expect(forbiddenRequests).toEqual([]);
    };

    await wallet.step(
      'faucet-keyboard: onboard the disposable wallet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      }
    );
    await wallet.step(
      'faucet-keyboard: select the zero-balance EVM network and dismiss first access',
      async () => {
        // Select directly through the real menu: switchNetwork() intentionally
        // dismisses this informational dialog before returning to its caller.
        const networkMenu = page
          .getByRole('button')
          .filter({ hasText: /UTXO|EVM/ })
          .first();
        await networkMenu.click();
        const menu = page.getByRole('menu');
        const evm = menu
          .getByRole('menuitem', { name: /EVM Networks/i })
          .first();
        if ((await evm.getAttribute('aria-expanded')) !== 'true')
          await evm.click();
        await menu
          .getByRole('menuitem', { name: NETWORK, exact: true })
          .click();
        await expect(prompt).toBeVisible();
        await expect(
          prompt.getByRole('button', {
            name: en.faucet.grabTokens,
            exact: true,
          })
        ).toBeEnabled();
        await prompt
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await expect(prompt).toHaveCount(0);
        await expect(banner).toBeVisible();
        await expect(banner).toBeEnabled();
        await expect
          .poll(() => publicState(page))
          .toMatchObject({
            chainId: 5700,
            kind: 'ethereum',
            url: RPC.slice(0, -1),
            // The real balance controller returns ethers.formatEther(0n).
            balance: '0.0',
            status: 'idle',
            loading: false,
            switching: false,
            firstAccess: false,
          });
        const eligible = await publicState(page);
        expect(fixture.evmAddresses).toContain(eligible.account.address);
        await expect(page.locator('#home-balance')).toHaveText('0');
        expect(
          zeroBalanceReads.map((read) => ({
            ...read,
            address: getAddress(read.address),
          }))
        ).toEqual(
          expect.arrayContaining([
            {
              address: getAddress(eligible.account.address),
              block: 'latest',
            },
          ])
        );
        observations.eligible = eligible;
      }
    );
    await wallet.step(
      'faucet-keyboard: Tab to the reopen banner and activate Enter',
      async (capture) => {
        await expect(banner).toHaveAttribute('type', 'button');
        await tabTo(page, banner);
        observations.enter = { focused: true, before: await publicState(page) };
        await capture(page);
        await page.keyboard.press('Enter');
        await assertFaucet();
      }
    );
    await wallet.step(
      'faucet-keyboard: return Home and activate the same banner with Space',
      async (capture) => {
        await back.click();
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expect(prompt).toHaveCount(0);
        await expect(banner).toBeVisible();
        await tabTo(page, banner);
        observations.space = { focused: true, before: await publicState(page) };
        await capture(page);
        await page.keyboard.press('Space');
        await assertFaucet();
      }
    );
    await wallet.step(
      'faucet-keyboard: retain the ordinary pointer reopen control',
      async () => {
        await back.click();
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expect(prompt).toHaveCount(0);
        await banner.click();
        await assertFaucet();
        observations.pointer = { route: new URL(page.url()).hash };
      }
    );
    await wallet.step(
      'faucet-keyboard: unsupported UTXO has no faucet and all traffic remains read-only',
      async () => {
        await back.click();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expect(banner).toHaveCount(0);
        await expect(prompt).toHaveCount(0);
        await expect(requestNow).toHaveCount(0);
        observations.unsupported = await publicState(page);
        expect(observations.unsupported).toMatchObject({
          chainId: 5700,
          kind: 'syscoin',
          status: 'idle',
          loading: false,
          switching: false,
        });
        expect(forbiddenRequests).toEqual([]);
        expect(deniedBalanceReads).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(routes!.reads).toContain(
          'synthetic-evm:eth_getTransactionCount'
        );
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(testSourceSha256);
      }
    );
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    try {
      await info.attach('faucet-reopen-keyboard-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            runtime,
            testSourceSha256,
            status,
            syntheticResponsesOnly: true,
            faucetClaimsRequested: false,
            controllerMutationsInjected: false,
            controllerResultsReplaced: false,
            observations,
            zeroBalanceReads,
            deniedBalanceReads,
            forbiddenRequests,
            deniedWrites: routes?.deniedWrites,
            fixtureReads: routes?.reads,
            proxyBlocked: server?.blocked,
          },
          null,
          2
        ),
      });
    } catch (error) {
      status = 'failed';
      throw error;
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
