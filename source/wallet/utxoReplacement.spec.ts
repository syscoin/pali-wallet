jest.unmock('syscoinjs-lib');

import { prepareLedgerPsbt } from '@sidhujag/sysweb3-keyring/cjs/ledger/prepare-psbt.js';
import { TrezorKeyring } from '@sidhujag/sysweb3-keyring/cjs/trezor/index.js';
import { assertPsbtAccountScope } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt-account-scope.js';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network/cjs/coin-utils.js';
import { getNetworkConfig } from '@sidhujag/sysweb3-network/cjs/networks.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { signTrezorReplacementPsbt } from './trezorReplacementSigner';
import { createOwnedUtxoBlockbookRead } from './utxoBlockbookReads';
import {
  availableUtxoReplacementKinds,
  prepareUtxoReplacement,
  readUtxoReplacementFee,
} from './utxoReplacement';
import { utxoSubmissionUrl, type UtxoSignedScope } from './utxoSignedBinding';

const bitcoin = syscoinUtils.bitcoinjs;
const network = bitcoin.networks.bitcoin;
const account = bitcoin.bip32
  .fromSeed(Buffer.alloc(32, 7), network)
  .derivePath("m/84'/0'/0'");
const key = account.derive(0).derive(0);
const changeKey = account.derive(1).derive(22);
const payment = (pubkey: Uint8Array) =>
  bitcoin.payments.p2wpkh({ pubkey, network });
const receiving = payment(key.publicKey);
const change = payment(changeKey.publicKey);
const external = bitcoin.payments.p2wpkh({
  hash: Buffer.alloc(20, 24),
  network,
});

function fixture(
  options: {
    changeScript?: Uint8Array;
    fee?: string;
    inputScript?: Uint8Array;
    sequence?: number;
  } = {}
) {
  const scope: UtxoSignedScope = {
    profileId: `0x${'ab'.repeat(32)}`,
    account: {
      id: 0,
      type: 'HDAccount',
      xpub: account.neutered().toBase58(),
      address: receiving.address,
    },
    network: {
      kind: 'syscoin',
      chainId: 0,
      slip44: 0,
      currency: 'BTC',
      genesisHash:
        '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
      url: 'https://blockbook.invalid/bitcoin/',
    },
  };
  const parent = new bitcoin.Transaction();
  parent.addInput(Buffer.alloc(32, 5), 3);
  parent.addOutput(options.inputScript ?? receiving.output, BigInt(110_000));
  const original = new bitcoin.Transaction();
  original.version = 2;
  original.locktime = 99;
  original.addInput(parent.getHash(), 0, options.sequence ?? 0xfffffffd);
  original.addOutput(external.output, BigInt(90_000));
  original.addOutput(options.changeScript ?? change.output, BigInt(19_000));
  original.setWitness(0, [Buffer.alloc(72), key.publicKey]);
  const unsigned = original.clone();
  unsigned.stripWitnesses();
  const predecessor = {
    owner: { ...scope.network, account: scope.account },
    operation: 'wallet' as const,
    issuedPaths: [
      {
        branch: 1 as const,
        index: 22,
        path: "m/84'/0'/0'/1/22",
        address: change.address,
        script: Buffer.from(change.output).toString('hex'),
      },
    ],
    txid: original.getId(),
    virtualSize: original.virtualSize(),
    unsignedTransaction: unsigned.toHex(),
    version: 2 as const,
    signedDigest: `0x${'11'.repeat(32)}`,
    url: utxoSubmissionUrl(scope.network.url),
    feeSatoshis: options.fee ?? '1000',
    outpoints: [`${parent.getId()}:0`],
  };
  const request = {
    scope,
    predecessor,
    kind: 'speed-up' as const,
    assertCurrent: () => undefined,
    isOwnedAddress: () => false,
    fetchPreviousTransaction: jest.fn(async () => ({ hex: parent.toHex() })),
  };
  return { request, original, parent };
}

const replacementRead = (url: string, body: unknown, status = 200) =>
  createOwnedUtxoBlockbookRead(
    { kind: 'fee', url },
    new AbortController().signal,
    () => undefined,
    async (input) => {
      const response = new Response(JSON.stringify(body), { status });
      Object.defineProperty(response, 'url', { value: input });
      return response;
    }
  );

