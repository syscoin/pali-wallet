import { expect, test, type Page, type TestInfo } from '@playwright/test';
import path from 'path';

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

test.beforeEach(() => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
});

async function snapshot(
  page: Page,
  info: TestInfo,
  name: string,
  observation: unknown
) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await info.attach(name, { path: file, contentType: 'image/png' });
  await info.attach(`${name}-observation`, {
    contentType: 'application/json',
    body: JSON.stringify(observation, null, 2),
  });
  console.log(name, JSON.stringify(observation));
}

for (const editDraft of [true, false]) {
  test(
    editDraft
      ? 'in-flight suggested RPC test does not overwrite a newer manual network draft'
      : 'current unedited suggestion retains its working RPC fallback',
    async ({}, info) => {
      test.setTimeout(120000);
      const before = { ...E2E_CONFIG };
      const server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'Qa122RecoverySynthetic!2026',
        rpcUrl: server.url,
      });
      let wallet: PaliWallet | undefined;
      let status: 'passed' | 'failed' = 'failed';
      let releaseFirst!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstSeen = false;
      let firstResponded = false;
      const reads: string[] = [];
      try {
        wallet = await PaliWallet.launch(
          editDraft
            ? 'qa122-recovery-network-draft'
            : 'qa122-recovery-network-fallback',
          {
            offlineHttpProxy: server.url,
            viewport: { width: 400, height: 620 },
          }
        );
        const routes = await installIsolatedVaultRoutes(
          wallet.context,
          createIsolatedVaultFixture(),
          server.url
        );
        await wallet.context.route('https://chainlist.org/rpcs.json', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                name: 'QA122 Delayed Network',
                chainId: 5700,
                networkId: 5700,
                nativeCurrency: {
                  name: 'Synthetic',
                  symbol: 'OLD',
                  decimals: 18,
                },
                rpc: [
                  { url: 'https://qa122-first.invalid/rpc' },
                  { url: 'https://qa122-second.invalid/rpc' },
                ],
                explorers: [],
              },
            ]),
          })
        );
        await wallet.context.route(
          'https://qa122-first.invalid/rpc',
          async (route) => {
            firstSeen = true;
            reads.push('old-first-auth-failure');
            await released;
            await route.fulfill({
              status: 401,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Synthetic API key required' }),
            });
            firstResponded = true;
          }
        );
        await wallet.context.route(
          'https://qa122-second.invalid/rpc',
          async (route) => {
            const calls = route.request().postDataJSON();
            expect(Array.isArray(calls)).toBe(true);
            const reply = calls.map((call: any) => {
              expect(['eth_chainId', 'eth_blockNumber']).toContain(call.method);
              reads.push(call.method);
              return {
                jsonrpc: '2.0',
                id: call.id,
                result: call.method === 'eth_chainId' ? '0x1644' : '0x1',
              };
            });
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(reply),
            });
          }
        );
        await wallet.importSeedAndCreatePassword();
        await wallet.ensureOnHome();
        await wallet.gotoRoute('#/settings/networks/custom-rpc');
        const page = wallet.page;
        const label = page.getByRole('combobox', {
          name: en.settings.label,
          exact: true,
        });
        await label.fill('QA122');
        await page
          .getByRole('option', { name: /QA122 Delayed Network/ })
          .click();
        await expect.poll(() => firstSeen).toBe(true);
        await expect(
          page.getByRole('button', { name: en.buttons.save, exact: true })
        ).toBeDisabled();
        if (editDraft) {
          await label.fill('My replacement network');
          await page.locator('#rpc_chainId').fill('12345');
          await page.locator('#rpc_symbol').fill('NEW');
          await page
            .locator('#rpc_url')
            .fill('https://my-replacement.invalid/rpc');
        }
        const fields = async () => ({
          label: await label.inputValue(),
          chainId: await page.locator('#rpc_chainId').inputValue(),
          symbol: await page.locator('#rpc_symbol').inputValue(),
          url: await page.locator('#rpc_url').inputValue(),
        });
        const newerDraft = await fields();
        await snapshot(
          page,
          info,
          'newer-manual-draft-while-old-check-pending',
          newerDraft
        );
        releaseFirst();
        await expect.poll(() => firstResponded).toBe(true);
        // Let the real controller deliver the completed read to the mounted form.
        // The stale path must remain inert, including before its next 300ms retry.
        if (editDraft) await page.waitForTimeout(500);
        await expect(
          page.getByRole('button', { name: en.buttons.save, exact: true })
        ).toBeEnabled({ timeout: 15000 });
        const afterOldCheck = await fields();
        await snapshot(page, info, 'draft-after-old-check-finishes', {
          newerDraft,
          afterOldCheck,
          reads,
          text: await page.locator('body').innerText(),
          runtime: extensionEvidence(),
        });
        expect(routes.deniedWrites).toEqual([]);
        if (editDraft) {
          expect(afterOldCheck).toEqual(newerDraft);
          expect(reads).toEqual(['old-first-auth-failure']);
          await expect(
            page.getByText(/Connected to QA122 Delayed Network/)
          ).toHaveCount(0);
        } else {
          expect(afterOldCheck).toEqual({
            label: 'QA122 Delayed Network',
            chainId: '5700',
            symbol: 'OLD',
            url: 'https://qa122-second.invalid/rpc',
          });
          expect(
            reads.filter((method) => method === 'eth_chainId')
          ).toHaveLength(3);
          await expect(
            page.getByText(/Connected to QA122 Delayed Network/)
          ).toBeVisible();
        }
        status = 'passed';
      } finally {
        releaseFirst();
        try {
          await wallet?.dispose(status);
        } finally {
          try {
            await server.close();
          } finally {
            Object.assign(E2E_CONFIG, before);
          }
        }
      }
    }
  );
}

