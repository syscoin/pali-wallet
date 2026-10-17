/* eslint-disable @typescript-eslint/no-var-requires */
// The pinned backend is CommonJS; its real installed runtime is intentional.
import * as ecc from '@bitcoinerlab/secp256k1';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import { pathToFileURL } from 'url';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
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

// This fixture tests real wallet/provider/backend cryptography. Chain metadata
// and mempool admission below are deliberately simulated, not public receipts.
test('BLS management links the node and preserves operator authorization through real Pali fee signing', async ({}, info) => {
  test.setTimeout(180000);
  const backendRoot = process.env.SENTRY_BACKEND_ROOT;
  if (!backendRoot || !path.isAbsolute(backendRoot))
    throw new Error('Pin the backend source checkout');
  const backendRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: backendRoot,
    encoding: 'utf8',
  }).trim();
  expect(backendRevision).toBe('4312e660cfa9a06a03a398cecf40a87c904bb095');
  const { createSentryAdapter } = require(path.join(
    backendRoot,
    'lib/sentryAdapter'
  ));
  const backendSyscoin = require(path.join(
    backendRoot,
    'node_modules/syscoinjs-lib'
  ));
  const backendSdk = await import(
    pathToFileURL(
      path.join(
        backendRoot,
        'node_modules/@sidhujag/sysweb3-sentry/dist/index.js'
      )
    ).href
  );
  const sdk = await import('@sidhujag/sysweb3-sentry');
  const bitcoin = backendSyscoin.utils.bitcoinjs;
  const network = backendSyscoin.utils.syscoinNetworks.testnet;
  const previous = { ...E2E_CONFIG };
  const fixture = createUtxoFixture();
  const proTxHash = 'ab'.repeat(32);
  const genesisHash =
    '0000066e1a6b9cfeac8295dce0cc8d9170690a74bc4878cf8a0b412554f5c222';
  const regtestGenesis =
    '000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6';
  const secret = '00'.repeat(31) + '01';
  const operator = await sdk.importSentryOperatorKey('bls-basic', secret);
  const owner = await sdk.importSentryAuthorityKey(
    'owner',
    'secp256k1',
    '00'.repeat(31) + '03'
  );
  const collateralKey = await sdk.importSentryAuthorityKey(
    'collateral',
    'secp256k1',
    '00'.repeat(31) + '02'
  );
  const addressFor = (key: { publicKey: string }) =>
    bitcoin.payments.p2pkh({
      pubkey: Buffer.from(key.publicKey, 'hex'),
      network,
    }).address;
  const registrationParent = new bitcoin.Transaction();
  registrationParent.addInput(Buffer.alloc(32, 12), 0);
  registrationParent.addOutput(
    bitcoin.payments.p2pkh({
      pubkey: Buffer.from(collateralKey.publicKey, 'hex'),
      network,
    }).output,
    BigInt(100000)
  );
  let nevmAddress = '';
  let trustedContext: unknown;
  const rpcCalls: string[] = [];
  const server = await startUtxoFixtureServer({
    readJson: (url) =>
      url.pathname === '/api/sentry/v1/context'
        ? trustedContext
        : fixtureRead(
            fixture,
            'https://blockbook-dev.syscoin.org' + url.pathname + url.search,
            'GET'
          ),
  });
  const library = new backendSyscoin.SyscoinJSLib(null, server.url, network);
  const fundingClient = {
    bitcoinjs: bitcoin,
    network,
    fetchUtxos: async () => [
      {
        txid: fixture.parentTxs[0].getId(),
        vout: 0,
        value: '100000',
        confirmations: 5,
        address: fixture.userAddress,
        path: "m/84'/1'/0'/0/0",
      },
      {
        txid: fixture.parentTxs[1].getId(),
        vout: 0,
        value: '100000',
        confirmations: 5,
        address: fixture.sponsorAddress,
        path: "m/84'/1'/1'/0/0",
      },
    ],
    createTransaction: (...args: any[]) => library.createTransaction(...args),
  };
  const adapter = createSentryAdapter({
    network: 'testnet',
    genesisHash,
    sdk: backendSdk,
    fundingClient,
    rpcCall: async (method: string, args: any[] = []) => {
      rpcCalls.push(method);
      if (method === 'getblockchaininfo') return { chain: 'test' };
      if (method === 'getblockhash') return genesisHash;
      if (method === 'protx_capabilities')
        return {
          version: 1,
          network: 'test',
          genesisHash,
          era: 'legacy-v3',
          height: 100,
          blockHash: 'cc'.repeat(32),
          preparationActive: false,
          requiredCollateralSatoshis: '100000',
        };
      if (method === 'protx_info')
        return {
          proTxHash,
          collateralHash: fixture.parentTxs[1].getId(),
          collateralIndex: 0,
          state: {
            pubKeyOperator: operator.publicKey,
            ownerAddress: addressFor(owner),
            votingAddress: fixture.userAddress,
            payoutAddress: fixture.userAddress,
            service: '1.2.3.4:18369',
            nevmAddress,
            confirmedHash: 'ef'.repeat(32),
            PoSeBanHeight: -1,
          },
        };
      if (method === 'protx_list')
        return [
          {
            proTxHash,
            collateralHash: fixture.parentTxs[1].getId(),
            collateralIndex: 0,
            state: { nevmAddress },
          },
        ];
      if (method === 'getrawtransaction') {
        if (args[0] === proTxHash && args[1] === true)
          return { confirmations: 5 };
        const tx = [...fixture.parentTxs, registrationParent].find(
          (candidate) => candidate.getId() === args[0]
        );
        if (tx)
          return args[1] === true
            ? { hex: tx.toHex(), confirmations: 5 }
            : tx.toHex();
      }
      if (method === 'gettxout' && args[0] === registrationParent.getId())
        return { confirmations: 5 };
      if (method === 'testmempoolaccept') return [{ allowed: true }]; // Explicit admission fixture, not Core evidence.
      throw new Error(`Unexpected fixture RPC ${method}`);
    },
  });
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'BlsManagementSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  const observations: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('sentry-management-fees', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const page = wallet.page;
    const routes = await wallet.step(
      'prepare isolated wallet and trusted synthetic node',
      async () => {
        const routes = await installUtxoFixtureRoutes(
          wallet!.context,
          fixture,
          server.url
        );
        await wallet!.context.route(`${server.url}/api/v2/**`, (route) =>
          route.continue()
        );
        await wallet!.context.route(
          `${server.url}/api/sentry/v1/context?**`,
          (route) =>
            route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify(trustedContext),
            })
        );
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await wallet!.gotoRoute('#/settings/sentry');
        await page.getByRole('button', { name: 'Import Sentry key' }).click();
        await page
          .getByLabel('Key label')
          .fill('Synthetic management operator');
        await page.getByLabel('Sentry private key (hex)').fill(secret);
        await page.getByRole('checkbox').check();
        await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        await expect(
          page.getByText('Operator key imported securely.')
        ).toBeVisible();
        for (const [role, key] of [
          ['owner', owner],
          ['collateral', collateralKey],
        ] as const) {
          await page.getByRole('button', { name: 'Import Sentry key' }).click();
          await page.getByLabel('Key role').selectOption(role);
          await page.getByLabel('Key label').fill(`Synthetic ${role}`);
          await page
            .getByLabel('Sentry private key (hex or WIF)')
            .fill(key.secretKey);
          await page.getByRole('checkbox').check();
          await page.getByLabel('Wallet password').fill(E2E_CONFIG.password);
          await page
            .getByRole('button', { name: 'Import', exact: true })
            .click();
          await expect(
            page.getByRole('heading', {
              name: `Synthetic ${role}`,
              exact: true,
            })
          ).toBeVisible();
        }
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
            new Promise<any>((resolve, reject) =>
              chrome.runtime.sendMessage(
                {
                  type: 'CONTROLLER_ACTION',
                  data: { methods: ['wallet', method], params },
                },
                (result) =>
                  result?.error
                    ? reject(new Error(String(result.error)))
                    : resolve(result)
              )
            );
          const state = await call('getState', []);
          await call('setActiveNetwork', [
            { ...state.vault.activeNetwork, url },
            true,
          ]);
        }, server.url);
        trustedContext = await adapter.context('testnet', proTxHash);
        await page.goto(server.url);
        await page.waitForFunction(() => Boolean((window as any).pali));
        const connection = await approve(
          wallet!.context,
          page,
          await startRequest(page, 'sys_requestAccounts')
        );
        expect(connection.result).toEqual([fixture.userAddress]);
        const capabilities = await adapter.capabilities();
        expect(capabilities.chain.era).toBe('legacy-v3');
        expect(capabilities.preparationActive).toBe(false);
        expect(capabilities.operations).not.toContain('registerOperator');
        return routes;
      }
    );
    await wallet.step(
      'link the public node and reject the actual regtest genesis',
      async (capture) => {
        const linkId = await startRequest(page, 'sys_linkSentryNode', [
          { version: 1, proTxHash, genesisHash },
        ]);
        const linkPopup = await popupFor(wallet!.context, page, linkId);
        await capture(linkPopup);
        await linkPopup
          .getByRole('button', { name: 'Link node', exact: true })
          .click();
        const linked = await settle(page, linkId);
        expect(linked.result).toMatchObject({
          linked: true,
          proTxHash,
          genesisHash,
        });
        const rejected = await settle(
          page,
          await startRequest(page, 'sys_linkSentryNode', [
            { version: 1, proTxHash, genesisHash: regtestGenesis },
          ])
        );
        expect(rejected.error).toBeTruthy();
        expect(rejected.result).toBeUndefined();
      }
    );
    await wallet.step(
      'unknown transaction errors and cancellation remain reachable in a short window',
      async (capture) => {
        const unknown = bitcoin.Psbt.fromBase64(fixture.single.psbt, {
          network,
        });
        unknown.setVersion(999);
        const id = await startRequest(page, 'sys_sign', [
          backendSyscoin.utils.exportPsbtToJson(unknown),
        ]);
        const popup = await popupFor(wallet!.context, page, id);
        await popup.setViewportSize({ width: 320, height: 360 });
        const error = popup.getByText(
          'Unsupported Syscoin transaction type: unknown',
          { exact: true }
        );
        await expect(error).toBeVisible();
        await error.scrollIntoViewIfNeeded();
        expect(
          await error.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2
            );
            return (
              rect.top >= 0 &&
              rect.bottom <= innerHeight &&
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              !!hit &&
              (hit === element || element.contains(hit))
            );
          })
        ).toBe(true);
        await expect(
          popup.getByRole('button', { name: 'Sign', exact: true })
        ).toBeDisabled();
        await capture(popup);
        await popup
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        expect((await settle(page, id)).error).toBeTruthy();
      }
    );
    for (const [label, target] of [
      ['add', '0x' + '12'.repeat(20)],
      ['update', '0x' + '34'.repeat(20)],
      ['remove', ''],
      ['registrar', ''],
      ['revoke', ''],
      ['register', ''],
    ]) {
      await wallet.step(
        `${label}: backend preparation and real Pali authority plus fee signatures`,
        async (capture) => {
          const service = ['add', 'update', 'remove'].includes(label);
          const operation = service
            ? 'updateService'
            : label === 'registrar'
            ? 'updateRegistrar'
            : label;
          const collateralOutpoint = {
            txid: registrationParent.getId(),
            vout: 0,
          };
          trustedContext =
            operation === 'register'
              ? await adapter.context('testnet', undefined, collateralOutpoint)
              : await adapter.context('testnet', proTxHash);
          const prepared = await adapter.prepare({
            operation,
            network: 'testnet',
            ...(operation === 'register'
              ? { collateralOutpoint }
              : { proTxHash }),
            changes: service
              ? { nevmAddress: target }
              : operation === 'revoke'
              ? { reason: 0 }
              : operation === 'updateRegistrar'
              ? { payoutAddress: fixture.recipientAddress }
              : {
                  service: '1.2.3.4:18369',
                  ownerAddress: addressFor(owner),
                  votingAddress: addressFor(owner),
                  operatorPublicKey: operator.publicKey,
                  operatorRewardBasisPoints: 0,
                  payoutAddress: fixture.userAddress,
                },
            xpub: fixture.userXpub,
            changeAddress: fixture.userAddress,
            feeRate: 10,
          });
          if (service)
            expect(prepared.review.changes.nevmAddress).toEqual({
              previous: nevmAddress,
              next: target,
            });
          const raw = sdk.decodeSentryTransaction(
            prepared.request.transactionHex
          );
          expect(raw.inputs).toHaveLength(1);
          expect(raw.inputs[0].txid).toBe(fixture.parentTxs[0].getId());
          expect(
            raw.inputs.some(
              (input) => input.txid === fixture.parentTxs[1].getId()
            )
          ).toBe(false);
          const unauthorizedPsbt = bitcoin.Psbt.fromBase64(
            prepared.fundingPsbt,
            { network }
          );
          unauthorizedPsbt.setVersion(raw.version);
          const noAuthorization = await settle(
            page,
            await startRequest(page, 'sys_sign', [
              backendSyscoin.utils.exportPsbtToJson(unauthorizedPsbt),
            ])
          );
          expect(noAuthorization.error.message).toContain(
            'SENTRY_FEE_AUTHORIZATION_REQUIRED'
          );
          const rejected = await settle(
            page,
            await startRequest(page, 'sys_signSentryOperation', [
              {
                ...prepared.request,
                chain: {
                  ...prepared.request.chain,
                  genesisHash: regtestGenesis,
                },
              },
            ])
          );
          expect(rejected.error).toBeTruthy();
          const id = await startRequest(page, 'sys_signSentryOperation', [
            prepared.request,
          ]);
          const popup = await popupFor(wallet!.context, page, id);
          if (service)
            await expect(
              popup
                .getByText(target || 'Remove registration', { exact: true })
                .first()
            ).toBeVisible();
          await popup.getByLabel('Wallet password').fill(E2E_CONFIG.password);
          await capture(popup);
          await popup.getByRole('button', { name: 'Authorize update' }).click();
          const signed = await settle(page, id, 45000);
          expect(signed.error).toBeUndefined();
          const context = {
            ...(trustedContext as any),
            previousTransactions: [fixture.parentTxs[0].toHex()],
            maxFeeSatoshis: '1000000',
          };
          expect(
            await (service
              ? sdk.verifySentryOperation
              : sdk.verifySentryManagementOperation)(
              {
                ...prepared.request,
                transactionHex: signed.result.transactionHex,
              },
              context
            )
          ).toBe(true);
          expect(JSON.stringify(signed.result)).not.toContain(
            'sentryFeeAuthorization'
          );
          const row = { network: 'testnet', protx_hash: proTxHash, prepared };
          const authorized = await adapter.authorize(row, signed.result);
          const cancelId = await startRequest(page, 'sys_sign', [
            authorized.psbt,
          ]);
          const cancelPopup = await popupFor(wallet!.context, page, cancelId);
          await cancelPopup.setViewportSize({ width: 320, height: 360 });
          const feeReview = cancelPopup.getByTestId('sentry-fee-review');
          await expect(feeReview).toContainText(
            'Authorizes the network-fee inputs'
          );
          // Decoding settles asynchronously and can replace this first review node.
          await expect(async () => {
            await feeReview.locator('p').last().scrollIntoViewIfNeeded();
          }).toPass({ timeout: 5000 });
          const cancelButton = cancelPopup.getByRole('button', {
            name: 'Cancel',
            exact: true,
          });
          await capture(cancelPopup);
          expect(
            await cancelButton.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return (
                rect.top >= 0 &&
                rect.bottom <= innerHeight &&
                rect.left >= 0 &&
                rect.right <= innerWidth &&
                element.contains(
                  document.elementFromPoint(
                    rect.x + rect.width / 2,
                    rect.y + rect.height / 2
                  )
                )
              );
            })
          ).toBe(true);
          await cancelPopup
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
          const cancelled = await settle(page, cancelId);
          expect(cancelled.error).toBeTruthy();
          const fee = await approve(
            wallet!.context,
            page,
            await startRequest(page, 'sys_sign', [authorized.psbt]),
            capture
          );
          expect(fee.error).toBeUndefined();
          for (const privateField of [
            'sentryFeeAuthorization',
            'approvedContext',
            'scopeIdentity',
          ])
            expect(JSON.stringify(fee.result)).not.toContain(privateField);
          const feePsbt =
            typeof fee.result === 'string' ? fee.result : fee.result.psbt;
          const psbt = bitcoin.Psbt.fromBase64(feePsbt, { network });
          const tx = psbt.extractTransaction();
          const validated = await adapter.validateSigned(row, feePsbt);
          expect(validated.transactionHex).toBe(tx.toHex());
          expect(
            await (service
              ? sdk.verifySentryOperation
              : sdk.verifySentryManagementOperation)(
              { ...prepared.request, transactionHex: tx.toHex() },
              context
            )
          ).toBe(true);
          const witness = tx.ins[0].witness;
          expect(witness).toHaveLength(2);
          const decoded = bitcoin.script.signature.decode(witness[0]);
          expect(decoded.hashType).toBe(bitcoin.Transaction.SIGHASH_ALL);
          const signingScript = bitcoin.payments.p2pkh({
            pubkey: witness[1],
            network,
          }).output;
          expect(
            ecc.verify(
              tx.hashForWitnessV0(
                0,
                signingScript,
                BigInt(100000),
                decoded.hashType
              ),
              witness[1],
              decoded.signature
            )
          ).toBe(true);
          expect(
            bitcoin.payments.p2wpkh({ pubkey: witness[1], network }).address
          ).toBe(fixture.userAddress);
          const operatorTx = bitcoin.Transaction.fromHex(
            signed.result.transactionHex
          );
          expect(
            tx.outs.map((output: any) => ({
              value: String(output.value),
              script: Buffer.from(output.script).toString('hex'),
            }))
          ).toEqual(
            operatorTx.outs.map((output: any) => ({
              value: String(output.value),
              script: Buffer.from(output.script).toString('hex'),
            }))
          );
          const changedTransaction = bitcoin.Transaction.fromHex(
            signed.result.transactionHex
          );
          changedTransaction.locktime += 1;
          const changed = target
            ? signed.result.transactionHex.replace(
                target.slice(2),
                '56'.repeat(20)
              )
            : changedTransaction.toHex();
          expect(changed).not.toBe(signed.result.transactionHex);
          await expect(
            adapter.authorize(row, {
              ...signed.result,
              transactionHex: changed,
            })
          ).rejects.toBeTruthy();
          observations.push({
            operation: label,
            previous: nevmAddress,
            next: target,
            txid: tx.getId(),
            feeSatoshis: prepared.review.feeSatoshis,
            operatorSignatureValid: true,
            feeSignatureValid: true,
            broadcast: false,
          });
          // Only advance the metadata fixture. No chain or mempool is changed.
          if (service) nevmAddress = target;
        }
      );
    }
    await wallet.step(
      'verify no public or fixture broadcast and record exact artifact scope',
      async () => {
        expect(rpcCalls).not.toContain('sendrawtransaction');
        expect(routes.deniedWrites).toEqual([]);
        expect(routes.syntheticBroadcasts).toEqual([]);
        await info.attach('bls-management-layered-evidence.json', {
          body: JSON.stringify(
            {
              ...extensionEvidence(),
              backendRoot,
              backendRevision,
              backendSyscoinVersion: require(path.join(
                backendRoot,
                'node_modules/syscoinjs-lib/package.json'
              )).version,
              backendSdkVersion: require(path.join(
                backendRoot,
                'node_modules/@sidhujag/sysweb3-sentry/package.json'
              )).version,
              chainFixture:
                'Tanenbaum metadata and mempool admission are synthetic; real Core lifecycle recorded separately',
              observations,
              rpcCalls,
            },
            null,
            2
          ),
          contentType: 'application/json',
        });
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