it.each(['speed-up', 'cancel'] as const)(
  'uses the verified replacement fee floor for %s when Blockbook quotes zero',
  async (kind) => {
    const { request } = fixture();
    const { url } = request.scope.network;
    const rate = await readUtxoReplacementFee(
      url,
      replacementRead(url, { result: '0' })
    );
    expect(rate).toBeUndefined();
    const { review } = await prepareUtxoReplacement({ ...request, kind });
    expect(review.feeSatoshis).toBe(review.minimumFeeSatoshis);
    expect(BigInt(review.feeSatoshis)).toBeGreaterThan(BigInt(1000));
    expect(request.fetchPreviousTransaction).toHaveBeenCalledTimes(1);
  }
);

it('keeps positive fee quotes and rejects malformed quotes, HTTP failures and mismatched scope', async () => {
  const { url } = fixture().request.scope.network;
  await expect(
    readUtxoReplacementFee(url, replacementRead(url, { result: '0.00001024' }))
  ).resolves.toBe(1e-8);
  for (const body of [{}, { result: 0 }, { result: '0', error: 'backend' }]) {
    await expect(
      readUtxoReplacementFee(url, replacementRead(url, body))
    ).rejects.toThrow('Invalid Blockbook fee quote');
  }
  await expect(
    readUtxoReplacementFee(url, replacementRead(url, { result: '0' }, 400))
  ).rejects.toThrow('Blockbook fee request failed');
  await expect(
    readUtxoReplacementFee(
      url,
      replacementRead('https://other.invalid', { result: '0' })
    )
  ).rejects.toThrow('Invalid owned Blockbook endpoint');
});

it('preserves the exact inputs, sequence, locktime and recipient while reducing verified change', async () => {
  const { request, original } = fixture();
  const prepared = await prepareUtxoReplacement(request);
  const psbt = PsbtUtils.fromPali(prepared.psbt, request.scope.network);
  expect(psbt.txInputs).toEqual(
    original.ins.map(({ hash, index, sequence }: any) => ({
      hash,
      index,
      sequence,
    }))
  );
  expect(psbt.locktime).toBe(original.locktime);
  expect(prepared.review.outputs).toEqual([
    { address: external.address, amountSatoshis: '90000' },
    {
      address: change.address,
      amountSatoshis: (
        BigInt(20_000) - BigInt(prepared.review.feeSatoshis)
      ).toString(),
    },
  ]);
  expect(prepared.review.previousFeeSatoshis).toBe('1000');
  expect(BigInt(prepared.review.feeSatoshis)).toBeGreaterThan(BigInt(1000));
  expect(request.fetchPreviousTransaction).toHaveBeenCalledTimes(1);
  const signed = psbt.signInput(0, key).finalizeAllInputs();
  const { record } = prepared.bindSigned(PsbtUtils.toPali(signed));
  expect(record.txid).not.toBe(request.predecessor.txid);
  expect(record.review.feeSatoshis).toBe(prepared.review.feeSatoshis);
});

it('cancels to one locally derived address with the exact reviewed fee', async () => {
  const { request } = fixture();
  const prepared = await prepareUtxoReplacement({
    ...request,
    kind: 'cancel',
    feeSatoshis: '1500',
  });
  expect(prepared.review.outputs).toEqual([
    { address: change.address, amountSatoshis: '108500' },
  ]);
  await expect(
    prepareUtxoReplacement({
      ...request,
      kind: 'cancel',
      ownedAddress: external.address,
    })
  ).rejects.toThrow(/wallet-owned/);
});

it('rejects an unverified backend prevout, incorrect retained fee and unsupported funding', async () => {
  const { request } = fixture();
  const forged = fixture({ inputScript: external.output });
  await expect(
    prepareUtxoReplacement({
      ...request,
      fetchPreviousTransaction: forged.request.fetchPreviousTransaction,
    })
  ).rejects.toThrow(/previous transaction mismatch/);
  await expect(
    prepareUtxoReplacement(fixture({ fee: '1001' }).request)
  ).rejects.toThrow(/retained fee/);
  await expect(
    prepareUtxoReplacement(
      fixture({
        inputScript: bitcoin.payments.p2pkh({ pubkey: key.publicKey, network })
          .output,
      }).request
    )
  ).rejects.toThrow(/unsupported/);
});

