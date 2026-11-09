import { createSentryCollateralCoordinator, createSentryCollateralRegistry, type SentryCollateralReservation } from '../../../source/wallet/sentryCollateral.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createKeyringHost,
  KeyringAccountType,
  SoftwareKeyring,
} from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { convertExtendedKeyVersion } from '@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths.js';
import { getNetworkConfig } from '@sidhujag/sysweb3-network/cjs/networks.js';
import { HDNodeWallet } from 'ethers/wallet';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { bufferUtils } from 'syscointx-js';
import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network/cjs/coin-utils.js';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';

import {
  UTXO_SIGNED_RECORD_KEY,
  UtxoSignedRecords,
} from '../../../source/wallet/utxoSignedRecords.ts';
import { SENTRY_NETWORKS } from '../../../source/shared/sentryNetworks.ts';
import { SYSX_ASSET_DECIMALS, SYSX_ASSET_GUID } from '../../../source/shared/syscoinAssetIds.ts';
import { ALLOCATION_SEND_VERSION, getExactAssetAllocations } from '../../../source/utils/syscoinPsbtValues.ts';
import { createNativeUtxoSend } from '../src/custody/utxoSend.ts';
import { getUtxoNetwork, getUtxoSdkNetwork, projectUtxoRegistration, utxoRegistrationData, UTXO_NETWORKS } from '../src/core/utxoNetworks.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { HdKeyExportFlow, keyExportRegistrationHash } from '../src/custody/hdKeyExport.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { createUtxoBalanceReader } from '../src/core/utxoBalanceReader.ts';
import { verifyUtxoRegistration } from '../src/core/utxoReadSession.ts';
import { findWifAddressType, UTXO_IMPORT_TYPES, type UtxoImportAddressType } from '../src/core/utxoAddresses.ts';
import { WALLET_CATALOGUE_KEY, type NativeAccountRecord } from '../src/custody/walletCatalogue.ts';
import { metadata } from './publicWatchFixtures.ts';
import { SENTRY_TX_HEX } from './sentryNodeFixtures.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';

const syntheticPassword = 'synthetic fixture password';
const fixtureAccountStateKey = 'fixture-custody-catalogue';
const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const bitcoin = syscoinUtils.bitcoinjs;