test('network-error recovery edit action is reachable by keyboard', async ({}, info) => {
  test.setTimeout(120000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa122RecoverySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa122-recovery-error-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    // Mainnet is intentionally offline in this synthetic fixture. Enter its
    // genuine failure screen through the visible red connection indicator.
    const failureIndicator = page.getByRole('button', {
      name: en.networkConnection.networkError,
      exact: true,
    });
    await expect(failureIndicator).toHaveCount(1);
    // Observe native focus before the original pointer action. This is the
    // real error indicator, not a fixture-created control.
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 620 },
    ]) {
      await page.setViewportSize(viewport);
      let focused = false;
      for (let step = 0; step < 30; step++) {
        await page.keyboard.press('Tab');
        focused = await failureIndicator.evaluate(
          (element) => document.activeElement === element
        );
        if (focused) break;
      }
      expect(focused).toBe(true);
      const identity = await failureIndicator.evaluate((element) => ({
        focused: document.activeElement === element,
        tag: element.tagName,
        ariaLabel: element.getAttribute('aria-label'),
        disabled: (element as HTMLButtonElement).disabled,
        className: element.className,
        bounds: element.getBoundingClientRect().toJSON(),
        parent: element.parentElement?.outerHTML.slice(0, 500),
      }));
      expect(identity.ariaLabel).toBe(en.networkConnection.networkError);
      expect(identity.disabled).toBe(false);
      expect(identity.bounds.width).toBeGreaterThanOrEqual(24);
      expect(identity.bounds.height).toBeGreaterThanOrEqual(24);
      expect(identity.bounds.x).toBeGreaterThanOrEqual(0);
      expect(identity.bounds.y).toBeGreaterThanOrEqual(0);
      expect(identity.bounds.right).toBeLessThanOrEqual(viewport.width);
      expect(identity.bounds.bottom).toBeLessThanOrEqual(viewport.height);
      const hits = await failureIndicator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [
          [box.left + box.width / 2, box.top + 2],
          [box.left + box.width / 2, box.bottom - 2],
          [box.left + 2, box.top + box.height / 2],
          [box.right - 2, box.top + box.height / 2],
          [box.left + box.width / 2, box.top + box.height / 2],
        ].map(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return {
            x,
            y,
            reachesButton: hit === element || element.contains(hit),
          };
        });
      });
      expect(hits.every((hit) => hit.reachesButton)).toBe(true);
      const network = page
        .getByTitle('Syscoin Mainnet', { exact: true })
        .locator('xpath=ancestor::button[1]');
      await expect(network).toBeEnabled();
      const networkCenterHit = await network.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2
        );
        return hit === element || element.contains(hit);
      });
      expect(networkCenterHit).toBe(true);
      await snapshot(
        page,
        info,
        `network-error-native-focus-before-${viewport.width}`,
        {
          viewport,
          identity,
          hits,
          networkCenterHit,
        }
      );
    }
    await page.setViewportSize({ width: 320, height: 360 });
    for (const menuName of ['network', 'general'] as const) {
      const opener =
        menuName === 'network'
          ? page
              .getByTitle('Syscoin Mainnet', { exact: true })
              .locator('xpath=ancestor::button[1]')
          : page.getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            });
      await opener.click();
      await expect(page.getByRole('menu')).toBeVisible();
      const target = page.locator('button.status-target');
      const overlay = await target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          hitsStatus: hit === element || element.contains(hit),
          hitTag: hit?.tagName,
        };
      });
      expect(overlay.hitsStatus).toBe(false);
      await snapshot(page, info, `network-status-${menuName}-overlay`, overlay);
      await page.mouse.click(overlay.x, overlay.y);
      await expect(page).toHaveURL(/#\/home$/);
      await expect(page.getByRole('menu')).toBeHidden();
    }
    await page.setViewportSize({ width: 400, height: 620 });
    await failureIndicator.click();
    await expect(page).toHaveURL(/#\/chain-fail-to-connect$/);
    const edit = page.getByText(en.chainError.editCurrentRpc, { exact: true });
    await expect(edit).toBeVisible();
    const observed: unknown[] = [];
    let reachable = true;
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 620 },
    ]) {
      await page.setViewportSize(viewport);
      const stops: unknown[] = [];
      let reached = false;
      for (let step = 0; step < 24; step++) {
        await page.keyboard.press('Tab');
        const stop = await edit.evaluate((element) => ({
          reached:
            element === document.activeElement ||
            element.contains(document.activeElement),
          tag: document.activeElement?.tagName,
          text: document.activeElement?.textContent?.slice(0, 80),
        }));
        stops.push(stop);
        reached ||= stop.reached;
        if (reached) break;
      }
      reachable &&= reached;
      const geometry = await edit.evaluate((element) => ({
        tag: element.tagName,
        role: element.getAttribute('role'),
        tabIndex: element.getAttribute('tabindex'),
        bounds: element.getBoundingClientRect().toJSON(),
      }));
      observed.push({ viewport, reached, geometry, stops });
      await snapshot(
        page,
        info,
        `network-error-edit-keyboard-${viewport.width}`,
        observed
      );
    }
    expect(reachable).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
    await snapshot(page, info, 'network-error-edit-keyboard-control', {
      observed,
      keyboardOpenedEditor: true,
      runtime: extensionEvidence(),
    });
    // Navigate back through the same document, then select the fixture's
    // healthy test network through the ordinary network menu.
    await page.goBack();
    await expect(page).toHaveURL(/#\/chain-fail-to-connect$/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/home$/);
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    const statusButton = page.locator('button.status-target');
    await expect(statusButton).toHaveCount(1);
    await expect(statusButton).toBeDisabled();
    let healthyReceivedTabFocus = false;
    for (let step = 0; step < 30; step++) {
      await page.keyboard.press('Tab');
      healthyReceivedTabFocus ||= await statusButton.evaluate(
        (element) => document.activeElement === element
      );
    }
    expect(healthyReceivedTabFocus).toBe(false);
    const healthy = await statusButton.evaluate((element) => ({
      tag: element.tagName,
      ariaLabel: element.getAttribute('aria-label'),
      disabled: (element as HTMLButtonElement).disabled,
      bounds: element.getBoundingClientRect().toJSON(),
    }));
    await snapshot(page, info, 'network-status-healthy-non-action', {
      ...healthy,
      healthyReceivedTabFocus,
    });
    await page
      .getByRole('button', { name: en.generalMenu.generalOptions, exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: en.generalMenu.advanced, exact: true })
      .click();
    await expect(page).toHaveURL(/#\/settings\/advanced$/);
    const refresh = page.locator('#advanced-refresh');
    if ((await refresh.getAttribute('aria-checked')) !== 'true') {
      await refresh.click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
    }
    await expect(refresh).toHaveAttribute('aria-checked', 'true');
    await page.locator('#advanced-autolock').fill('0');
    await page
      .getByRole('button', { name: en.buttons.save, exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/home$/);
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 620 },
    ]) {
      await page.setViewportSize(viewport);
      const network = page
        .getByTitle('Syscoin Testnet', { exact: true })
        .locator('xpath=ancestor::button[1]');
      const refreshButton = page.getByRole('button', {
        name: en.header.refresh,
        exact: true,
      });
      const general = page.getByRole('button', {
        name: en.generalMenu.generalOptions,
        exact: true,
      });
      await expect(statusButton).toBeDisabled();
      await expect(refreshButton).toBeVisible();
      const statusBox = (await statusButton.boundingBox())!;
      const networkBox = (await network.boundingBox())!;
      const refreshBox = (await refreshButton.boundingBox())!;
      const generalBox = (await general.boundingBox())!;
      expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(networkBox.x);
      expect(networkBox.x + networkBox.width).toBeLessThanOrEqual(refreshBox.x);
      expect(refreshBox.x + refreshBox.width).toBeLessThanOrEqual(generalBox.x);
      expect(generalBox.x + generalBox.width).toBeLessThanOrEqual(
        viewport.width
      );
      for (const button of [network, refreshButton, general]) {
        expect(
          await button.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2
            );
            return hit === element || element.contains(hit);
          })
        ).toBe(true);
      }
      await snapshot(
        page,
        info,
        `network-status-refresh-adjacency-${viewport.width}`,
        {
          viewport,
          statusBox,
          networkBox,
          refreshBox,
          generalBox,
        }
      );
    }
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, before);
      }
    }
  }
});
