import * as ecc from '@bitcoinerlab/secp256k1';
import { expect, test } from '@playwright/test';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

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

const bitcoin = sys.bitcoinjs;
const network = sys.syscoinNetworks.testnet;
const funding = BigInt(100000);
const recipientAmount = BigInt(50000);
const asSatoshis = (text: string) => {
  const [whole, fraction = ''] = text.replace(/\s+TSYS$/, '').split('.');
  return BigInt(whole) * BigInt(100000000) + BigInt(fraction.padEnd(8, '0'));
};

test('offline UTXO Activity pencil reviews and signs replacements with a zero Blockbook quote', async ({}, info) => {
  test.setTimeout(120_000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const extension = extensionEvidence();
  const before = { ...E2E_CONFIG };
  const fixture = createUtxoFixture(funding.toString());
  const parent = fixture.parentTxs[0];
  const server = await startUtxoFixtureServer();
  const accepted: Array<{
    fee: string;
    outputs: Array<{ address: string; value: string }>;
    txid: string;
    vsize: number;
  }> = [];
  const rawTransactions: Record<string, unknown> = {};
  let pending: unknown;
  let estimateFee = '0.00001';
  let wallet: PaliWallet | undefined;
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('utxo-activity-replacement', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url,
      {
        readState: () => ({
          estimateFee,
          unconfirmedTxs: pending ? 1 : 0,
          transactions: pending ? [pending] : [],
          rawTransactions,
        }),
        onSyntheticBroadcast(raw) {
          const tx = bitcoin.Transaction.fromHex(raw);
          const txid = tx.getId();
          const input = tx.ins[0];
          expect(tx.version).toBe(2);
          expect(tx.ins).toHaveLength(1);
          expect(Buffer.from(input.hash).reverse().toString('hex')).toBe(
            parent.getId()
          );
          expect(input.index).toBe(0);
          expect(input.sequence).toBeLessThan(0xfffffffe);
          expect(input.script.length).toBe(0);
          expect(input.witness).toHaveLength(2);
          const [encoded, pubkey] = input.witness;
          expect(bitcoin.payments.p2wpkh({ pubkey, network }).address).toBe(
            fixture.userAddress
          );
          const signature = bitcoin.script.signature.decode(encoded);
          expect(signature.hashType).toBe(bitcoin.Transaction.SIGHASH_ALL);
          const digest = tx.hashForWitnessV0(
            0,
            bitcoin.payments.p2pkh({ pubkey, network }).output!,
            funding,
            signature.hashType
          );
          expect(ecc.verify(digest, pubkey, signature.signature)).toBe(true);
          const outputs = tx.outs.map(({ value, script }) => ({
            value: value.toString(),
            address: bitcoin.address.fromOutputScript(script, network),
          }));
          const fee =
            funding -
            tx.outs.reduce((total, { value }) => total + value, BigInt(0));
          const vsize = tx.virtualSize();
          const previous = accepted.at(-1);
          expect(fee).toBeGreaterThan(BigInt(0));
          expect(fee).toBeLessThan(BigInt(2000));
          expect(accepted.some((row) => row.txid === txid)).toBe(false);
          if (previous) {
            // The fallback uses a maximum-size witness estimate. The actual
            // signed size can be one virtual byte smaller for this single input.
            const increment = fee - BigInt(previous.fee);
            expect(increment).toBeGreaterThanOrEqual(BigInt(vsize));
            expect(increment).toBeLessThanOrEqual(BigInt(vsize + 1));
            expect(fee * BigInt(previous.vsize)).toBeGreaterThan(
              BigInt(previous.fee) * BigInt(vsize)
            );
          }
          const row = {
            txid,
            hex: raw,
            confirmations: 0,
            blockHeight: 0,
            blockTime: 1700000000 + accepted.length,
            direction: 'sent',
            addressValueIn: funding.toString(),
            addressValueOut: outputs
              .filter(({ address }) => address !== fixture.recipientAddress)
              .reduce((total, { value }) => total + BigInt(value), BigInt(0))
              .toString(),
            valueIn: funding.toString(),
            value: (funding - fee).toString(),
            fees: fee.toString(),
            vin: [
              {
                txid: parent.getId(),
                vout: 0,
                value: funding.toString(),
                addresses: [fixture.userAddress],
                isAddress: true,
                sequence: input.sequence,
              },
            ],
            vout: tx.outs.map(({ script }, n) => ({
              n,
              hex: Buffer.from(script).toString('hex'),
              value: outputs[n].value,
              addresses: [outputs[n].address],
              isAddress: true,
            })),
          };
          accepted.push({ txid, fee: fee.toString(), vsize, outputs });
          pending = row;
          rawTransactions[txid] = row;
          return { result: txid };
        },
      }
    );

    const page = wallet.page;
    await wallet.step(
      'send the original replaceable transaction through the wallet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await page.locator('#send-btn').click();
        await page
          .getByPlaceholder('Receiver', { exact: true })
          .fill(fixture.recipientAddress);
        await page.getByPlaceholder('Amount', { exact: true }).fill('0.0005');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(page).toHaveURL(/#\/send\/confirm$/);
        await page
          .getByRole('button', { name: 'Confirm', exact: true })
          .click();
        await expect.poll(() => accepted.length).toBe(1);
        await expect(page).toHaveURL(/#\/home/);
        expect(accepted[0].outputs).toHaveLength(2);
        expect(accepted[0].outputs[0]).toEqual({
          address: fixture.recipientAddress,
          value: recipientAmount.toString(),
        });
      }
    );

    estimateFee = '0';
    const replacementSteps = [
      { action: en.header.speedUp, title: en.header.speedUp },
      { action: en.buttons.cancel, title: en.header.cancelTx },
    ];
    for (const [index, { action, title }] of replacementSteps.entries()) {
      await wallet.step(
        `review, decline and approve ${title} from its Activity pencil`,
        async () => {
          await page.locator('#activity-btn').click();
          const original = accepted[index];
          const row = page
            .getByText(
              `${original.txid.slice(0, 4)}...${original.txid.slice(-14)}`,
              { exact: true }
            )
            .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
          const pencil = row.getByRole('button', {
            name: en.transactions.transactionOptions,
          });
          const review = page.getByRole('dialog', { name: title, exact: true });
          const reviewReplacement = async () => {
            await pencil.click();
            const menu = page.getByRole('menu');
            await expect(
              menu.getByRole('menuitem', { name: en.transactions.seeDetails })
            ).toBeVisible();
            const feeReads = routes.reads.filter((read) =>
              read.includes('/estimatefee/')
            ).length;
            await menu
              .getByRole('menuitem', { name: action, exact: true })
              .click();
            await expect(review).toBeVisible();
            expect(
              routes.reads.filter((read) => read.includes('/estimatefee/'))
                .length
            ).toBeGreaterThan(feeReads);
            const fee = asSatoshis(
              await review.locator('dd').first().innerText()
            );
            expect(fee).toBeGreaterThan(BigInt(original.fee));
            await review.getByText(en.send.details, { exact: true }).click();
            await expect(
              review.getByText(original.txid, { exact: true })
            ).toBeVisible();
            await expect(
              review.getByText(original.outputs[1].address, { exact: true })
            ).toBeVisible();
            if (index === 0)
              await expect(
                review.getByText(fixture.recipientAddress, { exact: true })
              ).toBeVisible();
            else
              await expect(
                review.getByText(fixture.recipientAddress, { exact: true })
              ).toHaveCount(0);
            return fee;
          };
          const fee = await reviewReplacement();
          await review
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
          await expect(review).toBeHidden();
          expect(accepted).toHaveLength(index + 1);
          expect(await reviewReplacement()).toBe(fee);
          await review
            .getByRole('button', { name: en.buttons.confirm, exact: true })
            .click();
          await expect.poll(() => accepted.length).toBe(index + 2);
          await expect(review).toBeHidden();
          const replacement = accepted[index + 1];
          const replacementRow = page
            .getByText(
              `${replacement.txid.slice(0, 4)}...${replacement.txid.slice(
                -14
              )}`,
              { exact: true }
            )
            .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
          await expect(
            replacementRow.getByText(
              index === 0 ? en.header.speedUp : en.transactions.cancellation,
              { exact: true }
            )
          ).toBeVisible();
          await expect(replacementRow.getByTitle(original.txid)).toHaveText(
            `${en.transactions.replaces}: ${original.txid.slice(
              0,
              4
            )}...${original.txid.slice(-14)}`
          );
          expect(replacement.fee).toBe(fee.toString());
          expect(replacement.outputs).toEqual(
            index === 0
              ? [
                  original.outputs[0],
                  {
                    address: original.outputs[1].address,
                    value: (funding - recipientAmount - fee).toString(),
                  },
                ]
              : [
                  {
                    address: original.outputs[1].address,
                    value: (funding - fee).toString(),
                  },
                ]
          );
        }
      );
    }

    expect(routes.syntheticBroadcasts).toEqual(
      accepted.map(({ txid }) => txid)
    );
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('synthetic-testnet-replacement-evidence', {
      body: JSON.stringify(
        {
          ...extension,
          simulatedBlockbook: true,
          publicBroadcast: false,
          replacementQuote: estimateFee,
          originalFundingOutpoint: `${parent.getId()}:0`,
          actionsInOrder: ['original', 'speed-up', 'cancel'],
          accepted,
          fixtureReads: routes.reads,
          proxyDeniedConnections: server.blocked.length,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    throw error;
  } finally {
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
