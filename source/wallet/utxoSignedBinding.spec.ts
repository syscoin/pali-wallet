jest.unmock('syscoinjs-lib');

import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import {
  createUtxoTransactionBinding,
  prepareUtxoSignedBinding,
} from './utxoSignedBinding';

const bitcoin = syscoinUtils.bitcoinjs;
const network = bitcoin.networks.bitcoin;
const pair = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 12), { network });
const receiver = bitcoin.payments.p2wpkh({
  hash: Buffer.alloc(20, 13),
  network,
});
const scope = () => ({
  profileId: `0x${'ab'.repeat(32)}`,
  account: {
    id: 0,
    type: 'HDAccount' as const,
    address: receiver.address,
    xpub: 'fixture-account',
  },
  network: {
    kind: 'syscoin' as const,
    chainId: 0,
    slip44: 0,
    currency: 'BTC',
    url: 'https://blockbook.invalid/bitcoin/',
    genesisHash:
      '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  },
});
const request = { address: receiver.address, amountSatoshis: '90000' };

function fixture(witness = true, inputScript?: Uint8Array) {
  const payer = bitcoin.payments[witness ? 'p2wpkh' : 'p2pkh']({
    pubkey: pair.publicKey,
    network,
  });
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32, 1), 2);
  previous.addOutput(inputScript ?? payer.output, BigInt(110_000));
  previous.addOutput(payer.output, BigInt(110_000));
  function makePsbt({
    index = 0,
    sequence = 0xfffffffd,
    value = BigInt(110_000),
    version = 2,
    changeScript,
  }: {
    changeScript?: Uint8Array;
    index?: number;
    sequence?: number;
    value?: bigint;
    version?: number;
  } = {}) {
    const psbt = new bitcoin.Psbt({ network });
    psbt.setVersion(version);
    psbt.addInput({
      hash: previous.getId(),
      index,
      sequence,
      ...(witness
        ? { witnessUtxo: { script: inputScript ?? payer.output, value } }
        : { nonWitnessUtxo: previous.toBuffer() }),
    });
    psbt.addOutput({ address: receiver.address, value: BigInt(90_000) });
    psbt.addOutput(
      changeScript
        ? { script: changeScript, value: BigInt(19_000) }
        : { address: payer.address, value: BigInt(19_000) }
    );
    return psbt;
  }
  const fetchPreviousTransaction = jest.fn(async () => ({
    hex: previous.toHex(),
  }));
  const quote = PsbtUtils.toPali(makePsbt());
  const signingScope = scope();
  signingScope.account.address = payer.address;
  const prepare = (assertCurrent = () => undefined) =>
    prepareUtxoSignedBinding(signingScope, quote, request, {
      assertCurrent,
      fetchPreviousTransaction,
    });
  const sign = (options?: Parameters<typeof makePsbt>[0]) =>
    PsbtUtils.toPali(makePsbt(options).signInput(0, pair).finalizeAllInputs());
  return {
    fetchPreviousTransaction,
    makePsbt,
    payer,
    prepare,
    previous,
    quote,
    sign,
    signingScope,
  };
}

it.each(['input', 'change'])(
  'refuses an unqualified future witness %s in the actual native quote',
  async (position) => {
    const futureAddress = bitcoin.address.toBech32(
      Buffer.alloc(32, 9),
      2,
      network.bech32
    );
    const script = bitcoin.address.toOutputScript(futureAddress, network);
    const f = fixture(true, position === 'input' ? script : undefined);
    const quote = PsbtUtils.toPali(
      f.makePsbt(position === 'change' ? { changeScript: script } : undefined)
    );
    await expect(
      prepareUtxoSignedBinding(f.signingScope, quote, request, {
        assertCurrent: () => undefined,
        fetchPreviousTransaction: f.fetchPreviousTransaction,
      })
    ).rejects.toMatchObject({ code: 'UTXO_SOFTWARE_SPEND_UNSUPPORTED' });
    expect(f.fetchPreviousTransaction).toHaveBeenCalledTimes(1);
  }
);

