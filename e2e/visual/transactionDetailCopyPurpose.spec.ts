import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, Interface, id } from 'ethers';
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
  fixtureRead,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// External single-worker browser draft. Only public HTTP fixture data is
// synthetic. Controller/state/DOM responses are not replaced. Clipboard audit
// forwards the original native write and records only allowlisted public bytes.
const BUTTONS = '#details-view-content button';
async function nativeButton(
  context: BrowserContext,
  page: Page,
  target: Locator,
  selector = BUTTONS
) {
  const index = await target.evaluate(
    (button, buttonSelector) =>
      Array.from(document.querySelectorAll(buttonSelector)).indexOf(button),
    selector
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector,
    });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId: nodeIds[index],
      fetchRelatives: false,
    });
    const node = nodes.find(
      (entry) => entry.role?.value === 'button' && !entry.ignored
    );
    expect(node).toBeDefined();
    return {
      role: node!.role?.value,
      name: node!.name?.value,
      description: node!.description?.value ?? null,
    };
  } finally {
    await cdp.detach();
  }
}
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 40; i += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
async function installClipboardAudit(page: Page, allowed: string[]) {
  await page.evaluate((values) => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    const log = { writes: [] as string[], failures: 0, unexpected: 0 };
    navigator.clipboard.writeText = async (value: string) => {
      try {
        await original(value);
        if (values.includes(value)) log.writes.push(value);
        else log.unexpected += 1;
      } catch (error) {
        log.failures += 1;
        throw error;
      }
    };
    (window as any).__activityPublicClipboard = () => ({
      ...log,
      writes: [...log.writes],
    });
  }, allowed);
}

