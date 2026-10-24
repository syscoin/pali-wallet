import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
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

const RPC = 'https://rpc.tanenbaum.io/';
const CONTRACT = '0x000000000000000000000000000000000000feee';
const SYMBOL = 'RETRY';
const locales = [
  { code: 'en', text: en, option: 'English English' },
  { code: 'de', text: de, option: 'German Deutsch' },
  { code: 'fr', text: fr, option: 'French Français' },
] as const;

// Observe only the public identity, selected network, saved preference and
// synthetic imported token. Never inspect seed/keyring/password records.
async function publicState(page: Page) {
  return page.evaluate(async (contract) => {
    const { vault } = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const ref = vault.activeAccount;
    const account = vault.accounts[ref.type][ref.id];
    const tokens = Object.values(
      vault.accountAssets?.[ref.type]?.[ref.id]?.ethereum || {}
    ) as any[];
    const { language } = await chrome.storage.local.get(['language']);
    return {
      account: { id: ref.id, type: ref.type, address: account.address },
      network: {
        kind: vault.activeNetwork.kind,
        chainId: vault.activeNetwork.chainId,
        url: vault.activeNetwork.url,
      },
      language: language || 'en',
      tokens: tokens
        .filter((token) => token.contractAddress.toLowerCase() === contract)
        .map((token) => ({
          chainId: token.chainId,
          contract: token.contractAddress.toLowerCase(),
          symbol: token.tokenSymbol,
        })),
    };
  }, CONTRACT);
}

async function tabTo(page: Page, target: Locator) {
  // Always traverse a native Tab; retained pointer focus is not keyboard proof.
  for (let step = 0; step < 32; step++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement))
      break;
  }
  await expect(target).toBeFocused();
}

async function actionGeometry(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const read = () =>
    target.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = (x: number, y: number) => {
        const node = document.elementFromPoint(x, y);
        return !!node && (node === element || element.contains(node));
      };
      return {
        bounds: box.toJSON(),
        hits: [
          hit(box.left + box.width / 2, box.top + box.height / 2),
          hit(box.left + 1, box.top + box.height / 2),
          hit(box.right - 1, box.top + box.height / 2),
          hit(box.left + box.width / 2, box.top + 1),
          hit(box.left + box.width / 2, box.bottom - 1),
        ],
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
      };
    });
  for (let attempt = 0; attempt < 24; attempt++) {
    const current = await read();
    if (current.hits.every(Boolean)) break;
    await page.mouse.move(
      page.viewportSize()!.width - 5,
      page.viewportSize()!.height / 2
    );
    await page.mouse.wheel(0, current.bounds.top < 0 ? -90 : 90);
    await page.waitForTimeout(100);
  }
  const geometry = await read();
  expect(geometry.bounds.width).toBeGreaterThan(0);
  expect(geometry.bounds.height).toBeGreaterThan(0);
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.bounds.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.hits).toEqual([true, true, true, true, true]);
  return geometry;
}

