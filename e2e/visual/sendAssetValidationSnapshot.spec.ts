import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'crypto';
import {
  AbiCoder,
  Interface,
  dnsEncode,
  getAddress,
  id,
  namehash,
} from 'ethers';
import fs from 'fs';
import http from 'http';
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
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Permanent regression. Real vault, ordinary UI token import, real mainnet
// ENS provider and on-chain ABI calls. Only backend HTTP replies are synthetic.
// The local RPC server holds its response until a test-side explicit release;
// there is no sleep, controller interception, injected Redux state or signing.
const RPC = 'https://ethereum-rpc.publicnode.com/';
const TOKEN = '0x000000000000000000000000000000000000ed91';
const SYMBOL = 'SNAPSHOT';
const ENS_REGISTRY = '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e';
const ENS_RESOLVER = '0x000000000000000000000000000000000000ed92';
const UNIVERSAL_RESOLVER = '0xeeeeeeee14d718c2b47d9923deab1335e144eeee';
const NAMES = ['native-control.eth', 'token-control.eth', 'changed-asset.eth'];
const nodes = new Set(NAMES.map(namehash));
const dnsNodes = new Map(
  NAMES.map((name) => [dnsEncode(name), namehash(name)])
);
const abi = AbiCoder.defaultAbiCoder();
const universalInterface = new Interface([
  'function requireResolver(bytes) view returns ((bytes name, uint256 offset, bytes32 node, address resolver, bool extended))',
  'function resolve(bytes name, bytes data) view returns (bytes result, address resolver)',
]);
const resolverInterface = new Interface([
  'function resolve(bytes name, bytes data) view returns (bytes result)',
  'function addr(bytes32) view returns (address)',
  'function addr(bytes32,uint256) view returns (bytes)',
]);
const signature = (value: string) => id(value).slice(0, 10);
type Rpc = {
  id: number | string;
  jsonrpc: string;
  method: string;
  params: any[];
};
type Audit = {
  method: string;
  node?: string;
  queriedAddress?: string;
  selector?: string;
  target?: string;
};

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release, arrivals: 0 };
}
async function rpcServer(owner: string, recipient: string) {
  const reads: Audit[] = [];
  const deniedWrites: string[] = [];
  const unsupported: Audit[] = [];
  const nameGates = new Map<string, ReturnType<typeof gate>>();
  let tokenGate: ReturnType<typeof gate> | undefined;
  const respond = async (call: Rpc) => {
    const audit: Audit = { method: call?.method };
    const error = (message: string, code = -32601) => ({
      jsonrpc: '2.0',
      id: call?.id,
      error: { code, message },
    });
    if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params))
      return error('Invalid synthetic read');
    if (
      /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
        call.method
      )
    ) {
      deniedWrites.push(call.method);
      return error('Signing and writes forbidden');
    }
    let result: unknown;
    switch (call.method) {
      case 'eth_chainId':
        result = '0x1';
        break;
      case 'net_version':
        result = '1';
        break;
      case 'eth_blockNumber':
        result = '0x2b';
        break;
      case 'eth_getBalance':
        if (
          [owner, recipient].some(
            (a) => a.toLowerCase() === String(call.params[0]).toLowerCase()
          )
        )
          result =
            String(call.params[0]).toLowerCase() === owner.toLowerCase()
              ? '0x8ac7230489e80000'
              : '0x0';
        break;
      case 'eth_getTransactionCount':
        if (String(call.params[0]).toLowerCase() === owner.toLowerCase())
          result = '0x0';
        break;
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        result = '0x3b9aca00';
        break;
      case 'eth_getLogs':
        result = [];
        break;
      case 'eth_estimateGas':
        if (
          String(call.params[0]?.from).toLowerCase() === owner.toLowerCase() &&
          [recipient, TOKEN].some(
            (a) => a.toLowerCase() === String(call.params[0]?.to).toLowerCase()
          )
        )
          result = '0x5208';
        break;
      case 'eth_feeHistory':
        result = {
          oldestBlock: '0x2a',
          baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
          gasUsedRatio: [0.5],
          reward: [['0x3b9aca00']],
        };
        break;
      case 'eth_getBlockByNumber':
        result = {
          number: '0x2b',
          hash: '0x' + '12'.repeat(32),
          parentHash: '0x' + '11'.repeat(32),
          nonce: '0x0000000000000000',
          timestamp: '0x65000000',
          difficulty: '0x0',
          gasLimit: '0x1c9c380',
          gasUsed: '0x0',
          miner: '0x' + '00'.repeat(20),
          extraData: '0x',
          transactions: [],
          baseFeePerGas: '0x3b9aca00',
        };
        break;
      case 'eth_getCode':
        if (
          [
            owner,
            recipient,
            TOKEN,
            ENS_REGISTRY,
            ENS_RESOLVER,
            UNIVERSAL_RESOLVER,
          ].some(
            (a) => a.toLowerCase() === String(call.params[0]).toLowerCase()
          )
        )
          result = [
            TOKEN,
            ENS_REGISTRY,
            ENS_RESOLVER,
            UNIVERSAL_RESOLVER,
          ].includes(String(call.params[0]).toLowerCase())
            ? '0x60006000fd'
            : '0x';
        break;
      case 'eth_call': {
        const target = String(call.params[0]?.to).toLowerCase();
        const data = String(call.params[0]?.data).toLowerCase();
        const selector = data.slice(0, 10);
        Object.assign(audit, { target, selector });
        if (target === TOKEN) {
          const metadata = [
            ['name()', 'string', 'Synthetic snapshot token'],
            ['symbol()', 'string', SYMBOL],
            ['decimals()', 'uint8', 6],
            ['totalSupply()', 'uint256', 1000000],
            ['supportsInterface(bytes4)', 'bool', false],
          ] as const;
          if (selector === signature('balanceOf(address)')) {
            const [address] = abi.decode(['address'], '0x' + data.slice(10));
            if (
              data !==
              signature('balanceOf(address)') +
                abi.encode(['address'], [address]).slice(2)
            )
              break;
            audit.queriedAddress = String(address).toLowerCase();
            // The installed SDK's getContractType probes balanceOf(contract)
            // after refusing ERC721/ERC1155. This is not the owner's balance.
            if (String(address).toLowerCase() === TOKEN) {
              reads.push(audit);
              return {
                jsonrpc: '2.0',
                id: call.id,
                result: abi.encode(['uint256'], [0]),
              };
            }
            if (String(address).toLowerCase() !== owner.toLowerCase()) break;
            reads.push(audit);
            if (tokenGate) {
              tokenGate.arrivals++;
              await tokenGate.promise;
            }
            return {
              jsonrpc: '2.0',
              id: call.id,
              result: abi.encode(['uint256'], [1000000]),
            };
          }
          if (selector === signature('asset()')) {
            reads.push(audit);
            return error('Synthetic ERC20 is not an ERC4626 vault', 3);
          }
          const row = metadata.find(([name]) => signature(name) === selector);
          if (row) result = abi.encode([row[1]], [row[2]]);
        } else if (
          target === UNIVERSAL_RESOLVER &&
          selector === signature('requireResolver(bytes)')
        ) {
          // ethers 6.17 first asks the mainnet UniversalResolver for the exact
          // DNS name. Return its real tuple ABI, not the legacy registry ABI.
          const [dnsName] = universalInterface.decodeFunctionData(
            'requireResolver',
            data
          );
          const node = dnsNodes.get(dnsName);
          if (
            !node ||
            universalInterface.encodeFunctionData('requireResolver', [
              dnsName,
            ]) !== data
          )
            break;
          audit.node = node;
          result = universalInterface.encodeFunctionResult('requireResolver', [
            [dnsName, 0, node, ENS_RESOLVER, true],
          ]);
        } else if (
          [ENS_RESOLVER, UNIVERSAL_RESOLVER].includes(target) &&
          selector === signature('resolve(bytes,bytes)')
        ) {
          const outer =
            target === UNIVERSAL_RESOLVER
              ? universalInterface
              : resolverInterface;
          const [dnsName, subcall] = outer.decodeFunctionData('resolve', data);
          const node = dnsNodes.get(dnsName);
          if (
            !node ||
            outer.encodeFunctionData('resolve', [dnsName, subcall]) !== data
          )
            break;
          const inner = resolverInterface.parseTransaction({ data: subcall });
          if (
            !inner ||
            !['addr(bytes32)', 'addr(bytes32,uint256)'].includes(
              inner.signature
            ) ||
            inner.args[0] !== node ||
            (inner.signature === 'addr(bytes32,uint256)' &&
              inner.args[1] !== BigInt(60)) ||
            resolverInterface.encodeFunctionData(
              inner.fragment,
              Array.from(inner.args)
            ) !== subcall
          )
            break;
          const innerResult = resolverInterface.encodeFunctionResult(
            inner.fragment,
            [recipient]
          );
          audit.node = node;
          reads.push(audit);
          const held = nameGates.get(node);
          if (held) {
            held.arrivals++;
            await held.promise;
          }
          // Wildcard resolvers return one bytes value; UniversalResolver wraps
          // the same inner ABI result together with the resolver address.
          return {
            jsonrpc: '2.0',
            id: call.id,
            result: outer.encodeFunctionResult(
              'resolve',
              target === UNIVERSAL_RESOLVER
                ? [innerResult, ENS_RESOLVER]
                : [innerResult]
            ),
          };
        } else if (
          target === ENS_REGISTRY &&
          selector === signature('resolver(bytes32)')
        ) {
          const [node] = abi.decode(['bytes32'], '0x' + data.slice(10));
          audit.node = node;
          if (nodes.has(node)) result = abi.encode(['address'], [ENS_RESOLVER]);
        } else if (
          target === ENS_RESOLVER &&
          selector === signature('supportsInterface(bytes4)')
        ) {
          result = abi.encode(['bool'], [false]);
        } else if (
          target === ENS_RESOLVER &&
          [
            signature('addr(bytes32)'),
            signature('addr(bytes32,uint256)'),
          ].includes(selector)
        ) {
          const node = '0x' + data.slice(10, 74);
          audit.node = node;
          if (!nodes.has(node)) break;
          reads.push(audit);
          const held = nameGates.get(node);
          if (held) {
            held.arrivals++;
            await held.promise;
          }
          return {
            jsonrpc: '2.0',
            id: call.id,
            result:
              selector === signature('addr(bytes32)')
                ? abi.encode(['address'], [recipient])
                : abi.encode(['bytes'], [recipient]),
          };
        }
        break;
      }
    }
    if (result === undefined) {
      unsupported.push(audit);
      return error('Unsupported synthetic mainnet read');
    }
    reads.push(audit);
    return { jsonrpc: '2.0', id: call.id, result };
  };
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/rpc') {
      res.writeHead(403).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw new Error('Oversize fixture request');
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const replies = await Promise.all(
        (Array.isArray(body) ? body : [body]).map(respond)
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture port');
  return {
    url: `http://127.0.0.1:${address.port}/rpc`,
    reads,
    deniedWrites,
    unsupported,
    armName(name: string) {
      const held = gate();
      nameGates.set(namehash(name), held);
      return held;
    },
    armToken() {
      tokenGate = gate();
      return tokenGate;
    },
    releaseAll() {
      for (const held of nameGates.values()) held.release();
      tokenGate?.release();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function choose(page: Page, token: boolean) {
  await page.locator('#send-form [aria-haspopup="menu"]').click();
  const choice = page.getByRole('menuitem').filter({
    has: page.getByText(token ? SYMBOL : 'ETH', { exact: true }),
  });
  await expect(
    choice.getByText(token ? 'ERC-20' : en.send.native, { exact: true })
  ).toBeVisible();
  await choice.click();
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const tx = window.history.state?.usr?.tx;
    return tx
      ? {
          sender: tx.sender,
          receivingAddress: tx.receivingAddress,
          amount: tx.amount,
          isMax: tx.isMax,
          transactionType: tx.transactionType,
          token: tx.token
            ? {
                contractAddress: tx.token.contractAddress,
                decimals: tx.token.decimals,
                balance: tx.token.balance,
                symbol: tx.token.symbol,
              }
            : null,
        }
      : null;
  });
}

async function runValidationSnapshot(info: TestInfo, width: number) {
  test.setTimeout(240000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const proxy = await startUtxoFixtureServer();
  const rpc = await rpcServer(fixture.evmAddresses[0], fixture.evmAddresses[1]);
  const writeAttempts: string[] = [],
    pageErrors: string[] = [];
  const observations: any = {
    runtime,
    testSourceSha256: createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex'),
    syntheticHttpOnly: true,
    controls: [],
  };
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SendSnapshotSynthetic!2026',
    chainId: 1,
    networkLabel: 'Ethereum Mainnet',
    rpcUrl: proxy.url,
  });
  try {
    wallet = await PaliWallet.launch(
      'send-asset-validation-snapshot-' + width,
      {
        offlineHttpProxy: proxy.url,
        viewport: { width, height: width === 400 ? 620 : 360 },
      }
    );
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      proxy.url
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
      try {
        const body = request.postDataJSON();
        for (const call of Array.isArray(body) ? body : [body])
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
            writeAttempts.push(call.method);
      } catch {
        /* REST */
      }
    });
    await wallet.context.route(RPC, async (route) => {
      if (route.request().method() !== 'POST')
        return route.abort('blockedbyclient');
      const response = await fetch(rpc.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: route.request().postData() || '',
      });
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: await response.text(),
      });
    });
    await wallet.context.route(
      'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api**',
      async (route) => {
        const url = new URL(route.request().url());
        if (
          route.request().method() !== 'GET' ||
          ![
            'txlist',
            'pendingtxlist',
            'tokentx',
            'tokenlist',
            'eth_block_number',
          ].includes(url.searchParams.get('action') || '')
        )
          return route.fallback();
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            status: '1',
            message: 'OK',
            result:
              url.searchParams.get('action') === 'eth_block_number'
                ? '0x2b'
                : [],
          }),
        });
      }
    );
    await wallet.context.route(
      'https://api.coingecko.com/api/v3/**',
      async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET') return route.fallback();
        let body: unknown;
        if (url.pathname === `/api/v3/coins/ethereum/contract/${TOKEN}`)
          body = {
            id: 'synthetic-snapshot',
            name: 'Synthetic snapshot token',
            symbol: SYMBOL,
            categories: [],
            description: { en: 'Synthetic read-only token fixture' },
            market_data: { current_price: { usd: 1 } },
          };
        else if (
          url.pathname === '/api/v3/simple/price' &&
          url.searchParams.get('ids') === 'ethereum'
        )
          body = { ethereum: { usd: 1, usd_24h_change: 0 } };
        else return route.fallback();
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const amount = page.getByPlaceholder(en.send.amount, { exact: true });
    const receiver = page.getByPlaceholder(en.send.receiver, { exact: true });
    const next = page.locator('#send-eth-next-btn');
    const cancel = page.getByRole('button', {
      name: en.buttons.cancel,
      exact: true,
    });
    const checkPreview = async (value: string, token: boolean) => {
      await expect(page).toHaveURL(/#\/send\/confirm$/);
      await expect(page.locator('p.text-2xl')).toHaveText(
        `${value} ${token ? SYMBOL : 'ETH'}`
      );
      const state = await snapshot(page);
      // Fresh resolution returns checksum case; the real shared ENS cache
      // indexes addresses in lowercase. Require the exact same 20-byte address
      // in either valid representation, rather than treating case as identity.
      expect(getAddress(state!.receivingAddress)).toBe(
        getAddress(fixture.evmAddresses[1])
      );
      expect(state).toMatchObject({
        sender: fixture.evmAddresses[0],
        amount: value,
        isMax: false,
        token: token
          ? { contractAddress: TOKEN, decimals: 6, balance: 1 }
          : null,
      });
      observations.controls.push(state);
      await cancel.click();
      await expect(page).toHaveURL(/#\/send\/eth$/);
    };
    await wallet.step(
      'import synthetic vault and token through the ordinary mainnet UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('10');
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        const addCustomButtons = page.getByRole('button', {
          name: en.tokens.addCustomTab,
          exact: true,
        });
        const customTab = addCustomButtons.and(
          page.locator('button[aria-pressed]')
        );
        await expect(customTab).toHaveCount(1);
        await expect(customTab).toHaveAttribute('aria-pressed', 'false');
        await customTab.click();
        await expect(customTab).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#custom-token-contract').fill(TOKEN);
        const importToken = page.getByRole('button', {
          name: `Import ${SYMBOL} token`,
          exact: true,
        });
        await importToken.click();
        await expect(importToken).toBeDisabled();
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet!.ensureOnHome();
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/eth$/);
      }
    );
    await wallet.step(
      'healthy delayed native ENS keeps the native amount and Cancel restores it',
      async () => {
        const held = rpc.armName(NAMES[0]);
        await receiver.fill(NAMES[0]);
        await amount.fill('2');
        await expect(next).toBeEnabled();
        await next.click();
        await expect.poll(() => held.arrivals).toBeGreaterThan(0);
        await expect(page).toHaveURL(/#\/send\/eth$/);
        held.release();
        await checkPreview('2', false);
        await expect(amount).toHaveValue('2');
        await expect(receiver).toHaveValue(NAMES[0]);
      }
    );
    await wallet.step(
      'healthy token-first validation refuses two tokens and accepts exactly one half',
      async () => {
        await choose(page, true);
        await expect(amount).toBeEnabled();
        await receiver.fill(NAMES[1]);
        await amount.fill('2');
        await next.click();
        await expect(
          page.getByText(
            en.send.insufficientFundsVerified.replace('{{balance}}', '1'),
            { exact: true }
          )
        ).toBeVisible();
        await expect(page).toHaveURL(/#\/send\/eth$/);
        const error = page.getByText(
          en.send.insufficientFundsVerified.replace('{{balance}}', '1'),
          { exact: true }
        );
        await error.scrollIntoViewIfNeeded();
        await info.attach('verified-balance-error-' + width, {
          contentType: 'image/png',
          body: await page.screenshot({ animations: 'disabled' }),
        });
        await amount.fill('0.5');
        await next.click();
        await checkPreview('0.5', true);
        await expect(amount).toHaveValue('0.5');
      }
    );
    await wallet.step(
      'changing asset while ENS is held cannot reuse native validation for an unverified token',
      async () => {
        await choose(page, false);
        await expect(amount).toBeEnabled();
        const heldName = rpc.armName(NAMES[2]);
        await receiver.fill(NAMES[2]);
        await amount.fill('2');
        await next.click();
        await expect.poll(() => heldName.arrivals).toBeGreaterThan(0);
        const heldToken = rpc.armToken();
        await choose(page, true);
        await expect(amount).toBeDisabled();
        await expect.poll(() => heldToken.arrivals).toBeGreaterThan(0);
        const beforeReleaseReads = rpc.reads.length;
        heldName.release();
        // Observe either the actual preview route or settled receiver validation;
        // never infer refusal from an arbitrary sleep or a short lack of motion.
        await expect
          .poll(async () =>
            page.evaluate(() => {
              if (window.location.hash === '#/send/confirm') return 'preview';
              const input = document.querySelector(
                '#send-form input[type="text"]'
              );
              const item = input?.closest('.ant-form-item');
              return item &&
                !item.classList.contains('ant-form-item-is-validating') &&
                item.classList.contains('ant-form-item-has-success')
                ? 'settled-form'
                : 'pending';
            })
          )
          .not.toBe('pending');
        const reachedPreview = /#\/send\/confirm$/.test(page.url());
        observations.changedAsset = {
          reachedPreview,
          snapshot: reachedPreview ? await snapshot(page) : null,
          tokenBalanceResponseStillHeld: true,
          heldTokenReads: heldToken.arrivals,
          beforeReleaseReads,
          afterReleaseReads: rpc.reads.length,
        };
        if (reachedPreview) {
          await expect(page.locator('p.text-2xl')).toHaveText(`2 ${SYMBOL}`);
          await cancel.click();
          await expect(page).toHaveURL(/#\/send\/eth$/);
        }
        heldToken.release();
        expect
          .soft(
            reachedPreview,
            'A native amount must not become a newly selected unverified ERC20 preview'
          )
          .toBe(false);
        await expect(amount).toBeEnabled();
        await next.click();
        await expect(
          page.getByText(
            en.send.insufficientFundsVerified.replace('{{balance}}', '1'),
            { exact: true }
          )
        ).toBeVisible();
        await amount.fill('0.5');
        await next.click();
        await checkPreview('0.5', true);
      }
    );
    expect(writeAttempts).toEqual([]);
    expect(rpc.deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(rpc.unsupported).toEqual([]);
    expect(pageErrors).toEqual([]);
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    rpc.releaseAll();
    observations.rpcReads = rpc.reads;
    observations.unsupportedRpc = rpc.unsupported;
    observations.writeAttempts = writeAttempts;
    observations.deniedWrites = rpc.deniedWrites;
    observations.baseFixtureDeniedWrites = routes?.deniedWrites || [];
    observations.pageErrors = pageErrors;
    observations.status = status;
    await info.attach('send-asset-validation-observations', {
      body: JSON.stringify(observations, null, 2),
      contentType: 'application/json',
    });
    await wallet?.dispose(status);
    await rpc.close();
    await proxy.close();
    Object.assign(E2E_CONFIG, previous);
  }
}
for (const width of [400, 320]) {
  test(`Send keeps asset validation bound to pending ENS reads at ${width}px`, async ({}, info) => {
    await runValidationSnapshot(info, width);
  });
}
