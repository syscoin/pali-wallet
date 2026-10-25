// Complete-pass supplement: genuine provider requests and RPC wire failures only.
import { expect, test, type Page } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

for (const width of [400, 320]) {
  for (const scenario of [
    'rpc-old-error',
    'rpc-old-success',
    'api',
    'edit',
  ] as const) {
    const oldWrong = scenario === 'rpc-old-error' || scenario === 'edit';
    const isApi = scenario === 'api';
    test(`network validation keeps the current ${scenario} field at ${width}px`, async ({}, info) => {
      test.setTimeout(120000);
      const previous = { ...E2E_CONFIG };
      const server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'RpcOverlapSynthetic!2026',
        rpcUrl: server.url,
      });
      const oldUrl = 'https://old-rpc-overlap.synthetic.invalid/';
      const newUrl = 'https://new-rpc-overlap.synthetic.invalid/';
      const reads: Array<{ method: string; replied?: boolean; url: string }> =
        [];
      const writes: string[] = [];
      const oldApi = 'https://old-api-overlap.synthetic.invalid/api';
      const newApi = 'https://new-api-overlap.synthetic.invalid/api';
      const badMessage = isApi
        ? 'Public synthetic explorer rejection'
        : '13378';
      let release!: () => void;
      let gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let wallet: PaliWallet | undefined;
      let status: 'passed' | 'failed' = 'failed';
      const observations: Record<string, unknown> = {};
      try {
        wallet = await PaliWallet.launch(`rpc-freshness-${scenario}-${width}`, {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width, height: width === 320 ? 360 : 620 },
        });
        const routes = await installIsolatedVaultRoutes(
          wallet.context,
          createIsolatedVaultFixture(),
          server.url
        );
        await wallet.context.route(
          /^https:\/\/(old|new)-(rpc|api)-overlap\.synthetic\.invalid\/(?:api)?(?:\?.*)?$/,
          async (route) => {
            if (route.request().method() === 'GET') {
              const parsed = new URL(route.request().url());
              expect(parsed.pathname).toBe('/api');
              expect(parsed.searchParams.get('module')).toBe('block');
              expect(parsed.searchParams.get('action')).toBe(
                'eth_block_number'
              );
              const old = parsed.origin + parsed.pathname === oldApi;
              const record = {
                url: parsed.origin + parsed.pathname,
                method: 'GET',
                params: [],
                replied: false,
              };
              reads.push(record);
              if (old) await gate;
              await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(
                  old
                    ? { status: '1', message: 'OK', result: '0x10' }
                    : { status: '0', message: 'NOTOK', result: badMessage }
                ),
              });
              record.replied = true;
              return;
            }
            const payload = route.request().postDataJSON();
            const calls = Array.isArray(payload) ? payload : [payload];
            const old = route.request().url().startsWith(oldUrl);
            const records = calls.map((call) => ({
              url: route.request().url(),
              method: call.method,
              params: call.params,
              replied: false,
            }));
            reads.push(...records);
            if (
              calls.some(
                (call) =>
                  ![
                    'eth_chainId',
                    'eth_blockNumber',
                    'eth_getBalance',
                    'eth_getCode',
                    'eth_getBlockByNumber',
                  ].includes(call.method)
              )
            ) {
              writes.push(...calls.map((call) => call.method));
              await route.abort('blockedbyclient');
              return;
            }
            if (old) await gate;
            for (const call of calls) {
              if (call.method === 'eth_getBlockByNumber') {
                const [tag, full] = call.params || [];
                expect(call.params).toHaveLength(2);
                expect(
                  (tag === 'latest' && full === false) ||
                    (/^0x[0-9a-f]+$/.test(tag) &&
                      Number(BigInt(tag)) >= 6 &&
                      Number(BigInt(tag)) <= 16 &&
                      full === true)
                ).toBe(true);
              }
            }
            const wrong = isApi ? false : old ? oldWrong : !oldWrong;
            const replies = calls.map((call) => ({
              jsonrpc: '2.0',
              id: call.id,
              result:
                call.method === 'eth_chainId'
                  ? wrong
                    ? '0x3442'
                    : '0x3441'
                  : call.method === 'eth_blockNumber'
                  ? '0x10'
                  : call.method === 'eth_getCode'
                  ? '0x'
                  : call.method === 'eth_getBlockByNumber'
                  ? {
                      number:
                        call.params[0] === 'latest' ? '0x10' : call.params[0],
                      hash: '0x' + '12'.repeat(32),
                      parentHash: '0x' + '11'.repeat(32),
                      nonce: '0x0000000000000000',
                      timestamp: '0x1',
                      difficulty: '0x0',
                      gasLimit: '0x1c9c380',
                      gasUsed: '0x0',
                      miner: '0x' + '00'.repeat(20),
                      extraData: '0x',
                      transactions: [],
                      baseFeePerGas: '0x3b9aca00',
                    }
                  : '0x0',
            }));
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(
                Array.isArray(payload) ? replies : replies[0]
              ),
            });
            for (const r of records) r.replied = true;
          }
        );
        let dapp!: Page;
        await wallet.step(
          'ordinary wallet import and provider connection',
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
        const id = await startRequest(dapp, 'wallet_addEthereumChain', [
          {
            chainId: '0x3441',
            chainName: 'Public RPC overlap',
            rpcUrls: [
              isApi ? newUrl : 'https://initial-rpc-overlap.synthetic.invalid/',
            ],
            ...(isApi
              ? { apiUrl: 'https://initial-api-overlap.synthetic.invalid/api' }
              : {}),
            nativeCurrency: { name: 'Synthetic', symbol: 'SYN', decimals: 18 },
          },
        ]);
        const popup = await popupFor(wallet.context, dapp, id);
        await popup.setViewportSize({
          width,
          height: width === 320 ? 360 : 620,
        });
        const url = popup.getByPlaceholder(
          isApi
            ? en.settings.blockExplorerApiUrl
            : en.settings.rpcUrlPlaceholder
        );
        const errors = popup.locator('.ant-form-item-explain-error');
        const spinner = popup.getByRole('img', {
          name: 'loading',
          exact: true,
        });
        const view = async () => ({
          url: await url.inputValue(),
          errors: await errors.allTextContents(),
          loading: await spinner.count(),
          invalid: await url.getAttribute('aria-invalid'),
        });
        const settleView = async () => {
          let prior = '',
            stable = 0;
          await expect
            .poll(async () => {
              const now = JSON.stringify(await view());
              stable = now === prior ? stable + 1 : 0;
              prior = now;
              return stable;
            })
            .toBeGreaterThanOrEqual(2);
        };
        const expectCurrentFeedback = async () => {
          if (oldWrong) {
            await expect(errors).toHaveCount(0);
            await expect(url).not.toHaveAttribute('aria-invalid', 'true');
          } else {
            await expect(errors.first()).toContainText(badMessage);
            await expect(url).toHaveAttribute('aria-invalid', 'true');
          }
        };
        const shot = async (name: string) => {
          await popup.bringToFront();
          await url.scrollIntoViewIfNeeded();
          const footerTop = await popup
            .getByRole('button', { name: en.buttons.addNetwork, exact: true })
            .evaluate((el) => {
              for (let p: Element | null = el; p; p = p.parentElement)
                if (getComputedStyle(p).position === 'fixed')
                  return p.getBoundingClientRect().top;
              return innerHeight;
            });
          for (let n = 0; n < 8; n++) {
            const b = await url.boundingBox();
            if (!b) throw new Error('Missing current validation field');
            if (b.y >= 8 && b.y + b.height <= footerTop) break;
            await popup.mouse.move(width - 8, Math.min(150, footerTop - 8));
            await popup.mouse.wheel(0, b.y < 8 ? -100 : 100);
          }
          await info.attach(name, {
            body: await popup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
        };
        if (scenario === 'edit') {
          await wallet.step(
            'clearing and ABA edits discard an old pending validation without a stale spinner',
            async (capture) => {
              for (const mode of ['clear', 'aba']) {
                if (mode === 'aba')
                  gate = new Promise<void>((done) => {
                    release = done;
                  });
                const pendingUrl = oldUrl + '?attempt=' + mode;
                await url.fill(pendingUrl);
                await url.press('Tab');
                await expect
                  .poll(() => reads.some((r) => r.url === pendingUrl))
                  .toBe(true);
                await expect(spinner).toBeVisible();
                await url.fill(mode === 'clear' ? '' : newUrl);
                if (mode === 'aba') await url.fill(pendingUrl);
                await expect(url).toBeFocused();
                await expect(spinner).toHaveCount(0);
                release();
                await expect
                  .poll(() =>
                    reads.some((r) => r.url === pendingUrl && r.replied)
                  )
                  .toBe(true);
                await settleView();
                await expect(errors.filter({ hasText: '13378' })).toHaveCount(
                  0
                );
                await expect(url).toHaveValue(
                  mode === 'clear' ? '' : pendingUrl
                );
                await expect(spinner).toHaveCount(0);
                if (mode === 'clear') {
                  await expect(errors.first()).toContainText(
                    en.settings.rpcUrlRequired
                  );
                  await expect(url).toHaveAttribute('aria-invalid', 'true');
                } else
                  await expect(url).not.toHaveAttribute('aria-invalid', 'true');
                await shot('pending-validation-after-' + mode);
              }
              await capture(popup);
              await popup
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click();
              expect((await settle(dapp, id)).error?.code).toBe(4001);
            }
          );
        } else {
          await wallet.step(
            'an older real URL read remains held while a new URL settles',
            async (capture) => {
              await url.fill(isApi ? oldApi : oldUrl);
              await url.press('Tab');
              await expect
                .poll(
                  () =>
                    reads.filter((r) => r.url === (isApi ? oldApi : oldUrl))
                      .length
                )
                .toBeGreaterThan(0);
              await expect(spinner).toBeVisible();
              await url.fill(isApi ? newApi : newUrl);
              await url.press('Tab');
              await expect
                .poll(() =>
                  reads.some(
                    (r) => r.url === (isApi ? newApi : newUrl) && r.replied
                  )
                )
                .toBe(true);
              await expect(spinner).toHaveCount(0);
              await expectCurrentFeedback();
              observations.currentSettledBeforeOld = await view();
              await shot('new-url-settled-before-old-reply');
              await capture(popup);
            }
          );
          await wallet.step(
            'release the old wire read and observe only actual settled feedback',
            async (capture) => {
              release();
              await expect
                .poll(() =>
                  reads.some(
                    (r) => r.url === (isApi ? oldApi : oldUrl) && r.replied
                  )
                )
                .toBe(true);
              // The existing SDK may follow chainId with another allowed metadata read.
              // Wait for two identical actual UI samples, not an assumed defect.
              await settleView();
              observations.afterOldReply = await view();
              await shot('current-url-after-old-reply');
              await expectCurrentFeedback();
              await expect(url).toHaveValue(isApi ? newApi : newUrl);

              await capture(popup);
            }
          );
          await wallet.step(
            'explicit Add revalidates the current URL and does not save a mismatching endpoint',
            async (capture) => {
              const add = popup.getByRole('button', {
                name: en.buttons.addNetwork,
                exact: true,
              });
              const currentReads = () =>
                reads.filter(
                  (r) =>
                    r.url === (isApi ? newApi : newUrl) &&
                    r.method === (isApi ? 'GET' : 'eth_chainId')
                ).length;
              const beforeAddReads = currentReads();
              await add.click();
              await expect.poll(currentReads).toBeGreaterThan(beforeAddReads);
              if (oldWrong) {
                const result = await settle(dapp, id);
                expect(result.error).toBeUndefined();
                expect(result.result).toBeNull();
                expect(
                  (await settle(dapp, await startRequest(dapp, 'eth_chainId')))
                    .result
                ).toBe('0x3441');
                observations.addResult = 'current healthy URL accepted';
              } else {
                await expect(errors.first()).toContainText(badMessage);
                expect((await rpcObservation(dapp, id)).settled).not.toBe(true);
                observations.addResult = 'current mismatch rejected';
                await shot('current-mismatch-after-explicit-add');
                await capture(popup);
                await popup
                  .getByRole('button', { name: en.buttons.cancel, exact: true })
                  .click();
                const rejected = await settle(dapp, id);
                expect(rejected.error?.code).toBe(4001);
              }
            }
          );
        }
        expect(writes).toEqual([]);
        expect(routes.deniedWrites).toEqual([]);
        await info.attach('rpc-validation-freshness', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              runtime: extensionEvidence(),
              width,
              oldWrong,
              observations,
              reads,
              writes,
            },
            null,
            2
          ),
        });
        status = 'passed';
      } finally {
        release();
        try {
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    });
  }
}
