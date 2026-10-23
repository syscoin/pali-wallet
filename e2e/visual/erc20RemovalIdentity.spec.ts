import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
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
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// The three tokens enter through ordinary custom import and real persistence.
// Only allowlisted public HTTP/ABI replies are synthetic. No controller result,
// store state, DOM selection, timeout, retry policy or signing path is replaced.
const CONTRACTS = [
  '0x000000000000000000000000000000000000e020',
  '0x000000000000000000000000000000000000e021',
  '0x000000000000000000000000000000000000e022',
];
const SHARED = 'MATCH20';
const CONTROL = 'UNIQUE20';
const SYMBOLS = [SHARED, SHARED, CONTROL];
const names = [
  'Synthetic matching asset',
  'Synthetic matching asset',
  'Unique control asset',
];
const actionName = (action: 'view' | 'delete', symbol: string) =>
  // These pinned English labels and synthetic symbols have no regexp syntax.
  new RegExp(
    '^' +
      (action === 'view'
        ? en.tokens.viewTokenDetails
        : en.tokens.deleteToken
      ).replace('{{symbol}}', symbol) +
      '(?:$|[ :,(])'
  );

async function publicAssets(page: Page) {
  return page.evaluate(async (contracts) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { type, id: accountId } = state.vault.activeAccount;
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const disk = await chrome.storage.local.get(key);
    const project = (assets: any[]) =>
      (assets || [])
        .filter((asset) =>
          contracts.includes(asset.contractAddress?.toLowerCase())
        )
        .map((asset) => ({
          id: asset.id,
          contract: asset.contractAddress.toLowerCase(),
          chainId: asset.chainId,
          symbol: asset.tokenSymbol,
          name: asset.name,
          balance: asset.balance,
          logo: asset.logo,
          isNft: asset.isNft,
        }))
        .sort((a, b) => a.contract.localeCompare(b.contract));
    return {
      active: { type, id: accountId },
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
      },
      live: project(state.vault.accountAssets?.[type]?.[accountId]?.ethereum),
      persisted: project(
        disk[key]?.accountAssets?.[type]?.[accountId]?.ethereum
      ),
    };
  }, CONTRACTS);
}

