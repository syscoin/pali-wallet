import {
  expect,
  test,
  type Page,
  type TestInfo,
  type Locator,
} from '@playwright/test';
import {
  AbiCoder,
  Interface,
  concat,
  getCreate2Address,
  keccak256,
} from 'ethers';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  visualFixtureRead,
  VISUAL_FIXTURE_SEED,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_RPC,
} from '../harness/visualFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

// Exact public counterfactual addresses from the pinned fixture factory code.
// The wallet itself creates every account through the normal UI; this is only
// the read-only chain fixture for each of the51 resulting public identities.
function pickerFixtures() {
  const base = createVisualFixture();
  const abi = AbiCoder.defaultAbiCoder();
  const initialize = new Interface([
    'function initializeAccount(bytes initCode)',
  ]);
  const creation = concat([
    base.proxyCreationCode,
    abi.encode(
      ['address', 'bytes'],
      [
        base.implementation.address,
        initialize.encodeFunctionData('initializeAccount', [base.initCode]),
      ]
    ),
  ]);
  const anchor = `pali:eip155:${VISUAL_FIXTURE_CHAIN_ID}:${base.address.toLowerCase()}:smart-account-v1`;
  return Array.from({ length: 51 }, (_, accountIndex) => {
    const deploymentSalt = keccak256(
      abi.encode(
        ['string', 'uint256', 'address', 'bytes32', 'uint256'],
        [
          'PaliSmartAccount.ERC7579.anchor-salt.v1',
          VISUAL_FIXTURE_CHAIN_ID,
          base.factory.address,
          keccak256(abi.encode(['string'], [anchor])),
          accountIndex,
        ]
      )
    );
    const smartAccountAddress = getCreate2Address(
      base.factory.address,
      deploymentSalt,
      keccak256(creation)
    );
    if (accountIndex === 0)
      expect(smartAccountAddress).toBe(base.smartAccountAddress);
    return { ...base, deploymentSalt, smartAccountAddress };
  });
}

async function capture(page: Page, info: TestInfo, label: string) {
  await page.mouse.move(0, 0);
  const file = info.outputPath(label + '.png');
  await page.screenshot({ path: file, animations: 'disabled' });
  await info.attach(label, { path: file, contentType: 'image/png' });
}

async function revealByWheel(page: Page, target: Locator) {
  await page.bringToFront();
  const list = page.locator('[data-navigation-scroll="smart-account-picker"]');
  let previous = '';
  for (let i = 0; i < 100; i++) {
    const result = await target.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        clip = { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
      for (let n = el.parentElement; n; n = n.parentElement) {
        const s = getComputedStyle(n),
          p = n.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(s.overflowY)) {
          clip.top = Math.max(clip.top, p.top + n.clientTop);
          clip.bottom = Math.min(
            clip.bottom,
            p.top + n.clientTop + n.clientHeight
          );
        }
        if (/auto|scroll|hidden|clip/.test(s.overflowX)) {
          clip.left = Math.max(clip.left, p.left + n.clientLeft);
          clip.right = Math.min(
            clip.right,
            p.left + n.clientLeft + n.clientWidth
          );
        }
      }
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2
      );
      return {
        visible:
          r.top >= clip.top &&
          r.bottom <= clip.bottom &&
          r.left >= clip.left &&
          r.right <= clip.right &&
          Boolean(hit && (hit === el || el.contains(hit))),
        position: JSON.stringify([r.top, r.bottom]),
        direction: r.top < clip.top ? -1 : 1,
      };
    });
    if (result.visible && result.position === previous) return;
    previous = result.visible ? result.position : '';
    if (!result.visible) {
      await list.hover({ position: { x: 12, y: 24 } });
      await page.mouse.wheel(0, result.direction * 120);
    }
    await page.waitForTimeout(60);
  }
  throw new Error('Native wheel did not reveal settled exact picker target');
}

