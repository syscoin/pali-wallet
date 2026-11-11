jest.unmock('syscoinjs-lib');

import { SyscoinTransactionsCore } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core.js';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { bufferUtils } from 'syscointx-js';

import { capturePsbtEnvelope } from '../shared/psbtEnvelope';

import {
  capturePsbtAssetMetadata,
  preparePsbtApproval,
  psbtAssetMetadataUrl,
  type PsbtApprovalHost,
} from './psbtApprovals';
import { createOwnedUtxoBlockbookRead } from './utxoBlockbookReads';
import type { UtxoSignedRecords } from './utxoSignedRecords';

const bitcoin = syscoinUtils.bitcoinjs;
const outputNetwork = bitcoin.networks.bitcoin;
const key = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 12), {
  network: outputNetwork,
});
const payer = bitcoin.payments.p2wpkh({
  pubkey: key.publicKey,
  network: outputNetwork,
});
const recipient = bitcoin.payments.p2wpkh({
  hash: Buffer.alloc(20, 13),
  network: outputNetwork,
});
const network = Object.freeze({
  kind: 'syscoin',
  chainId: 0,
  slip44: 0,
  currency: 'btc',
  url: 'https://blockbook.invalid',
  utxoBackendChain: 'main',
});

function fixture(partial = false, asset = false) {
  const allocations = asset
    ? bitcoin.payments.embed({
        data: [
          bufferUtils.serializeAssetAllocations([
            {
              assetGuid: '123456',
              values: [{ n: 0, value: new syscoinUtils.BN('25') }],
            },
          ]),
        ],
      }).output
    : undefined;
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32, 1), 0);
  previous.addOutput(payer.output, BigInt(100_000));
  if (asset) {
    previous.version = 142;
    previous.addOutput(allocations!, BigInt(0));
  }
  const psbt = new bitcoin.Psbt({ network: outputNetwork });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    sequence: 0xfffffffd,
    witnessUtxo: { script: payer.output, value: BigInt(100_000) },
  });
  psbt.addOutput({ address: recipient.address, value: BigInt(99_000) });
  if (asset) {
    psbt.setVersion(142);
    psbt.addUnknownKeyValToInput(0, {
      key: Buffer.from('assetInfo'),
      value: Buffer.from(JSON.stringify({ assetGuid: '123456', value: '25' })),
    });
    psbt.addOutput({ script: allocations!, value: BigInt(0) });
  }
  const envelope = PsbtUtils.toPali(psbt);
  let current = true,
    protectedInput = false;
  const events: string[] = [];
  const check = jest.fn(() => {
    if (!current) throw new Error('Original approval retired');
  });
  const state = {
    activeNetwork: network,
    activeAccountId: 0,
    activeAccountType: 'Imported',
    accounts: {
      Imported: { 0: { id: 0, address: payer.address, xpub: payer.address } },
    },
  };
  // The real selected-account SDK dispatch, with an offline test custody signer.
  const sign = jest.fn(async (value) => {
    events.push('sign');
    value.signInput(0, key);
    if (!partial) value.finalizeAllInputs();
    return value;
  });
  const Syscoin = jest.requireActual('syscoinjs-lib').SyscoinJSLib;
  const sdk = new SyscoinTransactionsCore(
    () =>
      ({ hd: { sign } } as unknown as ReturnType<
        ConstructorParameters<typeof SyscoinTransactionsCore>[0]
      >),
    () => ({ main: new Syscoin(undefined, network.url, outputNetwork) }),
    () => state as never,
    {},
    () => check,
    'session',
    check
  );
  const readFetch = jest.fn(async (url: string) => {
    if (url !== `${network.url}/api/v2/tx/${previous.getId()}`)
      throw new Error('Unexpected read');
    const reply = Response.json({ hex: previous.toHex() });
    Object.defineProperty(reply, 'url', { value: url });
    return reply;
  });
  const records = {
    admit: jest.fn(async (_session, _record, _intent, submit) => {
      events.push('journal');
      return submit(
        async () => undefined,
        () => undefined
      );
    }),
    acknowledge: jest.fn(async () => {
      events.push('ack');
    }),
  };
  const post = jest.fn(async (url: string, init: RequestInit) => {
    events.push('POST');
    const transaction = bitcoin.Transaction.fromHex(init.body as string);
    const reply = Response.json({ result: transaction.getId() });
    Object.defineProperty(reply, 'url', { value: url });
    return reply;
  });
  const disclose = jest.fn(() => {
    events.push('disclose');
  });
  const host: PsbtApprovalHost = {
    network,
    sdk,
    assertCurrent: check,
    assertSoftwareSpend: jest.fn(check),
    withRead: async (guard, signal, operation) => {
      guard();
      const read = createOwnedUtxoBlockbookRead(
        {
          kind: 'wallet',
          address: payer.address,
          xpub: payer.address,
          url: network.url,
        },
        signal,
        guard,
        readFetch
      );
      const result = await operation(read);
      guard();
      return result;
    },
    assertUnprotected: jest.fn(async (_resolve, guard) => {
      guard();
      if (protectedInput) throw new Error('Protected collateral');
    }),
    withSignatureRelease: async (operation) => operation(disclose),
    fee: {
      verify: jest.fn(async (_psbt, _capability, guard) => {
        guard();
        return null;
      }),
      acquire: jest.fn(() => {
        throw new Error('Unsupported Sentry fee');
      }),
    },
    readAssetMetadata: jest.fn(async () => ({
      asset: {
        assetGuid: '123456',
        symbol: 'SYSX',
        assetType: 'SYSX',
        decimals: 8,
      },
    })),
    broadcast: {
      owner: () => ({
        chainId: 0,
        slip44: 0,
        genesisHash:
          '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        account: { id: 0, type: 'Imported', xpub: payer.address },
      }),
      records: records as unknown as UtxoSignedRecords,
      session: {
        keyring: {
          getPrivateRecordProfileId: async () => 'ab'.repeat(32),
          encryptPrivateRecord: async () => {
            throw new Error('Journal stub owns persistence');
          },
          decryptPrivateRecord: async () => {
            throw new Error('Journal stub owns persistence');
          },
        },
        assertCurrent: check,
      },
      withAdmission: (operation) => operation(post),
    },
  };
  const prepare = (method: 'sys_sign' | 'sys_signAndSend' = 'sys_sign') =>
    preparePsbtApproval(host, {
      method,
      origin: 'https://dapp.invalid',
      psbt: envelope,
      feeAuthorization: null,
    });
  return {
    psbt,
    envelope,
    host,
    sdk,
    prepare,
    sign,
    records,
    post,
    events,
    disclose,
    readFetch,
    retire: () => {
      current = false;
    },
    protect: () => {
      protectedInput = true;
    },
  };
}

