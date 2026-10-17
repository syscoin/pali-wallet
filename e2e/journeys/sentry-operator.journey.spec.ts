import { expect, test } from '@playwright/test';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  popupFor,
  providerRequest,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  createUtxoFixture,
  fixtureRead,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Public deterministic fixture only. Never import a real operator key here.
const OPERATOR_SECRET = '00'.repeat(31) + '01';

test('Sentry operator custody stays local, survives locking, and fits short windows', async ({}, info) => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SentrySyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('sentry-operator-custody', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    const page = wallet.page;
    await wallet.step(
      'open Sentry operator settings in a fresh offline wallet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await wallet!.gotoRoute('#/settings/sentry');
        await expect(
          page.getByText('No Sentry keys imported on this network.')
        ).toBeVisible();
      }
    );
    await wallet.step(
      'import a public synthetic BLS operator through the trusted wallet UI',
      async () => {
        await page.getByRole('button', { name: 'Import Sentry key' }).click();
        await page.getByLabel('Key label').fill('Offline synthetic node');
        await page.getByLabel('Sentry private key (hex)').fill(OPERATOR_SECRET);
        await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
        const importButton = page.getByRole('button', {
          name: 'Import',
          exact: true,
        });
        await expect(importButton).toBeDisabled();
        await page.getByRole('checkbox').check();
        await importButton.click();
        await expect(
          page.getByText('Operator key imported securely.')
        ).toBeVisible({ timeout: 30000 });
        await expect(
          page.getByRole('heading', { name: 'Offline synthetic node' })
        ).toBeVisible();
        const worker = wallet!.context
          .serviceWorkers()
          .find((item) => item.url().endsWith('background.bundle.js'))!;
        const storage = await worker.evaluate(async () => {
          const values = await new Promise<Record<string, unknown>>((resolve) =>
            chrome.storage.local.get(null, resolve)
          );
          return Object.fromEntries(
            Object.entries(values).filter(([key]) => key.startsWith('sentry-'))
          );
        });
        expect(JSON.stringify(storage)).not.toContain(OPERATOR_SECRET);
        expect(JSON.stringify(storage)).not.toContain(E2E_CONFIG.password);
        expect(JSON.stringify(storage)).not.toContain(UTXO_FIXTURE_SEED);
      }
    );
    await wallet.step(
      'retain encrypted operator key across lock and reauthentication',
      async () => {
        await page.evaluate(
          () =>
            new Promise<void>((resolve, reject) => {
              chrome.runtime.sendMessage(
                {
                  type: 'CONTROLLER_ACTION',
                  data: { methods: ['wallet', 'lock'], params: [] },
                },
                (result) =>
                  result?.error
                    ? reject(new Error(String(result.error)))
                    : resolve()
              );
            })
        );
        await wallet!.gotoRoute('#/');
        await wallet!.unlock();
        await wallet!.gotoRoute('#/settings/sentry');
        await expect(
          page.getByRole('heading', { name: 'Offline synthetic node' })
        ).toBeVisible();
      }
    );
    await wallet.step(
      'short-window import and removal controls stay reachable without exposing secrets',
      async () => {
        await page.setViewportSize({ width: 320, height: 360 });
        await page.getByRole('button', { name: 'Remove local key' }).click();
        await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
        const remove = page.getByRole('button', {
          name: 'Remove',
          exact: true,
        });
        await remove.scrollIntoViewIfNeeded();
        await expect(remove).toBeVisible();
        expect(
          await remove.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return (
              box.left >= 0 &&
              box.right <= innerWidth &&
              box.top >= 0 &&
              box.bottom <= innerHeight
            );
          })
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath('sentry-remove-320x360.png'),
        });
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Import Sentry key' }).click();
        await page.getByLabel('Key label').fill('Uncommitted draft');
        await page.getByLabel('Sentry private key (hex)').fill(OPERATOR_SECRET);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Import Sentry key' }).click();
        await expect(page.getByLabel('Sentry private key (hex)')).toHaveValue(
          ''
        );
        await expect(page.getByLabel('Wallet password')).toHaveValue('');
        await page.screenshot({
          path: info.outputPath('sentry-import-320x360.png'),
        });
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    wallet = undefined;
    throw error;
  } finally {
    await wallet?.dispose('failed');
    Object.assign(E2E_CONFIG, previous);
    await server.close();
  }
});