it('rejects non-RBF, external history, unverified change, and fees outside the reviewed range', async () => {
  const { request } = fixture();
  await expect(
    prepareUtxoReplacement(fixture({ sequence: 0xfffffffe }).request)
  ).rejects.toThrow(/unsupported/);
  await expect(
    prepareUtxoReplacement({
      ...request,
      predecessor: { ...request.predecessor, operation: 'external' },
    })
  ).rejects.toThrow(/unsupported/);
  await expect(
    prepareUtxoReplacement(fixture({ changeScript: external.output }).request)
  ).rejects.toThrow(/verified change/);
  await expect(
    prepareUtxoReplacement({ ...request, feeSatoshis: '1001' })
  ).rejects.toThrow(/minimum relay fee/);
  await expect(
    prepareUtxoReplacement({ ...request, feeSatoshis: '19999' })
  ).rejects.toThrow(/non-dust/);
});

it('rejects a signed transaction that changes a reviewed input sequence', async () => {
  const { request } = fixture();
  const prepared = await prepareUtxoReplacement(request);
  const psbt = PsbtUtils.fromPali(prepared.psbt, request.scope.network);
  psbt.setInputSequence(0, 0xfffffffc);
  const changed = PsbtUtils.toPali(psbt.signInput(0, key).finalizeAllInputs());
  expect(() => prepared.bindSigned(changed)).toThrow(/differs/);
});

it('offers only cancellation when the retained send has no change output', () => {
  const { request, original } = fixture();
  expect(availableUtxoReplacementKinds(request.predecessor)).toEqual([
    'speed-up',
    'cancel',
  ]);
  original.outs.pop();
  original.stripWitnesses();
  expect(
    availableUtxoReplacementKinds({
      ...request.predecessor,
      unsignedTransaction: original.toHex(),
      txid: original.getId(),
    })
  ).toEqual(['cancel']);
  expect(
    availableUtxoReplacementKinds(
      fixture({ sequence: 0xffffffff }).request.predecessor
    )
  ).toEqual([]);
});

it.each([
  { chainId: 57, slip44: 57, currency: 'SYS' },
  { chainId: 5700, slip44: 1, currency: 'TSYS' },
])(
  'builds and verifies a native Syscoin replacement on $currency',
  async (registration) => {
    const { request, parent, original } = fixture();
    const { networks } = getNetworkConfig(
      registration.slip44,
      registration.currency
    );
    const addressNetwork =
      registration.slip44 === 1 ? networks.testnet : networks.mainnet;
    const coin = findUtxoCoinByRegistration(registration)!;
    const syscoinNetwork = {
      ...request.scope.network,
      ...registration,
      genesisHash: coin.hashGenesisBlock,
    };
    const accountNode = bitcoin.bip32
      .fromSeed(Buffer.alloc(32, 7), addressNetwork)
      .derivePath(`m/84'/${registration.slip44}'/0'`);
    const inputKey = accountNode.derive(0).derive(0);
    const inputPayment = bitcoin.payments.p2wpkh({
      pubkey: inputKey.publicKey,
      network: addressNetwork,
    });
    const changePayment = bitcoin.payments.p2wpkh({
      pubkey: accountNode.derive(1).derive(0).publicKey,
      network: addressNetwork,
    });
    parent.outs[0].script = inputPayment.output;
    original.ins[0].hash = parent.getHash();
    original.outs[1].script = changePayment.output;
    const unsigned = original.clone();
    unsigned.stripWitnesses();
    const syscoinAccount = {
      ...request.scope.account,
      address: inputPayment.address,
      xpub: accountNode.neutered().toBase58(),
    };
    const prepared = await prepareUtxoReplacement({
      ...request,
      scope: {
        ...request.scope,
        network: syscoinNetwork,
        account: syscoinAccount,
      },
      predecessor: {
        ...request.predecessor,
        owner: { ...syscoinNetwork, account: syscoinAccount },
        issuedPaths: undefined,
        txid: original.getId(),
        unsignedTransaction: unsigned.toHex(),
        outpoints: [`${parent.getId()}:0`],
      },
    });
    const psbt = PsbtUtils.fromPali(prepared.psbt, syscoinNetwork);
    const signed = psbt.signInput(0, inputKey).finalizeAllInputs();
    expect(prepared.bindSigned(PsbtUtils.toPali(signed)).record.txid).toBe(
      signed.extractTransaction().getId()
    );
  }
);

