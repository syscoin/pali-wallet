import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
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

const CHAIN_ID = 31337;
const RPC = 'https://required-fields.synthetic.invalid/rpc';
const LABEL = '  Required fields fixture  ';
const SYMBOL = ' TST ';

const publicState = (page: Page) =>
  page.evaluate(async (chainId) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const project = (network: any) =>
      network
        ? {
            chainId: network.chainId,
            kind: network.kind,
            label: network.label,
            currency: network.currency,
            slip44: network.slip44,
            url: network.url,
          }
        : null;
    const ref = state.vault.activeAccount;
    return {
      live: project(state.vaultGlobal.networks.ethereum[chainId]),
      stored: project(saved.state?.vaultGlobal?.networks?.ethereum?.[chainId]),
      active: project(state.vault.activeNetwork),
      account: {
        ...ref,
        address: state.vault.accounts[ref.type][ref.id].address,
      },
      grantHosts: Object.keys(state.dapp.dapps).sort(),
      storedGrantHosts: Object.keys(saved.state?.dapp?.dapps || {}).sort(),
    };
  }, CHAIN_ID);

const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
const settle = async (page: Page) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getAnimations().every((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return (
            timing?.iterations === Infinity ||
            (animation.playState !== 'running' && !animation.pending)
          );
        })
      )
    )
    .toBe(true);
  await frame(page);
};
const tabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let count = 0; count < 80; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

const fieldEvidence = async (page: Page, selector: string) => {
  const input = page.locator(selector);
  await expect(input).toHaveCount(1);
  const dom = await input.evaluate((node) => {
    const field = node as HTMLInputElement;
    const item = field.closest('.ant-form-item')!;
    const content = item.querySelector('.ant-form-item-control-input-content');
    const wrapper = content?.firstElementChild;
    const visible = (element: Element) => {
      const r = element.getBoundingClientRect(),
        css = getComputedStyle(element);
      return (
        r.width > 0 &&
        r.height > 0 &&
        css.display !== 'none' &&
        css.visibility !== 'hidden'
      );
    };
    const attributes = (element: Element) => ({
      tag: element.tagName,
      id: element.id,
      invalid: element.getAttribute('aria-invalid'),
      required: element.getAttribute('aria-required'),
      describedBy: element.getAttribute('aria-describedby'),
      errorMessage: element.getAttribute('aria-errormessage'),
    });
    return {
      ...attributes(field),
      value: field.value,
      type: field.type,
      placeholder: field.placeholder,
      labels: Array.from(field.labels || []).map((label) =>
        label.textContent?.trim()
      ),
      wrapper: wrapper ? attributes(wrapper) : null,
      box: field.getBoundingClientRect().toJSON(),
      nearbyText: (item as HTMLElement).innerText,
      references: ['aria-describedby', 'aria-errormessage'].flatMap(
        (attribute) =>
          (field.getAttribute(attribute) || '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => {
              const element = document.getElementById(id);
              return {
                attribute,
                id,
                text: element?.textContent?.trim() || '',
                visible: !!element && visible(element),
              };
            })
      ),
      liveNodes: Array.from(item.querySelectorAll('[role="alert"],[aria-live]'))
        .filter(visible)
        .map((element) => ({
          role: element.getAttribute('role'),
          live: element.getAttribute('aria-live'),
          text: element.textContent?.trim() || '',
        })),
    };
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    });
    expect(nodeId).toBeGreaterThan(0);
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    });
    const field = nodes.find(
      (node) =>
        ['textbox', 'spinbutton', 'combobox'].includes(
          String(node.role?.value)
        ) && !node.ignored
    );
    expect(field).toBeDefined();
    return {
      dom,
      native: {
        role: field!.role?.value,
        name: field!.name?.value || '',
        description: field!.description?.value || '',
        properties: Object.fromEntries(
          (field!.properties || []).map((property) => [
            property.name,
            property.value?.value ?? null,
          ])
        ),
      },
    };
  } finally {
    await cdp.detach();
  }
};
const feedbackGeometry = (target: Locator) =>
  target.evaluate((element) => {
    const r = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const css = getComputedStyle(node),
        box = node.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
        clip.left = Math.max(clip.left, box.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          box.left + node.clientLeft + node.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
        clip.top = Math.max(clip.top, box.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          box.top + node.clientTop + node.clientHeight
        );
      }
    }
    const footer = document
      .querySelector('#rpc button[type=submit]')
      ?.closest('.fixed');
    if (footer)
      clip.bottom = Math.min(clip.bottom, footer.getBoundingClientRect().top);
    const center = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2
    );
    return {
      box: r.toJSON(),
      clip,
      visible:
        r.width > 0 &&
        r.height > 0 &&
        r.left >= clip.left - 0.5 &&
        r.right <= clip.right + 0.5 &&
        r.top >= clip.top - 0.5 &&
        r.bottom <= clip.bottom + 0.5 &&
        !!center &&
        (center === element || element.contains(center)),
    };
  });
