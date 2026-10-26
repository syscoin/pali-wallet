import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

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

// Ordinary imports and real controller storage establish the confirmation.
// Only exact public HTTP/ABI reads are synthetic. No state, controller, DOM,
// selection, timeout, retry policy or signing behavior is replaced.
const CONTRACTS = [
  '0x111111111111111111111111111111111111e721',
  '0x222222222222222222222222222222222222e722',
];
const RPC_URL = 'https://rpc.tanenbaum.io/';
const CHAIN_ID = 5700;
const abi = AbiCoder.defaultAbiCoder();
const selector = (signature: string) => id(signature).slice(0, 10);
const balanceSelector = selector('balanceOf(address)');
const shortContract = (contract: string) =>
  contract.slice(0, 4) + '...' + contract.slice(-4);
const removalLabel = (symbol: string) =>
  en.nftDetails.deleteNamedCollection.replace('{{symbol}}', symbol);

const publicAssets = (page: Page) =>
  page.evaluate(async (contracts) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const active = state.vault.activeAccount;
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const stored = await chrome.storage.local.get(key);
    const project = (vault: any) =>
      (vault?.accountAssets?.[active.type]?.[active.id]?.ethereum || [])
        .filter((asset: any) =>
          contracts.includes(asset.contractAddress?.toLowerCase())
        )
        .map((asset: any) => ({
          id: asset.id,
          contract: asset.contractAddress.toLowerCase(),
          chainId: asset.chainId,
          symbol: asset.tokenSymbol,
          name: asset.name,
          balance: asset.balance,
          standard: asset.tokenStandard,
          isNft: asset.isNft,
        }))
        .sort((a: any, b: any) => a.contract.localeCompare(b.contract));
    return {
      active: { id: active.id, type: active.type },
      owner: state.vault.accounts[active.type][active.id].address,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
        label: state.vault.activeNetwork.label,
      },
      live: project(state.vault),
      persisted: project(stored[key]),
    };
  }, CONTRACTS);

const BLACKLIST_FEEDS = new Map<string, unknown>([
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
    { blacklist: [], whitelist: [], fuzzylist: [] },
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
    [],
  ],
]);

// Ignore query ordering and EVM address letter-case, not endpoint/parameters.
const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  const serialized = query.toString();
  return `${url.origin}${url.pathname}${serialized ? `?${serialized}` : ''}`;
};

async function nativeIdentity(
  context: BrowserContext,
  page: Page,
  target: Locator,
  domSelector: string,
  role: string
) {
  const index = await target.evaluate(
    (element, query) =>
      Array.from(document.querySelectorAll(query)).indexOf(element),
    domSelector
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: domSelector,
    });
    const partial = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId: nodeIds[index],
      fetchRelatives: false,
    });
    const rootNode = partial.nodes.find(
      (node) => !node.ignored && node.role?.value === role
    );
    expect(rootNode).toBeDefined();
    const full = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(full.nodes.map((node) => [node.nodeId, node]));
    expect(byId.has(rootNode!.nodeId)).toBe(true);
    const descendants: { description: string; name: string; role: string }[] =
      [];
    const visit = (nodeId: string) => {
      const node = byId.get(nodeId);
      if (!node) return;
      if (!node.ignored)
        descendants.push({
          role: String(node.role?.value || ''),
          name: String(node.name?.value || ''),
          description: String(node.description?.value || ''),
        });
      for (const child of node.childIds || []) visit(child);
    };
    visit(rootNode!.nodeId);
    const dom = await target.evaluate((element) => ({
      text: (element as HTMLElement).innerText,
      title: element.getAttribute('title'),
      ariaLabel: element.getAttribute('aria-label'),
      labelledBy: element.getAttribute('aria-labelledby'),
      describedBy: element.getAttribute('aria-describedby'),
      identityAttributes: [element, ...element.querySelectorAll('*')].flatMap(
        (node) =>
          ['title', 'aria-label', 'alt'].flatMap((attribute) => {
            const value = node.getAttribute(attribute);
            return value ? [{ attribute, value }] : [];
          })
      ),
    }));
    return {
      role: String(rootNode!.role?.value || ''),
      name: String(rootNode!.name?.value || ''),
      description: String(rootNode!.description?.value || ''),
      descendants,
      dom,
      // No backend node IDs, focus state or geometry in this identity comparison.
      semanticSignature: JSON.stringify({
        text: dom.text,
        attributes: dom.identityAttributes,
        descendants,
      }),
    };
  } finally {
    await cdp.detach();
  }
}