async function nativeIdentity(
  context: BrowserContext,
  page: Page,
  target: Locator,
  selector: string,
  role: string
) {
  const index = await target.evaluate(
    (element, query) =>
      Array.from(document.querySelectorAll(query)).indexOf(element),
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

test('ERC20 row actions and removal confirmation distinguish ordinary same-symbol imports', async ({}, info) => {
  expect(process.version).toBe('v23.11.1');
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
  const server = await startUtxoFixtureServer();
  const abi = AbiCoder.defaultAbiCoder();
  const reads: { contract: string; selector: string }[] = [];
  const unsupported: { method: string; target: string }[] = [];
  const forbidden: string[] = [];
  const pageErrors: string[] = [];
  const observations: Record<string, any> = { runtime, sourceSha256 };
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TokenIdentitySyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin NEVM Testnet',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('erc20-removal-identity', {
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
      (value) => {
        observations.workerIdentity = value;
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('request', (request) => {
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
        /* GET/static requests */
      }
    });
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const rpc = route.request().postDataJSON();
      const calls = Array.isArray(rpc) ? rpc : [rpc];
      const targetOf = (call: any) =>
        String(call.params?.[0]?.to || call.params?.[0] || '').toLowerCase();
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call?.method) &&
            CONTRACTS.includes(targetOf(call))
        )
      )
        return route.fallback();
      const replies = calls.map((call: any) => {
        const target = targetOf(call);
        const contractIndex = CONTRACTS.indexOf(target);
        let result: unknown;
        if (call.method === 'eth_chainId') result = '0x1644';
        if (call.method === 'eth_getCode' && contractIndex >= 0)
          result = '0x60006000fd';
        if (call.method === 'eth_call' && contractIndex >= 0) {
          const prefix = String(call.params[0].data).slice(0, 10);
          if (prefix === id('name()').slice(0, 10))
            result = abi.encode(['string'], [names[contractIndex]]);
          if (prefix === id('symbol()').slice(0, 10))
            result = abi.encode(['string'], [SYMBOLS[contractIndex]]);
          if (prefix === id('decimals()').slice(0, 10))
            result = abi.encode(['uint8'], [18]);
          if (prefix === id('totalSupply()').slice(0, 10))
            result = abi.encode(['uint256'], ['1000000000000000000']);
          if (prefix === id('supportsInterface(bytes4)').slice(0, 10))
            result = abi.encode(['bool'], [false]);
          // A normal, valid zero balance is importable. No token value or funds
          // are transferred when the final optional exact-target deletion runs.
          if (prefix === id('balanceOf(address)').slice(0, 10))
            result = abi.encode(['uint256'], ['0']);
          if (result !== undefined)
            reads.push({ contract: target, selector: prefix });
        }
        if (result === undefined)
          unsupported.push({ method: call.method, target });
        return result === undefined
          ? {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32000, message: 'Unsupported synthetic read' },
            }
          : { jsonrpc: '2.0', id: call.id, result };
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
      });
    });
    await wallet.step(
      'import a disposable wallet and select the genuine EVM flow',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
        const custom = page
          .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
          .and(page.locator('button[aria-pressed]'));
        await expect(custom).toHaveCount(1);
        await custom.click();
        await expect(custom).toHaveAttribute('aria-pressed', 'true');
      }
    );
    for (const [index, contract] of CONTRACTS.entries()) {
      await wallet.step('ordinary custom import ' + contract, async () => {
        await page.locator('#custom-token-contract').fill(contract);
        const add = page.getByRole('button', {
          name: `Import ${SYMBOLS[index]} token`,
          exact: true,
        });
        await expect(add).toBeEnabled();
        await add.click();
        await expect(add).toBeDisabled();
        await expect
          .poll(async () =>
            (await publicAssets(page)).persisted.map((asset) => asset.contract)
          )
          .toContain(contract);
      });
    }
    await wallet.step(
      'return through Back and verify exact live and durable token identities',
      async () => {
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet!.ensureOnHome();
        await page.locator('#assets-btn').click();
        const actual = await publicAssets(page);
        expect(actual.live.map((asset) => asset.contract)).toEqual(CONTRACTS);
        expect(actual.persisted).toEqual(actual.live);
        expect(actual.live.map((asset) => asset.symbol)).toEqual(SYMBOLS);
        expect(actual.live[0].logo).toBe(actual.live[1].logo);
        expect(
          actual.live.every(
            (asset) => Number(asset.balance) === 0 && asset.isNft === false
          )
        ).toBe(true);
        observations.before = actual;
      }
    );
    const sharedRows = () =>
      page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: actionName('delete', SHARED) }),
      });
    const controlRow = () =>
      page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: actionName('delete', CONTROL) }),
      });
    await expect(sharedRows()).toHaveCount(2);
    await expect(controlRow()).toHaveCount(1);
    observations.rows = [];
    observations.dialogs = [];
    await wallet.step(
      'inspect real row AX trees and both removal dialogs; Cancel preserves each target',
      async () => {
        for (let index = 0; index < 2; index++) {
          const row = sharedRows().nth(index);
          const remove = row.getByRole('button', {
            name: actionName('delete', SHARED),
          });
          observations.rows.push({
            expectedContract: CONTRACTS[index],
            row: await nativeIdentity(
              wallet!.context,
              page,
              row,
              'li',
              'listitem'
            ),
            view: await nativeIdentity(
              wallet!.context,
              page,
              row.getByRole('button', { name: actionName('view', SHARED) }),
              'button',
              'button'
            ),
            remove: await nativeIdentity(
              wallet!.context,
              page,
              remove,
              'button',
              'button'
            ),
          });
          await remove.click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toHaveCount(1);
          observations.dialogs.push(
            await nativeIdentity(
              wallet!.context,
              page,
              dialog,
              '[role="dialog"]',
              'dialog'
            )
          );
          expect(observations.rows[index].row.dom.title).toBe(CONTRACTS[index]);
          expect(observations.rows[index].view.description).toBe(
            CONTRACTS[index]
          );
          expect(observations.rows[index].remove.description).toBe(
            CONTRACTS[index]
          );
          expect(observations.rows[index].row.dom.text).toContain(
            `${CONTRACTS[index].slice(0, 6)}...${CONTRACTS[index].slice(-4)}`
          );
          await expect(dialog).toContainText(CONTRACTS[index]);
          await expect(dialog).not.toContainText(CONTRACTS[1 - index]);
          for (const viewport of [
            { width: 320, height: 360 },
            { width: 400, height: 620 },
          ]) {
            await page.setViewportSize(viewport);
            for (const label of [en.buttons.cancel, en.buttons.delete]) {
              const action = dialog.getByRole('button', {
                name: label,
                exact: true,
              });
              await expect(action).toBeInViewport();
              await expect
                .poll(() =>
                  action.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    return (
                      rect.width > 0 &&
                      rect.height > 0 &&
                      rect.left >= 0 &&
                      rect.top >= 0 &&
                      rect.right <= window.innerWidth &&
                      rect.bottom <= window.innerHeight &&
                      element.contains(
                        document.elementFromPoint(
                          rect.x + rect.width / 2,
                          rect.y + rect.height / 2
                        )
                      )
                    );
                  })
                )
                .toBe(true);
            }
          }
          const screenshot = info.outputPath(
            `same-symbol-confirmation-${index}.png`
          );
          await page.screenshot({ path: screenshot, animations: 'disabled' });
          await info.attach(`same-symbol-confirmation-${index}`, {
            path: screenshot,
            contentType: 'image/png',
          });
          await dialog
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
          await expect(dialog).toHaveCount(0);
          expect(await publicAssets(page)).toEqual(observations.before);
        }
        observations.uniqueControl = {
          row: await nativeIdentity(
            wallet!.context,
            page,
            controlRow(),
            'li',
            'listitem'
          ),
          remove: await nativeIdentity(
            wallet!.context,
            page,
            controlRow().getByRole('button', {
              name: actionName('delete', CONTROL),
            }),
            'button',
            'button'
          ),
        };
        expect(observations.uniqueControl.remove.name).toContain(CONTROL);
        expect(observations.uniqueControl.remove.name).not.toBe(
          observations.rows[0].remove.name
        );
      }
    );
    await wallet.step(
      'healthy contract search and exact Details route distinguish either imported token',
      async () => {
        await page
          .getByRole('button', { name: en.tooltip.searchAssets, exact: true })
          .click();
        for (const contract of CONTRACTS.slice(0, 2)) {
          const input = page.getByRole('textbox', {
            name: en.assetsHeader.tokenOrContractAddress,
            exact: true,
          });
          await input.fill(contract);
          await expect(sharedRows()).toHaveCount(1);
          await sharedRows()
            .getByRole('button', { name: actionName('view', SHARED) })
            .click();
          await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
          const routeId = await page.evaluate(
            () => window.history.state?.usr?.id
          );
          expect(routeId).toBe(`${contract}-5700`);
          observations.detailsRoutes ||= [];
          observations.detailsRoutes.push({ contract, routeId });
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await expect(input).toHaveValue(contract);
        }
        await page
          .getByRole('textbox', {
            name: en.assetsHeader.tokenOrContractAddress,
            exact: true,
          })
          .press('Escape');
        await expect(sharedRows()).toHaveCount(2);
        expect(await publicAssets(page)).toEqual(observations.before);
      }
    );
    await wallet.step(
      'delete only the first zero-balance synthetic token and verify the second across reload',
      async () => {
        await sharedRows()
          .nth(0)
          .getByRole('button', { name: actionName('delete', SHARED) })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: en.buttons.delete, exact: true })
          .click();
        await expect
          .poll(async () =>
            (await publicAssets(page)).persisted.map((asset) => asset.contract)
          )
          .toEqual(CONTRACTS.slice(1));
        const after = await publicAssets(page);
        expect(after.live.map((asset) => asset.contract)).toEqual(
          CONTRACTS.slice(1)
        );
        expect(after.persisted).toEqual(after.live);
        expect(after.active).toEqual(observations.before.active);
        expect(after.network).toEqual(observations.before.network);
        observations.afterDelete = after;
        await page.reload();
        await wallet!.ensureOnHome();
        await page.locator('#assets-btn').click();
        expect(await publicAssets(page)).toEqual(after);
        await expect(sharedRows()).toHaveCount(1);
        await expect(controlRow()).toHaveCount(1);
      }
    );
    expect(unsupported).toEqual([]);
    expect(forbidden).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
    for (const contract of CONTRACTS)
      expect(
        reads.some(
          (read) =>
            read.contract === contract &&
            read.selector === id('symbol()').slice(0, 10)
        )
      ).toBe(true);
    // Keep the healthy controls and exact native identity observations together.
    expect
      .soft(
        observations.rows[0].row.semanticSignature,
        'same-symbol token rows need a distinguishable native or visible identity'
      )
      .not.toBe(observations.rows[1].row.semanticSignature);
    // A labelled row is allowed to supply a button's contextual identity;
    // identical button names alone are not the issue under investigation.
    expect
      .soft(
        observations.dialogs[0].semanticSignature,
        'removal confirmation must distinguish which same-symbol contract is targeted'
      )
      .not.toBe(observations.dialogs[1].semanticSignature);
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    try {
      await info.attach('erc20-removal-identity-evidence', {
        body: JSON.stringify(
          {
            ...observations,
            contracts: CONTRACTS,
            reads,
            unsupported,
            forbidden,
            pageErrors,
            deniedWrites: routes?.deniedWrites || [],
            proxyDeniedConnections: server.blocked.length,
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            zeroBalanceMetadataDeletionOnly: true,
          },
          null,
          2
        ),
        contentType: 'application/json',
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
});
