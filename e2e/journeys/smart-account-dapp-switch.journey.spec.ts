import { expect, test, type Page } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import { PaliWallet } from '../harness/pali';
import { createSmartAccountHydrationFixture } from '../harness/smartAccountHydrationFixture';
import {
  approve,
  extensionEvidence,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

const LABEL = 'Dapp connected smart account';
const MESSAGE = 'Synthetic smart account switch; cancel without signing';
const publicState = (page: Page, host: string) =>
  page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount;
    return {
      active: {
        ...ref,
        address: state.vault.accounts[ref.type][ref.id].address,
      },
      grant: state.dapp.dapps[origin]
        ? {
            accountId: state.dapp.dapps[origin].accountId,
            accountType: state.dapp.dapps[origin].accountType,
          }
        : null,
    };
  }, host);

test('a dapp can switch back to its connected smart account before approval', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const fixture = createSmartAccountHydrationFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: VISUAL_FIXTURE_SEED,
    password: 'SmartDappSwitchSynthetic!2026',
    rpcUrl: server.url,
    chainId: VISUAL_FIXTURE_CHAIN_ID,
    networkLabel: 'zkTanenbaum',
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {
    runtime: extensionEvidence(),
    chainResponses:
      'synthetic reads; no public chain or transaction publication',
    controllerStateReplaced: false,
    controllerResultsReplaced: false,
  };
  try {
    wallet = await PaliWallet.launch('smart-account-dapp-switch', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    await fixture.install(wallet.context, server.url);
    const page = wallet.page;
    const address = fixture.base.smartAccountAddress;
    const host = new URL(server.url).origin;
    await wallet.step(
      'create a smart account through the real account menu',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('zkTanenbaum', 'EVM');
        await wallet!.ensureOnHome();
        await page
          .getByRole('button', {
            name: en.generalMenu.generalOptions,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', {
            name: en.accountMenu.createNewAccount,
            exact: true,
          })
          .click();
        await page.locator('#account-name-input').fill(LABEL);
        await page
          .getByRole('button', {
            name: new RegExp(`^${en.settings.createSmartAccount}`, 'i'),
          })
          .click();
        const dialog = page
          .getByRole('dialog')
          .filter({ hasText: en.settings.yourNewAccount });
        await expect(dialog.getByText(address, { exact: true })).toBeVisible();
        await dialog.locator('#account-created-ok-btn').click();
        await wallet!.ensureOnHome();
        // This only changes the fenced chain's read responses. No wallet state,
        // controller result, contract call, or signature is replaced.
        fixture.state.deployed = true;
      }
    );
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    await wallet.step(
      'connect the inert local dapp to the created account',
      async () => {
        const id = await startRequest(dapp, 'eth_requestAccounts');
        const popup = await popupFor(wallet!.context, dapp, id);
        await popup.getByRole('searchbox').fill(address);
        const row = popup.getByRole('button').filter({ hasText: LABEL });
        await expect(row).toBeVisible();
        await row.click();
        const result = await approve(wallet!.context, dapp, id);
        expect(
          result.result.map((value: string) => value.toLowerCase())
        ).toEqual([address.toLowerCase()]);
        await expect
          .poll(() => publicState(page, host))
          .toMatchObject({
            grant: { accountId: 0, accountType: 'SmartAccount' },
          });
      }
    );
    await wallet.step(
      'select the HD account through the real account menu',
      async () => {
        await wallet!.ensureOnHome();
        await page.locator('#general-settings-button').click();
        const row = page.locator('#account-HDAccount-0');
        await expect(row).toBeVisible();
        await row.getByRole('menuitem').first().click();
        await expect
          .poll(() => publicState(page, host))
          .toMatchObject({
            active: { id: 0, type: 'HDAccount' },
            grant: { accountId: 0, accountType: 'SmartAccount' },
          });
        await wallet!.ensureOnHome();
      }
    );
    await wallet.step(
      'review the real switch prompt and cancel the signing request',
      async (capture) => {
        const message = `0x${Buffer.from(MESSAGE, 'utf8').toString('hex')}`;
        const id = await startRequest(dapp, 'personal_sign', [
          message,
          address,
        ]);
        const popup = await popupFor(wallet!.context, dapp, id);
        await expect(
          popup.getByText(en.connections.accountMismatch, { exact: true })
        ).toBeVisible();
        const payload = JSON.parse(
          new URL(popup.url()).searchParams.get('data') || '{}'
        );
        expect(payload.accountType).toBe('SmartAccount');
        expect(payload.connectedAccount).toEqual({
          id: 0,
          address,
          label: LABEL,
        });
        expect(Object.keys(payload.connectedAccount).sort()).toEqual([
          'address',
          'id',
          'label',
        ]);
        expect((await rpcObservation(dapp, id)).settled).not.toBe(true);
        const switchButton = popup.getByRole('button', {
          name: en.connections.switchAccount,
          exact: true,
        });
        await capture(popup);
        await expect(
          popup.getByText(en.receive.addressUnavailable, { exact: true })
        ).toHaveCount(0);
        await expect(
          popup.getByText(`${address.slice(0, 8)}...${address.slice(-4)}`, {
            exact: true,
          })
        ).toBeVisible();
        await expect(switchButton).toBeEnabled();
        // Keep the accepted prompt registered briefly to exercise a slow
        // browser-window close before the subsequent signing approval opens.
        await popup.evaluate(() => {
          const close = window.close.bind(window);
          window.close = () => {
            window.setTimeout(close, 250);
          };
        });
        await clickClosingPopup({
          click: () => switchButton.click(),
          isClosed: () => popup.isClosed(),
        });
        await expect.poll(() => popup.isClosed()).toBe(true);
        await expect
          .poll(() => publicState(page, host))
          .toMatchObject({
            active: { id: 0, type: 'SmartAccount', address },
            grant: { accountId: 0, accountType: 'SmartAccount' },
          });
        const signing = await popupFor(wallet!.context, dapp, id);
        await expect(signing.getByText(MESSAGE, { exact: true })).toBeVisible();
        await clickClosingPopup({
          click: () =>
            signing
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => signing.isClosed(),
        });
        const result = await settle(dapp, id, 30_000);
        expect(result.error).toMatchObject({ code: 4001 });
        expect(result.result).toBeUndefined();
        observations.switch = {
          available: true,
          signingCancellation: result.error,
        };
      }
    );
    expect(fixture.audit.deniedWrites).toEqual([]);
    expect(
      fixture.audit.deniedUnknown.filter((entry) => entry.startsWith('rpc:'))
    ).toEqual([]);
    observations.network = fixture.audit;
    await info.attach('smart-account-dapp-switch-evidence', {
      body: Buffer.from(JSON.stringify(observations, null, 2)),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    fixture.releaseAll();
    if (wallet) await wallet.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
