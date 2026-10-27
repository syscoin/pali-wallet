import { expect, test, type Page } from '@playwright/test';
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
import {
  extensionEvidence,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const ORIGIN = 'https://bridge.syscoin.org';
const FIXTURE_URL = `${ORIGIN}/pali-connection-selection-fixture`;
const SECOND_LABEL = 'Pending connection alternative';
// This document has no bridge code or external resources. Its actual origin
// enters the ordinary trusted-site branch while the launch proxy denies live IO.
const DOCUMENT = `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Connection selection fixture</title><h1>Connection selection fixture</h1><script>
window.__paliConformance={requests:[]};
window.__paliConformanceProvider={request:async args=>{
 const row={id:window.__paliConformance.requests.length,method:args.method,params:args.params,started:Date.now()};
 window.__paliConformance.requests.push(row);
 try{return row.result=await window.pali.request(args);}catch(e){row.error={code:e.code,message:String(e.message)};throw e;}
 finally{row.settled=true;row.durationMs=Date.now()-row.started;}
}};</script>`;

const publicState = (page: Page) =>
  page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = await chrome.storage.local.get([key, 'state']);
    const project = (ref: any, accounts: any) => ({
      id: ref.id,
      type: ref.type,
      address: accounts[ref.type][ref.id].address,
    });
    const grant = (value: any) =>
      value
        ? {
            accountId: value.accountId,
            accountType: value.accountType,
            host: value.host,
          }
        : null;
    return {
      active: project(state.vault.activeAccount, state.vault.accounts),
      savedActive: project(saved[key].activeAccount, saved[key].accounts),
      accounts: Object.values(state.vault.accounts.HDAccount).map(
        (account: any) => ({
          id: account.id,
          label: account.label,
          address: account.address,
        })
      ),
      grant: grant(state.dapp.dapps[origin]),
      savedGrant: grant(saved.state?.dapp?.dapps?.[origin]),
    };
  }, ORIGIN);

const delivery = (page: Page) =>
  page.evaluate(() => (window as any).__pendingConnection.snapshot());