it.each([true, false])(
  'shares the attested quote and final byte contract across hosts (witness %s)',
  async (witness) => {
    const f = fixture(witness);
    const quote = PsbtUtils.fromPali(f.quote, f.signingScope.network);
    const shared = createUtxoTransactionBinding(quote, '1000', () => undefined);
    const mobile = await f.prepare();
    const finalized = PsbtUtils.fromPali(f.sign(), f.signingScope.network);
    const transaction = shared.bindSigned(finalized);
    expect(shared.review).toEqual({
      feeSatoshis: mobile.review.feeSatoshis,
      unsignedHash: Buffer.from(
        bitcoin.crypto.hash256(quote.data.globalMap.unsignedTx.toBuffer())
      ).toString('hex'),
    });
    const mobileRecord = mobile.bindSigned(f.sign()).record;
    expect(transaction).toEqual({
      rawTransaction: mobileRecord.rawTransaction,
      txid: mobileRecord.txid,
      virtualSize: mobileRecord.virtualSize,
      feeSatoshis: mobileRecord.review.feeSatoshis,
      outpoints: mobileRecord.review.outpoints,
    });
    expect(Object.isFrozen(shared.review)).toBe(true);
    expect(Object.isFrozen(transaction)).toBe(true);
    expect(Object.isFrozen(transaction.outpoints)).toBe(true);
  }
);

it('rejects extracted bytes that differ from the captured unsigned PSBT', () => {
  const f = fixture();
  const quote = PsbtUtils.fromPali(f.quote, f.signingScope.network);
  const binding = createUtxoTransactionBinding(quote, '1000', () => undefined);
  const finalized = PsbtUtils.fromPali(f.sign(), f.signingScope.network);
  const changed = finalized.extractTransaction().clone();
  changed.outs[0]!.value -= BigInt(1);
  jest.spyOn(finalized, 'extractTransaction').mockReturnValue(changed);
  expect(() => binding.bindSigned(finalized)).toThrow(
    'Signed transaction differs from the reviewed inputs or fee'
  );
});

it('retains the original unsigned quote and exact fee across later mutations', () => {
  const f = fixture();
  const quote = PsbtUtils.fromPali(f.quote, f.signingScope.network);
  const binding = createUtxoTransactionBinding(quote, '1000', () => undefined);
  quote.setInputSequence(0, 0xfffffffc);
  expect(() =>
    binding.bindSigned(PsbtUtils.fromPali(f.sign(), f.signingScope.network))
  ).not.toThrow();
  expect(() =>
    binding.bindSigned(
      PsbtUtils.fromPali(
        f.sign({ value: BigInt(111_000) }),
        f.signingScope.network
      )
    )
  ).toThrow('Signed transaction differs from the reviewed inputs or fee');
});

it('requires a synchronous live owner before capture and after signing', () => {
  const f = fixture();
  const quote = PsbtUtils.fromPali(f.quote, f.signingScope.network);
  expect(() =>
    createUtxoTransactionBinding(quote, '1000', async () => undefined)
  ).toThrow('UTXO binding requires a synchronous owner');
  let current = true;
  const binding = createUtxoTransactionBinding(quote, '1000', () => {
    if (!current) throw new Error('Review expired');
  });
  const finalized = PsbtUtils.fromPali(f.sign(), f.signingScope.network);
  const extract = finalized.extractTransaction.bind(finalized);
  jest.spyOn(finalized, 'extractTransaction').mockImplementation(() => {
    current = false;
    return extract();
  });
  expect(() => binding.bindSigned(finalized)).toThrow('Review expired');
});

