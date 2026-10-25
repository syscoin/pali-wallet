import { expect, test, type Page } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Real provider requests, isolated wallet state and launch-time network denial.
for (const width of [400, 320]) {
  test(`external network consent keeps metadata readable and unobscured at ${width}`, async ({}, info) => {
    test.setTimeout(120000);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'NetworkConsentSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`full-consent-network-${width}`, {
        offlineHttpProxy: server.url,
        viewport: { width, height: width === 320 ? 360 : 620 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      const customRpc = 'https://consent-network.synthetic.invalid/';
      await wallet.context.route(customRpc, async (route) => {
        const payload = route.request().postDataJSON();
        const calls = Array.isArray(payload) ? payload : [payload];
        const replies = calls.map((call: any) => ({
          jsonrpc: '2.0',
          id: call.id,
          result:
            call.method === 'eth_chainId'
              ? '0x3441'
              : call.method === 'eth_getBalance'
              ? '0x0'
              : call.method === 'eth_blockNumber'
              ? '0x10'
              : call.method === 'eth_getCode'
              ? '0x'
              : null,
        }));
        if (
          calls.some((call: any) =>
            /^(eth_send|wallet_send|personal_|eth_sign)/.test(call.method)
          )
        )
          return route.abort('blockedbyclient');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
        });
      });
      let dapp!: Page;
      await wallet.step(
        'import the isolated wallet and connect the real fixture provider',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          dapp = await wallet!.context.newPage();
          await dapp.goto(server.url);
          await dapp.waitForFunction(() =>
            Boolean((window as any).pali?.request)
          );
          await approve(
            wallet!.context,
            dapp,
            await startRequest(dapp, 'eth_requestAccounts')
          );
          await wallet!.page.goto('about:blank');
        }
      );
      const request = [
        {
          chainId: '0x3441',
          chainName: 'Public synthetic network',
          rpcUrls: [customRpc],
          nativeCurrency: {
            name: 'Synthetic Coin',
            symbol: 'SYN',
            decimals: 18,
          },
        },
      ];
      await wallet.step(
        'cancel a real add-network request without changing selection',
        async (capture) => {
          const id = await startRequest(
            dapp,
            'wallet_addEthereumChain',
            request
          );
          const popup = await popupFor(wallet!.context, dapp, id);
          await popup.setViewportSize({
            width,
            height: width === 320 ? 360 : 620,
          });
          await expect(
            popup.getByRole('button', { name: /^cancel$/i })
          ).toBeEnabled();
          await capture(popup);
          await info.attach(`network-add-cancel-${width}`, {
            body: await popup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await clickClosingPopup({
            click: () =>
              popup.getByRole('button', { name: /^cancel$/i }).click(),
            isClosed: () => popup.isClosed(),
          });
          expect((await settle(dapp, id)).error?.code).toBe(4001);
        }
      );
      await wallet.step(
        'approve the same real add-network request',
        async (capture) => {
          const id = await startRequest(
            dapp,
            'wallet_addEthereumChain',
            request
          );
          const result = await approve(
            wallet!.context,
            dapp,
            id,
            async (popup) => {
              await popup.setViewportSize({
                width,
                height: width === 320 ? 360 : 620,
              });
              await info.attach(`network-add-confirm-${width}`, {
                body: await popup.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              });
              await capture(popup);
            }
          );
          expect(result.result).toBeNull();
        }
      );
      await wallet.step(
        'switch back through the real Ethereum chain consent',
        async (capture) => {
          const id = await startRequest(dapp, 'wallet_switchEthereumChain', [
            { chainId: '0x1644' },
          ]);
          const result = await approve(
            wallet!.context,
            dapp,
            id,
            async (popup) => {
              await popup.setViewportSize({
                width,
                height: width === 320 ? 360 : 620,
              });
              await info.attach(`network-switch-${width}`, {
                body: await popup.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              });
              await capture(popup);
            }
          );
          expect(result.result).toBeNull();
        }
      );
      await wallet.step(
        'explicit UTXO family switch uses its genuine consent',
        async (capture) => {
          const id = await startRequest(dapp, 'sys_changeUTXOEVM', [
            { chainId: 5700 },
          ]);
          const popup = await popupFor(wallet!.context, dapp, id);
          await popup.setViewportSize({
            width,
            height: width === 320 ? 360 : 620,
          });
          await expect(
            popup.getByRole('button', { name: en.buttons.change, exact: true })
          ).toBeEnabled();
          await info.attach(`network-family-switch-${width}`, {
            body: await popup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await capture(popup);
          await popup.mouse.move(100, 180);
          await popup.mouse.wheel(0, 1000);
          await popup.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
              )
          );
          const review = await popup.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'))
              .filter((e) =>
                ['Cancel', 'Change'].includes(e.textContent?.trim() || '')
              )
              .map((e) => ({
                text: e.textContent,
                rect: e.getBoundingClientRect().toJSON(),
              }));
            const spans = [];
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT
            );
            let node;
            while ((node = walker.nextNode())) {
              const text = node.textContent?.trim() || '';
              if (
                ![
                  'Syscoin NEVM Testnet',
                  'Syscoin Testnet',
                  'https://blockbook-dev.syscoin.org/',
                  '5700',
                ].includes(text)
              )
                continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              const r = range.getBoundingClientRect();
              const e = node.parentElement!;
              const hit = document.elementFromPoint(
                r.left + r.width / 2,
                r.top + r.height / 2
              );
              let parent: Element | null = e;
              let bg = '';
              while (parent) {
                const value = getComputedStyle(parent).backgroundColor;
                if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
                  bg = value;
                  break;
                }
                parent = parent.parentElement;
              }
              spans.push({
                text,
                rect: r.toJSON(),
                hit: hit?.tagName,
                exposed: !!hit && (e === hit || e.contains(hit)),
                color: getComputedStyle(e).color,
                fontSize: getComputedStyle(e).fontSize,
                background: bg,
              });
            }
            return { buttons, spans };
          });
          const visible = review.spans.filter(
            (span) =>
              span.rect.top >= 0 &&
              span.rect.bottom <= (width === 320 ? 360 : 620)
          );
          expect(visible.length).toBeGreaterThan(0);
          for (const span of visible) {
            expect(
              span.exposed,
              `metadata ${span.text} must not be hidden by the action buttons`
            ).toBe(true);
            for (const button of review.buttons) {
              const separated =
                span.rect.bottom <= button.rect.top ||
                span.rect.top >= button.rect.bottom ||
                span.rect.right <= button.rect.left ||
                span.rect.left >= button.rect.right;
              expect(
                separated,
                `metadata ${span.text} must not overlap ${button.text}`
              ).toBe(true);
            }
          }
          await info.attach(`network-family-bottom-${width}`, {
            body: await popup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await info.attach(`network-family-bottom-${width}-geometry`, {
            body: JSON.stringify(review),
            contentType: 'application/json',
          });
          for (const value of [
            'Syscoin NEVM Testnet',
            'Syscoin Testnet',
            'https://blockbook-dev.syscoin.org/',
            '5700',
          ]) {
            const label = popup
              .locator('span')
              .filter({ hasText: value })
              .first();
            await captureForegroundContrast(
              label,
              info,
              `family-metadata-${width}-${value.replace(/[^a-z0-9]/gi, '-')}`
            );
          }
          await clickClosingPopup({
            click: () =>
              popup
                .getByRole('button', { name: en.buttons.change, exact: true })
                .click(),
            isClosed: () => popup.isClosed(),
          });
          try {
            await expect.poll(() => popup.isClosed()).toBe(true);
            for (let step = 0; step < 5; step++) {
              await expect
                .poll(
                  async () =>
                    Boolean((await rpcObservation(dapp, id)).settled) ||
                    wallet!.context
                      .pages()
                      .some((p) =>
                        p
                          .url()
                          .startsWith(
                            `chrome-extension://${
                              wallet!.extensionId
                            }/external/connect-wallet`
                          )
                      )
                )
                .toBe(true);
              if ((await rpcObservation(dapp, id)).settled) break;
              const next = wallet!.context
                .pages()
                .filter((p) =>
                  p
                    .url()
                    .startsWith(
                      `chrome-extension://${
                        wallet!.extensionId
                      }/external/connect-wallet`
                    )
                )
                .at(-1)!;
              await next.setViewportSize({
                width,
                height: width === 320 ? 360 : 620,
              });
              const confirm = next
                .getByRole('button', { name: en.buttons.confirm, exact: true })
                .last();
              await expect(confirm).toBeEnabled();
              const prior = await next.locator('body').innerText();
              await info.attach(`network-reconnect-${width}-${step}`, {
                body: await next.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              });
              await capture(next);
              await clickClosingPopup({
                click: () => confirm.click(),
                isClosed: () => next.isClosed(),
              });
              await expect
                .poll(
                  async () =>
                    next.isClosed() ||
                    Boolean((await rpcObservation(dapp, id)).settled) ||
                    (await next
                      .locator('body')
                      .innerText()
                      .catch(() => '')) !== prior
                )
                .toBe(true);
            }
            expect((await settle(dapp, id)).error).toBeUndefined();
          } catch (error) {
            const pages = [];
            for (const page of wallet!.context.pages())
              pages.push({
                url: page.url(),
                text: await page
                  .locator('body')
                  .innerText()
                  .catch(() => ''),
              });
            await info.attach(`network-pending-pages-${width}`, {
              body: JSON.stringify({
                pages,
                request: await rpcObservation(dapp, id),
              }),
              contentType: 'application/json',
            });
            throw error;
          }
        }
      );
      await wallet.step(
        'ordinary EVM request from UTXO uses the actual forced network picker',
        async (capture) => {
          const id = await startRequest(dapp, 'eth_requestAccounts');
          const picker = await popupFor(wallet!.context, dapp, id);
          await picker.setViewportSize({
            width,
            height: width === 320 ? 360 : 620,
          });
          await expect(
            picker.locator('[data-navigation-scroll="network-picker"]')
          ).toBeVisible();
          await capture(picker);
          await info.attach(`network-forced-picker-${width}`, {
            body: await picker.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await picker
            .getByRole('button', { name: 'Syscoin NEVM Testnet', exact: true })
            .click();
          await picker
            .getByRole('button', { name: en.buttons.connect, exact: true })
            .click();
          const result = await approve(
            wallet!.context,
            dapp,
            id,
            async (popup) => {
              await popup.setViewportSize({
                width,
                height: width === 320 ? 360 : 620,
              });
              await capture(popup);
            }
          );
          expect(Array.isArray(result.result)).toBe(true);
        }
      );
      expect(routes.deniedWrites).toEqual([]);
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
}