test('connection selection stays on the reviewed account until real switch and grant acknowledgements arrive', async ({}, info) => {
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
    password: 'ConnectionPendingSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let popup: Page | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  const deniedTrustedRequests: string[] = [];
  try {
    wallet = await PaliWallet.launch('connection-pending-selection-contrast', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.context.route(`${ORIGIN}/**`, async (route) => {
      const request = route.request();
      if (
        request.url() !== FIXTURE_URL ||
        request.method() !== 'GET' ||
        request.resourceType() !== 'document'
      ) {
        deniedTrustedRequests.push(request.method() + ' ' + request.url());
        return route.abort('blockedbyclient');
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: DOCUMENT,
      });
    });
    const page = wallet.page;
    let before: Awaited<ReturnType<typeof publicState>>;
    let reviewed: { address: string; id: number; label: string };
    await wallet.step(
      'connection-pending prepare two ordinary accounts',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.gotoRoute('#/settings/account/new');
        await page.locator('#account-name-input').fill(SECOND_LABEL);
        await page.locator('#create-btn').click();
        await page
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await wallet!.ensureOnHome();
        before = await publicState(page);
        expect(before.active.id).toBe(1);
        expect(before.savedActive).toEqual(before.active);
        expect(before.accounts).toHaveLength(2);
        expect(before.grant).toBeNull();
        expect(before.savedGrant).toBeNull();
        reviewed = before.accounts.find((account) => account.id === 0)!;
        expect(reviewed.address).not.toBe(before.active.address);
        observations.before = before;
      }
    );

    const dapp = await wallet.context.newPage();
    await dapp.goto(FIXTURE_URL);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    const requestId = await startRequest(dapp, 'eth_requestAccounts');
    popup = await popupFor(wallet.context, dapp, requestId);
    const approval = popup;
    await approval.setViewportSize({ width: 400, height: 620 });
    const row = (label: string) =>
      approval.locator('[role="button"]').filter({
        has: approval.getByText(label, { exact: true }),
      });
    const reviewedRow = row(reviewed!.label);
    const otherRow = row(SECOND_LABEL);
    const healthyLabelPixels = new Map<number, Buffer>();
    const captureLabelPixels = async () => {
      await otherRow.hover();
      await otherRow.evaluate(async (element) => {
        const animations = new Set<Animation>();
        for (
          let node: Element | null = element;
          node;
          node = node.parentElement
        ) {
          for (const animation of node.getAnimations()) {
            if (
              Number.isFinite(
                Number(animation.effect?.getComputedTiming().endTime)
              )
            )
              animations.add(animation);
          }
        }
        await Promise.all(
          [...animations].map((animation) =>
            animation.finished.catch(() => undefined)
          )
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      });
      return otherRow
        .getByText(SECOND_LABEL, { exact: true })
        .screenshot({ animations: 'allow' });
    };

    const confirm = approval.getByRole('button', {
      name: en.buttons.confirm,
      exact: true,
    });
    await wallet.step(
      'connection-pending healthy pre-confirm selection',
      async (capture) => {
        await expect(approval.getByText(ORIGIN, { exact: true })).toBeVisible();
        await expect(approval.getByRole('dialog')).toHaveCount(0);
        await expect(otherRow).toHaveClass(/shadow-md/);
        await approval.setViewportSize({ width: 320, height: 360 });
        const compactSelection = approval.locator(
          '[data-connection-selected-summary]'
        );
        await expect(compactSelection).toBeVisible();
        await expect(compactSelection).toContainText(SECOND_LABEL);
        await expect(compactSelection).toContainText(
          `${before!.active.address.slice(
            0,
            8
          )}...${before!.active.address.slice(-4)}`
        );
        await approval.setViewportSize({ width: 400, height: 620 });
        await reviewedRow.click();
        await expect(reviewedRow).toHaveClass(/shadow-md/);
        await otherRow.press('Enter');
        await expect(otherRow).toHaveClass(/shadow-md/);
        await reviewedRow.press('Space');
        await expect(reviewedRow).toHaveClass(/shadow-md/);
        await approval.setViewportSize({ width: 320, height: 360 });
        await expect(compactSelection).toBeVisible();
        await expect(compactSelection).toContainText(reviewed!.label);
        await expect(compactSelection).toContainText(
          `${reviewed!.address.slice(0, 8)}...${reviewed!.address.slice(-4)}`
        );
        await approval.setViewportSize({ width: 400, height: 620 });
        expect(await publicState(page)).toEqual(before);
        await approval.evaluate(
          (target) => {
            const original = chrome.runtime.sendMessage;
            const stages: Record<string, any> = {};
            const held: Record<string, () => void> = {};
            chrome.runtime.sendMessage = function (...args: any[]) {
              const [message, callback] = args;
              const methods = message?.data?.methods?.join('.');
              const params = message?.data?.params;
              const stage =
                methods === 'wallet.setAccount'
                  ? 'switch'
                  : methods === 'dapp.connect'
                  ? 'grant'
                  : '';
              const matches =
                stage &&
                message?.type === 'CONTROLLER_ACTION' &&
                (stage === 'switch'
                  ? params?.[0] === target.id && params?.[1] === 'HDAccount'
                  : params?.[0]?.host === target.origin &&
                    params?.[0]?.accountId === target.id &&
                    params?.[0]?.accountType === 'HDAccount');
              if (!matches || typeof callback !== 'function')
                return (original as any).apply(chrome.runtime, args);
              const entry = (stages[stage] ||= {
                requests: 0,
                received: false,
                released: false,
                transportError: false,
                controllerError: false,
                heldForMs: 0,
              });
              entry.requests += 1;
              return original.call(chrome.runtime, message, (response) => {
                entry.received = true;
                entry.transportError = Boolean(chrome.runtime.lastError);
                entry.controllerError = Boolean(response?.error);
                const deliver = () => callback(response);
                if (
                  entry.transportError ||
                  entry.controllerError ||
                  entry.requests !== 1
                )
                  return deliver();
                const receivedAt = performance.now();
                held[stage] = () => {
                  entry.heldForMs = performance.now() - receivedAt;
                  entry.released = true;
                  deliver();
                };
              });
            } as typeof chrome.runtime.sendMessage;
            (window as any).__pendingConnection = {
              snapshot: () =>
                Object.fromEntries(
                  Object.entries(stages).map(([key, value]) => [
                    key,
                    { ...value, held: Boolean(held[key]) },
                  ])
                ),
              release: (stage: string) => {
                const deliver = held[stage];
                if (!deliver)
                  throw new Error('No completed acknowledgement held');
                delete held[stage];
                deliver();
              },
              cleanup: () => {
                const pending = Object.values(held);
                for (const key of Object.keys(held)) delete held[key];
                chrome.runtime.sendMessage = original;
                pending.forEach((deliver) => deliver());
              },
            };
          },
          { id: reviewed!.id, origin: ORIGIN }
        );
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await approval.setViewportSize(viewport);
          healthyLabelPixels.set(viewport.width, await captureLabelPixels());
        }
        await approval.setViewportSize({ width: 400, height: 620 });
        await capture(approval);
      }
    );

    const assertBusySelection = async () => {
      for (const accountRow of [reviewedRow, otherRow]) {
        await expect(accountRow).toHaveAttribute('aria-disabled', 'true');
        await expect(accountRow).toHaveAttribute('tabindex', '-1');
        await expect(
          accountRow.getByRole('button', {
            name: en.transactions.copyAddress,
            exact: true,
          })
        ).toBeDisabled();
      }
      await expect(confirm).toBeDisabled();
      const box = await otherRow.boundingBox();
      expect(box).not.toBeNull();
      // A physical click reaches the real row despite its aria-disabled state;
      // unlike locator.click it does not wait for the deliberately busy control.
      await approval.mouse.click(box!.x + 8, box!.y + box!.height / 2);
      await expect(otherRow).toBeFocused();
      await approval.keyboard.press('Enter');
      await approval.keyboard.press('Space');
      await expect(reviewedRow).toHaveClass(/shadow-md/);
      await expect(otherRow).not.toHaveClass(/shadow-md/);
      expect((await rpcObservation(dapp, requestId)).settled).not.toBe(true);
    };
    await wallet.step(
      'connection-pending completed switch cannot change reviewed selection',
      async (capture) => {
        await confirm.click();
        await expect
          .poll(() => delivery(approval))
          .toMatchObject({
            switch: {
              requests: 1,
              received: true,
              held: true,
              transportError: false,
              controllerError: false,
            },
          });
        await assertBusySelection();
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await approval.setViewportSize(viewport);
          // Focusing a busy row must preserve the healthy label's rendered
          // ellipsis. Comparing within this run avoids platform font baselines.
          expect(
            (await captureLabelPixels()).equals(
              healthyLabelPixels.get(viewport.width)!
            )
          ).toBe(true);
          const pendingConfirm = approval.getByRole('button', {
            name: en.buttons.confirm,
            exact: true,
          });
          await expect(pendingConfirm).toBeDisabled();
          await expect(pendingConfirm).toHaveAttribute('aria-busy', 'true');
          const spinner = pendingConfirm.locator(':scope > svg');
          const progress = await captureForegroundContrast(
            pendingConfirm,
            info,
            `connection-busy-progress-${viewport.width}`,
            'currentColor-icon'
          );
          // The spinner inherits this stable button's foreground. Measure its
          // backing without requiring the rotating SVG to become stationary.
          expect(
            await spinner.evaluate((node) => getComputedStyle(node).color)
          ).toBe(
            await pendingConfirm.evaluate(
              (node) => getComputedStyle(node).color
            )
          );
          // This is active progress, even though the action stays disabled.
          expect(progress.unsupported).toEqual([]);
          expect(progress.ratio).toBeGreaterThanOrEqual(3);
          expect(
            await spinner.evaluate((element) =>
              Number.parseFloat(getComputedStyle(element).width)
            )
          ).toBe(20);
          expect(
            await spinner.evaluate(
              (element) => getComputedStyle(element).animationName
            )
          ).not.toBe('none');
        }
        await approval.setViewportSize({ width: 400, height: 620 });
        const state = await publicState(page);
        expect(state.active).toEqual({
          id: reviewed!.id,
          type: 'HDAccount',
          address: reviewed!.address,
        });
        expect(state.savedActive).toEqual(state.active);
        expect(state.grant).toBeNull();
        expect(state.savedGrant).toBeNull();
        observations.switchHeld = { state, delivery: await delivery(approval) };
        await capture(approval);
        await approval.evaluate(() =>
          (window as any).__pendingConnection.release('switch')
        );
      }
    );
    await wallet.step(
      'connection-pending completed grant keeps the same reviewed selection',
      async (capture) => {
        await expect
          .poll(() => delivery(approval))
          .toMatchObject({
            grant: {
              requests: 1,
              received: true,
              held: true,
              transportError: false,
              controllerError: false,
            },
          });
        await assertBusySelection();
        const state = await publicState(page);
        const grant = {
          host: ORIGIN,
          accountId: reviewed!.id,
          accountType: 'HDAccount',
        };
        expect(state.active.address).toBe(reviewed!.address);
        expect(state.savedActive).toEqual(state.active);
        expect(state.grant).toEqual(grant);
        expect(state.savedGrant).toEqual(grant);
        observations.grantHeld = { state, delivery: await delivery(approval) };
        await capture(approval);
      }
    );
    await wallet.step(
      'connection-pending releases the exact acknowledgement and returns reviewed account',
      async () => {
        const snapshot = await delivery(approval);
        expect(snapshot.switch.requests).toBe(1);
        expect(snapshot.grant.requests).toBe(1);
        expect(snapshot.switch.heldForMs).toBeLessThan(9000);
        observations.completedDelivery = snapshot;
        await approval.evaluate(() =>
          (window as any).__pendingConnection.release('grant')
        );
        const result = await settle(dapp, requestId);
        expect(result.error).toBeUndefined();
        // The provider returns the same EVM identity in lowercase.
        expect(result.result).toEqual([reviewed!.address.toLowerCase()]);
        expect(approval.isClosed()).toBe(true);
        const current = await publicState(page);
        expect(current.active.address).toBe(reviewed!.address);
        expect(current.grant).toEqual(current.savedGrant);
        expect(current.grant?.accountId).toBe(reviewed!.id);
        observations.final = { result, current };
        expect(deniedTrustedRequests).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(sourceSha256);
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('connection-pending-selection-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          trustedDocumentUrl: FIXTURE_URL,
          deniedTrustedRequests,
          fixtureReads: routes?.reads ?? [],
          deniedWrites: routes?.deniedWrites ?? [],
          proxyDeniedConnections: server.blocked.length,
          actualCompletedAcknowledgementsOnly: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          signingOrBroadcastRequested: false,
        }),
      });
    } finally {
      try {
        if (popup && !popup.isClosed())
          await popup
            .evaluate(() => (window as any).__pendingConnection?.cleanup())
            .catch(() => undefined);
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