for (const scheme of ['bls-basic', 'slh-dsa-shake-128s'] as const) {
  test(`real ${scheme} operator authorization binds the reviewed NEVM address and rejects another network`, async ({}, info) => {
    test.setTimeout(180000);
    const sdk = await import('@sidhujag/sysweb3-sentry');
    const previous = { ...E2E_CONFIG };
    const fixture = createUtxoFixture();
    const trustedContext: { value?: unknown } = {};
    const server = await startUtxoFixtureServer({
      readJson: (url) =>
        url.pathname === '/api/sentry/v1/context'
          ? trustedContext.value
          : fixtureRead(
              fixture,
              'https://blockbook-dev.syscoin.org' + url.pathname + url.search,
              'GET'
            ),
    });
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'SentrySyntheticOnly!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    const key =
      scheme === 'bls-basic'
        ? await sdk.importSentryOperatorKey(scheme, OPERATOR_SECRET)
        : await sdk.deriveSentryOperatorKey(scheme, '01'.repeat(48));
    const chain = {
      genesisHash:
        '0000066e1a6b9cfeac8295dce0cc8d9170690a74bc4878cf8a0b412554f5c222',
      era: scheme === 'bls-basic' ? ('legacy-v3' as const) : ('pq-v4' as const),
    };
    const node = {
      proTxHash: 'ab'.repeat(32),
      operatorPublicKey: key.publicKey,
      ...(scheme === 'slh-dsa-shake-128s'
        ? {
            globalKeyVersion: 1,
            pqRecord: {
              version: 1,
              profile: 1,
              keyVersion: 1,
              publicKey: key.publicKey,
              childKeyCommitmentHex:
                '01000100eb0010000100000064000000' +
                '66'.repeat(32) +
                '77'.repeat(32),
              activatedHeight: 1000,
            },
          }
        : {}),
      service: '1.2.3.4:18369',
      operatorPayoutScript: '',
      nevmAddress: '',
      collateralOutpoint: { txid: fixture.parentTxs[1].getId(), vout: 0 },
      confirmedHash: 'ef'.repeat(32),
      poseBanHeight: -1,
    };
    trustedContext.value = { chain, node };
    const parent = fixture.parentTxs[0];
    let wallet: PaliWallet | undefined;
    try {
      wallet = await PaliWallet.launch('sentry-nevm-authorization', {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      const routes = await installUtxoFixtureRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route(`${server.url}/api/v2/**`, (route) =>
        route.continue()
      );
      await wallet.context.route(
        `${server.url}/api/sentry/v1/context?**`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ chain, node }),
          })
      );
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet.ensureOnHome();
      await wallet.gotoRoute('#/settings/sentry');
      const page = wallet.page;
      await page.getByRole('button', { name: 'Import Sentry key' }).click();
      await page.getByLabel('Key type').selectOption(scheme);
      await page
        .getByLabel('Key label')
        .fill(`Synthetic ${scheme === 'bls-basic' ? 'BLS' : 'PQ'} operator`);
      await page.getByLabel('Sentry private key (hex)').fill(key.secretKey);
      await page.getByRole('checkbox').check();
      await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(
        page.getByText('Operator key imported securely.')
      ).toBeVisible();
      await page.getByRole('button', { name: 'Trusted data service' }).click();
      await page.getByLabel('Trusted HTTPS service origin').fill(server.url);
      await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(
        page.getByText('Trusted service settings saved.')
      ).toBeVisible();
      const controller = <T>(method: string, params: unknown[]): Promise<T> =>
        page.evaluate(
          ({ method, params }) =>
            new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                {
                  type: 'CONTROLLER_ACTION',
                  data: { methods: ['wallet', method], params },
                },
                (result) =>
                  result?.error
                    ? reject(new Error(String(result.error)))
                    : resolve(result)
              );
            }),
          { method, params }
        );
      // Keep the real background fetch on the same local deny-by-default fixture.
      // Page route interception does not intercept service-worker fetch requests.
      const activeNetwork = await page.evaluate(
        () =>
          new Promise<any>((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: 'CONTROLLER_ACTION',
                data: { methods: ['wallet', 'getState'], params: [] },
              },
              (state) => resolve(state.vault.activeNetwork)
            );
          })
      );
      await controller('setActiveNetwork', [
        { ...activeNetwork, url: server.url },
        true,
      ]);
      const target = '0x' + '12'.repeat(20);
      const request = sdk.buildSentryServiceUpdate({
        chain,
        node,
        nevmAddress: target,
        inputs: [{ txid: parent.getId(), vout: 0 }],
        outputs: [
          {
            valueSatoshis: '99000',
            scriptHex: Buffer.from(parent.outs[0].script).toString('hex'),
          },
        ],
      });
      // Submit through the actual public provider and approve its real popup.
      await page.goto(server.url);
      await page.waitForFunction(() => Boolean((window as any).pali));
      const connection = await approve(
        wallet.context,
        page,
        await startRequest(page, 'sys_requestAccounts')
      );
      expect(connection.result).toEqual([fixture.userAddress]);
      const capabilities = await providerRequest(
        page,
        'sys_getSentryCapabilities'
      );
      expect(capabilities.operations).toContain('updateService');
      expect(capabilities.keys).toBeUndefined();
      const rejected = await settle(
        page,
        await startRequest(page, 'sys_signSentryOperation', [
          { ...request, chain: { ...chain, genesisHash: 'ff'.repeat(32) } },
        ])
      );
      expect(rejected.error).toBeTruthy();
      const id = await startRequest(page, 'sys_signSentryOperation', [request]);
      const popup = await popupFor(wallet.context, page, id);
      await expect(popup.getByText(target)).toBeVisible();
      await popup.screenshot({
        path: info.outputPath('sentry-authorize-400x620.png'),
      });
      await popup.setViewportSize({ width: 320, height: 360 });
      await expect
        .poll(() =>
          popup.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        .toBe(true);
      await popup.getByLabel('Wallet password').fill(E2E_CONFIG.password);
      await popup
        .getByRole('button', { name: 'Authorize update' })
        .scrollIntoViewIfNeeded();
      await expect(
        popup.getByRole('button', { name: 'Authorize update' })
      ).toBeEnabled();
      await popup.screenshot({
        path: info.outputPath('sentry-authorize-320x360.png'),
      });
      await popup.getByRole('button', { name: 'Authorize update' }).click();
      await expect
        .poll(
          async () => {
            if ((await rpcObservation(page, id)).settled) return true;
            if (!popup.isClosed() && (await popup.getByRole('alert').count()))
              throw new Error(await popup.getByRole('alert').innerText());
            return false;
          },
          { timeout: 45000 }
        )
        .toBe(true);
      const signed = await settle(page, id, 45000);
      expect(signed.error).toBeUndefined();
      const result = signed.result;
      expect(result.operatorPublicKey).toBe(key.publicKey);
      expect(JSON.stringify(result)).not.toContain(key.secretKey);
      expect(
        await sdk.verifySentryOperation(
          { ...request, transactionHex: result.transactionHex },
          {
            chain,
            node,
            previousTransactions: [parent.toHex()],
            maxFeeSatoshis: '100000',
          }
        )
      ).toBe(true);
      const changedAddress = result.transactionHex.replace(
        '12'.repeat(20),
        '34'.repeat(20)
      );
      expect(changedAddress).not.toBe(result.transactionHex);
      expect(
        await sdk.verifySentryOperation(
          { ...request, transactionHex: changedAddress },
          {
            chain,
            node,
            previousTransactions: [parent.toHex()],
            maxFeeSatoshis: '100000',
          }
        )
      ).toBe(false);
      const linkId = await startRequest(page, 'sys_linkSentryNode', [
        {
          version: 1,
          proTxHash: node.proTxHash,
          genesisHash: chain.genesisHash,
        },
      ]);
      const linkPopup = await popupFor(wallet.context, page, linkId);
      await expect(linkPopup.getByText(node.proTxHash)).toBeVisible();
      await linkPopup.screenshot({
        path: info.outputPath('sentry-link-400x620.png'),
      });
      await linkPopup.setViewportSize({ width: 320, height: 360 });
      await linkPopup
        .getByRole('button', { name: 'Link node', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        linkPopup.getByRole('button', { name: 'Link node', exact: true })
      ).toBeEnabled();
      await linkPopup.screenshot({
        path: info.outputPath('sentry-link-320x360.png'),
      });
      await linkPopup
        .getByRole('button', { name: 'Link node', exact: true })
        .click();
      expect((await settle(page, linkId)).result).toMatchObject({
        linked: true,
        proTxHash: node.proTxHash,
      });
      await wallet.step(
        'linked node and separate-account collateral survive reload and lock',
        async () => {
          const assertSavedNode = async () => {
            const settings = await controller<{
              collateral: Array<{
                proTxHash?: string;
                txid: string;
                vout: number;
              }>;
              linkedNodes: Array<{
                collateralOutpoint: { txid: string; vout: number };
                proTxHash: string;
              }>;
            }>('getSentrySettings', []);
            expect(settings.linkedNodes).toContainEqual(
              expect.objectContaining({
                proTxHash: node.proTxHash,
                collateralOutpoint: node.collateralOutpoint,
              })
            );
            expect(settings.collateral).toContainEqual({
              proTxHash: node.proTxHash,
              ...node.collateralOutpoint,
            });
            await expect(
              page.getByText(node.proTxHash, { exact: true })
            ).toBeVisible();
            await expect(
              page.getByText(
                `${node.collateralOutpoint.txid}:${node.collateralOutpoint.vout}`,
                { exact: true }
              )
            ).toBeVisible();
          };
          await wallet!.gotoRoute('#/settings/sentry');
          await assertSavedNode();
          await page.reload();
          await wallet!.waitAppReady();
          await assertSavedNode();
          await controller('lock', []);
          await wallet!.gotoRoute('#/');
          await wallet!.unlock();
          await wallet!.gotoRoute('#/settings/sentry');
          await assertSavedNode();
        }
      );
      await wallet.step(
        'ordinary public PSBT signing refuses the protected separate-account output',
        async (capture) => {
          await page.goto(server.url);
          await page.waitForFunction(() => Boolean((window as any).pali));
          expect(await providerRequest(page, 'sys_requestAccounts')).toEqual([
            fixture.userAddress,
          ]);
          // This same mixed-owner PSBT succeeds in the ordinary UTXO journey.
          // Its account-1 input is now explicitly linked collateral, so account-0
          // signing must refuse the whole request before returning any witness.
          const protectedId = await startRequest(page, 'sys_sign', [
            fixture.mixed,
          ]);
          const protectedPopup = await popupFor(
            wallet!.context,
            page,
            protectedId
          );
          await protectedPopup
            .getByRole('button', { name: /^(sign|confirm)$/i })
            .last()
            .click();
          await expect(
            protectedPopup.getByText(/spends protected Sentry Node collateral/)
          ).toBeVisible();
          await capture(protectedPopup);
          const refused = await settle(page, protectedId, 15000);
          expect(refused.error).toBeTruthy();
          expect(refused.result).toBeUndefined();
          expect(routes.deniedWrites).toEqual([]);
          expect(routes.syntheticBroadcasts).toEqual([]);
        }
      );
      await wallet.dispose('passed');
      wallet = undefined;
    } catch (error) {
      await wallet?.dispose('failed');
      wallet = undefined;
      throw error;
    } finally {
      await wallet?.dispose('failed');
      Object.assign(E2E_CONFIG, previous);
      await server.close();
    }
  });
}
