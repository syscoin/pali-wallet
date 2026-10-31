import { expect, test, type Locator, type Page } from '@playwright/test';
import { HDNodeWallet, Transaction, toBeHex } from 'ethers';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
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
async function keyboard(page: Page, target: Locator) {
  for (let i = 0; i < 45; i++) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
async function snap(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const file = path.join(
    E2E_CONFIG.artifactsDir,
    `${test.info().title.replace(/[^a-z0-9-]/gi, '-')}-${label}.png`
  );
  await page.screenshot({
    path: file,
    animations: 'disabled',
    mask: [page.locator('input[type="password"]')],
  });
  await test.info().attach(label, { path: file, contentType: 'image/png' });
}

for (const width of [400, 320])
  for (const action of ['speedup', 'cancel'] as const) {
    test(`normal ${action} submission retains its genuine pending metadata at ${width}`, async ({}, info) => {
      test.setTimeout(120_000);
      const prior = { ...E2E_CONFIG };
      const server = await startUtxoFixtureServer();
      const fixture = createIsolatedVaultFixture();
      const signingWallet = HDNodeWallet.fromPhrase(
        UTXO_FIXTURE_SEED,
        undefined,
        "m/44'/60'/0'/0/0"
      );
      expect(signingWallet.address).toBe(fixture.evmAddresses[0]);
      const original = Transaction.from(
        await signingWallet.signTransaction({
          type: 0,
          chainId: 5700,
          nonce: 0,
          gasLimit: 21000,
          gasPrice: 1000000000,
          value: BigInt('10000000000000000'),
          to: fixture.evmAddresses[1],
          data: '0x',
        })
      );
      const originals = new Map<string, Transaction>([
        [original.hash!, original],
      ]);
      const accepted: Array<{
        from: string;
        gasPrice: string;
        hash: string;
        nonce: number;
        to: string | null;
        value: string;
      }> = [];
      const unexpected: string[] = [];
      const rpcAudit: unknown[] = [];
      let publicPhase = false;
      let lookupFailure = false;
      let lastTransactionLookupAt = 0;
      let admission: typeof action | undefined;
      let wallet: PaliWallet | undefined;
      const rpcRow = (tx: Transaction) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        nonce: toBeHex(tx.nonce),
        value: toBeHex(tx.value),
        input: tx.data,
        gas: toBeHex(tx.gasLimit),
        gasPrice: toBeHex(tx.gasPrice!),
        chainId: toBeHex(tx.chainId),
        type: '0x0',
        r: tx.signature!.r,
        s: tx.signature!.s,
        v: toBeHex(tx.signature!.networkV ?? BigInt(tx.signature!.v)),
        blockNumber: null,
        blockHash: null,
        transactionIndex: null,
      });
      const explorerRow = (tx: Transaction) => ({
        ...rpcRow(tx),
        nonce: String(tx.nonce),
        value: tx.value.toString(),
        gas: tx.gasLimit.toString(),
        gasPrice: tx.gasPrice!.toString(),
        timeStamp: String(Math.floor(Date.now() / 1000)),
        confirmations: '0',
        isError: '0',
        // Explorer API field spelling.
        // eslint-disable-next-line camelcase
        txreceipt_status: null,
        gasUsed: null,
      });
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'SyntheticReplacementOnly!2026',
        rpcUrl: server.url,
      });
      let outcome: 'passed' | 'failed' = 'failed';
      try {
        wallet = await PaliWallet.launch(`replacement-${action}-${width}`, {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width, height: width === 400 ? 620 : 360 },
        });
        const routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url
        );
        await wallet.context.route('**/*', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (
            url.origin === 'https://explorer.tanenbaum.io' &&
            url.pathname === '/api' &&
            request.method() === 'GET'
          ) {
            const method = url.searchParams.get('action');
            let result: unknown;
            if (method === 'txlist') result = [];
            else if (method === 'pendingtxlist')
              result = [
                accepted.length ? originals.get(accepted[0].hash)! : original,
              ].map(explorerRow);
            else if (['tokentx', 'tokenlist'].includes(method || ''))
              result = [];
            else if (
              method === 'eth_block_number' ||
              method === 'eth_blockNumber'
            )
              result = '0x64';
            else if (method === 'gettxinfo')
              result = originals.has(url.searchParams.get('txhash') || '')
                ? explorerRow(originals.get(url.searchParams.get('txhash')!)!)
                : null;
            else return route.fallback();
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({
                status: Array.isArray(result) && !result.length ? '0' : '1',
                message: 'OK',
                result,
              }),
            });
          }
          if (
            url.origin !== 'https://rpc.tanenbaum.io' ||
            url.pathname !== '/' ||
            request.method() !== 'POST'
          )
            return route.fallback();
          const payload = request.postDataJSON();
          const calls = Array.isArray(payload) ? payload : [payload];
          const replies = calls.map((call) => {
            rpcAudit.push({
              method: call.method,
              lookupFailure,
              admission,
              hash:
                call.method === 'eth_getTransactionByHash'
                  ? call.params?.[0]
                  : undefined,
            });
            const reply = (result: unknown) => ({
              jsonrpc: '2.0',
              id: call.id,
              result,
            });
            const error = (message: string) => ({
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32000, message },
            });
            if (call.jsonrpc !== '2.0' || !Array.isArray(call.params)) {
              unexpected.push('malformed RPC');
              return error('Malformed');
            }
            switch (call.method) {
              case 'eth_sendRawTransaction': {
                if (
                  !admission ||
                  call.params.length !== 1 ||
                  typeof call.params[0] !== 'string'
                ) {
                  unexpected.push('unapproved synthetic submission');
                  return error('Not admitted');
                }
                const tx = Transaction.from(call.params[0]);
                expect(tx.from?.toLowerCase()).toBe(
                  fixture.evmAddresses[0].toLowerCase()
                );
                expect(tx.chainId).toBe(BigInt('5700'));
                expect(tx.nonce).toBe(0);
                // Preserve the pinned SDK's replacement gas policy.
                expect(tx.gasLimit).toBe(
                  BigInt(action === 'speedup' ? 25200 : 42000)
                );
                expect(tx.data).toBe('0x');
                expect(tx.to?.toLowerCase()).toBe(
                  fixture.evmAddresses[
                    action === 'cancel' ? 0 : 1
                  ].toLowerCase()
                );
                expect(tx.value).toBe(
                  action === 'cancel' ? BigInt('0') : original.value
                );
                expect(tx.gasPrice!).toBeGreaterThan(original.gasPrice!);
                expect(accepted).toHaveLength(0);
                originals.set(tx.hash!, tx);
                accepted.push({
                  hash: tx.hash!,
                  nonce: tx.nonce,
                  from: tx.from!,
                  to: tx.to,
                  value: tx.value.toString(),
                  gasPrice: tx.gasPrice!.toString(),
                });
                admission = undefined;
                return reply(tx.hash);
              }
              case 'eth_getTransactionByHash':
                lastTransactionLookupAt = Date.now();
                return lookupFailure
                  ? error('Synthetic original read unavailable')
                  : reply(
                      originals.has(call.params[0])
                        ? rpcRow(originals.get(call.params[0])!)
                        : null
                    );
              case 'eth_getTransactionReceipt':
                return reply(null);
              case 'eth_chainId':
                return reply('0x1644');
              case 'net_version':
                return reply('5700');
              case 'eth_blockNumber':
                return reply('0x64');
              case 'eth_getBalance':
                return reply(toBeHex(BigInt('10000000000000000000')));
              case 'eth_getTransactionCount':
                return reply(
                  call.params[1] === 'pending' &&
                    call.params[0]?.toLowerCase() ===
                      fixture.evmAddresses[0].toLowerCase()
                    ? '0x1'
                    : '0x0'
                );
              case 'eth_gasPrice':
              case 'eth_maxPriorityFeePerGas':
                return reply('0x3b9aca00');
              case 'eth_estimateGas':
                return reply('0x5208');
              case 'eth_getCode':
              case 'eth_call':
                return reply('0x');
              case 'eth_getLogs':
                return reply([]);
              case 'eth_feeHistory':
                return reply({
                  oldestBlock: '0x63',
                  baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
                  gasUsedRatio: [0.5],
                  reward: [['0x3b9aca00']],
                });
              case 'eth_getBlockByNumber':
              case 'eth_getBlockByHash':
                return reply({
                  number: '0x64',
                  hash: '0x' + '12'.repeat(32),
                  parentHash: '0x' + '11'.repeat(32),
                  nonce: '0x0000000000000000',
                  timestamp: toBeHex(Math.floor(Date.now() / 1000)),
                  difficulty: '0x0',
                  gasLimit: '0x1c9c380',
                  gasUsed: '0x0',
                  miner: '0x' + '00'.repeat(20),
                  extraData: '0x',
                  transactions: [],
                  baseFeePerGas: '0x3b9aca00',
                });
              default:
                unexpected.push(call.method);
                return error('Unsupported synthetic RPC');
            }
          });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
          });
        });
        const page = wallet.page,
          list = page.locator('#activity-panel-list');
        const awaitDistinctRead = async () => {
          // Ethers coalesces identical reads for 250 ms. A changed server
          // response is a distinct fault/recovery only after that real window.
          await expect
            .poll(() => Date.now() - lastTransactionLookupAt)
            .toBeGreaterThan(250);
        };
        const openAction = async (expectHeading = true) => {
          await list.locator('#transaction-options button').click();
          const name =
            action === 'speedup' ? en.header.speedUp : en.buttons.cancel;
          const item = page
            .getByRole('menuitem')
            .filter({ has: page.getByText(name, { exact: true }) });
          await expect(item).toHaveCount(1);
          const menu = page.getByRole('menu');
          await page.keyboard.press('Home');
          for (let index = 0; index < (action === 'speedup' ? 2 : 3); index++)
            await page.keyboard.press('ArrowDown');
          await expect
            .poll(() => menu.getAttribute('aria-activedescendant'))
            .toBe(await item.getAttribute('id'));
          await page.keyboard.press('Enter');
          if (expectHeading)
            await expect(
              page.getByRole('heading', {
                name:
                  action === 'speedup' ? en.header.speedTx : en.header.cancelTx,
                exact: true,
              })
            ).toBeVisible();
        };
        await wallet.step(
          'ordinary imported wallet and authentic pending original are visible',
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
            await wallet!.ensureOnHome();
            await page.locator('#activity-btn').click();
            publicPhase = true;
            await expect(
              list.getByText(en.send.pending, { exact: true })
            ).toBeVisible();
            await snap(page, 'pending-control');
          }
        );
        await wallet.step(
          'native dismissal of the fee action preserves the original and makes no submission',
          async () => {
            await openAction();
            await snap(page, 'fee-confirmation');
            await page.keyboard.press('Escape');
            await expect(
              page.getByRole('heading', {
                name:
                  action === 'speedup' ? en.header.speedTx : en.header.cancelTx,
                exact: true,
              })
            ).toHaveCount(0);
            expect(accepted).toEqual([]);
          }
        );
        await wallet.step(
          'genuine original-transaction read failure remains an error without submission',
          async () => {
            lookupFailure = true;
            await awaitDistinctRead();
            await openAction(false);
            await expect(
              page.getByText(
                action === 'speedup'
                  ? en.transactions.speedUpFeeUnavailable
                  : en.transactions.cancelFeeUnavailable,
                { exact: true }
              )
            ).toBeVisible();
            expect(accepted).toEqual([]);
            await snap(page, 'read-failure');
            const pendingDialog = page.getByRole('heading', {
              name:
                action === 'speedup' ? en.header.speedTx : en.header.cancelTx,
              exact: true,
            });
            if (await pendingDialog.isVisible())
              await page.keyboard.press('Escape');
            await expect(pendingDialog).toHaveCount(0);
            lookupFailure = false;
          }
        );
        await wallet.step(
          'fresh native confirmation submits only one locally intercepted valid signed replacement',
          async () => {
            await awaitDistinctRead();
            await openAction();
            const confirm = page.getByRole('button', {
              name: en.buttons.confirm,
              exact: true,
            });
            await expect(confirm).toBeEnabled();
            const consent =
              action === 'cancel'
                ? en.transactions.cancelFeeConsent
                : en.transactions.speedUpFeeConsent;
            await expect(
              page.getByText(consent.split('{{fee}}')[0], { exact: false })
            ).toBeVisible();
            await snap(page, 'healthy-fee-confirmation');
            admission = action;
            await keyboard(page, confirm);
            await page.keyboard.press('Enter');
            await expect.poll(() => accepted.length).toBe(1);
            const label = list.getByText(
              action === 'speedup'
                ? `(${en.header.speedUp})`
                : `(${en.transactions.cancelSubmitted})`,
              { exact: true }
            );
            await expect(label).toBeVisible();
            const exposure = () =>
              label.evaluate((node) => {
                let left = 0,
                  top = 0,
                  right = innerWidth,
                  bottom = innerHeight;
                for (
                  let parent = node.parentElement;
                  parent;
                  parent = parent.parentElement
                ) {
                  const style = getComputedStyle(parent),
                    box = parent.getBoundingClientRect();
                  if (/auto|hidden|scroll|clip/.test(style.overflowX)) {
                    left = Math.max(left, box.left + parent.clientLeft);
                    right = Math.min(
                      right,
                      box.left + parent.clientLeft + parent.clientWidth
                    );
                  }
                  if (/auto|hidden|scroll|clip/.test(style.overflowY)) {
                    top = Math.max(top, box.top + parent.clientTop);
                    bottom = Math.min(
                      bottom,
                      box.top + parent.clientTop + parent.clientHeight
                    );
                  }
                }
                const range = document.createRange();
                range.selectNodeContents(node);
                const glyphs = [...range.getClientRects()].filter(
                  (r) => r.width > 0 && r.height > 0
                );
                return {
                  y: node.getBoundingClientRect().y,
                  visible:
                    glyphs.length > 0 &&
                    glyphs.every(
                      (r) =>
                        r.left >= left &&
                        r.right <= right &&
                        r.top >= top &&
                        r.bottom <= bottom &&
                        node.contains(
                          document.elementFromPoint(
                            r.x + r.width / 2,
                            r.y + r.height / 2
                          )
                        )
                    ),
                };
              });
            for (let scroll = 0; scroll < 20; scroll++) {
              const current = await exposure();
              if (current.visible) break;
              await page.mouse.move(width - 8, (width === 400 ? 620 : 360) / 2);
              await page.mouse.wheel(0, current.y < 0 ? -100 : 100);
              await page.waitForTimeout(100);
            }
            expect((await exposure()).visible).toBe(true);
            if (action === 'cancel') {
              const amount = list.getByText('0 TSYS', { exact: true });
              await expect(amount).toBeVisible();
              await expect
                .poll(() =>
                  amount.evaluate((node) => {
                    let left = 0;
                    let right = innerWidth;
                    for (
                      let parent: Element | null = node;
                      parent;
                      parent = parent.parentElement
                    ) {
                      const style = getComputedStyle(parent);
                      if (/auto|hidden|scroll|clip/.test(style.overflowX)) {
                        const box = parent.getBoundingClientRect();
                        left = Math.max(
                          left,
                          box.left + parseFloat(style.borderLeftWidth || '0')
                        );
                        right = Math.min(
                          right,
                          box.right - parseFloat(style.borderRightWidth || '0')
                        );
                      }
                    }
                    const text = document.createRange();
                    text.selectNodeContents(node);
                    const bounds = text.getBoundingClientRect();
                    return Math.min(bounds.left - left, right - bounds.right);
                  })
                )
                .toBeGreaterThanOrEqual(0);
            }
            await snap(page, 'submitted-metadata');
            expect(routes.deniedWrites).toEqual([]);
            expect(unexpected).toEqual([]);
            // Strict measurement runs last so any discovered contrast failure keeps
            // all native action, healthy, error and signature proof from this case.
            await captureForegroundContrast(
              label,
              info,
              `${action}-metadata-${width}`
            );
          }
        );
        outcome = 'passed';
      } finally {
        await info.attach('replacement-public-evidence', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              runtime: extensionEvidence(),
              action,
              width,
              originalHash: original.hash,
              accepted,
              rpcAudit,
              visiblePublicText:
                publicPhase && wallet
                  ? await wallet.page.locator('body').innerText()
                  : undefined,
              unexpected,
              remoteBroadcasts: 0,
            },
            null,
            2
          ),
        });
        if (wallet) await wallet.dispose(outcome);
        Object.assign(E2E_CONFIG, prior);
        await server.close();
      }
    });
  }