for (const locale of locales) {
  test(`ordinary native and token fee Retry actions use saved ${locale.code} and recover without submission`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const fixture = createIsolatedVaultFixture();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'FeeRetryAccessibilitySynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let phase = 'setup';
    const reads: {
      completed: boolean;
      failed: boolean;
      method: string;
      phase: string;
    }[] = [];
    const deniedWrites: string[] = [];
    const pageErrors: string[] = [];
    const observations: unknown[] = [];
    const abi = AbiCoder.defaultAbiCoder();
    const selector = (value: string) => id(value).slice(0, 10);
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    try {
      wallet = await PaliWallet.launch(
        'fee-retry-accessibility-' + locale.code,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      // Forward every call to the native Clipboard method. Record completed
      // public fixture values only; never substitute a clipboard result.
      await page.evaluate(
        (allowed) => {
          const descriptor = Object.getOwnPropertyDescriptor(
            navigator.clipboard,
            'writeText'
          );
          const original = navigator.clipboard.writeText.bind(
            navigator.clipboard
          );
          const audit = {
            writes: [] as string[],
            failures: 0,
            unexpectedValues: 0,
          };
          Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async (text: string) => {
              try {
                await original(text);
                if (
                  allowed.some(
                    (value) => value.toLowerCase() === text.toLowerCase()
                  )
                )
                  audit.writes.push(text);
                else audit.unexpectedValues += 1;
              } catch (error) {
                audit.failures += 1;
                throw error;
              }
            },
          });
          (window as any).__confirmPublicCopyAudit = {
            snapshot: () => ({ ...audit, writes: [...audit.writes] }),
            restore: () => {
              if (descriptor)
                Object.defineProperty(
                  navigator.clipboard,
                  'writeText',
                  descriptor
                );
              else delete (navigator.clipboard as any).writeText;
            },
          };
        },
        [fixture.evmAddresses[0], fixture.evmAddresses[1], CONTRACT]
      );
      const copyAudit = () =>
        page.evaluate(() =>
          (window as any).__confirmPublicCopyAudit.snapshot()
        );
      // Change only allowlisted public HTTP/JSON-RPC read replies. Never replace
      // Chrome APIs, controller results, Redux, navigation or DOM form state.
      await wallet.context.route(RPC, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        const calls = Array.isArray(body) ? body : [body];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
        ) {
          deniedWrites.push(...calls.map((call: any) => call.method));
          return route.abort('blockedbyclient');
        }
        const entries: typeof reads = [];
        const replies = calls.map((call: any) => {
          let result: unknown;
          const params = call.params || [];
          const own = (value: unknown) =>
            String(value).toLowerCase() === CONTRACT;
          const account = (value: unknown) =>
            fixture.evmAddresses.some(
              (address) => address.toLowerCase() === String(value).toLowerCase()
            );
          if (call.method === 'eth_chainId') result = '0x1644';
          if (call.method === 'net_version') result = '5700';
          if (call.method === 'eth_blockNumber') result = '0x1';
          if (call.method === 'eth_getBalance' && account(params[0]))
            result = '0xde0b6b3a7640000';
          if (call.method === 'eth_getTransactionCount' && account(params[0]))
            result = '0x0';
          if (call.method === 'eth_getCode' && own(params[0]))
            result = '0x60006000fd';
          if (
            call.method === 'eth_estimateGas' &&
            (own(params[0]?.to) || account(params[0]?.to))
          )
            result = '0x186a0';
          if (
            call.method === 'eth_maxPriorityFeePerGas' ||
            call.method === 'eth_gasPrice'
          )
            result = '0x3b9aca00';
          if (call.method === 'eth_getBlockByNumber')
            result = {
              number: '0x1',
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
            };
          if (call.method === 'eth_call' && own(params[0]?.to)) {
            const data = String(params[0].data || '');
            const prefix = data.slice(0, 10);
            if (prefix === selector('name()'))
              result = abi.encode(['string'], ['Retry token']);
            if (prefix === selector('symbol()'))
              result = abi.encode(['string'], [SYMBOL]);
            if (prefix === selector('decimals()'))
              result = abi.encode(['uint8'], [6]);
            if (prefix === selector('totalSupply()'))
              result = abi.encode(['uint256'], ['100000000']);
            if (prefix === selector('supportsInterface(bytes4)'))
              result = abi.encode(['bool'], [false]);
            if (prefix === selector('balanceOf(address)')) {
              const [owner] = abi.decode(['address'], '0x' + data.slice(10));
              if (own(owner)) result = abi.encode(['uint256'], ['0']);
              else if (account(owner))
                result = abi.encode(['uint256'], ['100000000']);
            }
          }
          if (result === undefined) return undefined;
          const entry = {
            method: call.method,
            phase,
            failed:
              call.method === 'eth_gasPrice' && phase.endsWith('-failure'),
            completed: false,
          };
          entries.push(entry);
          return entry.failed
            ? {
                jsonrpc: '2.0',
                id: call.id,
                error: {
                  code: -32000,
                  message: 'Synthetic fee read unavailable',
                },
              }
            : { jsonrpc: '2.0', id: call.id, result };
        });
        if (replies.some((reply) => reply === undefined))
          return route.fallback();
        reads.push(...entries);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
        entries.forEach((entry) => {
          entry.completed = true;
        });
      });
      await wallet.step(
        `${locale.code}: import one disposable wallet and token, then save the real language preference`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.gotoRoute('#/tokens/add?tab=custom');
          const custom = page.getByRole('button', {
            name: en.tokens.addCustomTab,
            exact: true,
          });
          if (await custom.count()) await custom.click();
          await page.locator('#custom-token-contract').fill(CONTRACT);
          const add = page.getByRole('button', {
            name: en.tokens.importNamedToken.replace('{{symbol}}', SYMBOL),
            exact: true,
          });
          await expect(add).toBeEnabled();
          await add.click();
          await expect
            .poll(async () => (await publicState(page)).tokens.length)
            .toBe(1);
          await wallet!.ensureOnHome();
          if (locale.code !== 'en') {
            await page
              .getByRole('button', {
                name: en.generalMenu.generalOptions,
                exact: true,
              })
              .click();
            await page
              .getByRole('menuitem', {
                name: en.generalMenu.languages,
                exact: true,
              })
              .click();
            await page
              .getByRole('button', {
                name: en.settings.setYourPreferredLanguage,
                exact: true,
              })
              .click();
            await page
              .getByRole('menuitem', { name: locale.option, exact: true })
              .click();
            await page
              .getByRole('button', { name: en.buttons.save, exact: true })
              .click();
            await expect(
              page.getByText(locale.text.settings.languageWasSet, {
                exact: true,
              })
            ).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          }
          const initial = await publicState(page);
          expect(initial.language).toBe(locale.code);
          expect(initial.account).toEqual({
            id: 0,
            type: 'HDAccount',
            address: fixture.evmAddresses[0],
          });
          expect(initial.network).toEqual({
            kind: 'ethereum',
            chainId: 5700,
            url: RPC.slice(0, -1),
          });
          expect(initial.tokens).toHaveLength(1);
          observations.push({ initial });
        }
      );

      for (const asset of ['native', 'token'] as const) {
        const viewport =
          asset === 'native'
            ? { width: 400, height: 620 }
            : { width: 320, height: 360 };
        await page.setViewportSize(viewport);
        const baseline = await publicState(page);
        const confirm = page.getByRole('button', {
          name: locale.text.buttons.confirm,
          exact: true,
        });
        const retry = page.getByRole('button', {
          name: locale.text.receive.retry,
          exact: true,
        });
        const expectedActions = asset === 'native' ? 1 : 2;
        await wallet.step(
          `${locale.code} ${asset}: failed fee HTTP read exposes every localized Retry and blocks Confirm`,
          async () => {
            phase = asset + '-failure';
            await wallet!.ensureOnHome();
            await page.locator('#send-btn').click();
            if (asset === 'token') {
              await page.getByRole('button', { name: /^TSYS$/ }).click();
              await page
                .locator('button[role="menuitem"]')
                .filter({ hasText: SYMBOL })
                .click();
            }
            const amount = page.getByPlaceholder(locale.text.send.amount, {
              exact: true,
            });
            await expect(amount).toBeEnabled();
            await page
              .getByPlaceholder(locale.text.send.receiver, { exact: true })
              .fill(fixture.evmAddresses[1]);
            await amount.fill(asset === 'native' ? '0.001' : '1');
            const failuresBeforeNext = reads.filter(
              (read) => read.phase === phase && read.failed && read.completed
            ).length;
            await page.locator('#send-eth-next-btn').click();
            await expect(page).toHaveURL(/#\/send\/confirm$/);
            await expect(confirm).toBeDisabled();
            await expect(
              page
                .getByText(locale.text.send.unableToLoad, { exact: true })
                .first()
            ).toBeVisible();
            await expect
              .poll(
                () =>
                  reads.filter(
                    (read) =>
                      read.phase === phase && read.failed && read.completed
                  ).length
              )
              .toBeGreaterThan(failuresBeforeNext);
            await expect(retry).toHaveCount(expectedActions);
            await expect(
              page.getByRole('button', { name: 'reload', exact: true })
            ).toHaveCount(0);
            const geometry = [];
            for (let index = 0; index < expectedActions; index++) {
              await expect(retry.nth(index)).toHaveAttribute('type', 'button');
              geometry.push(await actionGeometry(page, retry.nth(index)));
            }
            const feeErrors = page.getByText(locale.text.send.unableToLoad, {
              exact: true,
            });
            for (let index = 0; index < (await feeErrors.count()); index++)
              await captureForegroundContrast(
                feeErrors.nth(index),
                info,
                `fee-${locale.code}-${asset}-${viewport.width}-${index}`
              );
            observations.push({
              phase,
              geometry,
              publicState: await publicState(page),
            });
            expect(await publicState(page)).toEqual(baseline);
          }
        );
        await wallet.step(
          `${locale.code} ${asset}: explicit ${
            asset === 'native' ? 'Tab Enter' : 'total-panel pointer'
          } Retry recovers a healthy quote only`,
          async () => {
            const action = retry.nth(expectedActions - 1);
            phase = asset + '-recovery';
            if (asset === 'native') {
              await tabTo(page, action);
              await page.keyboard.press('Enter');
            } else {
              await actionGeometry(page, action);
              await action.click();
            }
            await expect
              .poll(
                () =>
                  reads.filter(
                    (read) =>
                      read.phase === phase &&
                      read.method === 'eth_gasPrice' &&
                      !read.failed &&
                      read.completed
                  ).length
              )
              .toBeGreaterThan(0);
            await expect(confirm).toBeEnabled();
            await expect(retry).toHaveCount(0);
            await expect(
              page.getByText(locale.text.send.unableToLoad, { exact: true })
            ).toHaveCount(0);
            expect(await publicState(page)).toEqual(baseline);
            expect(routes!.deniedWrites).toEqual([]);
            expect(deniedWrites).toEqual([]);
            observations.push({ phase, publicState: await publicState(page) });
            // Never click Confirm: this proves only read-only recovery.
          }
        );
        await wallet.step(
          `${locale.code} ${asset}: localized native Copy actions preserve exact public identifiers`,
          async () => {
            const copyButtons = page.locator('button').filter({
              has: page.getByRole('img', { name: 'Copy', exact: true }),
            });
            const identifier =
              asset === 'token'
                ? await page.evaluate(async (contract) => {
                    const { vault } = await chrome.runtime.sendMessage({
                      type: 'getCurrentState',
                    });
                    const ref = vault.activeAccount;
                    const tokens = Object.values(
                      vault.accountAssets?.[ref.type]?.[ref.id]?.ethereum || {}
                    ) as any[];
                    return tokens.find(
                      (token) =>
                        token.contractAddress.toLowerCase() === contract
                    )?.contractAddress as string | undefined;
                  }, CONTRACT)
                : undefined;
            if (asset === 'token') {
              expect(identifier).toBeTruthy();
              expect(identifier!.toLowerCase()).toBe(CONTRACT);
            }
            const targets = [
              ...(identifier ? [identifier] : []),
              fixture.evmAddresses[0],
              fixture.evmAddresses[1],
            ];
            await expect(copyButtons).toHaveCount(targets.length);
            const start = (await copyAudit()).writes.length;
            const geometry = [];
            for (let index = 0; index < targets.length; index++) {
              const action = copyButtons.nth(index);
              await expect(action).toHaveAttribute('type', 'button');
              await expect(action).toHaveAccessibleName(
                locale.text.buttons.copy
              );
              geometry.push(await actionGeometry(page, action));
              if (index % 2 === 0) {
                await tabTo(page, action);
                await page.keyboard.press('Enter');
              } else await action.click();
              await expect
                .poll(async () => (await copyAudit()).writes.length)
                .toBe(start + index + 1);
            }
            const clipboard = await copyAudit();
            expect(clipboard.writes.slice(start)).toEqual(targets);
            expect(clipboard.failures).toBe(0);
            expect(clipboard.unexpectedValues).toBe(0);
            expect(await publicState(page)).toEqual(baseline);
            expect(routes!.deniedWrites).toEqual([]);
            expect(deniedWrites).toEqual([]);
            observations.push({
              phase: asset + '-copy',
              targets,
              clipboard,
              geometry,
              publicState: await publicState(page),
            });
          }
        );
        await wallet.step(
          `${locale.code} ${asset}: Cancel preserves exact unsigned draft and account context`,
          async () => {
            await page
              .getByRole('button', {
                name: locale.text.buttons.cancel,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/send\/eth$/);
            await expect(
              page.getByPlaceholder(locale.text.send.receiver, { exact: true })
            ).toHaveValue(fixture.evmAddresses[1]);
            await expect(
              page.getByPlaceholder(locale.text.send.amount, { exact: true })
            ).toHaveValue(asset === 'native' ? '0.001' : '1');
            expect(await publicState(page)).toEqual(baseline);
            await wallet!.ensureOnHome();
          }
        );
      }
      expect(routes.deniedWrites).toEqual([]);
      expect(deniedWrites).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect((await copyAudit()).writes).toHaveLength(5);
      expect((await copyAudit()).failures).toBe(0);
      expect((await copyAudit()).unexpectedValues).toBe(0);
      status = 'passed';
    } finally {
      try {
        await info.attach('fee-retry-accessibility-evidence-' + locale.code, {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              runtime: extensionEvidence(),
              sourceSha256: createHash('sha256')
                .update(fs.readFileSync(info.file))
                .digest('hex'),
              simulated: true,
              controllerStateReplaced: false,
              reads,
              deniedWrites,
              fixtureDeniedWrites: routes?.deniedWrites || [],
              proxyDeniedConnections: server.blocked.length,
              pageErrors,
              observations,
            },
            null,
            2
          ),
        });
      } finally {
        try {
          await wallet?.page
            .evaluate(() => (window as any).__confirmPublicCopyAudit?.restore())
            .catch(() => undefined);
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
