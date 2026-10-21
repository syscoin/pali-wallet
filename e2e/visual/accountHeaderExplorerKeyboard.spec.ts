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

const publicIdentity = (page: Page) =>
  page.evaluate(async () => {
    const { vault } = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const account =
      vault.accounts[vault.activeAccount.type][vault.activeAccount.id];
    return {
      address: account.address,
      xpub: account.xpub,
      account: vault.activeAccount,
      isBitcoinBased: vault.isBitcoinBased,
      chainId: vault.activeNetwork.chainId,
      explorer: vault.activeNetwork.explorer,
    };
  });

test('account explorer header supports click, Enter and Space for EVM addresses and UTXO xpubs', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'HeaderExplorerSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let phase = 'onboarding';
  const attempts: {
    method: string;
    phase: string;
    resource: string;
    url: string;
  }[] = [];
  const observations: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('account-header-explorer-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        url.origin !== server.url &&
        request.isNavigationRequest() &&
        request.resourceType() === 'document'
      ) {
        // Observe the real new-tab navigation, but never connect to an explorer.
        attempts.push({
          phase,
          url: request.url(),
          method: request.method(),
          resource: request.resourceType(),
        });
        return route.abort('blockedbyclient');
      }
      return route.fallback();
    });
    const page = wallet.page;
    await wallet.step('onboard the disposable fenced wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.ensureOnHome();
    });
    for (const entry of [
      {
        label: 'Syscoin NEVM Testnet',
        group: 'EVM',
        bitcoinBased: false,
        explorer: 'https://explorer.tanenbaum.io/',
        expectedUrl: `https://explorer.tanenbaum.io/address/${fixture.evmAddresses[0]}`,
      },
      {
        label: 'Syscoin Testnet',
        group: 'UTXO',
        bitcoinBased: true,
        explorer: 'https://explorer-blockbook-dev.syscoin.org/',
        expectedUrl: `https://explorer-blockbook-dev.syscoin.org/xpub/${fixture.utxo.userXpub}`,
      },
    ] as const) {
      await wallet.step(
        `${entry.group} account header exposes a native explorer button`,
        async () => {
          await wallet!.switchNetwork(entry.label, entry.group);
          await wallet!.ensureOnHome();
          const identity = await publicIdentity(page);
          expect(identity.account).toEqual({ id: 0, type: 'HDAccount' });
          expect(identity.isBitcoinBased).toBe(entry.bitcoinBased);
          expect(identity.chainId).toBe(5700);
          expect(identity.explorer?.replace(/\/$/, '')).toBe(
            entry.explorer.replace(/\/$/, '')
          );
          if (entry.bitcoinBased)
            expect(identity.xpub).toBe(fixture.utxo.userXpub);
          else expect(identity.address).toBe(fixture.evmAddresses[0]);
          const control = page.getByRole('button', {
            name: en.home.viewAccountOnExplorer,
            exact: true,
          });
          await expect(control).toBeVisible();
          await expect(control).toHaveAttribute('type', 'button');
          for (const activation of ['click', 'Enter', 'Space']) {
            phase = `${entry.group}-${activation}`;
            let tabs = 0;
            if (activation !== 'click') {
              do {
                await page.keyboard.press('Tab');
                tabs += 1;
              } while (
                tabs < 30 &&
                !(await control.evaluate(
                  (node) => node === document.activeElement
                ))
              );
              await expect(control).toBeFocused();
            }
            const before = attempts.length;
            const existingPages = new Set(wallet!.context.pages());
            const popups: Page[] = [];
            const recordPopup = (popup: Page) => popups.push(popup);
            page.on('popup', recordPopup);
            try {
              const [popup] = await Promise.all([
                page.waitForEvent('popup'),
                activation === 'click'
                  ? control.click()
                  : page.keyboard.press(activation),
              ]);
              await expect.poll(() => attempts.length).toBe(before + 1);
              expect(attempts[before]).toEqual({
                phase,
                url: entry.expectedUrl,
                method: 'GET',
                resource: 'document',
              });
              expect(popups).toEqual([popup]);
              expect(existingPages.has(popup)).toBe(false);
              expect(await popup.opener()).toBe(page);
              expect(popup.mainFrame().parentFrame()).toBeNull();
              expect(
                wallet!.context
                  .pages()
                  .filter((candidate) => !existingPages.has(candidate))
              ).toEqual([popup]);
              expect(await publicIdentity(page)).toEqual(identity);
              observations.push({
                phase,
                tabs,
                requestedUrl: attempts[before].url,
                observedPopupUrl: popup.url(),
                newPages: 1,
              });
            } finally {
              page.off('popup', recordPopup);
              for (const popup of wallet!.context.pages())
                if (!existingPages.has(popup) && !popup.isClosed())
                  await popup.close();
              if (!page.isClosed()) await page.bringToFront();
            }
          }
        }
      );
    }
    expect(attempts).toHaveLength(6);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('account-header-explorer-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          runtime: extensionEvidence(),
          sourceSha256: createHash('sha256')
            .update(fs.readFileSync(info.file))
            .digest('hex'),
          observations,
          attempts,
          deniedWrites: routes?.deniedWrites ?? [],
          proxyDeniedConnections: server.blocked.length,
          syntheticWallet: true,
          explorerRequestsAborted: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          windowOpenReplaced: false,
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
