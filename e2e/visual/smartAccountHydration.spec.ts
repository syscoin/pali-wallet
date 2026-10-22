import { expect, test, type Page } from '@playwright/test';
import {
  AbiCoder,
  concat,
  getBytes,
  hashMessage,
  id,
  keccak256,
  recoverAddress,
  toUtf8Bytes,
  TypedDataEncoder,
} from 'ethers';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import { PaliWallet } from '../harness/pali';
import { createSmartAccountHydrationFixture } from '../harness/smartAccountHydrationFixture';
import {
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

const LABEL = 'Hydration smart savings';
const MESSAGE = 'Pali synthetic hydration regression: off-chain approval only';

// Read only the public selection and module metadata from the actual worker.
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const { vault } = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const active = vault.activeAccount;
    const account = vault.accounts[active.type][active.id];
    return {
      active: { ...active, address: account.address },
      smartAccount: vault.accounts.SmartAccount[0]?.smartAccount,
      hdAccount: {
        address: vault.accounts.HDAccount[0].address,
        label: vault.accounts.HDAccount[0].label,
      },
    };
  });

const personalDigest = (account: string, message: string) =>
  keccak256(
    concat([
      '0x1901',
      TypedDataEncoder.hashDomain({
        chainId: VISUAL_FIXTURE_CHAIN_ID,
        name: 'pali.smart-account.erc1271',
        verifyingContract: account,
        version: '1',
      }),
      keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'bytes32'],
          [id('PersonalSign(bytes prefixed)'), hashMessage(getBytes(message))]
        )
      ),
    ])
  );

