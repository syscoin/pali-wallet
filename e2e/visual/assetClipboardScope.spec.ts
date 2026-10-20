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
import {
  SPT_GUID,
  SPT_BALANCE,
  SPT_ORIGIN_CONTRACT,
  SPT_SYMBOL,
  sptFixtureRead,
} from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

async function publicSelection(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { activeAccount, activeNetwork, accountAssets, accounts } =
      state.vault;
    return {
      accountId: activeAccount.id,
      accountType: activeAccount.type,
      accountLabel: accounts[activeAccount.type][activeAccount.id].label,
      chainId: activeNetwork.chainId,
      guids: (
        accountAssets[activeAccount.type][activeAccount.id].syscoin || []
      ).map((asset: any) => String(asset.assetGuid)),
    };
  });
}

for (const outcome of ['success', 'refusal'] as const) {
  test(`SPT clipboard ${outcome} stays with its original account while the real details view is reused`, async ({}, info) => {
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    const runtime = extensionEvidence();
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const fixture = createIsolatedVaultFixture();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'AssetClipboardSynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: unknown[] = [];
    try {
      wallet = await PaliWallet.launch(`asset-clipboard-${outcome}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      // Give the second public test account the same GUID through ordinary
      // explorer reads. No controller reply, Redux state or route props change.
      const asset = (
        sptFixtureRead(
          fixture.utxo,
          `https://blockbook-dev.syscoin.org/api/v2/asset/${SPT_GUID}`,
          'GET'
        ) as any
      ).asset;
      await wallet.context.route(
        (url) =>
          [
            'https://blockbook-dev.syscoin.org',
            'https://explorer-blockbook-dev.syscoin.org',
          ].includes(url.origin) &&
          [
            `/api/v2/xpub/${fixture.secondUtxo.xpub}`,
            `/api/v2/address/${fixture.secondUtxo.address}`,
          ].includes(url.pathname),
        (route) =>
          route.request().method() !== 'GET'
            ? route.fallback()
            : route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*' },
                body: JSON.stringify({
                  address: decodeURIComponent(
                    new URL(route.request().url()).pathname.split('/').pop()!
                  ),
                  balance: '0',
                  unconfirmedBalance: '0',
                  totalReceived: '0',
                  totalSent: '0',
                  txs: 0,
                  unconfirmedTxs: 0,
                  tokens: [],
                  tokensAsset: [{ ...asset, balance: '4200000000' }],
                }),
              })
      );
      const page = wallet.page;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const secondLabel = 'Other public SPT account';
      let lastImportNoticeAt = 0;
      const select = async (target: Page, id: number) => {
        await target.locator('#general-settings-button').click();
        await target.locator(`#account-HDAccount-${id}`).click();
        await expect(target.locator('#home-balance')).toBeVisible();
        await expect
          .poll(() => publicSelection(target))
          .toMatchObject({
            accountId: id,
            accountType: 'HDAccount',
            chainId: 5700,
          });
      };
      const importSpt = async () => {
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        const button = page.getByRole('button', {
          name: `Import ${SPT_SYMBOL} token`,
          exact: true,
        });
        await expect(button).toBeEnabled();
        if (lastImportNoticeAt) {
          // The app deliberately deduplicates identical notices for 2 seconds.
          // Keep each import's positive feedback control outside that window.
          await expect
            .poll(() => page.evaluate(() => Date.now()))
            .toBeGreaterThanOrEqual(lastImportNoticeAt + 2000);
        }
        await button.click();
        await expect
          .poll(() => publicSelection(page))
          .toMatchObject({
            guids: [SPT_GUID],
          });
        const successNotice = page.getByText(
          en.tokens.hasBeenAddedToYourWallet.replace('{{token}}', SPT_SYMBOL),
          { exact: true }
        );
        await expect(successNotice).toBeVisible();
        lastImportNoticeAt = await page.evaluate(() => Date.now());
        // The real app omits a close button and dismisses toasts on click.
        await successNotice.click();
        await expect(successNotice).toBeHidden();
        await expect(button).toBeDisabled();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await wallet!.ensureOnHome();
        expect((await publicSelection(page)).guids).toContain(SPT_GUID);
      };
      await wallet.step(
        'import the same public SPT into two ordinary accounts',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await importSpt();
          await page.locator('#general-settings-button').click();
          await page
            .getByText(en.accountMenu.createNewAccount, { exact: true })
            .click();
          await page.locator('#account-name-input').fill(secondLabel);
          await page.locator('#create-btn').click();
          await page.getByRole('button', { name: /^ok$/i }).first().click();
          await wallet!.ensureOnHome();
          await importSpt();
          await select(page, 0);
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', {
              name: `View details for ${SPT_SYMBOL} token`,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/home\/details/);
          const firstBalance = page
            .getByText('Balance', { exact: true })
            .locator('..');
          await expect(
            firstBalance.locator('span.text-brand-white')
          ).toHaveAttribute('title', SPT_BALANCE);
          await expect(
            firstBalance.locator('span.text-brand-white')
          ).not.toHaveAttribute('title', '42.0');
          await expect(
            page.getByTitle(en.send.copyContractAddress)
          ).toBeVisible();
        }
      );
      await page.evaluate(
        ({ contract, firstOutcome }) => {
          const original = navigator.clipboard.writeText.bind(
            navigator.clipboard
          );
          const observed: string[] = [];
          const writes: {
            nativeCompleted: boolean;
            settled: boolean;
            text: string;
          }[] = [];
          let held:
            | { reject: (error: Error) => void; resolve: () => void }
            | undefined;
          let holdNext = true;
          const observe = () => {
            document
              .querySelectorAll('.Toastify__toast-body')
              .forEach((node) => {
                const text = node.textContent || '';
                if (!observed.includes(text)) observed.push(text);
              });
          };
          const observer = new MutationObserver(observe);
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
          });
          // Only public clipboard IO is controlled. Successful writes execute
          // the real native method inside the click before completion is held.
          navigator.clipboard.writeText = async (text: string) => {
            if (text !== contract)
              throw new Error('Unexpected non-public clipboard value');
            const entry = { text, nativeCompleted: false, settled: false };
            writes.push(entry);
            const shouldHold = holdNext;
            holdNext = false;
            if (!shouldHold || firstOutcome === 'success') {
              await original(text);
              entry.nativeCompleted = true;
            }
            try {
              if (shouldHold)
                await new Promise<void>((resolve, reject) => {
                  held = { resolve, reject };
                });
            } finally {
              entry.settled = true;
            }
          };
          (window as any).__assetClipboard = {
            snapshot: () => {
              observe();
              return { writes, observed, held: !!held };
            },
            release: () => {
              if (!held) throw new Error('No clipboard completion is pending');
              const pending = held;
              held = undefined;
              if (firstOutcome === 'success') pending.resolve();
              else
                pending.reject(new Error('Synthetic native clipboard refusal'));
            },
            restore: () => {
              navigator.clipboard.writeText = original;
              observer.disconnect();
              held?.resolve();
              held = undefined;
            },
          };
        },
        { contract: SPT_ORIGIN_CONTRACT, firstOutcome: outcome }
      );
      const copy = page.getByTitle(en.send.copyContractAddress);
      const originalCopy = await copy.elementHandle();
      await wallet.step(
        'hold a public copy and change the real account in another wallet view',
        async () => {
          await copy.click();
          await expect
            .poll(() =>
              page.evaluate(() => (window as any).__assetClipboard.snapshot())
            )
            .toMatchObject({
              held: true,
              writes: [{ text: SPT_ORIGIN_CONTRACT, settled: false }],
            });
          const control = await wallet!.context.newPage();
          try {
            await control.goto(wallet!.appUrl('#/home'));
            await expect(control.locator('#home-balance')).toBeVisible();
            await select(control, 1);
          } finally {
            await control.close();
          }
          await expect
            .poll(() => publicSelection(page))
            .toMatchObject({
              accountId: 1,
              accountLabel: secondLabel,
              guids: [SPT_GUID],
            });
          // AccountHeader intentionally exists only on /home. The details
          // route instead proves its renderer received account 1 by displaying
          // that account's distinct HTTP-backed asset balance.
          const secondBalance = page
            .getByText('Balance', { exact: true })
            .locator('..');
          await expect(
            secondBalance.locator('span.text-brand-white')
          ).toHaveText('42');
          await expect(
            secondBalance.locator('span.text-brand-white')
          ).toHaveAttribute('title', '42.0');
          await expect(secondBalance).toContainText('TSPT');
          await expect(page).toHaveURL(/#\/home\/details/);
          await expect(copy).toBeVisible();
          expect(
            await originalCopy!.evaluate((element) => element.isConnected)
          ).toBe(true);
          expect(
            await copy.evaluate(
              (element, originalElement) => element === originalElement,
              originalCopy
            )
          ).toBe(true);
        }
      );
      await wallet.step(
        'retire old feedback and preserve a genuine current-account copy',
        async (capture) => {
          await page.bringToFront();
          await page.evaluate(async () => {
            (window as any).__assetClipboard.release();
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          });
          const stale = await page.evaluate(() =>
            (window as any).__assetClipboard.snapshot()
          );
          observations.push({ phase: 'old-completion', ...stale });
          expect(stale.observed).not.toContain(en.home.contractCopied);
          expect(stale.observed).not.toContain(en.transactions.copyFailed);
          expect(stale.writes).toEqual([
            {
              text: SPT_ORIGIN_CONTRACT,
              nativeCompleted: outcome === 'success',
              settled: true,
            },
          ]);
          await copy.click();
          await expect(
            page.getByText(en.home.contractCopied, { exact: true })
          ).toBeVisible();
          const healthy = await page.evaluate(() =>
            (window as any).__assetClipboard.snapshot()
          );
          observations.push({ phase: 'current-completion', ...healthy });
          expect(healthy.writes).toEqual([
            {
              text: SPT_ORIGIN_CONTRACT,
              nativeCompleted: outcome === 'success',
              settled: true,
            },
            { text: SPT_ORIGIN_CONTRACT, nativeCompleted: true, settled: true },
          ]);
          expect(healthy.observed).not.toContain(en.transactions.copyFailed);
          await capture(page);
        }
      );
      expect(errors).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        if (wallet && !wallet.page.isClosed())
          await wallet.page.evaluate(() =>
            (window as any).__assetClipboard?.restore()
          );
        await info.attach('asset-clipboard-scope-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            ...runtime,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            outcome,
            publicClipboardOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            observations,
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedConnections: server.blocked.length,
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
}