it.each([false, true])(
  'returns structured SDK PSBT bytes without broadcasting (partial %s)',
  async (partial) => {
    const f = fixture(partial);
    const pending = await f.prepare();
    expect(pending.review).toMatchObject({
      origin: 'https://dapp.invalid',
      method: 'sys_sign',
      feeSatoshis: '1000',
      complete: false,
      inputs: [
        {
          txid: Buffer.from(f.psbt.txInputs[0].hash).reverse().toString('hex'),
          vout: 0,
          valueSatoshis: '100000',
        },
      ],
      outputs: [
        {
          index: 0,
          address: recipient.address,
          valueSatoshis: '99000',
          assets: [],
        },
      ],
    });
    const signed = await pending.approve();
    expect(Object.keys(signed).sort()).toEqual(['assets', 'psbt']);
    const actual = PsbtUtils.fromPali(signed, network);
    expect(
      actual.data.inputs[0][partial ? 'partialSig' : 'finalScriptWitness']
    ).toBeDefined();
    expect(f.sign).toHaveBeenCalledTimes(1);
    expect(f.disclose).toHaveBeenCalledTimes(1);
    expect(f.records.admit).not.toHaveBeenCalled();
    expect(f.post).not.toHaveBeenCalled();
    expect(pending.disposition()).toEqual({ transactionNotBroadcast: true });
    await expect(pending.approve()).rejects.toThrow('already used');
    pending.dispose();
  }
);

