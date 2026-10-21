import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, Interface, id } from 'ethers';
import fs from 'fs';

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

for (const payloadBytes of [48, 2048]) {
  test(`decoded transaction tooltip remains readable with ${payloadBytes} public bytes`, async ({}, info) => {
    const mode = `payload-${payloadBytes}`;
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    const runtime = extensionEvidence();
    const testSourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    expect(runtime.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    const recipient = fixture.evmAddresses[0];
    const sender = `0x${'44'.repeat(20)}`;
    const contract = `0x${'33'.repeat(20)}`;
    const hashByte = payloadBytes === 48 ? 'b1' : 'b2';
    const hash = `0x${hashByte.repeat(32)}`;
    const blockHash = `0x${'42'.repeat(32)}`;
    const amount = '7';
    const byteParameters = [
      `0xfe${'12'.repeat(31)}`,
      `0x${'ab'.repeat(payloadBytes)}`,
    ];
    const payload = byteParameters[1];
    const input = new Interface([
      'function execute(bytes32 mode,bytes executionCalldata)',
    ]).encodeFunctionData('execute', byteParameters);
    const abi = AbiCoder.defaultAbiCoder();
    const metadata = new Map([
      [
        id('name()').slice(0, 10),
        abi.encode(['string'], ['Synthetic Transfer Token']),
      ],
      [id('symbol()').slice(0, 10), abi.encode(['string'], ['TRANSFER'])],
      [id('decimals()').slice(0, 10), abi.encode(['uint8'], [0])],
      [
        id('balanceOf(address)').slice(0, 10),
        abi.encode(['uint256'], [amount]),
      ],
      [id('totalSupply()').slice(0, 10), abi.encode(['uint256'], [amount])],
      [
        id('supportsInterface(bytes4)').slice(0, 10),
        abi.encode(['bool'], [false]),
      ],
    ]);
    const event = {
      hash,
      from: sender,
      to: recipient,
      contractAddress: contract,
      value: amount,
      input,
      nonce: '1',
      blockNumber: '42',
      blockHash,
      timeStamp: String(Math.floor(Date.now() / 1000) - 600),
      confirmations: '1',
      tokenDecimal: '0',
      tokenSymbol: 'TRANSFER',
      tokenName: 'Synthetic Transfer Token',
      gas: '50000',
      gasUsed: '45000',
      gasPrice: '1000000000',
    };
    const transaction = {
      hash,
      from: sender,
      to: contract,
      input,
      value: '0x0',
      nonce: '0x1',
      gas: '0xc350',
      gasPrice: '0x3b9aca00',
      blockNumber: '0x2a',
      blockHash,
      transactionIndex: '0x0',
      chainId: '0x1644',
      type: '0x0',
      r: `0x${'01'.repeat(32)}`,
      s: `0x${'02'.repeat(32)}`,
      v: '0x1b',
    };
    const receipt = {
      transactionHash: hash,
      transactionIndex: '0x0',
      blockHash,
      blockNumber: '0x2a',
      from: sender,
      to: contract,
      cumulativeGasUsed: '0xafc8',
      gasUsed: '0xafc8',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
      logsBloom: `0x${'00'.repeat(256)}`,
      status: '0x1',
      type: '0x0',
      contractAddress: null,
    };
    let releaseBody!: () => void;
    const heldBody = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const explorerReads: unknown[] = [];
    const rpcReads: string[] = [];
    const attemptedWrites: string[] = [];
    const measurements: unknown[] = [];
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'DecodedHistorySynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
    });
    try {
      wallet = await PaliWallet.launch(
        `transaction-tooltip-scrolling-${mode}`,
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
      await wallet.context.route(
        'https://explorer.tanenbaum.io/api**',
        async (route) => {
          const url = new URL(route.request().url());
          const action = url.searchParams.get('action');
          const result =
            action === 'tokentx' &&
            url.searchParams.get('address')?.toLowerCase() ===
              recipient.toLowerCase()
              ? [event]
              : [];
          const hasResult = Array.isArray(result)
            ? result.length > 0
            : Boolean(result);
          explorerReads.push({
            action,
            txhash: url.searchParams.get('txhash'),
            result,
          });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: hasResult ? '1' : '0',
              message: hasResult ? 'OK' : 'No transactions found',
              result,
            }),
          });
        }
      );
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        const calls = Array.isArray(body) ? body : [body];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
        ) {
          attemptedWrites.push(...calls.map((call: any) => call.method));
          return route.abort('blockedbyclient');
        }
        if (
          calls.some((call: any) => call.method === 'eth_getTransactionByHash')
        )
          await heldBody;
        const replies = calls.map((call: any) => {
          let result: unknown;
          switch (call.method) {
            case 'eth_chainId':
              result = '0x1644';
              break;
            case 'net_version':
              result = '5700';
              break;
            case 'eth_blockNumber':
              result = '0x2a';
              break;
            case 'eth_getBalance':
            case 'eth_getTransactionCount':
              result = '0x0';
              break;
            case 'eth_gasPrice':
            case 'eth_maxPriorityFeePerGas':
              result = '0x3b9aca00';
              break;
            case 'eth_getCode':
              result =
                call.params[0].toLowerCase() === contract
                  ? '0x60006000fd'
                  : '0x';
              break;
            case 'eth_call':
              result =
                call.params[0].to?.toLowerCase() === contract
                  ? metadata.get(call.params[0].data.slice(0, 10))
                  : '0x';
              break;
            case 'eth_getLogs':
              result = [];
              break;
            case 'eth_getTransactionByHash':
              result = call.params[0] === hash ? transaction : null;
              break;
            case 'eth_getTransactionReceipt':
              result = call.params[0] === hash ? receipt : null;
              break;
            case 'eth_getBlockByNumber':
              result = {
                number: '0x2a',
                hash: blockHash,
                parentHash: `0x${'41'.repeat(32)}`,
                nonce: '0x0000000000000000',
                timestamp: `0x${Number(event.timeStamp).toString(16)}`,
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0xafc8',
                miner: `0x${'00'.repeat(20)}`,
                extraData: '0x',
                transactions: [],
                baseFeePerGas: '0x3b9aca00',
              };
              break;
          }
          return result === undefined
            ? undefined
            : { jsonrpc: '2.0', id: call.id, result };
        });
        if (!replies.every((reply) => reply !== undefined))
          return route.fallback();
        rpcReads.push(...calls.map((call: any) => call.method));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
      });
      const page = wallet.page;
      const step = (name: string, action: () => Promise<void>) =>
        wallet!.step(name, async (capture) => {
          try {
            await action();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        });
      await step(
        `${mode}: open real received-token Activity history`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await page.locator('#activity-btn').click();
          const details = page
            .locator('#activity-panel-list')
            .getByRole('button', {
              name: en.notifications.clickToView,
              exact: true,
            });
          await expect(details).toHaveCount(1);
          await details.click();
          await expect(page).toHaveURL(/#\/home\/details/);
          await expect(
            page.getByText(en.transactions.decodedData, { exact: true })
          ).toBeVisible();
        }
      );

      let disclosure: ReturnType<typeof page.locator>;
      let tooltip: ReturnType<typeof page.locator>;
      let scrollRegion: ReturnType<typeof page.locator>;
      const frame = () =>
        page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            )
        );
      const measure = async (phase: string) => {
        await expect(tooltip).toBeVisible();
        const result = await scrollRegion.evaluate(
          (region, { expectedPayload, label }) => {
            const box = region.closest('[role="tooltip"]');
            if (!box) throw new Error('Owned tooltip missing');
            const rect = (element: Element) => {
              const r = element.getBoundingClientRect();
              return {
                top: r.top,
                bottom: r.bottom,
                left: r.left,
                right: r.right,
                width: r.width,
                height: r.height,
              };
            };
            const regionRect = region.getBoundingClientRect();
            const walker = document.createTreeWalker(
              region,
              NodeFilter.SHOW_TEXT
            );
            let payloadNode: Node | null = null;
            while (walker.nextNode())
              if (walker.currentNode.textContent === expectedPayload)
                payloadNode = walker.currentNode;
            if (!payloadNode)
              throw new Error('Exact public payload text node missing');
            const character = (offset: number) => {
              const range = document.createRange();
              range.setStart(payloadNode!, offset);
              range.setEnd(payloadNode!, offset + 1);
              const r = range.getBoundingClientRect();
              return {
                top: r.top,
                bottom: r.bottom,
                insideViewport:
                  r.top >= 0 &&
                  r.left >= 0 &&
                  r.bottom <= innerHeight &&
                  r.right <= innerWidth,
                insideRegion:
                  r.top >= regionRect.top &&
                  r.bottom <= regionRect.bottom &&
                  r.left >= regionRect.left &&
                  r.right <= regionRect.right,
              };
            };
            return {
              phase: label,
              rawText: region.textContent,
              viewport: { width: innerWidth, height: innerHeight },
              tooltipRect: rect(box),
              regionRect: rect(region),
              clientHeight: region.clientHeight,
              scrollHeight: region.scrollHeight,
              clientWidth: region.clientWidth,
              scrollWidth: region.scrollWidth,
              scrollTop: region.scrollTop,
              overflowY: getComputedStyle(region).overflowY,
              firstCharacter: character(0),
              lastCharacter: character(expectedPayload.length - 1),
            };
          },
          { expectedPayload: payload, label: phase }
        );
        const referenceHasFocus = await disclosure.evaluate(
          (element) => element === document.activeElement
        );
        measurements.push({ ...result, referenceHasFocus });
        return result;
      };
      const assertBounds = (value: Awaited<ReturnType<typeof measure>>) => {
        expect(value.rawText).toBe(payload);
        expect(value.tooltipRect.top).toBeGreaterThanOrEqual(0);
        expect(value.tooltipRect.left).toBeGreaterThanOrEqual(0);
        expect(value.tooltipRect.bottom).toBeLessThanOrEqual(
          value.viewport.height
        );
        expect(value.tooltipRect.right).toBeLessThanOrEqual(
          value.viewport.width
        );
        expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
      };
      const pressObserved = async (key: string) => {
        // Observe cancellation after the actual reference handler. This does
        // not replace the controller, alter the DOM, or synthesize the key.
        await page.evaluate(() => {
          (window as any).__tooltipScrollKeyEvidence = null;
          window.addEventListener(
            'keydown',
            (keyEvent) => {
              // The scroll handler stops propagation; inspect its final result
              // in a microtask after capturing the original native key event.
              queueMicrotask(() => {
                (window as any).__tooltipScrollKeyEvidence = {
                  key: keyEvent.key,
                  prevented: keyEvent.defaultPrevented,
                };
              });
            },
            { once: true, capture: true }
          );
        });
        await page.keyboard.press(key);
        await frame();
        const keyEvidence = await page.evaluate(
          () => (window as any).__tooltipScrollKeyEvidence
        );
        expect(keyEvidence?.key).toBe(key);
        measurements.push({ phase: 'key', ...keyEvidence });
        return keyEvidence as { key: string; prevented: boolean };
      };
      await step(
        mode + ': focus the bounded exact payload through ordinary Tab',
        async () => {
          releaseBody();
          await expect
            .poll(() => rpcReads.includes('eth_getTransactionReceipt'))
            .toBe(true);
          const decoded = page
            .getByText(en.transactions.decodedData, { exact: true })
            .locator('..');
          const value = decoded.getByText(
            payload.slice(0, 10) + '...' + payload.slice(-4),
            { exact: true }
          );
          await value.scrollIntoViewIfNeeded();
          disclosure = value.locator('..');
          await expect(disclosure).toHaveAttribute('tabindex', '0');
          for (let index = 0; index < 80; index++) {
            await page.keyboard.press('Tab');
            if (
              await disclosure.evaluate(
                (element) => element === document.activeElement
              )
            )
              break;
          }
          await expect(disclosure).toBeFocused();
          await expect(disclosure).toHaveAttribute('aria-describedby', /\S/);
          const descriptionId = await disclosure.getAttribute(
            'aria-describedby'
          );
          tooltip = page
            .locator('[id="' + descriptionId + '"]')
            .getByRole('tooltip');
          await expect(tooltip).toHaveText(payload);
          scrollRegion = tooltip.locator('.tippy-content > div > div');
          await expect(scrollRegion).toHaveCount(1);
          await frame();
          const initial = await measure('keyboard-open');
          assertBounds(initial);
          expect(initial.scrollTop).toBe(0);
          expect(initial.firstCharacter.insideRegion).toBe(true);
          expect(initial.firstCharacter.insideViewport).toBe(true);
          if (payloadBytes === 2048) {
            expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
            expect(initial.overflowY).toBe('auto');
            expect(initial.lastCharacter.insideRegion).toBe(false);
          } else {
            expect(initial.scrollHeight).toBeLessThanOrEqual(
              initial.clientHeight
            );
            expect(initial.lastCharacter.insideRegion).toBe(true);
            expect(initial.lastCharacter.insideViewport).toBe(true);
          }
        }
      );
      await step(
        mode + ': keyboard End and page keys reveal the payload tail',
        async () => {
          const endEvent = await pressObserved('End');
          if (payloadBytes === 2048) {
            expect(endEvent.prevented).toBe(true);
            const end = await measure('after-End');
            assertBounds(end);
            expect(end.scrollTop).toBeGreaterThan(0);
            expect(end.scrollTop + end.clientHeight).toBeGreaterThanOrEqual(
              end.scrollHeight - 1
            );
            expect(end.lastCharacter.insideRegion).toBe(true);
            expect(end.lastCharacter.insideViewport).toBe(true);
            expect((await pressObserved('PageUp')).prevented).toBe(true);
            const up = await measure('after-PageUp');
            expect(up.scrollTop).toBeLessThan(end.scrollTop);
            expect((await pressObserved('PageDown')).prevented).toBe(true);
            const down = await measure('after-PageDown');
            expect(down.scrollTop).toBeGreaterThan(up.scrollTop);
            await pressObserved('End');
            expect(
              (await measure('tail-visible')).lastCharacter.insideRegion
            ).toBe(true);
          } else {
            expect(endEvent.prevented).toBe(false);
            expect((await pressObserved('PageUp')).prevented).toBe(false);
            expect((await pressObserved('PageDown')).prevented).toBe(false);
            await disclosure.scrollIntoViewIfNeeded();
            await frame();
            const short = await measure('short-page-keys-not-trapped');
            assertBounds(short);
            expect(short.scrollTop).toBe(0);
          }
          await expect(disclosure).toBeFocused();
          await expect(page).toHaveURL(/#\/home\/details/);
        }
      );
      await step(
        mode + ': Home and pointer wheels scroll only the owned content',
        async () => {
          const homeEvent = await pressObserved('Home');
          expect(homeEvent.prevented).toBe(payloadBytes === 2048);
          await disclosure.scrollIntoViewIfNeeded();
          await frame();
          const home = await measure('after-Home');
          assertBounds(home);
          expect(home.scrollTop).toBe(0);
          expect(home.firstCharacter.insideRegion).toBe(true);
          expect(home.firstCharacter.insideViewport).toBe(true);
          const region = await scrollRegion.boundingBox();
          if (!region) throw new Error('Owned scroll region has no geometry');
          await page.mouse.move(
            region.x + region.width / 2,
            region.y + region.height / 2
          );
          await page.mouse.wheel(0, 1200);
          if (payloadBytes === 2048) {
            await expect
              .poll(() => scrollRegion.evaluate((node) => node.scrollTop))
              .toBeGreaterThan(0);
            const down = await measure('after-wheel-down');
            assertBounds(down);
            await page.mouse.wheel(0, -1200);
            await expect
              .poll(() => scrollRegion.evaluate((node) => node.scrollTop))
              .toBeLessThan(down.scrollTop);
            await pressObserved('Home');
          } else {
            await frame();
            expect(await scrollRegion.evaluate((node) => node.scrollTop)).toBe(
              0
            );
          }
          await disclosure.scrollIntoViewIfNeeded();
          await frame();
          const first = await measure('prefix-visible');
          assertBounds(first);
          expect(first.scrollTop).toBe(0);
          expect(first.firstCharacter.insideRegion).toBe(true);
          expect(first.firstCharacter.insideViewport).toBe(true);
          await expect(disclosure).toBeFocused();
        }
      );
      await step(
        mode + ': Escape dismisses without navigation or signing',
        async () => {
          await page.keyboard.press('Escape');
          await expect(tooltip).toBeHidden();
          await expect(disclosure).toBeFocused();
          await expect(disclosure).not.toHaveAttribute('aria-describedby');
          await expect(page).toHaveURL(/#\/home\/details/);
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      expect(attemptedWrites).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      expect(
        createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
      ).toBe(testSourceSha256);
      status = info.errors.length === 0 ? 'passed' : 'failed';
    } finally {
      releaseBody();
      try {
        fs.writeFileSync(
          info.outputPath('transaction-tooltip-scrolling-evidence.json'),
          JSON.stringify(
            {
              mode,
              amount,
              byteParameters,
              payloadBytes,
              measurements,
              regressionAssertions: true,
              publicDisplayDataOnly: true,
              status,
              runtime,
              explorerReads,
              rpcReads,
              attemptedWrites,
              testSourceSha256,
              deniedWrites: routes?.deniedWrites,
              proxyDeniedConnections: server.blocked.length,
              syntheticHttpOnly: true,
              controllerOrStateInjection: false,
            },
            null,
            2
          )
        );
      } catch (error) {
        status = 'failed';
        throw error;
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