const litecoinEndpoint = 'https://offline-ltc.invalid/blockbook';
const litecoinRegistration = projectUtxoRegistration({
  id: 'utxo:custom:0123456789abcdef0123456789abcdef', chainId: 2, slip44: 2,
  backendChain: 'Provider-main_2', endpoint: litecoinEndpoint, name: 'Litecoin fixture', explorer: litecoinEndpoint,
});
const testNetworks = [
  { network: getUtxoNetwork('bitcoin'), type: 'HDAccount', spt: false, utxoAddressType: undefined, assetSpec: undefined },
  { network: litecoinRegistration, type: 'HDAccount', spt: false, utxoAddressType: undefined, assetSpec: undefined },
  { network: getUtxoNetwork('syscoin'), type: 'HDAccount', spt: true, utxoAddressType: undefined, assetSpec: undefined },
  { network: getUtxoNetwork('utxo:5700'), type: 'Imported', spt: true, utxoAddressType: 'p2wpkh', assetSpec: undefined },
  { network: getUtxoNetwork('syscoin'), type: 'Imported', spt: true, utxoAddressType: 'p2tr', assetSpec: undefined },
  { network: getUtxoNetwork('syscoin'), type: 'HDAccount', spt: true, utxoAddressType: undefined,
    assetSpec: { assetGuid: '123456', decimals: 3, symbol: 'THREE' } },
] as const;
for (const { network, type, spt, utxoAddressType, assetSpec } of testNetworks)
test(`real native SDK ${spt ? `${assetSpec?.symbol ?? 'SYSX'} on ${network.symbol}` : network.symbol} ${utxoAddressType ?? type} quote, signed bytes, SQLite admission and exact ACK use the same scoped route`, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pali-utxo-signed-'));
  const file = join(directory, 'wallet.sqlite');
  const db = nodeConnection(file);
  let storage = await SqliteWalletStorage.open(
    db.connection,
    digest,
    INSTALLATION,
    true
  );
  let ring = new SoftwareKeyring(createKeyringHost(storage.keyringStorage), {
    captureEvmSubmission: null,
  });
  try {
    const sdkNetwork = getUtxoSdkNetwork(network);
    const state = {
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount as KeyringAccountType },
      activeNetwork: sdkNetwork,
      accounts: {
        HDAccount: {} as Record<
          number,
          Awaited<ReturnType<typeof ring.initializeWalletSecurely>>
        >,
        Imported: {} as Record<number, Awaited<ReturnType<typeof ring.importAccount>>>,
        Ledger: {},
        Trezor: {},
        SmartAccount: {},
      },
    };
    ring.setVaultStateGetter(() => state);
    const hd = await ring.initializeWalletSecurely(phrase, syntheticPassword);
    state.accounts.HDAccount[0] = hd;
    const account = type === 'Imported'
      ? await ring.importAccount(bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 13), { network: network.addressNetwork }).toWIF(), 'Fixture WIF', { utxoAddressType })
      : hd;
    if (type === 'Imported') {
      state.accounts.Imported[account.id] = account;
      state.activeAccount = { id: account.id, type: KeyringAccountType.Imported };
    }
    const profileId = await ring.getPrivateRecordProfileId();
    const evmRoot = HDNodeWallet.fromPhrase(phrase);
    let active = true;
    const assertCurrent = () => {
      if (!active) throw new Error('CANCELLED');
    };
    await storage.recovery!.bindIdentity(
      await storage.getWalletFingerprint(),
      {
        address: evmRoot.address,
        publicKey: evmRoot.publicKey,
        profileId,
      },
      assertCurrent
    );
    const asset: { assetGuid: string; decimals: number; symbol: string } | undefined = spt
      ? { ...(assetSpec ?? { assetGuid: SYSX_ASSET_GUID, decimals: SYSX_ASSET_DECIMALS, symbol: 'SYSX' }) } : undefined;
    const originalAsset = asset && { ...asset };
    const assetAmount = asset ? formatBaseUnits('12345678', asset.decimals) : '';
    const assetMaximum = asset ? formatBaseUnits('200000000', asset.decimals) : '';
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32, 7), 0);
    previous.addOutput(
      bitcoin.address.toOutputScript(account.address, network.addressNetwork),
      100000n
    );
    if (asset) {
      previous.version = ALLOCATION_SEND_VERSION;
      const data = bufferUtils.serializeAssetAllocations([{
        assetGuid: asset.assetGuid,
        values: [{ n: 0, value: new syscoinUtils.BN('200000000') }],
      }]);
      previous.addOutput(bitcoin.payments.embed({ data: [data] }).output, 0n);
    }
    const collateral = previous.clone();
    collateral.outs[0].value = BigInt((network.testnet ? SENTRY_NETWORKS.testnet : SENTRY_NETWORKS.mainnet).collateralSatoshis);
    const previousId = previous.getId(), collateralId = collateral.getId();
    const freeFunding = previous.clone(); freeFunding.ins[0].hash = Buffer.alloc(32, 9);
    const freeFundingId = freeFunding.getId();
    const assetCarrier = previous.clone();
    assetCarrier.outs[0].value = 330n; // Taproot carrier cannot cover both asset outputs plus fees.
    const feeCollateral = bitcoin.Transaction.fromHex(SENTRY_TX_HEX);
    const payload = Buffer.from(bitcoin.script.decompile(feeCollateral.outs[1].script)[1]);
    // Project the public v80 codec fixture to an internal collateral registration.
    // Its zero hash identifies vout 0, and internal registration has no collateral signature.
    const internal = payload.subarray(0, payload.length - 65);
    assert.equal(internal.at(-1), 65);
    internal.fill(0, 6, 42);
    internal[internal.length - 1] = 0;
    feeCollateral.outs[0].script = previous.outs[0].script;
    feeCollateral.outs[0].value = collateral.outs[0].value;
    feeCollateral.outs[1].script = bitcoin.payments.embed({ data: [internal] }).output;
    const assetCarrierId = assetCarrier.getId(), feeCollateralId = feeCollateral.getId();
    const fragments = asset ? Array.from({ length: 20 }, (_, index) => {
      const transaction = previous.clone(); transaction.ins[0].hash = Buffer.alloc(32, 40 + index);
      transaction.outs[1].script = bitcoin.payments.embed({ data: [bufferUtils.serializeAssetAllocations([{
        assetGuid: asset.assetGuid, values: [{ n: 0, value: new syscoinUtils.BN('10000000') }],
      }])] }).output;
      return transaction;
    }) : [];
    let fragmented = false;
    let useCollateral: false | 'asset' | 'fee' = false;
    let quoteFreeFunding = false;
    const recipient = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20, 8),
      network: network.addressNetwork,
    }).address;
    let records = new UtxoSignedRecords(storage.utxoSignedRecords!, storage.utxoSignedRecords!);
    let currentPostAuthority = assertCurrent;
    const calls: string[] = [];
    let published: string | undefined;
    let ackId: string | undefined;
    let showSavedTransfer = true;
    let failAck = !!asset;
    const posted: string[] = [];
    const reply = (url: string, data: unknown) => {
      const response = Response.json(data);
      Object.defineProperty(response, 'url', { value: url });
      return response;
    };
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      assert.equal(typeof input, 'string');
      const url = String(input);
      assert(url.startsWith(network.endpoint + '/'), 'Only the original endpoint should receive a retained request');
      const path = url.slice(network.endpoint.length);
      calls.push(`${init?.method} ${path}`);
      if (path === '/api/v2/') return reply(url, metadata(network));
      if (path === '/api/v2/block-index/0') return reply(url, { blockHash: network.genesisHash });
      if (path === '/api/v2/estimatefee/1')
        return reply(url, { result: '0.00001024' });
      if (path === `/api/v2/xpub/${account.xpub}?tokens=used&details=tokens`)
        return reply(url, { tokens: [] });
      if (path === `/api/v2/utxo/${account.xpub}`) {
        const funding = fragmented ? fragments : quoteFreeFunding ? [previous, freeFunding]
          : useCollateral === 'fee' ? [assetCarrier, feeCollateral]
          : [useCollateral === 'asset' ? collateral : previous];
        return reply(url, funding.map((transaction) => ({
          txid: transaction.getId(),
          vout: 0,
          value: transaction.outs[0].value.toString(),
          address: account.address,
          confirmations: 10,
          ...(type === 'HDAccount' ? { path: `m/84'/${network.slip44}'/0'/0/0` } : {}),
          ...(asset && transaction !== feeCollateral ? { assetInfo: { assetGuid: originalAsset!.assetGuid, value: fragmented ? '10000000' : '200000000' } } : {}),
        })));
      }
      if (path === `/api/v2/tx/${previousId}`)
        return reply(url, { hex: previous.toHex() });
      if (path === `/api/v2/tx/${freeFundingId}`)
        return reply(url, { hex: freeFunding.toHex() });
      if (path === `/api/v2/tx/${collateralId}`)
        return reply(url, { hex: collateral.toHex() });
      if (path === `/api/v2/tx/${assetCarrierId}`)
        return reply(url, { hex: assetCarrier.toHex() });
      if (path === `/api/v2/tx/${feeCollateralId}`)
        return reply(url, { hex: feeCollateral.toHex() });
      const fragment = fragments.find((transaction) => path === `/api/v2/tx/${transaction.getId()}`);
      if (fragment) return reply(url, { hex: fragment.toHex() });
      if (path === '/api/v2/sendtx/' && init?.method === 'POST') {
        published = init.body as string;
        posted.push(published);
        const tx = bitcoin.Transaction.fromHex(published);
        const signedId: string = tx.getId();
        ackId = signedId;
        const retained = await records.readExact(
          { keyring: ring, assertCurrent: currentPostAuthority },
          {
            chainId: network.chainId,
            slip44: network.slip44,
            genesisHash: network.genesisHash,
            account: { id: account.id, type, xpub: account.xpub },
          },
          signedId
        );
        assert.equal(retained?.rawTransaction, published);
        if (failAck) {
          failAck = false;
          throw new Error('Offline acknowledgement interrupted');
        }
        return reply(url, { result: ackId });
      }
      if (ackId && path === `/api/v2/tx/${ackId}`)
        return reply(url, !showSavedTransfer ? {} : {
          txid: ackId,
          hex: published,
          confirmations: 1,
          blockHash: 'a'.repeat(64),
        });
      throw new Error(`Unexpected offline fixture route ${path}`);
    };
    let protectedCollateral:SentryCollateralReservation[] = [];
    const collateralScope={walletIdentity:'fixture-owner',genesisHash:network.genesisHash};
    const collateralRegistry=createSentryCollateralRegistry({
      keyFor:async()=>`fixture:${network.genesisHash}`,
      read:async()=>protectedCollateral,
      write:async(_key,next,check,expected)=>{check();assert.equal(expected,protectedCollateral);protectedCollateral=next;},
    },createSentryCollateralCoordinator());
    const protection=Object.values(SENTRY_NETWORKS).some(item=>item.chainId===network.chainId&&item.genesisHash===network.genesisHash)
      ? {scope:collateralScope,registry:collateralRegistry} : null;
    const openSend = (assertOwner: () => void, currentNetwork = network) => createNativeUtxoSend(
      currentNetwork,
      {
        profileId,
        account: {
          id: account.id,
          type,
          address: account.address,
          xpub: account.xpub,
        },
        network: {
          kind: 'syscoin',
          chainId: network.chainId,
          slip44: network.slip44,
          currency: sdkNetwork.currency,
          genesisHash: network.genesisHash,
          url: currentNetwork.endpoint,
        },
      },
      { keyring: ring, assertCurrent: assertOwner },
      ring.syscoinTransaction,
      records,
      fetcher,
      ring.getAddress,
      protection
    );
    const send = openSend(assertCurrent);
    const protectFunding=async()=>{
      const admission=await collateralRegistry.captureSentryCollateralAdmission(collateralScope);
      await collateralRegistry.reserveSentryCollateral({...collateralScope,admission,assertCurrent:currentPostAuthority,
        reservation:{txid:previousId,vout:0,proTxHash:'ab'.repeat(32)}});
    };
    const releaseFunding=()=>collateralRegistry.releaseSentryCollateral({...collateralScope,assertCurrent:currentPostAuthority,
      reservation:{txid:previousId,vout:0,proTxHash:'ab'.repeat(32)}});
    if(protection){
      const draft={amount:asset?assetAmount:'0.0005',recipient,...(asset?{asset}: {})};
      const sign=t.mock.method(ring.syscoinTransaction,'signPSBT');
      const quote=ring.syscoinTransaction.getEstimateSysTransactionFee.bind(ring.syscoinTransaction);
      await protectFunding();
      const excluded=t.mock.method(ring.syscoinTransaction,'getEstimateSysTransactionFee',(...args:Parameters<typeof quote>)=>{
        assert(args[0].excludedOutpoints?.some(point=>point.txid===previousId&&point.vout===0));return quote(...args);
      });
      await assert.rejects(send.prepare(draft));excluded.mock.restore();await releaseFunding();
      const stale=await send.prepare(draft);await protectFunding();
      await assert.rejects(send.confirm(stale),/protected Sentry Node collateral/);
      assert.equal(sign.mock.callCount(),0);assert.deepEqual(posted,[]);await releaseFunding();
      const signOriginal=ring.syscoinTransaction.signPSBT.bind(ring.syscoinTransaction);sign.mock.restore();
      const hold=t.mock.method(ring.syscoinTransaction,'signPSBT',async(...args:Parameters<typeof signOriginal>)=>{
        const signed=await signOriginal(...args);await protectFunding();return signed;
      });
      const signedBeforeLink=await send.prepare(draft);
      await assert.rejects(send.confirm(signedBeforeLink),/protected Sentry Node collateral/);
      assert.equal(hold.mock.callCount(),1);assert.deepEqual(posted,[]);assert.deepEqual(await send.list(),[]);
      hold.mock.restore();await releaseFunding();calls.length=0;
    }
    if (asset) {
      const sign = t.mock.method(ring.syscoinTransaction, 'signPSBT');
      const quote = ring.syscoinTransaction.getEstimateSysTransactionFee.bind(ring.syscoinTransaction);
      const draft = { amount: assetAmount, recipient, asset, rbf: false };
      await assert.rejects(send.prepare({ ...draft, amount: '10000000000.00000000' }), { code: 'INVALID_INPUT' });
      await assert.rejects(send.prepare({ ...draft, rbf: 'false' as unknown as boolean }), { code: 'INVALID_INPUT' });
      assert.equal(calls.length, 0);
      useCollateral = utxoAddressType === 'p2tr' ? 'fee' : 'asset';
      await assert.rejects(send.prepare(draft), {
        code: 'UTXO_POSSIBLE_SENTRY_COLLATERAL',
        transactionNotBroadcast: true,
      });
      if (useCollateral === 'fee') {
        assert.equal(feeCollateral.version, 80);
        assert.equal(findWifAddressType(account.address, network), 'p2tr');
        assert(calls.includes(`GET /api/v2/tx/${feeCollateralId}`));
      }
      useCollateral = false;
      const defaultOptions = await send.prepare({ ...draft, rbf: undefined });
      assert.deepEqual(defaultOptions.transactionOptions, { rbf: true, zdag: false });
      const zdag = await send.prepare(draft);
      assert.deepEqual(zdag.transactionOptions, { rbf: false, zdag: true });
      const maxQuote = t.mock.method(ring.syscoinTransaction, 'getEstimateSysTransactionFee', (...args: Parameters<typeof quote>) => {
        assert.equal(args[0].amount, '2.00000000');
        assert.equal(args[0].txOptions.rbf, false);
        assert.equal(args[0].nativeSweep, undefined); assert.equal(args[0].isMax, undefined);
        return quote(...args);
      });
      const maximum = await send.prepare({ ...draft, amount: assetMaximum, max: true });
      assert.equal(maximum.outputs[0]?.asset?.rawAmount, '200000000');
      assert.equal(maximum.outputs.slice(1).some((output) => output.asset), false);
      maxQuote.mock.restore();
      fragmented = true;
      const large = await send.prepare({ ...draft, amount: assetMaximum, max: true });
      assert.deepEqual(large.transactionOptions, { rbf: true, zdag: false, zdagUnavailable: true });
      assert.equal(large.outputs[0]?.asset?.rawAmount, '200000000');
      fragmented = false;
      assert.equal(sign.mock.callCount(), 0);
      assert.deepEqual(await send.list(), []);
      assert.deepEqual(posted, []);
      async function whileQuoteHeld<T>(action: (pending: ReturnType<typeof send.prepare>) => Promise<T>): Promise<T> {
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const enteredQuote = new Promise<void>((resolve) => { entered = resolve; });
        const heldQuote = t.mock.method(ring.syscoinTransaction, 'getEstimateSysTransactionFee', async (...args: Parameters<typeof quote>) => {
          entered();
          await held;
          assert.equal(args[0].token?.guid, originalAsset!.assetGuid);
          assert.equal(args[0].amount, '0.12345678');
          assert.equal(args[0].txOptions.rbf, false);
          return quote(...args);
        });
        const pending = send.prepare(draft);
        try {
          await enteredQuote;
          const result = action(pending);
          release();
          return await result;
        } finally {
          release();
          draft.asset.assetGuid = originalAsset!.assetGuid;
          draft.asset.decimals = originalAsset!.decimals;
          draft.rbf = false;
          heldQuote.mock.restore();
        }
      }
      await whileQuoteHeld((pending) => {
        const rejected = assert.rejects(pending, /CANCELLED/);
        send.cancel();
        return rejected;
      });
      assert.equal(sign.mock.callCount(), 0);
      assert.deepEqual(await send.list(), []);
      assert.deepEqual(posted, []);

      const wrongAmountQuote = t.mock.method(ring.syscoinTransaction, 'getEstimateSysTransactionFee', (...[options, read]: Parameters<typeof quote>) =>
        quote({ ...options, amount: '0.12345679' }, read));
      await assert.rejects(send.prepare(draft), /PSBT does not match the ordinary SPT review/);
      wrongAmountQuote.mock.restore();
      const extraDataQuote = t.mock.method(ring.syscoinTransaction, 'getEstimateSysTransactionFee', async (...args: Parameters<typeof quote>) => {
        const result = await quote(...args);
        const psbt = PsbtUtils.fromPali(result.psbt, sdkNetwork);
        psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from('extra')] }).output, value: 0n });
        return { ...result, psbt: PsbtUtils.toPali(psbt) };
      });
      await assert.rejects(send.prepare(draft), /Invalid ordinary SPT data output/);
      extraDataQuote.mock.restore();
      assert.equal(sign.mock.callCount(), 0);
      assert.deepEqual(posted, []);

      const callStart = calls.length;
      const review = await whileQuoteHeld((pending) => {
        asset.assetGuid = '123457';
        asset.decimals = 0;
        draft.rbf = true;
        return pending;
      });
      assert.equal(calls.slice(callStart).filter((call) => call.includes('/api/v2/xpub/')).length, type === 'HDAccount' ? 1 : 0);
      assert.deepEqual(review.assetDisplay, originalAsset);
      assert.deepEqual(review.transactionOptions, { rbf: false, zdag: true });
      assert.equal(review.outputs[0]?.address, recipient);
      assert.deepEqual(review.outputs[0]?.asset, { assetGuid: originalAsset!.assetGuid, rawAmount: '12345678' });
      assert.equal(review.outputs[0]?.amountSatoshis, '294');
      const change = review.outputs.find(({ address, asset }) => address !== recipient && asset);
      assert.equal(change?.asset?.rawAmount, '187654322');
      assert.equal(change?.address === account.address, type === 'Imported');
      assert(BigInt(review.feeSatoshis) > 0n);
      await assert.rejects(send.confirm({ ...review }), /NOT_READY/);
      assert.equal(sign.mock.callCount(), 0);
      assert.deepEqual(posted, []);
      await assert.rejects(send.confirm(review), { code: 'UTXO_SUBMISSION_UNKNOWN' });
      assert.equal(sign.mock.callCount(), 1);
      assert.equal(posted.length, 1);
      const signed = bitcoin.Transaction.fromHex(posted[0]!);
      assert.equal(signed.version, ALLOCATION_SEND_VERSION);
      assert(signed.ins.every(({ sequence }: { sequence: number }) => sequence >= 0xfffffffe));
      const allocations = getExactAssetAllocations(signed);
      assert.equal(allocations[0]?.assetGuid, originalAsset!.assetGuid);
      assert.equal(allocations[0]?.values.find(({ n }) =>
        bitcoin.address.fromOutputScript(signed.outs[n].script, network.addressNetwork) === recipient
      )?.value, '12345678');
      // This direct SDK fixture owns the account map as a host would. Persist it
      // with the vault/journal and hydrate a fresh object from the reopened DB.
      await storage.keyringStorage.set(fixtureAccountStateKey, state);
      send.cancel();
      active = false;
      await ring.destroy();
      await storage.close();
      storage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, false);
      const persistedState = await storage.keyringStorage.get(fixtureAccountStateKey) as typeof state;
      assert.notEqual(persistedState, state);
      assert.equal(persistedState.activeAccount.id, account.id);
      assert.equal(persistedState.activeAccount.type, KeyringAccountType[type]);
      ring = new SoftwareKeyring(createKeyringHost(storage.keyringStorage), { captureEvmSubmission: null });
      ring.setVaultStateGetter(() => persistedState);
      assert.equal((await ring.unlock(syntheticPassword)).canLogin, true);
      assert.equal(await ring.getPrivateRecordProfileId(), profileId);
      currentPostAuthority = () => assert.equal(ring.isUnlocked(), true);
      records = new UtxoSignedRecords(storage.utxoSignedRecords!, storage.utxoSignedRecords!);
      const freshSign = t.mock.method(ring.syscoinTransaction, 'signPSBT');
      const reopened = openSend(currentPostAuthority);
      if (network.id === 'syscoin' && type === 'HDAccount') {
        // The real lost-ACK journal and a full collateral registry overlap once:
        // 1001 source entries must remain 1000 unique exclusions, with no truncation.
        const owner = { chainId: network.chainId, slip44: network.slip44, genesisHash: network.genesisHash,
          account: { id: account.id, type, xpub: account.xpub } };
        const retained = await records.fundingExclusions({ keyring: ring, assertCurrent: currentPostAuthority }, owner);
        assert.deepEqual(retained.outpoints, [{ txid: previousId, vout: 0 }]);
        protectedCollateral = [{ txid: previousId, vout: 0, proTxHash: 'ab'.repeat(32) },
          ...Array.from({ length: 999 }, (_, index) => ({ txid: (index + 1).toString(16).padStart(64, '0'), vout: 0, pendingRegistration: true as const }))];
        assert.equal(retained.outpoints.length + protectedCollateral.length, 1001);
        const expected = new Set([...retained.outpoints, ...protectedCollateral].map(({ txid, vout }) => `${txid}:${vout}`));
        assert.equal(expected.size, 1000); assert(!expected.has(`${freeFundingId}:0`));
        const before = (await storage.recovery.readSnapshot()).records.find(({ key }) => key === UTXO_SIGNED_RECORD_KEY)!.value;
        const postsBefore = posted.length, signaturesBefore = freshSign.mock.callCount();
        const originalQuote = ring.syscoinTransaction.getEstimateSysTransactionFee.bind(ring.syscoinTransaction);
        let exclusions: Parameters<typeof originalQuote>[0]['excludedOutpoints'];
        const quote = t.mock.method(ring.syscoinTransaction, 'getEstimateSysTransactionFee', async (...args: Parameters<typeof originalQuote>) => {
          exclusions = args[0].excludedOutpoints;
          const result = await originalQuote(...args); // Exercise the SDK's real 1000-entry admission.
          const inputs: readonly { hash: Uint8Array; index: number }[] = PsbtUtils.fromPali(result.psbt, sdkNetwork).txInputs;
          assert.deepEqual(inputs.map(({ hash, index }) => ({ txid: Buffer.from(hash).reverse().toString('hex'), vout: index })), [{ txid: freeFundingId, vout: 0 }]);
          return result;
        });
        quoteFreeFunding = true;
        try {
          const additional = await reopened.prepare({ amount: assetAmount, recipient, asset });
          assert(additional.outputs.some(output => output.address === recipient));
          assert.equal(exclusions!.length, 1000);
          assert.deepEqual(new Set(exclusions!.map(({ txid, vout }) => `${txid}:${vout}`)), expected);
          assert.equal(freshSign.mock.callCount(), signaturesBefore); assert.equal(posted.length, postsBefore);
          assert.equal((await storage.recovery.readSnapshot()).records.find(({ key }) => key === UTXO_SIGNED_RECORD_KEY)!.value, before);
        } finally {
          quote.mock.restore(); quoteFreeFunding = false; protectedCollateral = []; reopened.cancel();
        }
      }
      const afterRestart = calls.length;
      assert.deepEqual(await reopened.list(), [{ txid: signed.getId(), accepted: false }]);
      await assert.rejects(reopened.confirm(review), /NOT_READY/);
      let retry = await reopened.prepareRetry(signed.getId());
      if(protection){
        await protectFunding();
        await assert.rejects(reopened.confirm(retry),/protected Sentry Node collateral/);
        assert.equal(posted.length,1);assert.equal(freshSign.mock.callCount(),0);
        await assert.rejects(reopened.prepareRetry(signed.getId()),/protected Sentry Node collateral/);
        await releaseFunding();retry=await reopened.prepareRetry(signed.getId());
      }
      assert.deepEqual(retry.outputs, review.outputs);
      assert.equal(retry.feeSatoshis, review.feeSatoshis);
      assert.deepEqual(retry.transactionOptions, { rbf: false, zdag: true });
      await reopened.confirm(retry);
      assert.equal(sign.mock.callCount(), 1);
      assert.equal(freshSign.mock.callCount(), 0);
      assert.deepEqual(calls.slice(afterRestart), ['GET /api/v2/', 'GET /api/v2/block-index/0', 'POST /api/v2/sendtx/']);
      assert.deepEqual(posted, [posted[0], posted[0]]);
      return;
    }
    await assert.rejects(send.prepare({
      amount: '1', recipient,
      asset: { assetGuid: SYSX_ASSET_GUID, decimals: SYSX_ASSET_DECIMALS, symbol: 'SYSX' },
    }), { code: 'INVALID_INPUT' });
    assert.equal(calls.length, 0);
    const unsupportedVersions = network === litecoinRegistration ? [1, 2, 16] : [2, 16];
    for (const version of unsupportedVersions) {
      const unsupported = bitcoin.address.toBech32(Buffer.alloc(32, 9), version, network.addressNetwork.bech32);
      await assert.rejects(send.prepare({ amount: '0.0004', recipient: unsupported }), { code: 'INVALID_INPUT' });
      assert.equal(calls.length, 0);
    }
    let review = await send.prepare({ amount: '0.0004', recipient });
    assert.deepEqual(review.transactionOptions, { rbf: true });
    assert.equal(review.outputs[0]?.address, recipient);
    assert.equal(review.outputs[0]?.amountSatoshis, '40000');
    const change = review.outputs[1];
    assert(change && change.address !== account.address && change.address !== recipient);
    assert.equal(bitcoin.address.fromOutputScript(bitcoin.address.toOutputScript(change.address, network.addressNetwork), network.addressNetwork), change.address);
    assert(BigInt(review.feeSatoshis) > 0n);
    assert.equal(calls.filter((entry) => entry.startsWith('POST')).length, 0);
    await assert.rejects(send.confirm({ ...review }), /NOT_READY/);
    const originalSign = ring.syscoinTransaction.signPSBT.bind(ring.syscoinTransaction);
    const dishonestSign = t.mock.method(ring.syscoinTransaction, 'signPSBT', async (...args: Parameters<typeof originalSign>) => {
      const signed = await originalSign(...args);
      const psbt = PsbtUtils.fromPali(signed, sdkNetwork);
      const witness = psbt.data.inputs[0]?.witnessUtxo;
      assert(witness);
      witness.value += 1n;
      return PsbtUtils.toPali(psbt);
    });
    await assert.rejects(send.confirm(review), {
      code: 'UTXO_QUOTE_FEE_CHANGED',
      transactionNotBroadcast: true,
    });
    assert.equal(calls.filter((entry) => entry.startsWith('POST')).length, 0);
    assert.equal((await send.list()).length, 0);
    dishonestSign.mock.restore();
    const quote = ring.syscoinTransaction.getEstimateSysTransactionFee.bind(ring.syscoinTransaction);
    const wrongOptions = t.mock.method(ring.syscoinTransaction, 'getEstimateSysTransactionFee', (...[options, read]: Parameters<typeof quote>) =>
      quote({ ...options, txOptions: { rbf: true } }, read));
    await assert.rejects(send.prepare({ amount: '0.0004', recipient, rbf: false }), /UTXO_OPTIONS_CHANGED/);
    wrongOptions.mock.restore();
    review = await send.prepare({ amount: '0.0004', recipient, rbf: false });
    assert.deepEqual(review.transactionOptions, { rbf: false });
    const { txid } = await send.confirm(review);
    assert(bitcoin.Transaction.fromHex(published!).ins.every(({ sequence }: { sequence: number }) => sequence >= 0xfffffffe));
    assert.equal(txid, ackId);
    assert.equal(calls.filter((entry) => entry.startsWith('POST')).length, 1);
    assert.equal(await send.check(txid), 'confirmed');
    if (network === litecoinRegistration) {
      const replacement = projectUtxoRegistration({
        ...utxoRegistrationData(network),
        endpoint: 'https://new-ltc.invalid/other-wallet',
      });
      state.activeNetwork = getUtxoSdkNetwork(replacement);
      const reopened = openSend(assertCurrent, replacement);
      const beforeCheck = calls.length;
      showSavedTransfer = false;
      assert.equal(await reopened.check(txid), 'unknown');
      assert.deepEqual(calls.slice(beforeCheck), ['GET /api/v2/', 'GET /api/v2/block-index/0', `GET /api/v2/tx/${txid}`]);
      const beforeReview = calls.length;
      const retry = await reopened.prepareRetry(txid);
      assert.equal(retry.retryProviderOrigin, 'https://offline-ltc.invalid');
      assert.deepEqual(retry.outputs, review.outputs);
      assert.deepEqual(retry.transactionOptions, { rbf: false });
      assert.equal(calls.length, beforeReview);
      const exactRaw = published;
      assert.equal((await reopened.confirm(retry)).txid, txid);
      assert.deepEqual(calls.slice(beforeReview), ['GET /api/v2/', 'GET /api/v2/block-index/0', 'POST /api/v2/sendtx/']);
      assert.deepEqual(posted, [exactRaw, exactRaw]);
      assert.equal(state.activeNetwork.url, replacement.endpoint);
    }
    const persisted = (await storage.recovery!.readSnapshot()).records.find(
      (entry) => entry.key === UTXO_SIGNED_RECORD_KEY
    );
    assert(persisted && !persisted.value.includes(published!));
    const beforeCancel = calls.length;
    active = false;
    await assert.rejects(
      send.prepare({ amount: '0.0004', recipient }),
      /CANCELLED/
    );
    assert.equal(calls.length, beforeCancel);
  } finally {
    await ring.destroy();
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('native custody combines shared-default WIF and BIP84 accounts with verified custom UTXO registration', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Ambient network forbidden'); });
  const directory = await mkdtemp(join(tmpdir(), 'pali-utxo-wif-'));
  const file = join(directory, 'wallet.sqlite');
  const password = 'PUBLIC WIF fixture password 1!';
  let initialized = false;
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  let network = getUtxoNetwork('bitcoin');
  let hdXpub = '';
  let backendDrift = false;
  let blockBroadcast = false;
  let beforeSigningJournal: string | undefined;
  const endpoint = litecoinEndpoint;
  const unsupportedEndpoint = 'https://offline-zec.invalid/blockbook';
  const zec = findUtxoCoinByRegistration({ chainId: 133, slip44: 133 })!;
  const btgEndpoint = 'https://offline-btg.invalid/blockbook';
  const candidateEndpoint = 'https://offline-ltc-candidate.invalid/blockbook';
  const btg = findUtxoCoinByRegistration({ chainId: 156, slip44: 156 })!;
  assert.equal(zec.segwit, false);
  assert.equal(btg.segwit, true);
  assert.equal(btg.forkId, 79);
  const registration = litecoinRegistration;
  let candidateMismatch: 'coin' | 'backend' | 'genesis' | undefined;
  let holdCandidateStatus: (() => Promise<void>) | undefined;
  let address = '';
  let lookup = '';
  let fundingAddress = '';
  let lastExtendedKey = '';
  let holdCatalogueUpdate: (() => Promise<void>) | undefined;
  let previous = new bitcoin.Transaction();
  let confirmed = false;
  let missingSavedTransfer = false;
  const calls: string[] = [];
  const routes: string[] = [];
  const posts: string[] = [];
  const reply = (url: string, data: unknown) => {
    const response = Response.json(data);
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    assert.equal(typeof input, 'string');
    const url = String(input);
    routes.push(`${init?.method} ${url}`);
    if (url.startsWith(candidateEndpoint + '/')) {
      const path = url.slice(candidateEndpoint.length);
      calls.push(`${init?.method} ${path}`);
      assert.equal(init?.method, 'GET');
      if (path === '/api/v2/') {
        await holdCandidateStatus?.();
        const status = metadata(registration);
        if (candidateMismatch === 'backend') status.backend.chain = 'wrong-backend';
        if (candidateMismatch === 'coin') Object.assign(status.blockbook, { coin: 'Bitcoin', network: 'BTC' });
        return reply(url, status);
      }
      if (path === `/api/v2/address/${address}?details=tokenBalances&tokens=nonzero`)
        return reply(url, { address, balance: '100000', unconfirmedBalance: '0', unconfirmedTxs: 0 });
      assert.equal(path, '/api/v2/block-index/0');
      return reply(url, { blockHash: candidateMismatch === 'genesis' ? 'c'.repeat(64) : registration.genesisHash });
    }
    const unsupported = url.startsWith(btgEndpoint + '/') ? [btgEndpoint, btg] as const
      : url.startsWith(unsupportedEndpoint + '/') ? [unsupportedEndpoint, zec] as const : undefined;
    if (unsupported) {
      const [base, coin] = unsupported;
      const path = url.slice(base.length);
      calls.push(`${init?.method} ${path}`);
      assert.equal(init?.method, 'GET');
      if (path === '/api/v2/') return reply(url, {
        blockbook: { coin: coin.coinLabel, network: coin.coinShortcut, decimals: coin.decimals },
        backend: { chain: 'main' },
      });
      assert.equal(path, '/api/v2/block-index/0');
      return reply(url, { blockHash: coin.hashGenesisBlock });
    }
    const path = url.slice(network.endpoint.length);
    calls.push(`${init?.method} ${path}`);
    assert(url.startsWith(network.endpoint));
    if (path === '/api/v2/') {
      const status = metadata(network);
      if (backendDrift || (blockBroadcast && (await storage.recovery.readSnapshot()).records
        .find((row) => row.key === UTXO_SIGNED_RECORD_KEY)?.value !== beforeSigningJournal))
        status.backend.chain = 'mismatched-backend';
      return reply(url, status);
    }
    if (path === `/api/v2/xpub/${hdXpub}?details=tokenBalances&tokens=nonzero`)
      return reply(url, { address: hdXpub, balance: '100000', unconfirmedBalance: '0', unconfirmedTxs: 0 });
    if (path === '/api/v2/block-index/0') return reply(url, { blockHash: network.genesisHash });
    if (path === `/api/v2/address/${address}?details=tokenBalances&tokens=nonzero`)
      return reply(url, { address, balance: '100000', unconfirmedBalance: '0', unconfirmedTxs: 0 });
    if (lookup !== address && path === `/api/v2/xpub/${lookup}?details=tokenBalances&tokens=nonzero`)
      return reply(url, { address: lookup, balance: '100000', unconfirmedBalance: '0', unconfirmedTxs: 0 });
    if (lookup !== address && path === `/api/v2/xpub/${lookup}?tokens=used&details=tokens`)
      return reply(url, { tokens: [] });
    if (path === '/api/v2/estimatefee/1') return reply(url, { result: '0.00001024' });
    if (path === `/api/v2/utxo/${lookup}`) return reply(url, [{
      txid: previous.getId(), vout: 0, value: '100000', address: fundingAddress, confirmations: 10,
      ...(lookup !== address && { path: `m/84'/${network.slip44}'/7'/0/4` }),
    }]);
    if (path === `/api/v2/tx/${previous.getId()}`) return reply(url, { hex: previous.toHex() });
    if (path === '/api/v2/sendtx/' && init?.method === 'POST') {
      assert.equal(typeof init.body, 'string');
      const raw = init.body as string, txid = bitcoin.Transaction.fromHex(raw).getId();
      const persisted = (await storage.recovery.readSnapshot()).records.find((row) => row.key === UTXO_SIGNED_RECORD_KEY);
      assert(persisted && persisted.value.includes(txid) && !persisted.value.includes(raw));
      posts.push(raw);
      return reply(url, { result: txid });
    }
    const latest = posts.at(-1);
    if (latest && path === `/api/v2/tx/${bitcoin.Transaction.fromHex(latest).getId()}`)
      return reply(url, missingSavedTransfer ? {} : { txid: bitcoin.Transaction.fromHex(latest).getId(), hex: latest,
        confirmations: confirmed ? 1 : 0, ...(confirmed && { blockHash: 'a'.repeat(64) }) });
    throw new Error(`Unexpected fixture route ${path}`);
  };
  const openStorage = async () => {
    const { connection } = nodeConnection(file, {
      after: async (kind, sql) => {
        if (kind === 'run' && sql.startsWith('UPDATE keyring_records SET value') && holdCatalogueUpdate) {
          const hold = holdCatalogueUpdate;
          holdCatalogueUpdate = undefined;
          await hold();
        }
      },
    });
    storage = await SqliteWalletStorage.open(connection, digest, INSTALLATION, !initialized);
    initialized = true;
    return storage;
  };
  const reader = createUtxoBalanceReader({ fetch: fetcher });
  const sdk = await loadNativeKeyringSdk();
  let interceptExport: ((key: string) => Promise<string>) | undefined;
  let exports = 0;
  const factory = createKeyringRuntimeFactory({ readEvmRetirement: null,
    ensureCryptoReady: async () => undefined,
    openStorage,
    loadSdk: async () => ({ ...sdk, HostKeyring: class extends sdk.HostKeyring {
      constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) {
        super(...args);
        const unwrap = this.getPrivateKeyByAccountId;
        this.getPrivateKeyByAccountId = async (...input) => {
          exports++;
          const key = await unwrap(...input);
          return interceptExport ? interceptExport(key) : key;
        };
      }
    } }),
    utxoFetch: fetcher,
    readUtxoAccount: reader.readAccount,
    readUtxoBalance: reader.readBalance,
  });
  const newOwner = () => new NativeCustodyAuthority({ async open() {
    runtime = await factory.open() as KeyringRuntime;
    return runtime;
  } });
  let owner = newOwner();
  const current = () => undefined;
  const selectNetwork = () => owner.selectNetwork(network.id, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
  const selectAccount = (id: string) => owner.manageAccounts({ kind: 'select', id }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
  const removeAccount = (id: string, credential = password) => owner.manageAccounts({ kind: 'remove', id, password: credential }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
  const preview = (privateKey: string, utxoAddressType?: UtxoImportAddressType) => owner.previewUtxoImport(
    { privateKey, ...(utxoAddressType && { utxoAddressType }) }, owner.getSnapshot().revision, owner.getCatalogue()!.revision, current
  );
  const submit = (privateKey: string, utxoAddressType: UtxoImportAddressType | undefined, expectedAddress: string) => owner.importAccount(
    { privateKey, ...(utxoAddressType && { utxoAddressType }), expectedAddress, label: `Imported ${utxoAddressType ?? 'BIP84'}` },
    password, owner.getSnapshot().revision, owner.getCatalogue()!.revision
  );
  try {
    await owner.initialize();
    await owner.importPhrase(phrase, password);
    await runtime.backup.confirm(await runtime.backup.fingerprint());
    await owner.refreshAuthenticatedMetadata();
    assert.equal(owner.getCatalogue()!.active.accountId, 'hd:60:0');

    const beforeUnsupported = owner.getCatalogue()!;
    const priorUnsupportedRequests = calls.length;
    for (const endpoint of [unsupportedEndpoint, btgEndpoint]) {
      const add = owner.addUtxoNetwork({ endpoint, name: '', explorer: '' },
        owner.getSnapshot().revision, beforeUnsupported.revision, new AbortController().signal);
      if (endpoint === btgEndpoint) await assert.rejects(add, { code: 'INVALID_INPUT' });
      else await assert.rejects(add);
      assert.equal(owner.getCatalogue(), beforeUnsupported);
    }
    assert.deepEqual(calls.slice(priorUnsupportedRequests), ['GET /api/v2/', 'GET /api/v2/block-index/0', 'GET /api/v2/', 'GET /api/v2/block-index/0']);
    assert.equal(owner.getCatalogue(), beforeUnsupported);
    const publicRegistration = await verifyUtxoRegistration({ endpoint: btgEndpoint, name: '', explorer: '' }, undefined,
      { fetch: fetcher, timeoutMs: 1000 }, new AbortController().signal, current);
    assert.equal(publicRegistration.symbol, 'BTG');
    assert.equal(owner.getCatalogue(), beforeUnsupported);
    await assert.rejects(owner.manageNetwork({ kind: 'add-utxo-network' }, owner.getSnapshot().revision,
      beforeUnsupported.revision), { code: 'CANCELLED' });
    assert.equal(owner.getCatalogue(), beforeUnsupported);
    network = registration;
    const oldCatalogue = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const lifetime = new AbortController();
    holdCatalogueUpdate = () => { entered.resolve(); return release.promise; };
    const rejected = assert.rejects(owner.addUtxoNetwork({ endpoint, name: '', explorer: '' },
      owner.getSnapshot().revision, beforeUnsupported.revision, lifetime.signal));
    await Promise.race([entered.promise, rejected.then(() => { throw new Error('Registration did not reach SQLite'); })]);
    lifetime.abort();
    release.resolve();
    await rejected;
    assert.deepEqual(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), oldCatalogue);
    await owner.unlock(password);
    const beforeAdd = calls.length;
    await owner.addUtxoNetwork({ endpoint, name: registration.name, explorer: '' },
      owner.getSnapshot().revision, owner.getCatalogue()!.revision, new AbortController().signal);
    assert.deepEqual(calls.slice(beforeAdd), ['GET /api/v2/', 'GET /api/v2/block-index/0']);
    const unused = owner.getCatalogue()!.utxoNetworks.find((candidate) => candidate.endpoint === endpoint)!;
    const removeNetwork = (id: string) => owner.removeUtxoNetwork(
      id, owner.getSnapshot().revision, owner.getCatalogue()!.revision, new AbortController().signal
    );
    const beforeRemoval = await storage.recovery.readSnapshot();
    const beforeRemovalCatalogue = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    const beforeRemovalRequests = calls.length;
    await assert.rejects(removeNetwork('bitcoin'), { code: 'INVALID_INPUT' });
    await assert.rejects(owner.removeUtxoNetwork(unused.id, owner.getSnapshot().revision,
      beforeRemovalCatalogue.revision - 1, new AbortController().signal), { code: 'CANCELLED' });
    await assert.rejects(owner.manageNetwork({ kind: 'remove-utxo-network' }, owner.getSnapshot().revision,
      owner.getCatalogue()!.revision), { code: 'CANCELLED' });
    const removalEntered = Promise.withResolvers<void>(), releaseRemoval = Promise.withResolvers<void>();
    holdCatalogueUpdate = () => { removalEntered.resolve(); return releaseRemoval.promise; };
    const interrupted = assert.rejects(removeNetwork(unused.id), { code: 'CANCELLED' });
    try {
      await Promise.race([removalEntered.promise, interrupted.then(() => { throw new Error('Removal did not reach SQLite'); })]);
      owner.lock();
    } finally {
      releaseRemoval.resolve();
    }
    await interrupted;
    assert.deepEqual((await storage.recovery.readSnapshot()).records, beforeRemoval.records);
    await owner.unlock(password);
    await removeNetwork(unused.id);
    assert.equal(calls.length, beforeRemovalRequests);
    await owner.dispose();
    owner = newOwner();
    await owner.initialize();
    await owner.unlock(password);
    const afterRemoval = await storage.recovery.readSnapshot();
    const afterRemovalCatalogue = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    assert.equal(owner.getCatalogue()!.utxoNetworks.some(({ id }) => id === unused.id), false);
    assert.deepEqual(afterRemovalCatalogue, {
      ...beforeRemovalCatalogue,
      networks: beforeRemovalCatalogue.networks.filter(({ id }) => id !== unused.id),
      revision: beforeRemovalCatalogue.revision + 1,
    });
    const withoutCatalogue = (snapshot: typeof beforeRemoval) => snapshot.records.filter(({ key }) => key !== WALLET_CATALOGUE_KEY);
    assert.deepEqual(withoutCatalogue(afterRemoval), withoutCatalogue(beforeRemoval));

    await owner.addUtxoNetwork({ endpoint, name: registration.name, explorer: '' },
      owner.getSnapshot().revision, owner.getCatalogue()!.revision, new AbortController().signal);
    const custom = owner.getCatalogue()!.utxoNetworks.find((candidate) => candidate.endpoint === endpoint)!;
    assert.equal(custom.backendChain, registration.backendChain);
    const beforeEdit = owner.getCatalogue()!;
    const contextRevision = owner.getSnapshot().revision;
    const editCandidate = (id = custom.id, signal = new AbortController().signal) =>
      owner.editUtxoNetwork(id, { endpoint: candidateEndpoint, name: custom.name },
        contextRevision, beforeEdit.revision, signal);
    for (const mismatch of ['coin', 'backend', 'genesis'] as const) {
      candidateMismatch = mismatch;
      await assert.rejects(editCandidate(), /UTXO registration does not match the selected coin/);
      assert.equal(owner.getCatalogue(), beforeEdit);
      assert.equal(owner.getSnapshot().revision, contextRevision);
    }
    candidateMismatch = undefined;
    const candidateEntered = Promise.withResolvers<void>(), releaseCandidate = Promise.withResolvers<void>();
    const editLifetime = new AbortController();
    const beforeCancelledEdit = calls.length;
    holdCandidateStatus = () => { candidateEntered.resolve(); return releaseCandidate.promise; };
    const cancelledEdit = editCandidate(custom.id, editLifetime.signal);
    const failedEdit = assert.rejects(cancelledEdit);
    try {
      await Promise.race([candidateEntered.promise, cancelledEdit]);
      editLifetime.abort();
    } finally {
      releaseCandidate.resolve();
      holdCandidateStatus = undefined;
    }
    await failedEdit;
    assert.deepEqual(calls.slice(beforeCancelledEdit), ['GET /api/v2/']);
    assert.equal(owner.getCatalogue(), beforeEdit);
    const beforeForbiddenEdit = calls.length;
    await assert.rejects(editCandidate('bitcoin'), { code: 'INVALID_INPUT' });
    const unauthorizedEdit = { kind: 'edit-utxo-network', id: custom.id, name: custom.name, endpoint: candidateEndpoint } as const;
    await assert.rejects(owner.manageNetwork(unauthorizedEdit, contextRevision, beforeEdit.revision), { code: 'INVALID_INPUT' });
    await assert.rejects(owner.manageNetwork({ kind: 'edit-utxo-network' }, contextRevision, beforeEdit.revision), { code: 'CANCELLED' });
    assert.equal(calls.length, beforeForbiddenEdit);
    assert.equal(owner.getCatalogue(), beforeEdit);
    const beforeDuplicate = owner.getCatalogue()!;
    await assert.rejects(owner.addUtxoNetwork({ endpoint, name: 'Duplicate', explorer: '' },
      owner.getSnapshot().revision, beforeDuplicate.revision, new AbortController().signal));
    assert.equal(owner.getCatalogue(), beforeDuplicate);
    for (const target of [custom, ...UTXO_NETWORKS]) {
      network = target;
      await selectNetwork();
      if (target === custom) {
        const beforeIneligibleRequests = calls.length;
        await assert.rejects(removeNetwork(custom.id), { code: 'INVALID_INPUT' });
        await owner.selectNetwork('ethereum', owner.getSnapshot().revision, owner.getCatalogue()!.revision);
        const saved = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
        const ready = owner.getSnapshot();
        await assert.rejects(removeNetwork(custom.id), { code: 'ACCOUNT_NOT_REMOVABLE' });
        assert.equal(owner.getSnapshot(), ready);
        assert.deepEqual(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), saved);
        assert.equal(calls.length, beforeIneligibleRequests);
        await selectNetwork();
        const hd = saved.groups.find((entry) => entry.key === '2')!.accounts.HDAccount[0]!;
        assert.match(hd.address, /^ltc1/);
        hdXpub = hd.xpub;
        const beforeBalance = calls.length;
        backendDrift = true;
        await assert.rejects(runtime.readUtxoBalance!(custom.id, hd.address, new AbortController().signal));
        backendDrift = false;
        assert.deepEqual(calls.slice(beforeBalance), ['GET /api/v2/']);
        assert.equal((await runtime.readUtxoBalance!(custom.id, hd.address, new AbortController().signal)).confirmedUnits, '100000');
        assert.match(calls.at(-1)!, /^GET \/api\/v2\/xpub\/zpub/);
      }
      const key = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 13), { network: network.addressNetwork });
      const wif = key.toWIF();
      const cfg = getNetworkConfig(network.slip44, getUtxoSdkNetwork(network).currency);
      const versions = cfg.types.zPubType as (NonNullable<typeof cfg.types.zPubType> & {
        testnet: { vprv: string };
      }) | undefined;
      assert(versions);
      const accountNode = bitcoin.bip32.fromSeed(Buffer.alloc(32, 9), network.addressNetwork)
        .derivePath(`m/84'/${network.slip44}'/7'`);
      const zPrivate = convertExtendedKeyVersion(accountNode.toBase58(),
        network.testnet ? versions.testnet.vprv : versions.mainnet.zprv);
      const accountAddress = (change: number, index: number) => bitcoin.payments.p2wpkh({
        pubkey: accountNode.derive(change).derive(index).publicKey,
        network: network.addressNetwork,
      }).address!;
      if (target === custom) {
        const taproot = bitcoin.payments.p2tr({ network: network.addressNetwork, internalPubkey: key.publicKey.slice(1) }).address!;
        const stored = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
        const beforeCalls = calls.length;
        await assert.rejects(preview(wif, 'p2tr'), { code: 'INVALID_INPUT' });
        await assert.rejects(submit(wif, 'p2tr', taproot), { code: 'INVALID_INPUT' });
        assert.deepEqual(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), stored);
        assert.equal(calls.length, beforeCalls);
      }
      const scripts = target === custom ? ['p2wpkh', 'p2pkh'] as const : [...UTXO_IMPORT_TYPES, undefined];
      for (const [index, script] of scripts.entries()) {
        const options = { network: network.addressNetwork };
        const secret = script ? wif : zPrivate;
        address = !script ? accountAddress(0, 0) : (script === 'p2tr'
          ? bitcoin.payments.p2tr({ ...options, internalPubkey: key.publicKey.slice(1) })
          : bitcoin.payments[script]({ ...options, pubkey: key.publicKey })).address!;
        lookup = script ? address : convertExtendedKeyVersion(accountNode.neutered().toBase58(), network.publicKeyVersion);
        fundingAddress = script ? address : accountAddress(0, 4);
        if (script) assert.equal(findWifAddressType(address, network), script);
        const before = JSON.stringify(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY));
        const callsBefore = calls.length;
        assert.equal(await preview(secret, script), address);
        assert.equal(JSON.stringify(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY)), before);
        assert.equal(calls.length, callsBefore);
        if (target === UTXO_NETWORKS[0] && index === 0) {
          const wrongChecksum = wif.slice(0, -1) + (wif.endsWith('1') ? '2' : '1');
          await assert.rejects(preview(wrongChecksum, script), { code: 'INVALID_INPUT' });
          await assert.rejects(preview('zprv' + 'A'.repeat(107), script), { code: 'INVALID_INPUT' });
          await assert.rejects(preview('0x' + '11'.repeat(32), script), { code: 'INVALID_INPUT' });
          await assert.rejects(submit(wif, 'p2pkh', address), { code: 'INVALID_INPUT' });
          await owner.unlock(password);
          assert.equal(JSON.stringify(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY)), before);

          const oldContext = owner.getSnapshot().revision, oldCatalogue = owner.getCatalogue()!.revision;
          await owner.selectNetwork('ethereum', oldContext, oldCatalogue);
          await assert.rejects(owner.importAccount(
            { privateKey: wif, utxoAddressType: script, expectedAddress: address, label: 'Revoked review' },
            password, oldContext, oldCatalogue
          ), { code: 'CANCELLED' });
          await selectNetwork();
        }
        if (!script) {
          lastExtendedKey = secret;
          const wrongClass = convertExtendedKeyVersion(accountNode.toBase58(),
            network.testnet ? versions.mainnet.zprv : versions.testnet.vprv);
          await assert.rejects(preview(wrongClass), { code: 'INVALID_INPUT' });
          await assert.rejects(preview(accountNode.toBase58()), { code: 'INVALID_INPUT' });
          await assert.rejects(preview(secret, 'p2pkh'), { code: 'INVALID_INPUT' });
          if (target === UTXO_NETWORKS[0]) {
            await assert.rejects(submit(secret, undefined, fundingAddress), { code: 'INVALID_INPUT' });
            await owner.unlock(password);
            const updated = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            holdCatalogueUpdate = () => { updated.resolve(); return release.promise; };
            const pending = submit(secret, undefined, address);
            const rejected = assert.rejects(pending, { code: 'CANCELLED' });
            try {
              await Promise.race([updated.promise, pending]);
              assert.equal(holdCatalogueUpdate, undefined);
              owner.lock();
            } finally { release.resolve(); }
            await rejected;
            assert.equal(JSON.stringify(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY)), before);
            await owner.unlock(password);
          }
        }
        await submit(secret, script, address);
        const accountId = `imported:${network.slip44}:${index}`;
        assert.equal(owner.getCatalogue()!.active.accountId, accountId);
        assert.equal(owner.getSnapshot().account?.address, address);
        const saved = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
        const group = saved.groups.find((entry) => entry.activeNetwork.slip44 === network.slip44)!;
        assert.equal(group.accounts.Imported[index]?.xpub, lookup);
        assert.equal(owner.getCatalogue()!.accounts.find(({ id }) => id === accountId)?.utxoExtended, script ? undefined : true);
        assert.equal(saved.recovery.find((entry) => entry.identity.address === address)?.identity.slip44, network.slip44);
        assert.equal(JSON.stringify(saved).includes(secret), false);
        assert.equal(JSON.stringify(owner.getCatalogue()).includes('xprv'), false);
        const keyFlow = new HdKeyExportFlow(owner, () => runtime.keyExport);
        try {
          const callsBeforeReveal = calls.length;
          const shown = await keyFlow.begin(password);
          assert.equal(shown.privateKey, secret);
          assert.equal(shown.address, address);
          assert.equal(shown.accountId, accountId);
          assert.equal(keyFlow.isCurrent(shown.id), true);
          assert.equal(calls.length, callsBeforeReveal);
          assert.deepEqual(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), saved);
          assert.equal(JSON.stringify(owner.getSnapshot()).includes(secret), false);
          keyFlow.cancel();
          assert.equal(keyFlow.isCurrent(shown.id), false);
          if (target === UTXO_NETWORKS[0] && index === 0) {
            const beforeExport = exports;
            const catalogue = owner.getCatalogue()!;
            const scope = { authorityRevision: owner.getSnapshot().revision, catalogueRevision: catalogue.revision,
              accountId, index, address, networkId: network.id,
              registrationHash: keyExportRegistrationHash(network.id, catalogue) };
            await assert.rejects(runtime.keyExport!.readSelected({ ...scope, registrationHash: `0x${'f'.repeat(64)}` }, password, current), /CANCELLED/);
            assert.equal(exports, beforeExport);
            owner.lock(); await owner.unlock(password);
            await assert.rejects(keyFlow.begin('wrong password'), /INVALID_CREDENTIAL/);
            assert.equal(exports, beforeExport);
            await owner.unlock(password);

            const anotherNetwork = UTXO_NETWORKS.find((candidate) => candidate.addressNetwork.wif !== network.addressNetwork.wif)!;
            for (const forged of [
              `${wif.slice(0, -1)}${wif.endsWith('1') ? '2' : '1'}`,
              bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 14), { network: network.addressNetwork }).toWIF(),
              bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 13), { network: anotherNetwork.addressNetwork }).toWIF(),
            ]) {
              interceptExport = async () => forged;
              await assert.rejects(keyFlow.begin(password), { message: 'KEY_EXPORT_UNAVAILABLE' });
              await owner.unlock(password);
            }
            const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
            interceptExport = async (raw) => { entered.resolve(); await release.promise; return raw; };
            const pending = keyFlow.begin(password);
            const rejection = assert.rejects(pending, { message: 'CANCELLED' });
            await entered.promise;
            owner.lock(); release.resolve();
            await rejection;
            interceptExport = undefined;
            await owner.unlock(password);
            await selectAccount(`hd:${network.slip44}:0`);
            const beforeHd = exports;
            const extended = await keyFlow.begin(password);
            assert.equal(extended.accountId, `hd:${network.slip44}:0`);
            assert(extended.privateKey.startsWith(network.testnet ? 'vprv' : 'zprv'));
            assert.equal(exports, beforeHd + 1);
            await selectAccount(accountId);
            assert.equal(keyFlow.isCurrent(extended.id), false);
            assert.equal(calls.length, callsBeforeReveal);
          }
        } finally { keyFlow.dispose(); }
        if (index === 0 || !script) {
          const beforeDuplicate = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
          const revision = owner.getSnapshot().revision;
          await assert.rejects(preview(secret, script), { code: 'DUPLICATE_ACCOUNT' });
          assert.equal(owner.getSnapshot().revision, revision);
          assert.equal(owner.getSnapshot().phase, 'ready');
          assert.equal(owner.getCatalogue()!.active.accountId, accountId);
          assert.deepEqual(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), beforeDuplicate);
          await assert.rejects(submit(secret, script, address), { code: 'DUPLICATE_ACCOUNT' });
        }
        assert.equal((await runtime.readUtxoBalance!(network.id, address, new AbortController().signal)).confirmedUnits, '100000');

        previous = new bitcoin.Transaction();
        previous.addInput(Buffer.alloc(32, network.slip44 + index + 2), 0);
        previous.addOutput(bitcoin.address.toOutputScript(fundingAddress, network.addressNetwork), 100000n);
        const recipient = bitcoin.payments.p2wpkh({ ...options, hash: Buffer.alloc(20, 19) }).address!;
        let send = await runtime.openUtxoSend!(current);
        const max = await send.prepare({ amount: '', recipient, max: true });
        assert.equal(max.outputs.length, 1);
        assert.equal(max.outputs[0]?.address, recipient);
        assert.equal(BigInt(max.outputs[0]!.amountSatoshis) + BigInt(max.feeSatoshis), 100000n);
        const review = await send.prepare({ amount: '0.0004', recipient });
        assert.deepEqual(review.outputs[0], { address: recipient, amountSatoshis: '40000' });
        assert.equal(review.outputs[1]?.address, script ? address : accountAddress(1, 0));
        assert(BigInt(review.feeSatoshis) > 0n);
        let txid: string, raw: string | undefined;
        if (target === custom) {
          beforeSigningJournal = (await storage.recovery.readSnapshot()).records
            .find((row) => row.key === UTXO_SIGNED_RECORD_KEY)?.value;
          blockBroadcast = true;
          const beforePosts = posts.length;
          await assert.rejects(send.confirm(review), { code: 'UTXO_SUBMISSION_NOT_DISPATCHED', transactionNotBroadcast: true });
          assert.equal(posts.length, beforePosts);
          const [retained] = await send.list();
          assert(retained);
          assert.equal(retained.accepted, false);
          txid = retained.txid;
          blockBroadcast = false;
          if (index === 0) {
            const savedJournal = (await storage.recovery.readSnapshot()).records
              .find((row) => row.key === UTXO_SIGNED_RECORD_KEY)?.value;
            const beforeRename = owner.getCatalogue()!;
            const beforeRequests = calls.length;
            await owner.editUtxoNetwork(custom.id, { name: 'Renamed Litecoin', endpoint: custom.endpoint + '/' },
              owner.getSnapshot().revision, beforeRename.revision, new AbortController().signal);
            const afterRename = owner.getCatalogue()!;
            assert.deepEqual(afterRename.active, beforeRename.active);
            assert.deepEqual(afterRename.accounts, beforeRename.accounts);
            const renamed = afterRename.utxoNetworks.find((entry) => entry.id === custom.id)!;
            assert.equal(renamed.name, 'Renamed Litecoin');
            assert.equal(renamed.endpoint, custom.endpoint);
            assert.equal(renamed.genesisHash, custom.genesisHash);
            assert.equal(calls.length, beforeRequests);
            assert.equal((await storage.recovery.readSnapshot()).records
              .find((row) => row.key === UTXO_SIGNED_RECORD_KEY)?.value, savedJournal);
            const ready = owner.getSnapshot();
            await assert.rejects(owner.editUtxoNetwork(custom.id, { name: renamed.name, endpoint: candidateEndpoint },
              ready.revision, afterRename.revision, new AbortController().signal),
              { code: 'UTXO_ENDPOINT_HAS_SAVED_TRANSFER' });
            assert.equal(owner.getSnapshot(), ready);
            assert.equal(owner.getCatalogue(), afterRename);
            assert.equal((await storage.recovery.readSnapshot()).records
              .find((row) => row.key === UTXO_SIGNED_RECORD_KEY)?.value, savedJournal);
            assert.deepEqual(routes.slice(beforeRequests), [
              `GET ${candidateEndpoint}/api/v2/`, `GET ${candidateEndpoint}/api/v2/block-index/0`,
            ]);
          }
        } else {
          ({ txid } = await send.confirm(review));
          raw = posts.at(-1)!;
        }

        if (target === UTXO_NETWORKS[0] && index === 0) {
          await selectAccount(`hd:${network.slip44}:0`);
          await assert.rejects(removeAccount(accountId), { code: 'PENDING_TRANSFER' });
          await owner.unlock(password);
          assert(owner.getCatalogue()!.accounts.some((entry) => entry.id === accountId));
          await selectAccount(accountId);
        }
        await owner.dispose();
        owner = newOwner();
        await owner.initialize();
        await owner.unlock(password);
        assert.equal(owner.getCatalogue()!.active.accountId, accountId);
        assert.equal(owner.getSnapshot().account?.address, address);
        send = await runtime.openUtxoSend!(current);
        assert.deepEqual((await send.list()).map((entry) => entry.txid), [txid]);
        assert.equal((await send.confirm(await send.prepareRetry(txid))).txid, txid);
        if (raw) assert.equal(posts.at(-1), raw);
        else assert.equal(bitcoin.Transaction.fromHex(posts.at(-1)!).getId(), txid);
        confirmed = true;
        assert.equal(await send.check(txid), 'confirmed');
        confirmed = false;
        if (target === custom && index === scripts.length - 1) {
          const beforeSwap = owner.getCatalogue()!;
          const catalogueBytes = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
          const journalBytes = (await storage.recovery.readSnapshot()).records
            .find((row) => row.key === UTXO_SIGNED_RECORD_KEY)?.value;
          const replaceEndpoint = (signal: AbortSignal) => owner.editUtxoNetwork(custom.id,
            { name: 'Renamed Litecoin', endpoint: candidateEndpoint }, owner.getSnapshot().revision,
            owner.getCatalogue()!.revision, signal);
          const swapStarted = Promise.withResolvers<void>(), continueSwap = Promise.withResolvers<void>();
          const swapLifetime = new AbortController();
          holdCatalogueUpdate = () => { swapStarted.resolve(); return continueSwap.promise; };
          const aborted = assert.rejects(replaceEndpoint(swapLifetime.signal));
          try {
            await Promise.race([swapStarted.promise, aborted.then(() => { throw new Error('Swap did not reach SQLite'); })]);
            swapLifetime.abort();
          } finally {
            continueSwap.resolve();
          }
          await aborted;
          assert.deepEqual(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), catalogueBytes);
          await owner.unlock(password);

          const beforeSave = routes.length;
          await replaceEndpoint(new AbortController().signal);
          assert.deepEqual(routes.slice(beforeSave), [
            `GET ${candidateEndpoint}/api/v2/`, `GET ${candidateEndpoint}/api/v2/block-index/0`,
          ]);
          await owner.dispose();
          owner = newOwner();
          await owner.initialize();
          await owner.unlock(password);
          const afterSwap = owner.getCatalogue()!;
          assert.deepEqual(afterSwap.active, beforeSwap.active);
          assert.deepEqual(afterSwap.accounts, beforeSwap.accounts);
          const replacement = afterSwap.utxoNetworks.find(({ id }) => id === custom.id)!;
          assert.equal(replacement.endpoint, candidateEndpoint);
          assert.equal(replacement.genesisHash, custom.genesisHash);
          assert.equal(replacement.backendChain, custom.backendChain);
          assert.equal(replacement.explorer, custom.explorer);
          assert.equal((await storage.recovery.readSnapshot()).records
            .find((row) => row.key === UTXO_SIGNED_RECORD_KEY)?.value, journalBytes);
          const beforeBalance = routes.length;
          assert.equal((await runtime.readUtxoBalance!(custom.id, address, new AbortController().signal)).confirmedUnits, '100000');
          assert(routes.slice(beforeBalance).every((request) => request.startsWith(`GET ${candidateEndpoint}/`)));
          assert(routes.length > beforeBalance);

          const exact = posts.at(-1);
          const reopened = await runtime.openUtxoSend!(current);
          const beforeReorg = routes.length;
          missingSavedTransfer = true;
          assert.equal(await reopened.check(txid), 'unknown');
          const retry = await reopened.prepareRetry(txid);
          assert.equal(retry.retryProviderOrigin, new URL(endpoint).origin);
          assert.equal((await reopened.confirm(retry)).txid, txid);
          missingSavedTransfer = false;
          assert.equal(posts.at(-1), exact);
          assert.deepEqual(routes.slice(beforeReorg), [
            `GET ${endpoint}/api/v2/`, `GET ${endpoint}/api/v2/block-index/0`, `GET ${endpoint}/api/v2/tx/${txid}`,
            `GET ${endpoint}/api/v2/`, `GET ${endpoint}/api/v2/block-index/0`, `POST ${endpoint}/api/v2/sendtx/`,
          ]);
        }
        const laneRequests = calls.slice(callsBefore);
        assert.equal(laneRequests.some((entry) => entry.includes('/xpub/')), !script);
        assert.equal(laneRequests.some((entry) => entry.includes(secret)), false);
      }
    }
    // Default lanes post twice, custom lanes post on retry, and the replaced
    // provider lane replays the original bytes once more after a reorg.
    assert.equal(posts.length, UTXO_NETWORKS.length * (UTXO_IMPORT_TYPES.length + 1) * 2 + 3);
    await selectAccount(`hd:${network.slip44}:0`);
    await removeAccount(`imported:${network.slip44}:0`);
    assert.equal(owner.getCatalogue()!.accounts.some((account) => account.id === `imported:${network.slip44}:0`), false);

    const beforeReset = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    const nextPassword = 'PUBLIC changed WIF fixture password 2!';
    owner.lock();
    const recovery = new NativeRecoveryCoordinator({
      owner, async retireControllers() {}, ensureCryptoReady: async () => undefined, openStorage,
    });
    try {
      const proof = await recovery.prepare(phrase, nextPassword, current);
      assert.equal(await recovery.commit(proof), 'committed-locked');
    } finally {
      await recovery.dispose();
    }
    await owner.dispose();
    owner = newOwner();
    await owner.initialize();
    await owner.unlock(nextPassword);
    const afterReset = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    assert.deepEqual(afterReset.recovery, beforeReset.recovery);
    for (const previousGroup of beforeReset.groups) {
      const group = afterReset.groups.find((entry) => entry.key === previousGroup.key)!;
      for (const account of Object.values(previousGroup.accounts.Imported)) {
        const restored = group.accounts.Imported[account.id]!;
        assert.equal(restored.address, account.address);
        assert.equal(restored.xpub, account.xpub);
        assert.notEqual(restored.xprv, account.xprv);
      }
    }
    const restoredId = `imported:${network.slip44}:${UTXO_IMPORT_TYPES.length}`;
    await selectAccount(restoredId);
    const keyFlow = new HdKeyExportFlow(owner, () => runtime.keyExport);
    try {
      const shown = await keyFlow.begin(nextPassword);
      assert.equal(shown.privateKey, lastExtendedKey);
      assert.equal(shown.accountId, restoredId);
    } finally { keyFlow.dispose(); }
    const restored = await runtime.openUtxoSend!(current);
    const [previousSend] = await restored.list();
    assert(previousSend);
    const oldRaw = posts.at(-1);
    assert.equal((await restored.confirm(await restored.prepareRetry(previousSend.txid))).txid, previousSend.txid);
    assert.equal(posts.at(-1), oldRaw);
  } finally {
    await owner.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