it('submits only explicit complete sign-and-send through the existing durable journal', async () => {
  const f = fixture();
  const pending = await f.prepare('sys_signAndSend');
  const result = await pending.approve();
  if (!('txid' in result))
    throw new Error('Expected explicit submission result');
  expect(result).toMatchObject({
    txid: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(f.events).toEqual(['sign', 'disclose', 'journal', 'POST', 'ack']);
  const record = f.records.admit.mock.calls[0][1];
  expect(record).toMatchObject({
    operation: 'external',
    url: `${network.url}/api/v2/sendtx/`,
    feeSatoshis: '1000',
    txid: result.txid,
  });
  expect(f.post.mock.calls[0][1].body).toBe(record.rawTransaction);
  expect(pending.disposition()).toEqual({
    transactionNotBroadcast: false,
    txid: result.txid,
  });
  pending.dispose();
});

it.each(['ack', 'lost reply'] as const)(
  'keeps exact POST disposition through retirement and %s',
  async (outcome) => {
    const f = fixture();
    const entered = Promise.withResolvers<string>();
    const response = Promise.withResolvers<Response>();
    f.post.mockImplementation((url, init) => {
      entered.resolve(bitcoin.Transaction.fromHex(init.body as string).getId());
      return response.promise;
    });
    const pending = await f.prepare('sys_signAndSend');
    const approval = pending.approve();
    const txid = await entered.promise;
    const observed = pending.disposition();
    expect(observed).toEqual({ transactionNotBroadcast: false, txid });
    expect(Object.isFrozen(observed)).toBe(true);
    pending.dispose();
    f.retire();
    if (outcome === 'ack') {
      const reply = Response.json({ result: txid });
      Object.defineProperty(reply, 'url', {
        value: `${network.url}/api/v2/sendtx/`,
      });
      response.resolve(reply);
      await expect(approval).resolves.toEqual({ txid });
    } else {
      response.reject(new Error('Reply lost'));
      await expect(approval).rejects.toMatchObject({
        code: 'UTXO_SUBMISSION_UNKNOWN',
        transactionNotBroadcast: false,
        txid,
      });
    }
    expect(pending.disposition()).toEqual(observed);
  }
);

it('proves no POST when retirement wins while the journal admission is held', async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const admit = f.records.admit.getMockImplementation()!;
  f.records.admit.mockImplementation(async (...args) => {
    entered.resolve();
    await resume.promise;
    return admit(...args);
  });
  const pending = await f.prepare('sys_signAndSend');
  const approval = pending.approve();
  await entered.promise;
  pending.dispose();
  resume.resolve();
  await expect(approval).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(pending.disposition()).toEqual({ transactionNotBroadcast: true });
  expect(f.post).not.toHaveBeenCalled();
});

it('preserves the mandatory private journal session guard alongside request authority', async () => {
  const f = fixture();
  f.host.broadcast.session.assertCurrent = () => {
    throw new Error('Private journal lease retired');
  };
  const pending = await f.prepare('sys_signAndSend');
  await expect(pending.approve()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(pending.disposition()).toEqual({ transactionNotBroadcast: true });
  expect(f.post).not.toHaveBeenCalled();
  pending.dispose();
});

it.each([
  [137, 'sign PoDA PSBTs for external submission'],
  [81, 'Sentry operations require sys_sign'],
] as const)(
  'keeps version %s explicitly sign-only before the signer',
  async (version, message) => {
    const f = fixture();
    f.envelope.psbt = PsbtUtils.toPali(f.psbt.setVersion(version)).psbt;
    await expect(f.prepare('sys_signAndSend')).rejects.toThrow(message);
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.post).not.toHaveBeenCalled();
  }
);

it('uses verified allocation amounts and fresh observed metadata, never envelope metadata', async () => {
  const f = fixture(false, true);
  f.envelope.assets = JSON.stringify([
    ['123456', { decimals: 0, symbol: 'FAKE' }],
  ]);
  const pending = await f.prepare();
  expect(pending.review.outputs[0].assets).toEqual([
    {
      assetGuid: '123456',
      rawAmount: '25',
      amount: '0.00000025',
      symbol: 'SYSX',
      isBurn: false,
    },
  ]);
  expect(pending.review.transactionOptions).toEqual({ rbf: true, zdag: false });
  jest.mocked(f.host.readAssetMetadata).mockResolvedValueOnce({
    asset: {
      assetGuid: '123456',
      symbol: 'Changed',
      assetType: 'SYSX',
      decimals: 8,
    },
  });
  await expect(pending.approve()).rejects.toThrow('metadata changed');
  expect(f.sign).not.toHaveBeenCalled();
  expect(f.disclose).not.toHaveBeenCalled();
  expect(f.host.readAssetMetadata).toHaveBeenCalledTimes(2);
  pending.dispose();
});

it('retains partial sign-only semantics but refuses to submit incomplete signatures', async () => {
  const f = fixture(true);
  const pending = await f.prepare('sys_signAndSend');
  await expect(pending.approve()).rejects.toThrow();
  expect(f.sign).toHaveBeenCalledTimes(1);
  expect(f.records.admit).not.toHaveBeenCalled();
  expect(f.post).not.toHaveBeenCalled();
  pending.dispose();
});

it('captures original request bytes instead of following a later caller mutation', async () => {
  const f = fixture();
  const pending = await f.prepare();
  f.envelope.psbt = PsbtUtils.toPali(f.psbt.setLocktime(99)).psbt;
  const result = await pending.approve();
  expect(PsbtUtils.fromPali(result, network).locktime).toBe(0);
  pending.dispose();
});

it.each(['unsigned', 'owner', 'collateral'] as const)(
  'refuses disclosure after the signer changes %s',
  async (change) => {
    const f = fixture();
    const sign = f.sign.getMockImplementation()!;
    f.sign.mockImplementation(async (psbt) => {
      const signed = await sign(psbt);
      if (change === 'owner') f.retire();
      if (change === 'collateral') f.protect();
      if (change === 'unsigned') {
        const changed = new bitcoin.Psbt({ network: outputNetwork });
        changed.addInput({
          hash: signed.txInputs[0].hash,
          index: 0,
          witnessUtxo: { script: payer.output, value: BigInt(100_000) },
        });
        changed.addOutput({
          address: recipient.address,
          value: BigInt(98_000),
        });
        return changed;
      }
      return signed;
    });
    const pending = await f.prepare();
    await expect(pending.approve()).rejects.toThrow();
    expect(f.disclose).not.toHaveBeenCalled();
    expect(f.post).not.toHaveBeenCalled();
    pending.dispose();
  }
);

it.each(['retired', 'disposed'] as const)(
  'does not sign after a %s review',
  async (state) => {
    const f = fixture();
    const pending = await f.prepare();
    if (state === 'retired') f.retire();
    else pending.dispose();
    await expect(pending.approve()).rejects.toThrow();
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.disclose).not.toHaveBeenCalled();
    pending.dispose();
  }
);

