import { expect, test } from '@playwright/test';
import { utils } from 'syscoinjs-lib';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  popupFor,
  providerRequest,
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

test('imported Taproot WIF authorizes its matching legacy Sentry owner through the provider', async ({}, info) => {
  test.setTimeout(180000);
  const sdk = await import('@sidhujag/sysweb3-sentry');
  const previous = { ...E2E_CONFIG };
  const fixture = createUtxoFixture();
  const network = utils.syscoinNetworks.testnet;
  const pair = utils.bitcoinjs.ECPair.fromPrivateKey(Buffer.alloc(32, 12), {
    network,
  });
  const taproot = utils.bitcoinjs.payments.p2tr({
    internalPubkey: pair.publicKey.slice(1),
    network,
  }).address;
  const ownerKeyId = sdk.sentryKeyId(
    Buffer.from(pair.publicKey).toString('hex')
  );
  const operator = await sdk.importSentryOperatorKey(
    'bls-basic',
    '00'.repeat(31) + '01'
  );
  const chain = {
    genesisHash:
      '0000066e1a6b9cfeac8295dce0cc8d9170690a74bc4878cf8a0b412554f5c222',
    era: 'legacy-v3' as const,
  };
  const node = {
    proTxHash: 'ab'.repeat(32),
    operatorPublicKey: operator.publicKey,
    ownerKeyId,
    votingKeyId: ownerKeyId,
    payoutScript: Buffer.from(fixture.parentTxs[0].outs[0].script).toString(
      'hex'
    ),
    service: '1.2.3.4:18369',
    operatorPayoutScript: '',
    nevmAddress: '',
    collateralOutpoint: { txid: fixture.parentTxs[1].getId(), vout: 0 },
    confirmedHash: 'ef'.repeat(32),
    poseBanHeight: -1,
  };
  const server = await startUtxoFixtureServer({
    readJson: (url) => {
      if (url.pathname === '/api/sentry/v1/context') return { chain, node };
      if (url.pathname === `/api/v2/address/${taproot}`)
        return {
          address: taproot,
          balance: '0',
          unconfirmedBalance: '0',
          txs: 0,
          tokens: [],
          transactions: [],
        };
      return fixtureRead(
        fixture,
        'https://blockbook-dev.syscoin.org' + url.pathname + url.search,
        'GET'
      );
    },
  });
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SentrySyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('sentry-taproot-wallet-authority', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route(`${server.url}/**`, (route) => route.continue());
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    await wallet.ensureOnHome();
    const page = wallet.page;
    await wallet.step(
      'import a synthetic WIF using the real Taproot account option',
      async () => {
        await wallet!.gotoRoute('#/settings/account/import');
        await page.locator('#import-account-identifier').fill(pair.toWIF());
        await page.getByRole('radio', { name: 'Taproot (P2TR)' }).check();
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        await expect(
          page.getByText('Account imported successfully')
        ).toBeVisible();
        await wallet!.gotoRoute('#/settings/sentry');
        await page
          .getByRole('button', { name: 'Trusted data service' })
          .click();
        await page.getByLabel('Trusted HTTPS service origin').fill(server.url);
        await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(
          page.getByText('Trusted service settings saved.')
        ).toBeVisible();
        await page.evaluate(async (url) => {
          const call = (method: string, params: unknown[]) =>
            new Promise<any>((resolve) =>
              chrome.runtime.sendMessage(
                {
                  type: 'CONTROLLER_ACTION',
                  data: { methods: ['wallet', method], params },
                },
                resolve
              )
            );
          const state = await call('getState', []);
          await call('setActiveNetwork', [
            { ...state.vault.activeNetwork, url },
            true,
          ]);
        }, server.url);
      }
    );
    const parent = fixture.parentTxs[0];
    const request = sdk.buildSentryRegistrarUpdate({
      chain,
      node,
      votingKeyId: '34'.repeat(20),
      inputs: [{ txid: parent.getId(), vout: 0 }],
      outputs: [
        {
          valueSatoshis: '99000',
          scriptHex: Buffer.from(parent.outs[0].script).toString('hex'),
        },
      ],
    });
    await wallet.step(
      'review and authenticate the original compressed owner identity without a separate key import',
      async () => {
        await page.goto(server.url);
        await page.waitForFunction(() => Boolean((window as any).pali));
        const connected = await approve(
          wallet!.context,
          page,
          await startRequest(page, 'sys_requestAccounts')
        );
        expect(connected.result).toEqual([taproot]);
        expect(
          (await providerRequest(page, 'sys_getSentryCapabilities')).operations
        ).toContain('updateRegistrar');
        const id = await startRequest(page, 'sys_signSentryOperation', [
          request,
        ]);
        const popup = await popupFor(wallet!.context, page, id);
        await expect(
          popup.getByRole('option', { name: /Selected wallet account/ })
        ).toHaveCount(1);
        await popup.getByLabel('Wallet password').fill(E2E_CONFIG.password);
        await popup.screenshot({
          path: info.outputPath('taproot-owner-approval.png'),
          mask: [popup.getByLabel('Wallet password')],
        });
        await popup.getByRole('button', { name: 'Authorize update' }).click();
        const result = await settle(page, id, 45000);
        expect(result.error).toBeUndefined();
        expect(result.result.complete).toBe(true);
        expect(JSON.stringify(result.result)).not.toContain(pair.toWIF());
        expect(JSON.stringify(result.result)).not.toContain(
          Buffer.from(pair.privateKey).toString('hex')
        );
        expect(
          await sdk.verifySentryManagementOperation(
            { ...request, transactionHex: result.result.transactionHex },
            {
              chain,
              node,
              network: {
                bech32Hrp: 'tsys',
                pubKeyHash: 0x41,
                scriptHash: 0xc4,
              },
              previousTransactions: [parent.toHex()],
              maxFeeSatoshis: '100000',
            }
          )
        ).toBe(true);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
    await wallet.dispose('passed');
    wallet = undefined;
  } finally {
    await wallet?.dispose('failed');
    Object.assign(E2E_CONFIG, previous);
    await server.close();
  }
});