// Measure the actual full-address glyph ranges, not just the paragraph box.
// The confirmation body can wrap or scroll; no text or selection is changed.
async function contractExposure(dialog: Locator, contract: string) {
  const paragraph = dialog.locator('p').filter({ hasText: contract });
  if ((await paragraph.count()) !== 1)
    return { found: false, fullyVisible: false, rects: [] };
  return paragraph.evaluate((element, exactContract) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode && !textNode.textContent?.includes(exactContract))
      textNode = walker.nextNode();
    if (!textNode) return { found: false, fullyVisible: false, rects: [] };
    const start = textNode.textContent!.indexOf(exactContract);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + exactContract.length);
    const clip = {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
    let stylesVisible = true;
    for (
      let parent: Element | null = element;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      stylesVisible &&=
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0;
      const bounds = parent.getBoundingClientRect();
      if (/(?:hidden|clip|scroll|auto)/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left);
        clip.right = Math.min(clip.right, bounds.right);
      }
      if (/(?:hidden|clip|scroll|auto)/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top);
        clip.bottom = Math.min(clip.bottom, bounds.bottom);
      }
    }
    const rects = Array.from(range.getClientRects()).map((rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    }));
    return {
      found: true,
      text: exactContract,
      clip,
      rects,
      fullyVisible:
        stylesVisible &&
        rects.length > 0 &&
        rects.every(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= clip.left - 1 &&
            rect.right <= clip.right + 1 &&
            rect.top >= clip.top - 1 &&
            rect.bottom <= clip.bottom + 1
        ),
    };
  }, contract);
}