it.each([true, false])(
  'binds the exact SJS descriptor and signed vsize (witness %s)',
  async (witness) => {
    const f = fixture(witness);
    const binding = await f.prepare();
    const signed = binding.bindSigned(f.sign());
    const tx = bitcoin.Transaction.fromHex(signed.rawTransaction);
    const events: string[] = [];
    const fetch = jest.fn(async (url: string) => {
      events.push('POST');
      const response = new Response(JSON.stringify({ result: tx.getId() }));
      Object.defineProperty(response, 'url', { value: url });
      return response;
    });
    await expect(
      syscoinUtils.sendRawTransaction(
        f.signingScope.network.url,
        signed.rawTransaction,
        undefined,
        {
          fetch,
          signal: new AbortController().signal,
          assertCurrent: () => undefined,
          async prepare(descriptor: Parameters<typeof signed.bindPrepared>[0]) {
            expect(Object.isFrozen(descriptor)).toBe(true);
            expect(signed.bindPrepared(descriptor)).toEqual({
              ...descriptor,
              scope: f.signingScope,
              review: {
                recipient: request,
                outputs: [
                  request,
                  { address: f.payer.address, amountSatoshis: '19000' },
                ],
                outpoints: [`${f.previous.getId()}:0`],
                feeSatoshis: '1000',
              },
              virtualSize: tx.virtualSize(),
            });
            expect(f.signingScope.network.chainId).toBe(0);
            expect(Object.isFrozen(binding.review.outpoints)).toBe(true);
            expect(f.fetchPreviousTransaction.mock.calls).toEqual(
              witness ? [[f.previous.getId()]] : []
            );
            events.push('prepare');
          },
        }
      )
    ).resolves.toEqual({ result: tx.getId() });
    expect(events).toEqual(['prepare', 'POST']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://blockbook.invalid/bitcoin/api/v2/sendtx/',
      expect.objectContaining({ body: signed.rawTransaction, method: 'POST' })
    );
  }
);

it('rejects changed raw bytes, txid, or destination at the actual prepare callback', async () => {
  const f = fixture();
  const signed = (await f.prepare()).bindSigned(f.sign());
  const fetch = jest.fn();
  await expect(
    syscoinUtils.sendRawTransaction(
      f.signingScope.network.url,
      signed.rawTransaction,
      undefined,
      {
        fetch,
        signal: new AbortController().signal,
        assertCurrent: () => undefined,
        async prepare(descriptor: Parameters<typeof signed.bindPrepared>[0]) {
          expect(() =>
            signed.bindPrepared({
              ...descriptor,
              url: 'https://another.invalid/api/v2/sendtx/',
            })
          ).toThrow(/Submission differs/);
          expect(() =>
            signed.bindPrepared({ ...descriptor, txid: '22'.repeat(32) })
          ).toThrow(/Submission differs/);
          signed.bindPrepared({
            ...descriptor,
            rawTransaction: PsbtUtils.fromPali(
              f.sign({ sequence: 0xfffffffc }),
              f.signingScope.network
            )
              .extractTransaction()
              .toHex(),
          });
        },
      }
    )
  ).rejects.toMatchObject({
    code: 'UTXO_SUBMISSION_NOT_DISPATCHED',
    transactionNotBroadcast: true,
  });
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects signed output authority with changed inputs, fee, or incomplete signatures', async () => {
  const f = fixture();
  const binding = await f.prepare();
  expect(() => binding.bindSigned(f.sign({ sequence: 0xfffffffc }))).toThrow(
    /differs from the reviewed transaction/
  );
  expect(() => binding.bindSigned(f.sign({ index: 1 }))).toThrow(
    /differs from the reviewed transaction/
  );
  expect(() => binding.bindSigned(f.sign({ value: BigInt(111_000) }))).toThrow(
    /differs from the reviewed inputs or fee/
  );
  expect(() => binding.bindSigned(f.quote)).toThrow(/Not finalized/);
});