async function measureLoadMore(target: Locator, info: TestInfo, label: string) {
  await target.page().mouse.move(0, 0);
  await target.page().waitForTimeout(250);
  const evidence = await target.evaluate((el) => {
    const parse = (s: string) => {
      const m = s.match(/^rgba?\(([^)]+)\)$/);
      if (!m) throw new Error('Unknown color');
      return m[1]
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
    };
    let bg: number[] | undefined;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (
        s.opacity !== '1' ||
        s.filter !== 'none' ||
        s.mixBlendMode !== 'normal'
      )
        throw new Error('Unsupported compositing');
      const c = parse(s.backgroundColor);
      if (!bg && c[3] !== 0) {
        if (c.length === 4 && c[3] !== 1)
          throw new Error('Translucent backing');
        bg = c;
      }
      if (!bg && s.backgroundImage !== 'none')
        throw new Error('Non-solid backing');
    }
    if (!bg) throw new Error('No opaque backing');
    const lum = (c: number[]) =>
      [0.2126, 0.7152, 0.0722].reduce((v, w, i) => {
        const n = c[i] / 255;
        return (
          v + w * (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
        );
      }, 0);
    const style = getComputedStyle(el),
      fg = parse(style.color),
      a = lum(fg),
      b = lum(bg),
      r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2
    );
    return {
      color: style.color,
      background: bg,
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      bounds: r.toJSON(),
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      hit: Boolean(hit && (hit === el || el.contains(hit))),
      text: el.textContent,
    };
  });
  expect(evidence.hit).toBe(true);
  expect(evidence.ratio).toBeGreaterThanOrEqual(4.5);
  await info.attach(label + '-paint', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
  return evidence;
}