test('smart-account policy refresh serializes with real message signing and rejects a changed account', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const fixture = createSmartAccountHydrationFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: VISUAL_FIXTURE_SEED,
    password: 'SmartHydrationSynthetic!2026',
    rpcUrl: server.url,
    chainId: VISUAL_FIXTURE_CHAIN_ID,
    networkLabel: 'zkTanenbaum',
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {
    runtime: extensionEvidence(),
    chainResponses: 'synthetic; no public chain or transaction publication',
    controllerStateReplaced: false,
    controllerResultsReplaced: false,
  };
  try {
    wallet = await PaliWallet.launch('smart-account-hydration', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    await fixture.install(wallet.context, server.url);
    const page = wallet.page;
    await wallet.step(
      'import the disposable wallet and select the fenced synthetic network',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('zkTanenbaum', 'EVM');
        await wallet!.ensureOnHome();
      }
    );
    await wallet.step(
      'create and select the smart account through the real wallet UI',
      async () => {
        await wallet!.gotoRoute('#/settings/account/new');
        await page.locator('#account-name-input').fill(LABEL);
        await page
          .getByRole('button', {
            name: new RegExp(`^${en.settings.createSmartAccount}`, 'i'),
          })
          .click();
        const dialog = page
          .getByRole('dialog')
          .filter({ hasText: en.settings.yourNewAccount });
        await expect(
          dialog.getByText(fixture.base.smartAccountAddress, { exact: true })
        ).toBeVisible();
        await dialog.locator('#account-created-ok-btn').click();
        await wallet!.ensureOnHome();
        expect((await publicState(page)).active).toMatchObject({
          type: 'SmartAccount',
          id: 0,
        });
      }
    );
    await wallet.step(
      'read the synthetic deployed guardian policy through production hydration',
      async () => {
        fixture.state.deployed = true;
        fixture.state.guardianInstalled = true;
        await wallet!.gotoRoute('#/settings/account/smart-account-policy');
        await expect(
          page.locator('[data-navigation-scroll="smart-account-policy"]')
        ).toBeVisible();
        const state = await publicState(page);
        expect(state.smartAccount.isDeployed).toBe(true);
        expect(state.smartAccount.installedModules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'executor' }),
          ])
        );
        await wallet!.gotoRoute('#/home');
        await wallet!.ensureOnHome();
      }
    );
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    await wallet.step(
      'connect the local dapp explicitly to the intended smart account',
      async () => {
        const request = await startRequest(dapp, 'eth_requestAccounts');
        const popup = await popupFor(wallet!.context, dapp, request);
        await expect(
          popup.getByText(server.url, { exact: true })
        ).toBeVisible();
        await popup
          .getByRole('searchbox')
          .fill(fixture.base.smartAccountAddress);
        const row = popup.getByRole('button').filter({ hasText: LABEL });
        await expect(row).toBeVisible();
        await row.click();
        await expect(row).toHaveClass(/border-brand-royalblue/);
        await popup
          .getByRole('button', { name: en.buttons.confirm, exact: true })
          .click();
        const untrusted = popup
          .getByRole('dialog')
          .filter({ hasText: en.connections.nonTrusted });
        await expect(untrusted).toBeVisible();
        await clickClosingPopup({
          click: () =>
            untrusted
              .getByRole('button', { name: en.buttons.confirm, exact: true })
              .click(),
          isClosed: () => popup.isClosed(),
        });
        expect(
          (await settle(dapp, request)).result.map((address: string) =>
            address.toLowerCase()
          )
        ).toEqual([fixture.base.smartAccountAddress.toLowerCase()]);
      }
    );
    const message = `0x${Buffer.from(toUtf8Bytes(MESSAGE)).toString('hex')}`;
    await wallet.step(
      'serialize the policy read and confirmed personal_sign without reusing an old read',
      async (capture) => {
        fixture.state.guardianInstalled = false;
        fixture.armBarrier();
        await wallet!.gotoRoute('#/settings/account/smart-account-policy');
        await fixture.waitForRead(1);
        const request = await startRequest(dapp, 'personal_sign', [
          message,
          fixture.base.smartAccountAddress,
        ]);
        const popup = await popupFor(wallet!.context, dapp, request);
        await expect(popup.getByText(MESSAGE, { exact: true })).toBeVisible();
        await capture(popup);
        const confirm = popup.getByRole('button', {
          name: en.buttons.confirm,
          exact: true,
        });
        await confirm.click();
        await expect(confirm).toBeDisabled();
        expect((await rpcObservation(dapp, request)).settled).not.toBe(true);
        expect(fixture.metadataReadCount).toBe(1);
        fixture.releaseRead(1);
        await fixture.waitForRead(2);
        const refreshed = await publicState(page);
        expect(
          refreshed.smartAccount.installedModules.some(
            (module: any) => module.type === 'executor'
          )
        ).toBe(false);
        observations.firstReadCommittedBeforeSecond = true;
        fixture.releaseRead(2);
        const response = await settle(dapp, request, 30_000);
        expect(response.error).toBeUndefined();
        const signature = response.result as string;
        expect(getBytes(signature)).toHaveLength(85);
        expect(signature.slice(0, 42).toLowerCase()).toBe(
          fixture.base.validator.address.toLowerCase()
        );
        expect(
          recoverAddress(
            personalDigest(fixture.base.smartAccountAddress, message),
            `0x${signature.slice(42)}`
          ).toLowerCase()
        ).toBe(fixture.base.address.toLowerCase());
        observations.signature = {
          bytes: 85,
          recoveredOwner: fixture.base.address,
          validator: fixture.base.validator.address,
        };
        expect(fixture.audit.deniedWrites).toEqual([]);
        fixture.releaseAll();
        await expect.poll(() => popup.isClosed()).toBe(true);
      }
    );
    await wallet.step(
      'a controlled real-controller account change rejects pending signing hydration before any signature',
      async (capture) => {
        await wallet!.gotoRoute('#/home');
        await wallet!.ensureOnHome();
        fixture.armBarrier();
        const request = await startRequest(dapp, 'personal_sign', [
          message,
          fixture.base.smartAccountAddress,
        ]);
        const popup = await popupFor(wallet!.context, dapp, request);
        await expect(popup.getByText(MESSAGE, { exact: true })).toBeVisible();
        const confirm = popup.getByRole('button', {
          name: en.buttons.confirm,
          exact: true,
        });
        await confirm.click();
        await expect(confirm).toBeDisabled();
        await fixture.waitForRead(1);
        const { hdAccount } = await publicState(page);
        // Recheck the real main-window guard independently of popup event timing.
        await page.reload();
        await wallet!.waitAppReady();
        await expect(
          page.getByRole('heading', {
            name: 'Pali is Currently Active',
            exact: true,
          })
        ).toBeVisible();
        // The account menu is intentionally unavailable during approval. Exercise
        // its production controller operation without replacing state or results.
        const switchResponse = await page.evaluate(async (expectedAddress) => {
          const result = await chrome.runtime.sendMessage({
            type: 'CONTROLLER_ACTION',
            data: {
              methods: ['wallet', 'setAccount'],
              params: [0, 'HDAccount', false, expectedAddress],
            },
          });
          return result ?? null;
        }, hdAccount.address);
        // setAccount returns void; structured controller failures are not success.
        expect(switchResponse).toBeNull();
        await expect
          .poll(() => publicState(page))
          .toMatchObject({
            active: { type: 'HDAccount', id: 0, address: hdAccount.address },
          });
        fixture.releaseRead(1);
        const error = popup
          .getByRole('dialog')
          .filter({ hasText: en.transactions.signatureFailed });
        await expect(error).toBeVisible();
        await capture(popup);
        await clickClosingPopup({
          click: () =>
            error.getByRole('button', { name: 'Ok', exact: true }).click(),
          isClosed: () => popup.isClosed(),
        });
        const response = await settle(dapp, request, 30_000);
        expect(response.result).toBeUndefined();
        expect(response.error).toBeDefined();
        expect(fixture.metadataReadCount).toBe(1);
        expect(fixture.audit.deniedWrites).toEqual([]);
        observations.controlledRealControllerAccountChangeRejected = {
          error: response.error,
          mainWindowBlocked: true,
          metadataReads: fixture.metadataReadCount,
          operation: 'wallet.setAccount via CONTROLLER_ACTION',
          selected: hdAccount.address,
        };
        fixture.releaseAll();
      }
    );
    observations.network = fixture.audit;
    expect(fixture.audit.deniedWrites).toEqual([]);
    // Startup UTXO and remote security-feed reads remain blocked by the
    // established visual fixture. Every RPC needed by this EVM case must be
    // explicitly modeled; never hide an unsupported contract/RPC response.
    expect(
      fixture.audit.deniedUnknown.filter((request) =>
        request.startsWith('rpc:')
      )
    ).toEqual([]);
    await info.attach('smart-account-hydration-evidence', {
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