it('requires the explicit first output amount and excludes specialized transactions before prevout work', async () => {
  const f = fixture();
  await expect(
    prepareUtxoSignedBinding(
      f.signingScope,
      f.quote,
      { ...request, amountSatoshis: '19000' },
      {
        assertCurrent: () => undefined,
        fetchPreviousTransaction: f.fetchPreviousTransaction,
      }
    )
  ).rejects.toThrow(/does not match the ordinary UTXO review/);
  await expect(
    prepareUtxoSignedBinding(
      f.signingScope,
      PsbtUtils.toPali(f.makePsbt({ version: 142 })),
      request,
      {
        assertCurrent: () => undefined,
        fetchPreviousTransaction: f.fetchPreviousTransaction,
      }
    )
  ).rejects.toThrow(/does not match the ordinary UTXO review/);
  expect(f.fetchPreviousTransaction).not.toHaveBeenCalled();
});

it('rejects a dishonest previous-output value and expired review owner', async () => {
  const f = fixture();
  await expect(
    prepareUtxoSignedBinding(
      f.signingScope,
      PsbtUtils.toPali(f.makePsbt({ value: BigInt(111_000) })),
      request,
      {
        assertCurrent: () => undefined,
        fetchPreviousTransaction: f.fetchPreviousTransaction,
      }
    )
  ).rejects.toThrow(/Conflicting PSBT input/);

  let current = true;
  const guard = () => {
    if (!current) throw new Error('Review expired');
  };
  let reply!: () => void;
  const held = new Promise<void>((resolve) => {
    reply = resolve;
  });
  const pending = prepareUtxoSignedBinding(f.signingScope, f.quote, request, {
    assertCurrent: guard,
    async fetchPreviousTransaction() {
      await held;
      return { hex: f.previous.toHex() };
    },
  });
  current = false;
  reply();
  await expect(pending).rejects.toThrow('Review expired');

  current = true;
  const binding = await f.prepare(guard);
  const signed = binding.bindSigned(f.sign());
  current = false;
  const fetch = jest.fn();
  await expect(
    syscoinUtils.sendRawTransaction(
      f.signingScope.network.url,
      signed.rawTransaction,
      undefined,
      {
        fetch,
        signal: new AbortController().signal,
        assertCurrent: () => undefined,
        async prepare(descriptor: Parameters<typeof signed.bindPrepared>[0]) {
          signed.bindPrepared(descriptor);
        },
      }
    )
  ).rejects.toMatchObject({ code: 'UTXO_SUBMISSION_NOT_DISPATCHED' });
  expect(fetch).not.toHaveBeenCalled();
});

it('retains detached account, registration, and quote values before prevout work', async () => {
  const f = fixture();
  let complete!: (response: { hex: string }) => void;
  const held = new Promise<{ hex: string }>((resolve) => {
    complete = resolve;
  });
  const expected = structuredClone(f.signingScope);
  const finalized = f.sign();
  const pending = prepareUtxoSignedBinding(f.signingScope, f.quote, request, {
    assertCurrent: () => undefined,
    fetchPreviousTransaction: () => held,
  });
  f.signingScope.account.id = 1;
  f.signingScope.network.url = 'https://different.invalid';
  f.quote.psbt = '';
  complete({ hex: f.previous.toHex() });
  const signed = (await pending).bindSigned(finalized);
  const tx = bitcoin.Transaction.fromHex(signed.rawTransaction);
  const fetch = jest.fn(async (url: string) => {
    const response = new Response(JSON.stringify({ result: tx.getId() }));
    Object.defineProperty(response, 'url', { value: url });
    return response;
  });
  await expect(
    syscoinUtils.sendRawTransaction(
      expected.network.url,
      signed.rawTransaction,
      undefined,
      {
        fetch,
        signal: new AbortController().signal,
        assertCurrent: signed.assertCurrent,
        async prepare(descriptor: Parameters<typeof signed.bindPrepared>[0]) {
          expect(signed.bindPrepared(descriptor).scope).toEqual(expected);
        },
      }
    )
  ).resolves.toEqual({ result: tx.getId() });
});