for (const scenario of ['different-symbol', 'same-symbol'] as const) {
  test(
    'ERC721 ' + scenario + ' removal retains selected collection identity',
    async ({}, info) => {
      expect(process.version).toBe('v26.12.1');
      expect(info.config.workers).toBe(1);
      expect(info.retry).toBe(0);
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
      expect(E2E_CONFIG.extensionPath).toBe(
        process.env.PALI_TEST_DAPP_EXTENSION_PATH
      );
      const runtime = extensionEvidence();
      expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
      const sourceSha256 = createHash('sha256')
        .update(fs.readFileSync(info.file))
        .digest('hex');
      const previous = { ...E2E_CONFIG };
      const fixture = createIsolatedVaultFixture();
      const owner = fixture.evmAddresses[0].toLowerCase();
      const symbols =
        scenario === 'same-symbol'
          ? ['MATCH721', 'MATCH721']
          : ['FIRST721', 'SECOND721'];
      const names =
        scenario === 'same-symbol'
          ? ['Synthetic matching collection', 'Synthetic matching collection']
          : ['First synthetic collection', 'Second synthetic collection'];
      const config = getNetworkConfig(57, 'sys');
      const initialXpub = new sys.HDSigner(
        UTXO_FIXTURE_SEED,
        '',
        false,
        config.networks,
        57,
        config.types.zPubType,
        84
      ).getAccountXpub();
      const auxiliary = new Map<string, unknown>(BLACKLIST_FEEDS);
      const addAuxiliary = (url: string, body: unknown) =>
        auxiliary.set(requestKey(new URL(url)), body);
      for (const query of [
        'details=tokenBalances&tokens=used',
        'details=txsummary&pageSize=30',
        'details=tokenBalances&tokens=nonzero',
        'details=txslight&pageSize=30',
      ])
        addAuxiliary(
          'https://blockbook.syscoin.org/api/v2/xpub/' +
            initialXpub +
            '?' +
            query,
          {
            address: initialXpub,
            balance: '0',
            unconfirmedBalance: '0',
            totalReceived: '0',
            totalSent: '0',
            txs: 0,
            unconfirmedTxs: 0,
            usedTokens: 0,
            tokens: [],
            tokensAsset: [],
            transactions: [],
          }
        );
      for (const origin of [
        'https://blockbook.syscoin.org',
        'https://blockbook-dev.syscoin.org',
      ])
        addAuxiliary(origin + '/api/v2/tickers/currency', {
          ts: 1,
          rates: { usd: 1 },
        });
      addAuxiliary('https://api.coingecko.com/api/v3/asset_platforms', []);
      addAuxiliary(
        'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
        { syscoin: { usd: 1, ['usd_24h_change']: 0 } }
      );
      for (const action of [
        'tokenlist',
        'txlist',
        'pendingtxlist',
        'tokentx',
      ]) {
        const url = new URL('https://explorer.tanenbaum.io/api');
        url.searchParams.set('module', 'account');
        url.searchParams.set('action', action);
        url.searchParams.set('address', owner);
        if (action === 'txlist' || action === 'tokentx')
          url.searchParams.set('sort', 'desc');
        addAuxiliary(url.href, {
          status: action === 'tokenlist' ? '1' : '0',
          message: action === 'tokenlist' ? 'OK' : 'No transactions found',
          result: [],
        });
      }
      const server = await startUtxoFixtureServer();
      const reads: Array<Record<string, unknown>> = [];
      const responses: Array<Record<string, unknown>> = [];
      const unsupported: Array<Record<string, unknown>> = [];
      const forbidden: string[] = [];
      const pageErrors: string[] = [];
      const responseErrors: string[] = [];
      const httpReads: Array<{ method: string; url: string }> = [];
      const httpFailures: Array<{
        error?: string;
        method: string;
        url: string;
      }> = [];
      const auxiliaryReads: string[] = [];
      const observations: Record<string, any> = {
        scenario,
        runtime,
        sourceSha256,
        rows: [],
        dialogs: [],
        milestones: {},
      };
      let wallet: PaliWallet | undefined;
      let routes:
        | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
        | undefined;
      let status: 'passed' | 'failed' = 'failed';
      const evidence = () => ({
        ...observations,
        status,
        contracts: CONTRACTS,
        symbols,
        names,
        reads,
        responses,
        unsupported,
        forbidden,
        pageErrors,
        responseErrors,
        httpReads,
        httpFailures,
        auxiliaryReads,
        fixtureReads: routes?.reads || [],
        deniedWrites: routes?.deniedWrites || [],
        proxyDeniedConnections: server.blocked.length,
        proxyDeniedConnectionsArePlatformEvidenceOnly: true,
        syntheticHttpOnly: true,
        stateInjected: false,
        controllerReplaced: false,
        signingOrBroadcastRequested: false,
        collectionRemovalIsWalletMetadataOnly: true,
      });
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'NftIdentitySynthetic!2026',
        chainId: CHAIN_ID,
        networkLabel: 'Syscoin NEVM Testnet',
        rpcUrl: server.url,
      });
      try {
        wallet = await PaliWallet.launch(
          'nft-collection-removal-identity-' + scenario,
          {
            offlineHttpProxy: server.url,
            viewport: { width: 400, height: 620 },
          }
        );
        const page = wallet.page;
        const step: PaliWallet['step'] = (name, action) =>
          wallet!.step(scenario + ': ' + name, action);
        // Observe the first generic route too, not just the later contract handler.
        page.on('pageerror', (error) => pageErrors.push(error.message));
        wallet.context.on('request', (request) => {
          const url = new URL(request.url());
          if (['http:', 'https:'].includes(url.protocol))
            httpReads.push({ method: request.method(), url: request.url() });
          if (/\/sendtx(?:\/|$)/i.test(url.pathname)) forbidden.push('sendtx');
          try {
            const body = request.postDataJSON();
            for (const call of Array.isArray(body) ? body : [body])
              if (
                /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                  call?.method || ''
                )
              )
                forbidden.push(call.method);
          } catch {
            /* Ordinary GET has no JSON body. */
          }
        });
        wallet.context.on('requestfailed', (request) => {
          if (/^https?:/.test(request.url()))
            httpFailures.push({
              method: request.method(),
              url: request.url(),
              error: request.failure()?.errorText,
            });
        });
        wallet.context.on('response', async (response) => {
          if (
            response.url() !== RPC_URL ||
            response.request().method() !== 'POST'
          )
            return;
          let calls: any[];
          try {
            const body = response.request().postDataJSON();
            calls = (Array.isArray(body) ? body : [body]).filter(
              (call) =>
                call?.method === 'eth_call' &&
                CONTRACTS.includes(call.params?.[0]?.to?.toLowerCase()) &&
                String(call.params?.[0]?.data).slice(0, 10) === balanceSelector
            );
          } catch {
            return;
          }
          if (!calls.length) return;
          try {
            const body = await response.json(),
              replies = Array.isArray(body) ? body : [body];
            for (const call of calls) {
              const reply = replies.find((item: any) => item.id === call.id);
              if (!reply) throw new Error('Missing actual balanceOf reply');
              const [account] = abi.decode(
                ['address'],
                '0x' + call.params[0].data.slice(10)
              );
              responses.push({
                at: Date.now(),
                target: call.params[0].to.toLowerCase(),
                owner: String(account).toLowerCase(),
                status: response.status(),
                error: reply.error ?? null,
                result: reply.result ?? null,
              });
            }
          } catch (error) {
            responseErrors.push(String(error));
          }
        });
        routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url,
          (url) => {
            if (!auxiliary.has(requestKey(url))) return undefined;
            auxiliaryReads.push(url.href);
            return auxiliary.get(requestKey(url));
          }
        );
        await wallet.context.route(RPC_URL, async (route) => {
          if (route.request().method() !== 'POST') return route.fallback();
          let input: any;
          try {
            input = route.request().postDataJSON();
          } catch {
            unsupported.push({ method: 'malformed-json' });
            return route.abort('blockedbyclient');
          }
          const calls = Array.isArray(input) ? input : [input];
          const targetOf = (call: any) =>
            String(
              call.params?.[0]?.to || call.params?.[0] || ''
            ).toLowerCase();
          if (
            !calls.some(
              (call: any) =>
                ['eth_call', 'eth_getCode'].includes(call?.method) &&
                CONTRACTS.includes(targetOf(call))
            )
          )
            return route.fallback();
          const replies = calls.map((call: any) => {
            const target = targetOf(call),
              index = CONTRACTS.indexOf(target);
            let result: unknown;
            if (call?.jsonrpc === '2.0' && Array.isArray(call.params)) {
              if (call.method === 'eth_chainId' && call.params.length === 0)
                result = '0x1644';
              if (call.method === 'eth_getCode' && index >= 0)
                result = '0x60006000fd';
              if (call.method === 'eth_call' && index >= 0) {
                const data = String(call.params[0].data),
                  prefix = data.slice(0, 10);
                if (prefix === selector('name()') && data.length === 10)
                  result = abi.encode(['string'], [names[index]]);
                if (prefix === selector('symbol()') && data.length === 10)
                  result = abi.encode(['string'], [symbols[index]]);
                if (
                  prefix === selector('supportsInterface(bytes4)') &&
                  data.length === 74
                ) {
                  const [value] = abi.decode(['bytes4'], '0x' + data.slice(10));
                  result = abi.encode(
                    ['bool'],
                    [value === '0x80ac58cd' || value === '0x01ffc9a7']
                  );
                }
                if (prefix === balanceSelector && data.length === 74) {
                  const [account] = abi.decode(
                    ['address'],
                    '0x' + data.slice(10)
                  );
                  if (String(account).toLowerCase() === owner)
                    result = abi.encode(['uint256'], ['1']);
                }
                if (result !== undefined)
                  reads.push({ target, selector: prefix, result });
              }
            }
            if (result === undefined) {
              unsupported.push({ method: call?.method, target });
              return {
                jsonrpc: '2.0',
                id: call?.id,
                error: { code: -32000, message: 'Unsupported synthetic read' },
              };
            }
            return { jsonrpc: '2.0', id: call.id, result };
          });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(Array.isArray(input) ? replies : replies[0]),
          });
        });
        const row = (contract: string) =>
          page.getByRole('listitem').filter({
            has: page.getByText(shortContract(contract), { exact: true }),
          });
        const remove = (contract: string) =>
          row(contract).getByRole('button', {
            name: removalLabel(symbols[CONTRACTS.indexOf(contract)]),
            exact: true,
          });
        const showNfts = async () => {
          await page.locator('#assets-btn').click();
          const nfts = page.getByRole('button', {
            name: en.tooltip.viewNFTs,
            exact: true,
          });
          await nfts.click();
          await expect(nfts).toHaveAttribute('aria-pressed', 'true');
        };
        await step(
          'create a disposable wallet and select the ordinary EVM flow',
          async () => {
            observations.worker = await verifyExecutingWorker(
              wallet!.context,
              wallet!.extensionId,
              E2E_CONFIG.extensionPath,
              (value) => {
                observations.worker = value;
              }
            );
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
            await wallet!.ensureOnHome();
            observations.initial = await publicAssets(page);
            expect(observations.initial.live).toEqual([]);
            expect(observations.initial.persisted).toEqual([]);
            expect(observations.initial.owner.toLowerCase()).toBe(owner);
            expect(observations.initial.network.chainId).toBe(CHAIN_ID);
            await page.locator('#assets-btn').click();
            await page
              .getByRole('button', { name: en.home.importToken, exact: true })
              .click();
            await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
            const custom = page
              .getByRole('button', {
                name: en.tokens.addCustomTab,
                exact: true,
              })
              .and(page.locator('button[aria-pressed]'));
            await expect(custom).toHaveCount(1);
            await custom.click();
            await expect(custom).toHaveAttribute('aria-pressed', 'true');
          }
        );
        for (const [index, contract] of CONTRACTS.entries()) {
          await step('ordinary custom import ' + contract, async () => {
            await page.locator('#custom-token-contract').fill(contract);
            const add = page.getByRole('button', {
              name: en.tokens.importNamedToken.replace(
                '{{symbol}}',
                symbols[index]
              ),
              exact: true,
            });
            await expect(add).toBeEnabled();
            await add.click();
            await expect(add).toBeDisabled();
            await expect
              .poll(async () =>
                (
                  await publicAssets(page)
                ).persisted.map((asset: any) => asset.contract)
              )
              .toContain(contract);
            await expect
              .poll(() =>
                responses.some(
                  (response) =>
                    response.target === contract &&
                    response.owner === owner &&
                    response.status === 200 &&
                    response.error === null &&
                    response.result === abi.encode(['uint256'], ['1'])
                )
              )
              .toBe(true);
            const asset = (await publicAssets(page)).live.find(
              (item: any) => item.contract === contract
            );
            expect(asset).toMatchObject({
              id: contract + '-' + CHAIN_ID,
              chainId: CHAIN_ID,
              symbol: symbols[index],
              name: names[index],
              standard: 'ERC-721',
              isNft: true,
              balance: 1,
            });
          });
        }
        await step(
          'Back shows the two exact live and durable collectible identities',
          async () => {
            await page
              .getByRole('button', { name: en.buttons.back, exact: true })
              .click();
            await wallet!.ensureOnHome();
            await showNfts();
            observations.before = await publicAssets(page);
            expect(
              observations.before.live.map((asset: any) => asset.contract)
            ).toEqual(CONTRACTS);
            expect(observations.before.persisted).toEqual(
              observations.before.live
            );
            expect(observations.before.active).toEqual(
              observations.initial.active
            );
            expect(observations.before.network).toEqual(
              observations.initial.network
            );
            for (const contract of CONTRACTS) {
              await expect(row(contract)).toHaveCount(1);
              await expect(row(contract)).toContainText(
                shortContract(contract)
              );
            }
            await expect(page.locator('.Toastify__toast')).toHaveCount(0);
            observations.milestones.importAndExactPersistence = true;
          }
        );
        for (const viewport of [
          { width: 320, height: 360 },
          { width: 400, height: 620 },
        ]) {
          for (const contract of CONTRACTS) {
            for (const cancellation of ['pointer', 'keyboard'] as const) {
              await step(
                viewport.width +
                  'px ' +
                  contract +
                  ' ' +
                  cancellation +
                  ' Cancel retains both collections',
                async (capture) => {
                  await page.setViewportSize(viewport);
                  await expect(row(contract)).toHaveCount(1);
                  const rowIdentity = await nativeIdentity(
                    wallet!.context,
                    page,
                    row(contract),
                    'li',
                    'listitem'
                  );
                  expect(rowIdentity.dom.text).toContain(
                    shortContract(contract)
                  );
                  observations.rows.push({
                    width: viewport.width,
                    contract,
                    cancellation,
                    identity: rowIdentity,
                  });
                  await remove(contract).click();
                  const dialog = page.getByRole('dialog');
                  await expect(dialog).toHaveCount(1);
                  const identity = await nativeIdentity(
                    wallet!.context,
                    page,
                    dialog,
                    '[role="dialog"]',
                    'dialog'
                  );
                  const bodyText = await page.locator('body').innerText();
                  const geometry = await dialog.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    return {
                      left: rect.left,
                      top: rect.top,
                      right: rect.right,
                      bottom: rect.bottom,
                      width: rect.width,
                      height: rect.height,
                    };
                  });
                  observations.dialogs.push({
                    width: viewport.width,
                    contract,
                    cancellation,
                    identity,
                    bodyText,
                    geometry,
                  });
                  await capture(page);
                  observations.dialogs[
                    observations.dialogs.length - 1
                  ].contractExposure = await contractExposure(dialog, contract);
                  observations.dialogs[
                    observations.dialogs.length - 1
                  ].bodyParagraphs = await dialog
                    .locator('p')
                    .allTextContents();
                  if (cancellation === 'keyboard') {
                    const paragraph = dialog
                      .locator('p')
                      .filter({ hasText: contract });
                    const body = paragraph.locator('..');
                    const scrollable = await body.evaluate(
                      (element) =>
                        element.scrollHeight > element.clientHeight + 1
                    );
                    const originalCopy =
                      en.send.deleteCollectionConfirm.replace(
                        '{{name}}',
                        symbols[CONTRACTS.indexOf(contract)]
                      );
                    const warningParagraph = body
                      .locator(':scope > p')
                      .filter({ hasText: originalCopy });
                    const warning = originalCopy
                      .slice(originalCopy.indexOf('?') + 1)
                      .trim();
                    await expect(warningParagraph).toHaveText(originalCopy);
                    if (scrollable) {
                      await expect(body).toHaveAttribute('tabindex', '0');
                      for (let count = 0; count < 12; count++) {
                        if (
                          await body.evaluate(
                            (element) => element === document.activeElement
                          )
                        )
                          break;
                        await page.keyboard.press('Tab');
                      }
                      await expect(body).toBeFocused();
                      await page.keyboard.press('End');
                    }
                    await expect
                      .poll(
                        async () =>
                          (
                            await contractExposure(dialog, warning)
                          ).fullyVisible
                      )
                      .toBe(true);
                    await expect(dialog.getByRole('heading')).toBeInViewport();
                    await expect(
                      dialog.getByRole('button', {
                        name: en.buttons.cancel,
                        exact: true,
                      })
                    ).toBeInViewport();
                    await expect(
                      dialog.getByRole('button', {
                        name: en.buttons.delete,
                        exact: true,
                      })
                    ).toBeInViewport();
                    await expect(paragraph).toContainText(contract);
                    observations.dialogs[
                      observations.dialogs.length - 1
                    ].warningRead = {
                      scrollable,
                      warning: await contractExposure(dialog, warning),
                      paragraphText: await paragraph.innerText(),
                      warningText: await warningParagraph.innerText(),
                    };
                    await info.attach(
                      `${scenario}-${viewport.width}-${contract}-keyboard-warning`,
                      {
                        contentType: 'image/png',
                        body: await page.screenshot({ animations: 'disabled' }),
                      }
                    );
                    if (scrollable) await page.keyboard.press('Home');
                    await expect
                      .poll(
                        async () =>
                          (
                            await contractExposure(dialog, contract)
                          ).fullyVisible
                      )
                      .toBe(true);
                  }
                  const cancel = dialog.getByRole('button', {
                    name: en.buttons.cancel,
                    exact: true,
                  });
                  await expect(cancel).toBeEnabled();
                  if (cancellation === 'pointer') await cancel.click();
                  else {
                    for (let count = 0; count < 12; count++) {
                      if (
                        await cancel.evaluate(
                          (element) => element === document.activeElement
                        )
                      )
                        break;
                      await page.keyboard.press('Tab');
                    }
                    await expect(cancel).toBeFocused();
                    await page.keyboard.press('Enter');
                  }
                  await expect(dialog).toHaveCount(0);
                  expect(await publicAssets(page)).toEqual(observations.before);
                }
              );
            }
          }
        }
        await step(
          'confirm removes only the chosen collection, retaining the other across reload',
          async () => {
            await page.setViewportSize({ width: 400, height: 620 });
            await remove(CONTRACTS[1]).click();
            const dialog = page.getByRole('dialog');
            await dialog
              .getByRole('button', { name: en.buttons.delete, exact: true })
              .click();
            await expect
              .poll(async () =>
                (
                  await publicAssets(page)
                ).persisted.map((asset: any) => asset.contract)
              )
              .toEqual([CONTRACTS[0]]);
            const after = await publicAssets(page);
            expect(after.live).toEqual([observations.before.live[0]]);
            expect(after.persisted).toEqual(after.live);
            expect(after.active).toEqual(observations.before.active);
            expect(after.network).toEqual(observations.before.network);
            observations.afterDelete = after;
            await page.reload();
            await wallet!.ensureOnHome();
            await showNfts();
            expect(await publicAssets(page)).toEqual(after);
            await expect(row(CONTRACTS[0])).toHaveCount(1);
            await expect(row(CONTRACTS[1])).toHaveCount(0);
            observations.milestones.exactRemovalAndReload = true;
          }
        );
        await step(
          'strict read-only fences and pinned worker remain intact',
          async () => {
            expect(unsupported).toEqual([]);
            expect(forbidden).toEqual([]);
            expect(routes!.deniedWrites).toEqual([]);
            expect(pageErrors).toEqual([]);
            expect(responseErrors).toEqual([]);
            expect(httpFailures).toEqual([]);
            for (const contract of CONTRACTS) {
              for (const signature of [
                'name()',
                'symbol()',
                'supportsInterface(bytes4)',
                'balanceOf(address)',
              ])
                expect(
                  reads.some(
                    (read) =>
                      read.target === contract &&
                      read.selector === selector(signature)
                  )
                ).toBe(true);
            }
            expect(extensionEvidence()).toEqual(runtime);
            expect(
              createHash('sha256')
                .update(fs.readFileSync(info.file))
                .digest('hex')
            ).toBe(sourceSha256);
            observations.milestones.safety = true;
            await info.attach('nft-removal-identity-before-assertion', {
              contentType: 'application/json',
              body: JSON.stringify(evidence(), null, 2),
            });
          }
        );
        await step(
          'the final confirmation identifies which selected contract will be removed',
          async () => {
            // Keep all imports, Cancel modes, exact deletion/reload and safety
            // controls ahead of the intended baseline failure.
            for (const width of [320, 400]) {
              const selected = observations.dialogs.filter(
                (item: any) =>
                  item.width === width && item.cancellation === 'pointer'
              );
              expect(selected).toHaveLength(2);
              expect(selected[0].contract).toBe(CONTRACTS[0]);
              expect(selected[1].contract).toBe(CONTRACTS[1]);
              expect(
                selected[0].identity.semanticSignature,
                'distinct selected contracts need distinguishable visible/native confirmation identity'
              ).not.toBe(selected[1].identity.semanticSignature);
            }
            for (const dialog of observations.dialogs) {
              expect(dialog.bodyParagraphs.filter(Boolean)).toEqual([
                en.settings.contractAddress,
                dialog.contract,
                en.send.deleteCollectionConfirm.replace(
                  '{{name}}',
                  symbols[CONTRACTS.indexOf(dialog.contract)]
                ),
              ]);
              expect(dialog.identity.dom.text).toContain(dialog.contract);
              expect(dialog.bodyText).toContain(dialog.contract);
              expect(dialog.contractExposure).toMatchObject({
                found: true,
                text: dialog.contract,
                fullyVisible: true,
              });
              const otherContract = CONTRACTS.find(
                (contract) => contract !== dialog.contract
              )!;
              expect(dialog.identity.dom.text).not.toContain(otherContract);
            }
          }
        );
        status = 'passed';
      } finally {
        try {
          await info.attach('nft-collection-removal-identity-evidence', {
            contentType: 'application/json',
            body: JSON.stringify(evidence(), null, 2),
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
    }
  );
}