it('derives Ledger input and wallet-output paths from the authenticated account', async () => {
  const type = 'Ledger' as const;
  const { request, parent } = fixture();
  const scope = {
    ...request.scope,
    account: { ...request.scope.account, type },
  };
  const predecessor = {
    ...request.predecessor,
    owner: { ...request.predecessor.owner, account: scope.account },
  };
  expect(availableUtxoReplacementKinds(predecessor)).toEqual([
    'speed-up',
    'cancel',
  ]);
  const prepared = await prepareUtxoReplacement({
    ...request,
    scope,
    predecessor,
  });
  const psbt = PsbtUtils.fromPali(prepared.psbt, scope.network);
  const paths = ({
    unknownKeyVals,
  }: {
    unknownKeyVals?: { key: Uint8Array; value: Uint8Array }[];
  }) =>
    unknownKeyVals
      ?.filter((field) => Buffer.from(field.key).toString() === 'path')
      .map(({ value }) => Buffer.from(value).toString()) ?? [];
  expect(paths(psbt.data.inputs[0])).toEqual(["m/84'/0'/0'/0/0"]);
  expect(paths(psbt.data.outputs[0])).toEqual([]);
  expect(paths(psbt.data.outputs[1])).toEqual(["m/84'/0'/0'/1/22"]);

  expect(() =>
    assertPsbtAccountScope(psbt, {
      account: scope.account,
      accountId: scope.account.id,
      accountType: type,
      network: scope.network,
    })
  ).not.toThrow();
  expect(Buffer.from(psbt.data.inputs[0].nonWitnessUtxo).toString('hex')).toBe(
    parent.toHex()
  );
  const enriched = prepareLedgerPsbt(
    psbt,
    scope.account.xpub,
    scope.account.id,
    'BTC',
    0,
    '6e468902'
  );
  expect(enriched.data.inputs[0].bip32Derivation[0]).toMatchObject({
    path: "m/84'/0'/0'/0/0",
    masterFingerprint: Buffer.from('6e468902', 'hex'),
  });
  expect(enriched.data.outputs[1].bip32Derivation[0].path).toBe(
    "m/84'/0'/0'/1/22"
  );

  // Exercise the final binding using a synthetic signature for the exact reviewed bytes.
  const finalized = PsbtUtils.toPali(
    psbt.signInput(0, key).finalizeAllInputs()
  );
  expect(prepared.bindSigned(finalized).record.review).toMatchObject(
    prepared.review
  );
  await expect(
    prepareUtxoReplacement({
      ...request,
      scope,
      predecessor,
      kind: 'cancel',
      ownedAddress: external.address,
      isOwnedAddress: () => true,
    })
  ).rejects.toThrow(/wallet-owned/);
});

it('signs the Trezor replacement with its authenticated input amount and unchanged outputs', async () => {
  const { request, original, parent } = fixture();
  const trezorAccount = { ...request.scope.account, type: 'Trezor' as const };
  const scope = { ...request.scope, account: trezorAccount };
  const predecessor = {
    ...request.predecessor,
    owner: { ...request.predecessor.owner, account: trezorAccount },
  };
  expect(availableUtxoReplacementKinds(predecessor)).toEqual([
    'speed-up',
    'cancel',
  ]);
  const prepared = await prepareUtxoReplacement({
    ...request,
    scope,
    predecessor,
  });
  const trezor = Object.create(TrezorKeyring.prototype);
  trezor.signUtxoTransaction = jest.fn(async (converted, psbt) => {
    expect(
      converted.inputs[0].address_n.map((child: number) => child >>> 0)
    ).toEqual([0x80000054, 0x80000000, 0x80000000, 0, 0]);
    expect(converted).toMatchObject({
      version: original.version,
      locktime: original.locktime,
      inputs: [
        {
          sequence: original.ins[0].sequence,
          amount: parent.outs[0].value.toString(),
          script_type: 'SPENDWITNESS',
        },
      ],
      outputs: [{ address: external.address }, { address: change.address }],
    });
    return psbt.signInput(0, key).finalizeAllInputs();
  });
  const finalized = await signTrezorReplacementPsbt({
    psbt: prepared.psbt,
    scope,
    trezor,
    assertCurrent: request.assertCurrent,
    signal: new AbortController().signal,
  });
  expect(prepared.bindSigned(finalized).record.review).toMatchObject(
    prepared.review
  );
});
