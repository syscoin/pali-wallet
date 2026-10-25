// Genuine provider requests and read-only ABI fixtures for collection-watch lifecycle.
import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  providerRequest,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
type Mode =
  | 'metadata-held'
  | 'balance-held'
  | 'healthy'
  | 'failed-contract-read'
  | 'failed-balance';
const contracts = {
  metadata: '0x000000000000000000000000000000000000c721',
  zero: '0x000000000000000000000000000000000000c722',
  failed: '0x000000000000000000000000000000000000c723',
  unavailable: '0x000000000000000000000000000000000000c724',
};
const selector = (name: string) => id(name).slice(0, 10);

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`ordinary ERC721 collection watch states and fresh-request recovery at ${viewport.width}`, async ({}, info) => {
    test.setTimeout(150_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const sourceHash = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const runtime = extensionEvidence();
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const fixture = createIsolatedVaultFixture();
    const abi = AbiCoder.defaultAbiCoder();
    const modes = new Map<string, Mode>([
      [contracts.metadata, 'metadata-held'],
      [contracts.zero, 'balance-held'],
      [contracts.failed, 'failed-contract-read'],
      [contracts.unavailable, 'failed-balance'],
    ]);
    const released: Array<() => void> = [];
    const held: Array<{ contract: string; selector: string }> = [];
    const reads: Array<{
      contract: string;
      method: string;
      phase: Mode;
      selector?: string;
    }> = [];
    const denied: string[] = [];
    const writes: string[] = [];
    const observations: Array<Record<string, unknown>> = [];
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let dapp: Page | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'C11PublicCollectionSynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
    });
    try {
      wallet = await PaliWallet.launch(
        'complete-c11-watch-states-' + viewport.width,
        { offlineHttpProxy: server.url, viewport, recordVideo: false }
      );
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      wallet.context.on('request', (request) => {
        try {
          const payload = request.postDataJSON();
          for (const call of Array.isArray(payload) ? payload : [payload])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              writes.push(call.method);
        } catch {
          /* Non-RPC public request. */
        }
        if (/\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname))
          writes.push('sendtx');
      });
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        const calls = Array.isArray(body) ? body : [body];
        const target = (call: any): string =>
          String(call.params?.[0]?.to || call.params?.[0] || '').toLowerCase();
        if (
          !calls.some(
            (call: any) =>
              ['eth_call', 'eth_getCode'].includes(call.method) &&
              modes.has(target(call))
          )
        )
          return route.fallback();
        if (
          calls.some((call: any) =>
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign)/i.test(
              call.method
            )
          )
        ) {
          denied.push('write');
          return route.abort('blockedbyclient');
        }
        for (const call of calls) {
          const address = target(call);
          const prefix = String(call.params?.[0]?.data || '').slice(0, 10);
          const mode = modes.get(address);
          if (
            mode &&
            call.method === 'eth_call' &&
            ((mode === 'metadata-held' &&
              [selector('name()'), selector('symbol()')].includes(prefix)) ||
              (mode === 'balance-held' &&
                prefix === selector('balanceOf(address)')))
          ) {
            held.push({ contract: address, selector: prefix });
            await new Promise<void>((resolve) => released.push(resolve));
          }
        }
        const answers = calls.map((call: any) => {
          const address = target(call);
          const phase = modes.get(address);
          const prefix = String(call.params?.[0]?.data || '').slice(0, 10);
          if (!phase) {
            if (call.method === 'eth_chainId')
              return { jsonrpc: '2.0', id: call.id, result: '0x1644' };
            denied.push('unexpected batched method:' + call.method);
            return {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32601, message: 'Unsupported synthetic read' },
            };
          }
          reads.push({
            contract: address,
            method: call.method,
            selector: prefix || undefined,
            phase,
          });
          const failure =
            phase === 'failed-contract-read' ||
            (phase === 'failed-balance' &&
              prefix === selector('balanceOf(address)'));
          if (failure)
            return {
              jsonrpc: '2.0',
              id: call.id,
              error: {
                code: -32000,
                message: 'Synthetic public collection read unavailable',
              },
            };
          let result: unknown;
          if (call.method === 'eth_getCode') result = '0x60006000fd';
          if (call.method === 'eth_call') {
            if (prefix === selector('supportsInterface(bytes4)')) {
              const [type] = abi.decode(
                ['bytes4'],
                '0x' + call.params[0].data.slice(10)
              );
              result = abi.encode(
                ['bool'],
                [['0x80ac58cd', '0x5b5e139f', '0x01ffc9a7'].includes(type)]
              );
            } else if (prefix === selector('name()'))
              result = abi.encode(['string'], ['Public Collection']);
            else if (prefix === selector('symbol()'))
              result = abi.encode(['string'], ['C11NFT']);
            else if (prefix === selector('decimals()'))
              result = abi.encode(['uint8'], [0]);
            else if (prefix === selector('totalSupply()'))
              result = abi.encode(['uint256'], [100]);
            else if (prefix === selector('balanceOf(address)')) {
              const [owner] = abi.decode(
                ['address'],
                '0x' + call.params[0].data.slice(10)
              );
              expect(owner.toLowerCase()).toBe(
                fixture.evmAddresses[0].toLowerCase()
              );
              result = abi.encode(
                ['uint256'],
                [address === contracts.zero ? 0 : 1]
              );
            } else denied.push('unexpected contract selector:' + prefix);
          }
          return result === undefined
            ? {
                jsonrpc: '2.0',
                id: call.id,
                error: { code: -32601, message: 'Unsupported synthetic read' },
              }
            : { jsonrpc: '2.0', id: call.id, result };
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? answers : answers[0]),
        });
      });
      await wallet.context.route(
        'https://api.coingecko.com/api/v3/**',
        async (route) => {
          const url = new URL(route.request().url());
          if (
            route.request().method() !== 'GET' ||
            !Object.values(contracts).some((address) =>
              url.pathname.endsWith('/contract/' + address)
            )
          )
            return route.fallback();
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Synthetic collection has no market listing',
            }),
          });
        }
      );
      await wallet.step(
        'ordinary onboarding, network selection and provider connection',
        async (capture) => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await wallet!.page.goto('about:blank');
          dapp = await wallet!.context.newPage();
          await dapp.goto(server.url);
          await dapp.waitForFunction(() => Boolean((window as any).pali));
          const connected = await approve(
            wallet!.context,
            dapp,
            await startRequest(dapp, 'eth_requestAccounts'),
            capture
          );
          expect(
            connected.result.map((value: string) => value.toLowerCase())
          ).toEqual([fixture.evmAddresses[0].toLowerCase()]);
          expect(await providerRequest(dapp, 'eth_chainId')).toBe('0x1644');
        }
      );
      const openWatchRequest = async (request: number) => {
        let popup = await popupFor(wallet!.context, dapp!, request);
        if (new URL(popup.url()).pathname === '/external/spam-warning') {
          await expect(
            popup.getByRole('heading', {
              name: en.spamWarning.title,
              exact: true,
            })
          ).toBeVisible();
          await expect(
            popup.getByText(server.url, { exact: true })
          ).toBeVisible();
          const proceed = popup.getByRole('button', {
            name: en.buttons.continue,
            exact: true,
          });
          await expect(proceed).toBeEnabled();
          const warning = popup;
          await clickClosingPopup({
            click: () => proceed.click(),
            isClosed: () => warning.isClosed(),
          });
          popup = await popupFor(wallet!.context, dapp!, request);
        }
        return popup;
      };
      const watch = (address: string) => ({
        type: 'ERC721',
        options: { address, tokenId: '7' },
      });
      const matching = async () =>
        (
          (await providerRequest(dapp!, 'wallet_getTokens')).ethereum || []
        ).filter((asset: any) =>
          Object.values(contracts).includes(asset.contractAddress.toLowerCase())
        );
      const captureState = async (popup: Page, label: string) => {
        await popup.mouse.move(0, 0);
        await info.attach(label + '-' + viewport.width, {
          body: await popup.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        observations.push({
          label,
          viewport,
          requestUrl: popup.url(),
          buttons: await popup.getByRole('button').allTextContents(),
        });
      };
      const balanceValue = (popup: Page) =>
        popup
          .locator('p')
          .filter({ hasText: en.send.balance })
          .locator(':scope > span')
          .first();
      const cancel = async (popup: Page, request: number) => {
        const rejected = await dismissRejectedApproval({
          click: () =>
            popup
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => popup.isClosed(),
          settle: () => settle(dapp!, request),
        });
        expect(rejected.error?.code).toBe(4001);
        expect(await matching()).toEqual([]);
      };
      await wallet.step(
        'real metadata reads remain loading until physical response release',
        async () => {
          const request = await startRequest(
            dapp!,
            'wallet_watchAsset',
            watch(contracts.metadata)
          );
          const popup = await openWatchRequest(request);
          await popup.setViewportSize(viewport);
          await expect
            .poll(
              () =>
                held.filter((value) => value.contract === contracts.metadata)
                  .length
            )
            .toBeGreaterThan(0);
          await expect(
            popup.locator('#external-root .animate-spin')
          ).toBeVisible();
          await expect(
            popup.getByRole('button', {
              name: en.buttons.addToken,
              exact: true,
            })
          ).toHaveCount(0);
          expect((await rpcObservation(dapp!, request)).settled).not.toBe(true);
          expect((await rpcObservation(dapp!, request)).result).toBeUndefined();
          expect((await rpcObservation(dapp!, request)).error).toBeUndefined();
          await captureState(popup, 'erc721-metadata-loading');
          const spinner = popup.locator('.animate-spin').last();
          const spinnerSize = await spinner.evaluate((element) => ({
            width: getComputedStyle(element).width,
            height: getComputedStyle(element).height,
          }));
          expect(spinnerSize).toEqual({ width: '64px', height: '64px' });
          await captureForegroundContrast(
            spinner,
            info,
            `watch-asset-loading-arc-${viewport.width}`,
            'border'
          );

          modes.set(contracts.metadata, 'healthy');
          released.splice(0).forEach((resolve) => resolve());
          await expect(
            popup.getByRole('button', {
              name: en.buttons.addToken,
              exact: true,
            })
          ).toBeEnabled();
          await expect(balanceValue(popup)).toHaveText('1');
          await popup.mouse.move(viewport.width - 8, 180);
          await popup.mouse.wheel(0, 280);
          await captureState(popup, 'erc721-collection-healthy');
          await cancel(popup, request);
        }
      );
      await wallet.step(
        'real held collection-balance read resolves to a valid zero-owned collection',
        async () => {
          const request = await startRequest(
            dapp!,
            'wallet_watchAsset',
            watch(contracts.zero)
          );
          const popup = await openWatchRequest(request);
          await popup.setViewportSize(viewport);
          await expect
            .poll(
              () =>
                held.filter((value) => value.contract === contracts.zero).length
            )
            .toBeGreaterThan(0);
          await expect(
            popup.locator('#external-root .animate-spin')
          ).toBeVisible();
          await captureState(popup, 'erc721-balance-loading');
          modes.set(contracts.zero, 'healthy');
          released.splice(0).forEach((resolve) => resolve());
          await expect(
            popup.getByRole('button', {
              name: en.buttons.addToken,
              exact: true,
            })
          ).toBeEnabled();
          await expect(balanceValue(popup)).toHaveText('0');
          await popup.mouse.move(viewport.width - 8, 180);
          await popup.mouse.wheel(0, 280);
          await captureState(popup, 'erc721-collection-zero');
          await cancel(popup, request);
        }
      );
      await wallet.step(
        'failed fresh balance is Unavailable rather than a fabricated zero',
        async () => {
          const request = await startRequest(
            dapp!,
            'wallet_watchAsset',
            watch(contracts.unavailable)
          );
          const popup = await openWatchRequest(request);
          await popup.setViewportSize(viewport);
          await expect(
            popup.getByRole('button', {
              name: en.buttons.addToken,
              exact: true,
            })
          ).toBeEnabled();
          await expect(balanceValue(popup)).toHaveText(en.settings.unavailable);
          await popup.mouse.move(viewport.width - 8, 180);
          await popup.mouse.wheel(0, 280);
          await captureState(popup, 'erc721-collection-balance-unavailable');
          await cancel(popup, request);
        }
      );
      await wallet.step(
        'contract-read error has Close and recovers on a fresh ordinary provider request',
        async () => {
          const request = await startRequest(
            dapp!,
            'wallet_watchAsset',
            watch(contracts.failed)
          );
          const popup = await openWatchRequest(request);
          await popup.setViewportSize(viewport);
          await expect(
            popup.getByRole('heading', {
              name: en.settings.assetNotFound,
              exact: true,
            })
          ).toBeVisible();
          await expect(
            popup.getByRole('button', {
              name: en.buttons.addToken,
              exact: true,
            })
          ).toHaveCount(0);
          await captureState(popup, 'erc721-contract-read-error');
          const help = popup.getByText(en.components.pleaseVerifyThat, {
            exact: true,
          });
          await popup.mouse.move(viewport.width - 8, viewport.height / 2);
          await popup.mouse.wheel(0, 500);
          await expect(help).toBeVisible();
          await captureForegroundContrast(
            help,
            info,
            'watch-asset-error-help-' + viewport.width
          );
          await captureForegroundContrast(
            popup.getByText(en.components.contractAddressCorrect, {
              exact: true,
            }),
            info,
            'watch-asset-error-help-item-' + viewport.width
          );
          await captureState(popup, 'erc721-error-help-revealed');
          const closed = await dismissRejectedApproval({
            click: () =>
              popup
                .getByRole('button', { name: en.buttons.close, exact: true })
                .click(),
            isClosed: () => popup.isClosed(),
            settle: () => settle(dapp!, request),
          });
          expect(closed.error?.code).toBe(4001);
          expect(await matching()).toEqual([]);
          modes.set(contracts.failed, 'healthy');
          const next = await startRequest(
            dapp!,
            'wallet_watchAsset',
            watch(contracts.failed)
          );
          const recovered = await openWatchRequest(next);
          await recovered.setViewportSize(viewport);
          await expect(
            recovered.getByRole('button', {
              name: en.buttons.addToken,
              exact: true,
            })
          ).toBeEnabled();
          await expect(balanceValue(recovered)).toHaveText('1');
          await recovered.mouse.move(viewport.width - 8, 180);
          await recovered.mouse.wheel(0, 280);
          await captureState(recovered, 'erc721-fresh-request-recovered');
          await cancel(recovered, next);
        }
      );
      await wallet.step(
        'invalid collection address uses its normal error review without importing',
        async () => {
          const invalidRequest = await startRequest(
            dapp!,
            'wallet_watchAsset',
            watch('not-an-address')
          );
          const invalidPopup = await openWatchRequest(invalidRequest);
          await invalidPopup.setViewportSize(viewport);
          await expect(
            invalidPopup.getByRole('heading', {
              name: en.settings.assetNotFound,
              exact: true,
            })
          ).toBeVisible();
          await expect(
            invalidPopup.getByRole('button', {
              name: en.buttons.addToken,
              exact: true,
            })
          ).toHaveCount(0);
          await captureState(invalidPopup, 'erc721-invalid-address');
          const rejected = await dismissRejectedApproval({
            click: () =>
              invalidPopup
                .getByRole('button', { name: en.buttons.close, exact: true })
                .click(),
            isClosed: () => invalidPopup.isClosed(),
            settle: () => settle(dapp!, invalidRequest),
          });
          expect(rejected.error?.code).toBe(4001);
          expect(await matching()).toEqual([]);
          expect(
            reads.some((read) => read.selector === selector('ownerOf(uint256)'))
          ).toBe(false);
          expect(denied).toEqual([]);
          expect(writes).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceHash);
        }
      );
      status = 'passed';
    } finally {
      released.splice(0).forEach((resolve) => resolve());
      await info.attach('erc721-watch-states-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            status,
            runtime,
            viewport,
            sourceHash,
            observations,
            held,
            reads,
            denied,
            writes,
            scope:
              'collection watch request; ERC721 tokenId-specific ownership warning and same-request Retry are not implemented in this flow',
            controllerStateReplaced: false,
            providerRequestForged: false,
            signedOrBroadcast: false,
          },
          null,
          2
        ),
      });
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