const revealFeedback = async (page: Page, target: Locator) => {
  await settle(page);
  for (let count = 0; count < 16; count += 1) {
    const current = await feedbackGeometry(target);
    if (current.visible) return current;
    const viewport = page.viewportSize()!;
    const delta = current.box.top < current.clip.top ? -80 : 80;
    const point = await page.evaluate(() => {
      const owner = document.querySelector(
        '[data-navigation-scroll="wallet-layout"]'
      );
      const x = innerWidth - 8,
        y = innerHeight / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        owned: !!owner && !!hit && (hit === owner || owner.contains(hit)),
      };
    });
    expect(point.owned).toBe(true);
    expect(point.x).toBeLessThan(viewport.width);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, delta);
    await settle(page);
  }
  const geometry = await feedbackGeometry(target);
  expect(geometry.visible).toBe(true);
  return geometry;
};

test('custom network required fields refuse blank text and preserve meaningful padding on Save', async ({}, info) => {
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
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'RequiredNetworkFieldsSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let phase = 'onboarding';
  const reads: Array<{ method: string; phase: string; url: string }> = [];
  const unexpectedRpcRequests: Array<{ method: string; url: string }> = [];
  const attemptedWrites: string[] = [];
  const observations: Record<string, unknown> = {};
  const nameFeedback: Array<{
    field: Awaited<ReturnType<typeof fieldEvidence>>;
    phase: string;
  }> = [];
  try {
    wallet = await PaliWallet.launch('custom-network-required-fields', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    wallet.context.on('request', (request) => {
      if (!/^https?:/.test(request.url())) return;
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        /* ordinary REST */
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (
        /\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname) ||
        calls.some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      )
        attemptedWrites.push(request.url());
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    // The launch proxy never forwards. Only this exact synthetic chain-ID read
    // is fulfilled; form validation, SDK code, controller and storage stay real.
    await wallet.context.route(
      (url) => url.origin === new URL(RPC).origin,
      async (route) => {
        const request = route.request();
        const refuse = () => {
          unexpectedRpcRequests.push({
            method: request.method(),
            url: request.url(),
          });
          return route.abort('blockedbyclient');
        };
        if (request.url() !== RPC) return refuse();
        const headers = {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
        };
        if (request.method() === 'OPTIONS')
          return route.fulfill({ status: 204, headers });
        let call: any;
        try {
          call = request.postDataJSON();
        } catch {
          return refuse();
        }
        if (
          request.method() !== 'POST' ||
          call?.jsonrpc !== '2.0' ||
          call.method !== 'eth_chainId' ||
          !Array.isArray(call.params) ||
          call.params.length !== 0 ||
          !['number', 'string'].includes(typeof call.id)
        )
          return refuse();
        reads.push({ phase, method: call.method, url: request.url() });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: call.id,
            result: `0x${CHAIN_ID.toString(16)}`,
          }),
        });
      }
    );
    await wallet.context.route('https://chainlist.org/rpcs.json', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
          })
        : route.abort('blockedbyclient')
    );
    const page = wallet.page;
    const networkMenu = page
      .getByRole('button')
      .filter({ has: page.locator('#network-settings-btn') });
    const label = page.getByRole('combobox', {
      name: en.settings.label,
      exact: true,
    });
    const symbol = page.locator('input#rpc_symbol');
    const save = page.getByRole('button', {
      name: en.buttons.save,
      exact: true,
    });
    let before: Awaited<ReturnType<typeof publicState>>;
    await wallet.step(
      'open the ordinary custom network form and validate its synthetic endpoint',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        before = await publicState(page);
        expect(before.live).toBeNull();
        expect(before.stored).toBeNull();
        expect(before.grantHosts).toEqual([]);
        expect(before.storedGrantHosts).toEqual([]);
        await networkMenu.click();
        await page
          .getByRole('menuitem', {
            name: en.networkMenu.customRpc,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await label.fill('Required fields fixture');
        await symbol.fill('TST');
        await page.locator('input#rpc_url').fill(RPC);
        await page.locator('input#rpc_url').press('Tab');
        await expect(page.locator('input#rpc_chainId')).toHaveValue(
          String(CHAIN_ID)
        );
        expect(reads.some((read) => read.method === 'eth_chainId')).toBe(true);
        await expect(save).toBeEnabled();
        observations.before = before;
      }
    );
    await wallet.step(
      'observe actual Name and direct Symbol feedback at both supported viewport sizes',
      async () => {
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          await label.fill('');
          await symbol.fill('');
          const readsBefore = reads.length;
          await save.click();
          const nameError = page.getByText(en.settings.networkNameRequired, {
            exact: true,
          });
          const symbolError = page.getByText(en.settings.symbolRequired, {
            exact: true,
          });
          await expect(nameError).toHaveCount(1);
          await expect(nameError).toBeVisible();
          await expect(symbolError).toHaveCount(1);
          await expect(symbolError).toBeVisible();
          await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
          await expect(label).toHaveValue('');
          await expect(symbol).toHaveValue('');
          await expect(page.locator('input#rpc_url')).toHaveValue(RPC);
          expect(reads.length).toBe(readsBefore);
          expect(await publicState(page)).toEqual(before!);

          // Reveal the whole real item, not only its helper. The initial narrow
          // exploratory capture could otherwise leave its input above viewport.
          const nameItem = page
            .locator('#rpc .ant-form-item')
            .filter({ has: label });
          await expect(nameItem).toHaveCount(1);
          await tabTo(page, label);
          const nameGeometry = await revealFeedback(page, nameItem);
          const field = await fieldEvidence(page, 'input#rpc_label');
          nameFeedback.push({
            phase: viewport.width + 'x' + viewport.height + '-empty',
            field,
          });
          await page.mouse.move(2, 2);
          await settle(page);
          await captureForegroundContrast(
            nameError,
            info,
            `antd-network-name-${viewport.width}`
          );
          const originalPath = info.outputPath(
            viewport.width +
              'x' +
              viewport.height +
              '-actual-name-required-feedback.png'
          );
          const png = await page.screenshot({
            path: originalPath,
            fullPage: false,
            caret: 'initial',
          });
          expect({
            width: png.readUInt32BE(16),
            height: png.readUInt32BE(20),
          }).toEqual(viewport);
          observations['name-feedback-' + viewport.width] = {
            viewport,
            field,
            geometry: nameGeometry,
            original: {
              path: originalPath,
              sha256: createHash('sha256').update(png).digest('hex'),
              fullPage: false,
              caret: 'initial',
            },
          };

          const symbolItem = page
            .locator('#rpc .ant-form-item')
            .filter({ has: symbol });
          await expect(symbolItem).toHaveCount(1);
          await tabTo(page, symbol);
          const symbolGeometry = await revealFeedback(page, symbolItem);
          const positive = await fieldEvidence(page, 'input#rpc_symbol');
          expect(symbolGeometry.visible).toBe(true);
          expect(
            positive.dom.references.some(
              (reference) =>
                reference.visible &&
                reference.text.includes(en.settings.symbolRequired)
            )
          ).toBe(true);
          expect(positive.native.description).toContain(
            en.settings.symbolRequired
          );
          expect(positive.native.properties.invalid).toBe('true');
          observations['symbol-native-positive-' + viewport.width] = positive;
          expect(await publicState(page)).toEqual(before!);
        }
        // Restore the original case's viewport and values before its existing
        // whitespace/refusal/SDK-save/reload sequence continues unchanged.
        await page.setViewportSize({ width: 400, height: 620 });
        await label.fill('Required fields fixture');
        await symbol.fill('TST');
        await expect(page.locator('input#rpc_url')).toHaveValue(RPC);
        expect(await publicState(page)).toEqual(before!);
      }
    );
    const invalid = [
      {
        name: 'spaces label',
        label: '   ',
        symbol: 'TST',
        error: en.settings.networkNameRequired,
      },
      {
        name: 'NBSP label',
        label: '\u00a0\u00a0',
        symbol: 'TST',
        error: en.settings.networkNameRequired,
      },
      {
        name: 'spaces symbol',
        label: 'Required fields fixture',
        symbol: '   ',
        error: en.settings.symbolRequired,
      },
      {
        name: 'NBSP symbol',
        label: 'Required fields fixture',
        symbol: '\u00a0\u00a0',
        error: en.settings.symbolRequired,
      },
    ];
    for (const scenario of invalid) {
      await wallet.step(
        `refuse ${scenario.name} without adding, granting or selecting a network`,
        async () => {
          phase = scenario.name;
          await label.fill(scenario.label);
          await symbol.fill(scenario.symbol);
          const readsBefore = reads.length;
          await save.click();
          await expect(
            page.getByText(scenario.error, { exact: true })
          ).toBeVisible();
          await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
          await expect(label).toHaveValue(scenario.label);
          await expect(symbol).toHaveValue(scenario.symbol);
          await expect(save).toBeEnabled();
          await expect(
            page.getByText(en.settings.rpcSuccessfullyAdded, { exact: true })
          ).toHaveCount(0);
          expect(reads.length).toBe(readsBefore);
          expect(await publicState(page)).toEqual(before!);
          if (scenario.error === en.settings.networkNameRequired) {
            nameFeedback.push({
              phase: scenario.name,
              field: await fieldEvidence(page, 'input#rpc_label'),
            });
          }
          observations[scenario.name] = {
            label: await label.inputValue(),
            symbol: await symbol.inputValue(),
            state: await publicState(page),
          };
        }
      );
    }
    const expected = {
      chainId: CHAIN_ID,
      kind: 'ethereum',
      label: LABEL,
      currency: SYMBOL.toLowerCase(),
      slip44: 60,
      url: RPC,
    };
    await wallet.step(
      'save meaningful padded fields through the actual SDK and durable registry',
      async () => {
        phase = 'save';
        await label.fill(LABEL);
        await symbol.fill(SYMBOL);
        await save.click();
        await expect(page).toHaveURL(/#\/home$/);
        await expect
          .poll(() => publicState(page))
          .toEqual({
            ...before,
            live: expected,
            stored: expected,
          });
        observations.saved = await publicState(page);
      }
    );
    await wallet.step(
      'reload and reopen the saved row with exact padded values',
      async () => {
        phase = 'reopen';
        await page.reload();
        await wallet!.waitAppReady();
        if (await page.locator('#unlock-btn').isVisible())
          await wallet!.unlock();
        await wallet!.ensureOnHome();
        expect(await publicState(page)).toEqual(observations.saved);
        await networkMenu.click();
        await page
          .getByRole('menuitem', {
            name: en.networkMenu.manageNetworks,
            exact: true,
          })
          .click();
        const row = page
          .locator('li')
          // Manage Networks displays the existing 25-character truncated label.
          .filter({
            has: page.getByText('Required fields fixture ...', { exact: true }),
          });
        await expect(row).toHaveCount(1);
        await row.locator('button').first().click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await expect(page.locator('input#rpc_label')).toHaveAttribute(
          'type',
          'hidden'
        );
        await expect(page.locator('input#rpc_label')).toHaveValue(LABEL);
        await expect(symbol).toHaveValue(SYMBOL);
        await expect(page.locator('input#rpc_url')).toHaveValue(RPC);
        observations.reopened = await publicState(page);
      }
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every((read) => read.url === RPC && read.method === 'eth_chainId')
    ).toBe(true);
    expect(unexpectedRpcRequests).toEqual([]);
    expect(attemptedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    await wallet.step(
      'only after every original save reload identity and wire guard judge Name association',
      async () => {
        expect(nameFeedback).toHaveLength(4);
        for (const observed of nameFeedback) {
          expect(
            observed.field.dom.references.some(
              (reference) =>
                reference.visible &&
                reference.text.includes(en.settings.networkNameRequired)
            )
          ).toBe(true);
          expect(observed.field.native.description).toContain(
            en.settings.networkNameRequired
          );
          expect(observed.field.dom.invalid).toBe('true');
          expect(observed.field.native.properties.invalid).toBe('true');
        }
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('custom-network-required-fields-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          nameFeedback,
          reads,
          unexpectedRpcRequests,
          attemptedWrites,
          fixtureReads: routes?.reads || [],
          deniedWrites: routes?.deniedWrites || [],
          proxyBlocked: server.blocked,
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          chromeApiReplaced: false,
          signingOrBroadcastRequested: false,
        }),
      });
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