it('refuses a fee-tagged request when the required host adapter cannot authorize it', async () => {
  const f = fixture();
  await expect(
    preparePsbtApproval(f.host, {
      method: 'sys_sign',
      origin: 'https://dapp.invalid',
      psbt: f.envelope,
      feeAuthorization: 'not-a-capability',
    })
  ).rejects.toThrow('SENTRY_FEE_AUTHORIZATION_REQUIRED');
  expect(f.sign).not.toHaveBeenCalled();
  expect(f.host.fee.acquire).not.toHaveBeenCalled();
});

it('requires explicit fee and signature-release host ports', async () => {
  const f = fixture();
  await expect(
    preparePsbtApproval(
      { ...f.host, fee: undefined } as unknown as PsbtApprovalHost,
      {
        method: 'sys_sign',
        origin: 'https://dapp.invalid',
        psbt: f.envelope,
        feeAuthorization: null,
      }
    )
  ).rejects.toThrow('Explicit PSBT signing ports');
  expect(f.readFetch).not.toHaveBeenCalled();
});

it('keeps canonical metadata parsing shared and refuses dapp or other-GUID substitutes', () => {
  const asset = {
    assetGuid: '123456',
    symbol: 'SYSX',
    assetType: 'SYSX',
    decimals: 8,
  };
  expect(capturePsbtAssetMetadata('123456', { asset })).toEqual(asset);
  expect(() => capturePsbtAssetMetadata('123456', asset)).toThrow(
    'Unable to verify'
  );
  expect(() =>
    capturePsbtAssetMetadata('123456', {
      asset: { ...asset, assetGuid: '123457' },
    })
  ).toThrow('Unable to verify');
  expect(
    psbtAssetMetadataUrl('https://blockbook.invalid/prefix/', '123456')
  ).toBe('https://blockbook.invalid/prefix/api/v2/asset/123456?details=basic');
  expect(() => psbtAssetMetadataUrl(network.url, '../123456')).toThrow(
    'Invalid asset GUID'
  );
});

it('captures the bounded two-string envelope before the full SDK parser', () => {
  const f = fixture();
  expect(capturePsbtEnvelope(f.envelope)).toEqual(f.envelope);
  expect(() => capturePsbtEnvelope({ psbt: f.envelope.psbt })).toThrow(
    'Invalid PSBT envelope'
  );
  expect(() =>
    capturePsbtEnvelope({ psbt: 'x'.repeat(800_000), assets: '[]' })
  ).toThrow('work limits');
});
