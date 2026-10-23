import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
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

const FIRST_LABEL = 'Pending label A';
const NEXT_LABEL = 'Current label B';
const PADDED_LABEL = '  Family savings  ';

const publicAccount = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount;
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = await chrome.storage.local.get(key);
    const project = (account: any) => ({
      id: account.id,
      label: account.label,
      address: account.address,
    });
    return {
      active: ref,
      live: project(state.vault.accounts[ref.type][ref.id]),
      saved: project(saved[key].accounts[ref.type][ref.id]),
    };
  });

test('account label input stays locked until its genuine completed Save is acknowledged', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceHash = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountLabelPendingSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let delivery: any;
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('account-label-pending-input', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const page = wallet.page;
    const input = page.getByPlaceholder(en.settings.accountLabel, {
      exact: true,
    });
    const save = page.getByRole('button', {
      name: en.buttons.save,
      exact: true,
    });
    await wallet.step(
      'open the active account through the normal Manage Accounts Edit button',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        const before = await publicAccount(page);
        expect(before.active).toEqual({ id: 0, type: 'HDAccount' });
        expect(before.live).toEqual(before.saved);
        observations.before = before;
        await wallet!.gotoRoute('#/settings/manage-accounts');
        await page
          .getByRole('button', {
            name: `${en.buttons.edit}: ${before.live.label}`,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/edit-account$/);
        await expect(input).toHaveValue(before.live.label);
        await expect(input).toBeEnabled();
        await expect(input).toHaveAccessibleName(en.settings.accountLabel);
        const accessibility = await wallet!.context.newCDPSession(page);
        try {
          const { root } = await accessibility.send('DOM.getDocument', {
            depth: 0,
          });
          const { nodeId } = await accessibility.send('DOM.querySelector', {
            nodeId: root.nodeId,
            selector: '#edit-account input',
          });
          expect(nodeId).toBeGreaterThan(0);
          const { nodes } = await accessibility.send(
            'Accessibility.getPartialAXTree',
            { nodeId, fetchRelatives: false }
          );
          const name = nodes.find((node) => node.role?.value === 'textbox')
            ?.name?.value;
          expect(name).toBe(en.settings.accountLabel);
          observations.nativeBrowserAccountLabelName = name;
        } finally {
          await accessibility.detach();
        }
        await page.evaluate(
          ({ firstLabel, target }) => {
            const original = chrome.runtime.sendMessage;
            let armed = true;
            let held: (() => void) | undefined;
            let receivedAt = 0;
            const evidence = {
              matchingRequests: 0,
              labelRequests: 0,
              received: false,
              released: false,
              transportError: false,
              controllerError: false,
              heldForMs: 0,
            };
            (chrome.runtime.sendMessage as any) = (...args: any[]) => {
              const [message, callback] = args;
              const methods = message?.data?.methods;
              const params = message?.data?.params;
              const isLabelRequest =
                message?.type === 'CONTROLLER_ACTION' &&
                JSON.stringify(methods) ===
                  JSON.stringify(['wallet', 'editAccountLabel']);
              if (isLabelRequest) evidence.labelRequests += 1;
              const matching =
                isLabelRequest &&
                params?.[0] === firstLabel &&
                params?.[1] === target.id &&
                params?.[2] === target.type;
              if (!matching || !armed || typeof callback !== 'function')
                return (original as any).apply(chrome.runtime, args);
              armed = false;
              evidence.matchingRequests += 1;
              // Dispatch the real operation immediately. Hold only its final
              // acknowledgement after the worker has committed the exact label.
              return original.call(chrome.runtime, message, (response) => {
                evidence.received = true;
                evidence.transportError = Boolean(chrome.runtime.lastError);
                evidence.controllerError = Boolean(response?.error);
                const deliver = () => callback(response);
                if (evidence.transportError || evidence.controllerError)
                  return deliver();
                receivedAt = performance.now();
                held = deliver;
              });
            };
            (window as any).__pendingLabelSave = {
              snapshot: () => ({ ...evidence, held: Boolean(held) }),
              release: () => {
                if (!held) throw new Error('No genuine label completion held');
                const deliver = held;
                held = undefined;
                evidence.heldForMs = performance.now() - receivedAt;
                evidence.released = true;
                deliver();
              },
              cleanup: () => {
                const deliver = held;
                held = undefined;
                deliver?.();
                chrome.runtime.sendMessage = original;
              },
            };
          },
          { firstLabel: FIRST_LABEL, target: before.active }
        );
      }
    );

    await wallet.step(
      'the real Save commits but its still-pending UI cannot accept a replacement draft',
      async (capture) => {
        await input.fill(FIRST_LABEL);
        await expect(input).toHaveAccessibleName(en.settings.accountLabel);
        await save.click();
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).__pendingLabelSave.snapshot())
          )
          .toMatchObject({
            matchingRequests: 1,
            received: true,
            held: true,
            transportError: false,
            controllerError: false,
          });
        await expect(page).toHaveURL(/#\/settings\/edit-account$/);
        await expect(input).toHaveValue(FIRST_LABEL);
        await expect(input).toBeDisabled();
        await expect(save).toBeDisabled();
        const committed = await publicAccount(page);
        expect(committed.active).toEqual({ id: 0, type: 'HDAccount' });
        expect(committed.live.label).toBe(FIRST_LABEL);
        expect(committed.saved.label).toBe(FIRST_LABEL);
        expect(committed.live).toEqual(committed.saved);
        observations.committedWhileAcknowledgementHeld = committed;
        await capture(page);
        await page.evaluate(async () => {
          (window as any).__pendingLabelSave.release();
          await new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done()))
          );
        });
        await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
        await expect(
          page.getByRole('button', {
            name: `${en.buttons.edit}: ${FIRST_LABEL}`,
            exact: true,
          })
        ).toBeVisible();
        delivery = await page.evaluate(() =>
          (window as any).__pendingLabelSave.snapshot()
        );
        expect(delivery.released).toBe(true);
        expect(delivery.held).toBe(false);
        expect(delivery.heldForMs).toBeLessThan(9_000);
      }
    );

    await wallet.step(
      'reopening the editor enables a new exact label and native Enter Save',
      async () => {
        await page
          .getByRole('button', {
            name: `${en.buttons.edit}: ${FIRST_LABEL}`,
            exact: true,
          })
          .click();
        await expect(input).toBeEnabled();
        await expect(input).toHaveValue(FIRST_LABEL);
        await input.fill(NEXT_LABEL);
        await input.press('Enter');
        await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
        await expect(
          page.getByRole('button', {
            name: `${en.buttons.edit}: ${NEXT_LABEL}`,
            exact: true,
          })
        ).toBeVisible();
        const current = await publicAccount(page);
        expect(current.active).toEqual({ id: 0, type: 'HDAccount' });
        expect(current.live.label).toBe(NEXT_LABEL);
        expect(current.saved.label).toBe(NEXT_LABEL);
        expect(current.live).toEqual(current.saved);
        observations.current = current;
        expect(routes!.deniedWrites).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(sourceHash);
      }
    );

    await wallet.step(
      'blank and non-breaking-space labels stay editable without saving or navigating',
      async () => {
        const before = await publicAccount(page);
        const requestsBefore = await page.evaluate(
          () => (window as any).__pendingLabelSave.snapshot().labelRequests
        );
        await page
          .getByRole('button', {
            name: `${en.buttons.edit}: ${NEXT_LABEL}`,
            exact: true,
          })
          .click();
        await expect(input).toHaveValue(NEXT_LABEL);
        const rejected: Array<{ kind: string; labelRequests: number }> = [];
        for (const [kind, label] of [
          ['spaces', '   '],
          ['non-breaking spaces', '\u00a0\u00a0'],
        ]) {
          await input.fill(label);
          await save.click();
          await expect(
            page.getByText(en.settings.newLabel, { exact: true })
          ).toBeVisible();
          await expect(input).toHaveValue(label);
          await expect(input).toBeEnabled();
          await expect(page).toHaveURL(/#\/settings\/edit-account$/);
          expect(await publicAccount(page)).toEqual(before);
          const labelRequests = await page.evaluate(
            () => (window as any).__pendingLabelSave.snapshot().labelRequests
          );
          expect(labelRequests).toBe(requestsBefore);
          rejected.push({ kind, labelRequests });
        }
        observations.rejectedBlankLabels = rejected;
      }
    );

    await wallet.step(
      'a meaningful padded label is saved by Enter with its exact spelling retained',
      async () => {
        await input.fill(PADDED_LABEL);
        await input.press('Enter');
        await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
        const edited = page.getByRole('button', {
          name: `${en.buttons.edit}: Family savings`,
          exact: true,
        });
        await expect(edited).toBeVisible();
        await expect(edited).toHaveAttribute(
          'aria-label',
          `${en.buttons.edit}: ${PADDED_LABEL}`
        );
        const current = await publicAccount(page);
        expect(current.active).toEqual({ id: 0, type: 'HDAccount' });
        expect(current.live.label).toBe(PADDED_LABEL);
        expect(current.saved.label).toBe(PADDED_LABEL);
        expect(current.live).toEqual(current.saved);
        observations.paddedLabel = current;
        expect(routes!.deniedWrites).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(sourceHash);
      }
    );
    status = 'passed';
  } finally {
    try {
      if (wallet && !wallet.page.isClosed())
        delivery = await wallet.page.evaluate(() =>
          (window as any).__pendingLabelSave?.snapshot()
        );
      await info.attach('account-label-pending-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceHash,
          observations,
          delivery,
          deniedWrites: routes?.deniedWrites ?? [],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
          controllerResultReplaced: false,
          genuineCompletedCallbackDelayOnly: true,
          storageFailureRecoveryCoveredByNativeTest: true,
          signingOrBroadcastRequested: false,
        }),
      });
    } finally {
      try {
        if (wallet && !wallet.page.isClosed())
          await wallet.page.evaluate(() =>
            (window as any).__pendingLabelSave?.cleanup()
          );
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
