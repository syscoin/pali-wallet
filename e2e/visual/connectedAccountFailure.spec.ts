import { type Locator, type Page, expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const exposed = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      box.left < 0 ||
      box.top < 0 ||
      box.right > innerWidth ||
      box.bottom > innerHeight
    )
      return false;
    return [
      [box.left + box.width / 2, box.top + 2],
      [box.left + box.width / 2, box.bottom - 2],
      [box.left + 2, box.top + box.height / 2],
      [box.right - 2, box.top + box.height / 2],
    ].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === element || element.contains(hit));
    });
  });

for (const viewport of [
  { width: 320, height: 360 },
  { width: 400, height: 620 },
]) {
  test(`account-mismatch rejection stays actionable at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    test.setTimeout(120_000);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PopupSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let popup: Page | undefined;
    let routes:
      | Awaited<ReturnType<typeof installUtxoFixtureRoutes>>
      | undefined;
    const failures: string[] = [];
    const pageErrors: string[] = [];
    const evidence: Record<string, unknown> = {
      ...extensionEvidence(),
      viewport,
      simulated: true,
      directPopupRoute: true,
      fullDappRequestLifecycleTested: false,
      controllerOrDomReplaced: false,
      status: 'running',
    };
    const directory =
      process.env.PALI_CONNECTED_ACCOUNT_OUTPUT ||
      path.join(E2E_CONFIG.artifactsDir, 'connected-account-failure');
    fs.mkdirSync(directory, { recursive: true });
    const capture = async (page: Page, name: string) => {
      const file = path.join(
        directory,
        `${viewport.width}x${viewport.height}-${name}.png`
      );
      await page.screenshot({ path: file, animations: 'disabled' });
      await info.attach(name, { path: file, contentType: 'image/png' });
    };
    const selection = async () =>
      wallet!.page.evaluate(async () => {
        const state = await chrome.runtime.sendMessage({
          type: 'getCurrentState',
        });
        const active =
          state.vault.accounts[state.vault.activeAccount.type][
            state.vault.activeAccount.id
          ];
        return {
          id: active.id,
          address: active.address,
          label: active.label,
          accountType: state.vault.activeAccount.type,
          staleIdExists: Boolean(
            state.vault.accounts[state.vault.activeAccount.type][2147483647]
          ),
        };
      });
    try {
      wallet = await PaliWallet.launch(
        `connected-account-failure-${viewport.width}x${viewport.height}`,
        { offlineHttpProxy: server.url, viewport }
      );
      routes = await installUtxoFixtureRoutes(
        wallet.context,
        createUtxoFixture(),
        server.url
      );
      await wallet.step('onboard the fenced synthetic wallet', async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
      });
      const initial = await selection();
      expect(initial.staleIdExists).toBe(false);
      evidence.initialSelection = initial;
      const open = async (id: number) => {
        const page = await wallet!.context.newPage();
        popup = page;
        await page.setViewportSize(viewport);
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
          if (message.text().includes('Failed to change account:'))
            failures.push(message.text());
        });
        await page.goto(
          `chrome-extension://${
            wallet!.extensionId
          }/external.html?route=change-active-connected-account&data=${encodeURIComponent(
            JSON.stringify({
              host: 'https://fixture.invalid',
              eventName: 'changeActiveConnected',
              accountType: initial.accountType,
              connectedAccount: {
                id,
                address: initial.address,
                label:
                  id === initial.id ? initial.label : 'Unavailable account',
              },
            })
          )}`
        );
        await expect(page.locator('#initial-loader')).toHaveCSS('opacity', '0');
        const action = page.getByRole('button', {
          name: en.connections.switchAccount,
          exact: true,
        });
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeEnabled();
        await expect.poll(() => exposed(action)).toBe(true);
        return page;
      };

      await wallet.step(
        'a valid account acknowledgement closes its popup',
        async (shot) => {
          const healthy = await open(initial.id);
          await capture(healthy, 'healthy-before-switch');
          await shot(healthy);
          await Promise.all([
            healthy.waitForEvent('close'),
            healthy
              .getByRole('button', {
                name: en.connections.switchAccount,
                exact: true,
              })
              .click(),
          ]);
          evidence.healthyPopupClosed = true;
          expect(failures).toEqual([]);
          expect(await selection()).toEqual(initial);
        }
      );

      const failed = await open(2147483647);
      const action = failed.getByRole('button', {
        name: en.connections.switchAccount,
        exact: true,
      });
      const cancel = failed.getByRole('button', {
        name: en.buttons.cancel,
        exact: true,
      });
      const alert = failed.getByRole('alert');
      const clickAndObserveSettlement = async () => {
        // Observe actual button attributes without replacing a controller or
        // changing DOM. Production intentionally strips console messages.
        await action.evaluate((element) => {
          const state = { busy: false, settled: false };
          (window as any).__paliAccountSwitchObservation = state;
          const observer = new MutationObserver((records) => {
            state.busy ||=
              element.getAttribute('aria-busy') === 'true' ||
              records.some(
                (record) =>
                  record.attributeName === 'aria-busy' &&
                  record.oldValue === 'true'
              );
            state.settled =
              state.busy &&
              element.getAttribute('aria-busy') !== 'true' &&
              !element.hasAttribute('disabled');
            if (state.settled) observer.disconnect();
          });
          observer.observe(element, {
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ['aria-busy', 'disabled'],
          });
        });
        await action.click();
        await expect
          .poll(() =>
            failed.evaluate(
              () => (window as any).__paliAccountSwitchObservation.settled
            )
          )
          .toBe(true);
        expect(failed.isClosed()).toBe(false);
        await expect(action).toBeEnabled();
        await expect(cancel).toBeEnabled();
      };
      await wallet.step(
        'an unavailable account settles with visible actionable feedback',
        async (shot) => {
          await clickAndObserveSettlement();
          evidence.failedSwitchSettledWithoutClose = true;
          await shot(failed);
          await expect(alert).toHaveText('Account not found');
          evidence.naturalControllerRejectionObserved = true;
          await alert.scrollIntoViewIfNeeded();
          await expect.poll(() => exposed(alert)).toBe(true);
          await expect.poll(() => exposed(action)).toBe(true);
          await expect.poll(() => exposed(cancel)).toBe(true);
          await capture(failed, 'rejection');
        }
      );
      await wallet.step(
        'retry settles without a false success or selection change',
        async (shot) => {
          await clickAndObserveSettlement();
          await expect(alert).toHaveText('Account not found');
          await expect.poll(() => exposed(cancel)).toBe(true);
          expect(await selection()).toEqual(initial);
          await capture(failed, 'retry-rejection');
          await shot(failed);
        }
      );
      await wallet.step(
        'Cancel closes the failed approval without selecting the missing account',
        async (shot) => {
          await shot(failed);
          await Promise.all([failed.waitForEvent('close'), cancel.click()]);
          evidence.failedPopupCancelled = true;
          expect(await selection()).toEqual(initial);
        }
      );
      expect(pageErrors).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      evidence.status = 'passed';
    } catch (error) {
      evidence.status = 'failed';
      evidence.failure = error instanceof Error ? error.message : String(error);
      if (popup && !popup.isClosed()) {
        await capture(popup, 'failure');
        await info.attach('failure-ui', {
          body: await popup.locator('body').ariaSnapshot(),
          contentType: 'text/plain',
        });
      }
      throw error;
    } finally {
      evidence.controllerFailures = failures;
      evidence.pageErrors = pageErrors;
      evidence.deniedWrites = routes?.deniedWrites;
      evidence.testSourceSha256 = createHash('sha256')
        .update(fs.readFileSync(__filename))
        .digest('hex');
      fs.writeFileSync(
        path.join(directory, `${viewport.width}x${viewport.height}.json`),
        JSON.stringify(evidence, null, 2)
      );
      await wallet
        ?.dispose(evidence.status === 'passed' ? 'passed' : 'failed')
        .catch(() => undefined);
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  });
}