test('Activity detail Copy controls identify their field and retain exact native clipboard bytes', async ({}, info) => {
  test.setTimeout(240_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
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
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ActivityCopyPurposeSynthetic!2026',
    rpcUrl: server.url,
  });
  const contract = '0x' + '33'.repeat(20);
  const evmHash = '0x' + '71'.repeat(32);
  const utxoHash = '72'.repeat(32);
  const sptHash = '73'.repeat(32);
  const guid = '123457';
  const evmFrom = fixture.evmAddresses[0];
  const evmTo = fixture.evmAddresses[1];
  const transfer = new Interface([
    'function transfer(address to,uint256 value)',
  ]);
  const input = transfer.encodeFunctionData('transfer', [evmTo, 1000000]);
  const evm = {
    hash: evmHash,
    from: evmFrom,
    to: contract,
    input,
    value: '0',
    nonce: '0',
    blockNumber: '42',
    blockHash: '0x' + 'bb'.repeat(32),
    timeStamp: '1700000000',
    timestamp: 1700000000,
    confirmations: '5',
    chainId: 5700,
    type: '2',
    gas: '60000',
    gasLimit: '60000',
    gasUsed: '50000',
    gasPrice: '1000000000',
    isError: '0',
    txreceipt_status: '1',
  };
  const tokenEvent = {
    ...evm,
    to: evmTo,
    contractAddress: contract,
    tokenSymbol: 'TST',
    tokenDecimal: '6',
    value: '1000000',
  };
  const makeUtxo = (txid: string, token: boolean) => ({
    txid,
    version: 2,
    blockHash: 'bb'.repeat(32),
    blockHeight: 42,
    blockTime: 1700000000 + (token ? 1 : 0),
    confirmations: 5,
    fees: '1000',
    valueIn: '100000000',
    value: '99999000',
    vin: [
      {
        txid: 'cc'.repeat(32),
        vout: 0,
        n: 0,
        addresses: [fixture.utxo.userAddress],
        isAddress: true,
        isOwn: true,
        value: '100000000',
        sequence: 0xffffffff,
      },
    ],
    vout: [
      {
        n: 0,
        addresses: [fixture.utxo.recipientAddress],
        isAddress: true,
        isOwn: false,
        value: '99999000',
        ...(token
          ? { assetInfo: { assetGuid: guid, value: '100000000' } }
          : {}),
      },
    ],
    ...(token
      ? {
          tokenType: 'SPTAssetAllocationSend',
          tokenTransfers: [
            { token: guid, symbol: 'TSPT', decimals: 8, value: '100000000' },
          ],
          accountAssetTransfers: [
            {
              assetGuid: guid,
              symbol: 'TSPT',
              decimals: 8,
              value: '100000000',
            },
          ],
        }
      : {}),
  });
  const utxo = makeUtxo(utxoHash, false);
  const spt = makeUtxo(sptHash, true);
  const raw = Object.fromEntries(
    [utxo, spt].map((tx) => [
      tx.txid,
      {
        ...tx,
        vin: tx.vin.map((vin) => ({ ...vin, isOwn: undefined })),
        vout: tx.vout.map((vout) => ({ ...vout, isOwn: undefined })),
      },
    ])
  );
  const allowedBytes = [
    evmFrom,
    evmTo,
    evmHash,
    fixture.utxo.userAddress,
    fixture.utxo.recipientAddress,
    utxoHash,
    sptHash,
    guid,
  ];
  const attemptedWrites: string[] = [];
  const pageErrors: string[] = [];
  const reads: string[] = [];
  const expectedCopies: string[] = [];
  const observations: any = {
    runtime,
    testSourceSha256,
    syntheticHttpOnly: true,
    controllerStateReplaced: false,
  };
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('activity-detail-copy-purpose', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (identity) => {
        observations.workerIdentity = identity;
      }
    );
    wallet.context.on('request', (request) => {
      if (/\/sendtx(?:\/|$)/i.test(request.url()))
        attemptedWrites.push('sendtx');
      try {
        const data = request.postDataJSON();
        for (const call of Array.isArray(data) ? data : [data])
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
            attemptedWrites.push(call.method);
      } catch {
        /* ordinary GET */
      }
    });
    // Existing fixtureRead produces ordinary Blockbook account + raw-tx HTTP
    // responses; the actual history controller normalizes these after receipt.
    await wallet.context.route(
      /^https:\/\/(?:explorer-)?blockbook-dev\.syscoin\.org\/api\/v2\/(?:xpub|address|tx)\//,
      async (route) => {
        if (route.request().method() !== 'GET')
          return route.abort('blockedbyclient');
        const value = fixtureRead(fixture.utxo, route.request().url(), 'GET', {
          transactions: [utxo, spt],
          rawTransactions: raw,
        });
        if (value === undefined) return route.fallback();
        reads.push(new URL(route.request().url()).pathname);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(value),
        });
      }
    );
    await wallet.context.route(
      'https://explorer.tanenbaum.io/api**',
      async (route) => {
        if (route.request().method() !== 'GET')
          return route.abort('blockedbyclient');
        const url = new URL(route.request().url());
        const action = url.searchParams.get('action');
        let result: unknown = [];
        if (
          action === 'txlist' &&
          url.searchParams.get('address')?.toLowerCase() ===
            evmFrom.toLowerCase()
        )
          result = [evm];
        else if (
          action === 'tokentx' &&
          url.searchParams.get('address')?.toLowerCase() ===
            evmFrom.toLowerCase()
        )
          result = [tokenEvent];
        else if (
          action === 'gettxinfo' &&
          url.searchParams.get('txhash') === evmHash
        )
          result = evm;
        else if (['eth_blockNumber', 'eth_block_number'].includes(action || ''))
          result = '0x2a';
        reads.push('explorer:' + action);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: Array.isArray(result) && !result.length ? '0' : '1',
            message:
              Array.isArray(result) && !result.length
                ? 'No transactions found'
                : 'OK',
            result,
          }),
        });
      }
    );
    const coder = AbiCoder.defaultAbiCoder();
    const metadata = new Map([
      [
        id('name()').slice(0, 10),
        coder.encode(['string'], ['Synthetic activity token']),
      ],
      [id('symbol()').slice(0, 10), coder.encode(['string'], ['TST'])],
      [id('decimals()').slice(0, 10), coder.encode(['uint8'], [6])],
      [
        id('balanceOf(address)').slice(0, 10),
        coder.encode(['uint256'], [1000000]),
      ],
    ]);
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const data = route.request().postDataJSON();
      const calls = Array.isArray(data) ? data : [data];
      if (
        calls.some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      )
        return route.abort('blockedbyclient');
      const replies = calls.map((call) => {
        const result =
          call.method === 'eth_getTransactionCount'
            ? '0x1'
            : call.method === 'eth_blockNumber'
            ? '0x2a'
            : call.method === 'eth_getCode' &&
              call.params[0]?.toLowerCase() === contract
            ? '0x60006000fd'
            : call.method === 'eth_call' &&
              call.params[0]?.to?.toLowerCase() === contract
            ? metadata.get(call.params[0].data.slice(0, 10))
            : undefined;
        return result === undefined
          ? undefined
          : { jsonrpc: '2.0', id: call.id, result };
      });
      if (replies.some((reply) => reply === undefined)) return route.fallback();
      reads.push(...calls.map((call) => 'rpc:' + call.method));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(data) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const field = (label: string) =>
      page.getByText(label, { exact: true }).locator('..');
    const checkFields = async (
      caseName: string,
      fields: Array<[string, string]>
    ) => {
      const records = [];
      for (const [label, value] of fields) {
        const button = field(label).getByRole('button');
        await button.scrollIntoViewIfNeeded();
        const ax = await nativeButton(wallet!.context, page, button);
        records.push({
          label,
          ax,
          attributes: await button.evaluate((node) => ({
            title: node.getAttribute('title'),
            labelledby: node.getAttribute('aria-labelledby'),
            describedby: node.getAttribute('aria-describedby'),
          })),
        });
        expect
          .soft(
            String(ax.name),
            caseName + ': field purpose is part of native button name'
          )
          .toContain(label);
        expect
          .soft(String(ax.name), caseName + ': copy action remains named')
          .toContain(en.buttons.copy);
        if (records.length === 1) await button.click();
        else {
          await tabTo(page, button);
          await page.keyboard.press('Enter');
        }
        expectedCopies.push(value);
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).__activityPublicClipboard())
          )
          .toEqual({ writes: expectedCopies, failures: 0, unexpected: 0 });
      }
      observations[caseName] = records;
      await info.attach(caseName, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
    };
    await wallet.step(
      'create disposable wallet and open genuine ERC20 history details',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await installClipboardAudit(page, allowedBytes);
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
        await expect
          .poll(() => reads.includes('explorer:gettxinfo'))
          .toBe(true);
        await checkFields('evm-erc20', [
          [en.send.from, evmFrom],
          [en.send.to, evmTo],
          [en.send.transactionId, evmHash],
        ]);
      }
    );
    await wallet.step(
      'open genuine UTXO and SPT Activity rows and preserve their raw bytes',
      async () => {
        await wallet!.ensureOnHome();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        for (const [name, hash] of [
          ['utxo-native', utxoHash],
          ['utxo-spt', sptHash],
        ]) {
          const row = page
            .getByText(hash.slice(0, 4) + '...' + hash.slice(-14), {
              exact: true,
            })
            .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
          const listCopy = row.getByRole('button', {
            name: new RegExp('^' + en.buttons.copy),
          });
          const listAx = await nativeButton(
            wallet!.context,
            page,
            listCopy,
            '#activity-panel-list button'
          );
          observations[name + '-list-copy'] = listAx;
          expect
            .soft(
              String(listAx.name),
              name + ': list copy identifies the transaction field'
            )
            .toContain(en.send.transactionId);
          expect
            .soft(
              String(listAx.name),
              name + ': list copy identifies the exact transaction'
            )
            .toContain(hash);
          await listCopy.click();
          expectedCopies.push(hash);
          await expect
            .poll(() =>
              page.evaluate(() => (window as any).__activityPublicClipboard())
            )
            .toEqual({ writes: expectedCopies, failures: 0, unexpected: 0 });
          await row
            .getByRole('button', {
              name: en.notifications.clickToView,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/home\/details/);
          await expect
            .poll(() => reads.includes('/api/v2/tx/' + hash))
            .toBe(true);
          const fields: Array<[string, string]> = [
            [en.send.from, fixture.utxo.userAddress],
            [en.send.to, fixture.utxo.recipientAddress],
            [en.send.transactionId, hash],
          ];
          if (name === 'utxo-spt') fields.push([en.send.assetGuid, guid]);
          await checkFields(name, fields);
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home(?:[?#]|$)/);
          await page.locator('#activity-btn').click();
        }
      }
    );
    expect(attemptedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
    await info.attach('activity-detail-copy-evidence', {
      body: Buffer.from(
        JSON.stringify(
          {
            ...observations,
            reads,
            attemptedWrites,
            deniedWrites: routes?.deniedWrites,
            pageErrors,
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
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