test('fifty-one ordinary smart accounts retain the picker pagination and selected identity at both sizes', async ({}, info) => {
  test.setTimeout(180000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const old = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixtures = pickerFixtures();
  const mainnetXpub = new sys.HDSigner(
    VISUAL_FIXTURE_SEED,
    '',
    false
  ).getAccountXpub();
  const publicAccountsSet = new Set(
    fixtures.map((f) => f.smartAccountAddress.toLowerCase())
  );
  const initialized = new Interface([
    'function isInitialized(address account) view returns (bool)',
  ]);
  const ownerAbi = new Interface([
    'function owners(address account) view returns (address[])',
    'function childValidators(address account) view returns (address[])',
    'function threshold(address account) view returns (uint64)',
  ]);
  const p256Abi = new Interface([
    'function authData(address account) view returns ((bytes32,bytes32,bytes32,bytes32,uint256))',
  ]);
  const slhAbi = new Interface([
    'function authData(address account) view returns ((bytes32,bytes32))',
  ]);
  const exactModules = new Map(
    fixtures[0].infrastructure
      .filter((c) =>
        [
          'ecdsaValidator',
          'p256WebAuthnValidator',
          'slhDsaValidator',
          'compositeValidator',
        ].includes(c.id)
      )
      .map((c) => [c.address.toLowerCase(), c.id])
  );
  const zero32 = '0x' + '00'.repeat(32);
  const moduleRead = (call: any) => {
    if (
      call?.method !== 'eth_call' ||
      !Array.isArray(call.params) ||
      call.params.length !== 2 ||
      call.params[1] !== 'latest'
    )
      return undefined;
    const tx = call.params[0],
      id = exactModules.get(String(tx?.to).toLowerCase());
    if (!id || typeof tx.data !== 'string') return undefined;
    for (const abi of [initialized, ownerAbi, p256Abi, slhAbi]) {
      let parsed;
      try {
        parsed = abi.parseTransaction({ data: tx.data });
      } catch {
        continue;
      }
      if (
        !parsed ||
        !publicAccountsSet.has(String(parsed.args[0]).toLowerCase())
      )
        continue;
      let value: unknown[] | undefined;
      if (parsed.name === 'isInitialized') value = [false];
      else if (parsed.name === 'owners' && id === 'ecdsaValidator')
        value = [[]];
      else if (parsed.name === 'childValidators' && id === 'compositeValidator')
        value = [[]];
      else if (
        parsed.name === 'threshold' &&
        ['ecdsaValidator', 'compositeValidator'].includes(id)
      )
        value = [0];
      else if (
        parsed.name === 'authData' &&
        id === 'p256WebAuthnValidator' &&
        abi === p256Abi
      )
        value = [[zero32, zero32, zero32, zero32, 0]];
      else if (
        parsed.name === 'authData' &&
        id === 'slhDsaValidator' &&
        abi === slhAbi
      )
        value = [[zero32, zero32]];
      if (value)
        return {
          jsonrpc: '2.0',
          id: call.id,
          result: abi.encodeFunctionResult(parsed.fragment, value),
        };
    }
    return undefined;
  };

  Object.assign(E2E_CONFIG, {
    seedPhrase: VISUAL_FIXTURE_SEED,
    password: 'PickerPublicOnly!2026',
    rpcUrl: server.url,
    chainId: VISUAL_FIXTURE_CHAIN_ID,
    networkLabel: 'zkTanenbaum',
  });
  let wallet: PaliWallet | undefined,
    status: 'passed' | 'failed' = 'failed';
  const reads: string[] = [],
    deniedWrites: string[] = [],
    deniedUnknown: string[] = [];
  try {
    wallet = await PaliWallet.launch('smart-picker-fifty-one', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    await wallet.context.route('**/*', async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
      if (
        url.origin === server.url &&
        url.pathname === '/' &&
        req.method() === 'GET'
      )
        return route.continue();
      let payload: unknown;
      try {
        payload = req.postDataJSON();
      } catch {
        /* exact GET fixture below */
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (
        /\/sendtx(?:\/|$)/i.test(url.pathname) ||
        calls.some((c: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
            c?.method || ''
          )
        )
      ) {
        deniedWrites.push(req.url());
        return route.abort('blockedbyclient');
      }
      if (req.method() === 'GET') {
        const lists = new Map<string, unknown>([
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
            {
              version: 2,
              tolerance: 2,
              whitelist: [],
              blacklist: [],
              fuzzylist: [],
            },
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
        let body = lists.get(url.href);
        if (
          url.origin === 'https://blockbook.syscoin.org' &&
          url.pathname === '/api/v2/xpub/' + encodeURIComponent(mainnetXpub)
        )
          body = {
            address: mainnetXpub,
            balance: '0',
            unconfirmedBalance: '0',
            totalReceived: '0',
            totalSent: '0',
            txs: 0,
            unconfirmedTxs: 0,
            tokens: [],
            tokensAsset: [],
          };
        if (
          url.href === 'https://blockbook.syscoin.org/api/v2/tickers/currency'
        )
          body = [];
        if (body !== undefined) {
          reads.push('exact-public-get:' + url.pathname);
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
          });
        }
      }

      let result: ReturnType<typeof visualFixtureRead>;
      if (
        req.method() === 'POST' &&
        url.origin === VISUAL_FIXTURE_RPC &&
        url.pathname === '/'
      ) {
        const replies: unknown[] = [];
        for (const call of calls) {
          let accepted: ReturnType<typeof visualFixtureRead>;
          const moduleResult = moduleRead(call);
          if (moduleResult) {
            replies.push(moduleResult);
            reads.push('exact-undeployed-module-read');
            continue;
          }
          for (const fixture of fixtures) {
            const candidate = visualFixtureRead(
              fixture,
              req.url(),
              req.method(),
              call
            );
            if (candidate && !candidate.unsupported?.length) {
              accepted = candidate;
              break;
            }
          }
          if (!accepted) {
            deniedUnknown.push(JSON.stringify(call));
            return route.abort('blockedbyclient');
          }
          replies.push(accepted.body);
          reads.push(...accepted.reads);
        }
        result = {
          body: Array.isArray(payload) ? replies : replies[0],
          reads: [],
        };
      } else {
        for (const fixture of fixtures) {
          const candidate = visualFixtureRead(
            fixture,
            req.url(),
            req.method(),
            payload
          );
          if (candidate && !candidate.unsupported?.length) {
            result = candidate;
            break;
          }
        }
      }
      if (!result) {
        deniedUnknown.push(req.url());
        return route.abort('blockedbyclient');
      }
      reads.push(...result.reads);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(result.body),
      });
    });
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('zkTanenbaum', 'EVM');
    await wallet.ensureOnHome();
    const page = wallet.page;
    const general = async () =>
      page.locator('#general-settings-button').click();
    for (let i = 0; i < 51; i++) {
      await general();
      await page
        .getByRole('menuitem', {
          name: en.accountMenu.createNewAccount,
          exact: true,
        })
        .click();
      await page
        .locator('#account-name-input')
        .fill(`Pagination account ${String(i + 1).padStart(2, '0')}`);
      await page
        .getByRole('button', {
          name: new RegExp(`^${en.settings.createSmartAccount}`, 'i'),
        })
        .click();
      const dialog = page
        .getByRole('dialog')
        .filter({ hasText: en.settings.yourNewAccount });
      await expect(
        dialog.getByText(fixtures[i].smartAccountAddress, { exact: true })
      ).toBeVisible();
      await dialog.locator('#account-created-ok-btn').click();
      await wallet.ensureOnHome();
    }
    const publicAccounts = await page.evaluate(async () => {
      const s = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
      return Object.values(s.vault.accounts.SmartAccount).map((a: any) => ({
        id: a.id,
        address: a.address,
        label: a.label,
        chainId: a.smartAccount.chainId,
      }));
    });
    expect(publicAccounts).toHaveLength(51);
    expect(new Set(publicAccounts.map((a) => a.address)).size).toBe(51);
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      // Switch to the original EOA through the real dropdown so Hub opens its
      // compatible-account picker rather than the active smart-account page.
      await page.locator('#general-settings-button').locator('..').click();
      await page
        .getByRole('menuitem', {
          name: `Account 1 (${fixtures[0].address})`,
          exact: true,
        })
        .click();
      await general();
      await page.locator('#smart-account-hub-btn').click();
      await page
        .getByRole('button', {
          name: en.smartAccountHub.chooseAccount,
          exact: true,
        })
        .click();
      const search = page.getByRole('searchbox', {
        name: en.connections.searchAccounts,
        exact: true,
      });
      await search.fill('No matching pagination account');
      await expect(
        page.getByText(en.connections.noMatchingAccounts, { exact: true })
      ).toBeVisible();
      await search.fill('');
      await expect(page.getByTestId(/^smart-account-option-/)).toHaveCount(50);
      await capture(page, info, `picker-${viewport.width}-first-page`);
      const more = page.getByRole('button', {
        name: en.buttons.loadMore,
        exact: true,
      });
      await revealByWheel(page, more);
      await expect(more).toBeEnabled();
      await measureLoadMore(
        more,
        info,
        'picker-' + viewport.width + '-load-more'
      );
      await capture(page, info, `picker-${viewport.width}-load-more`);
      await more.click();
      await expect(page.getByTestId(/^smart-account-option-/)).toHaveCount(51);
      await expect(more).toHaveCount(0);
      const last = page.getByTestId('smart-account-option-50');
      await revealByWheel(page, last);
      await expect(last).toContainText('Pagination account 51');
      await capture(page, info, `picker-${viewport.width}-fifty-first`);
      await last.click();
      await expect(page).toHaveURL(/#\/home\/smart-account$/);
      const active = await page.evaluate(async () => {
        const s = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
        return s.vault.accounts[s.vault.activeAccount.type][
          s.vault.activeAccount.id
        ].address;
      });
      expect(active).toBe(fixtures[50].smartAccountAddress);
      await page
        .getByRole('button', { name: en.buttons.close, exact: true })
        .first()
        .click();
      await wallet.ensureOnHome();
    }
    expect(deniedWrites).toEqual([]);
    expect(deniedUnknown).toEqual([]);
    await info.attach('pagination-public-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        runtime,
        publicAccounts,
        reads,
        deniedWrites,
        deniedUnknown,
        ordinaryUiCreated: 51,
        controllerStateReplaced: false,
      }),
    });
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, old);
    }
  }
});
