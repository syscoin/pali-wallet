jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');

import { utils as sys } from 'syscoinjs-lib';

import { createPendingNativeChain } from '../../e2e/harness/pendingNativeChain';
import {
  importFixturePsbt,
  fixtureRead,
  installUtxoFixtureRoutes,
} from '../../e2e/harness/utxoFixture';

const bitcoin = sys.bitcoinjs;
const network = sys.syscoinNetworks.testnet;
const host = 'https://blockbook-dev.syscoin.org';
type Chain = ReturnType<typeof createPendingNativeChain>;

async function signedRaw(chain: Chain, fee = 140, recipient?: string) {
  const current = chain.current();
  const state = chain.readState();
  const parent =
    current.txid === chain.fixture.parentTxs[0].getId()
      ? chain.fixture.parentTxs[0]
      : bitcoin.Transaction.fromHex(
          (state.rawTransactions![current.txid] as any).hex
        );
  const psbt = new bitcoin.Psbt({ network });
  psbt.addInput({
    hash: current.txid,
    index: 0,
    nonWitnessUtxo: parent.toBuffer(),
    witnessUtxo: parent.outs[0],
    bip32Derivation: importFixturePsbt(chain.fixture.single).data.inputs[0]
      .bip32Derivation,
  });
  psbt.addOutput({
    address: recipient || chain.fixture.userAddress,
    value: BigInt(current.value) - BigInt(fee),
  });
  const signed = await chain.fixture.signUserOffline(psbt);
  return signed.extractTransaction().toHex();
}

describe('local pending native chain model', () => {
  it('accepts four valid synthetic self-spends linked to their exact unconfirmed parent', async () => {
    const chain = createPendingNativeChain();
    const root = chain.current();
    for (let index = 0; index < 4; index++) {
      const previous = chain.current();
      const raw = await signedRaw(chain);
      const receipt = chain.acceptBroadcast(raw);
      expect(chain.accepted[index]).toMatchObject({
        txid: receipt.result,
        parentTxid: previous.txid,
        grossSatoshis: previous.value,
        recipientSatoshis: String(BigInt(previous.value) - BigInt(140)),
        feeSatoshis: '140',
        sighash: bitcoin.Transaction.SIGHASH_ALL,
      });
      expect(() => chain.acceptBroadcast(raw)).toThrow('replay');
      expect(chain.readState().utxos).toEqual([
        expect.objectContaining({ txid: receipt.result, confirmations: 0 }),
      ]);
    }
    expect(new Set(chain.accepted.map((row) => row.txid)).size).toBe(4);
    expect(chain.accepted[0].parentTxid).toBe(root.txid);
    expect(chain.readState()).toMatchObject({
      balance: '9775331',
      omitUnconfirmedBalance: true,
    });
  });

  it('omits mempool delta only for basic and aligns tokenBalances after the first receipt', async () => {
    const chain = createPendingNativeChain();
    const url = host + '/api/v2/xpub/' + chain.fixture.userXpub;
    expect(
      fixtureRead(chain.fixture, url, 'GET', chain.readState())
    ).toMatchObject({
      balance: '9775331',
      unconfirmedBalance: '0',
      unconfirmedTxs: 3,
    });
    chain.acceptBroadcast(await signedRaw(chain));
    const summary = fixtureRead(
      chain.fixture,
      url + '?details=tokenBalances&tokens=nonzero',
      'GET',
      chain.readState()
    );
    expect(summary).toMatchObject({ balance: '9775331', unconfirmedTxs: 4 });
    expect((summary as any).unconfirmedBalance).toBe(
      (BigInt(chain.current().value) - BigInt(9775331)).toString()
    );
    expect(
      fixtureRead(
        chain.fixture,
        url + '?details=basic',
        'GET',
        chain.readState()
      )
    ).not.toHaveProperty('unconfirmedBalance');
  });

  it.each([0, -1, 1001])('rejects an invalid synthetic fee %s', async (fee) => {
    const chain = createPendingNativeChain();
    const before = chain.current();
    const raw = await signedRaw(chain, fee);
    expect(() => chain.acceptBroadcast(raw)).toThrow('fee');
    expect(chain.current()).toEqual(before);
    expect(chain.accepted).toEqual([]);
  });

  it('rejects a signed payment to another synthetic account', async () => {
    const chain = createPendingNativeChain();
    const raw = await signedRaw(chain, 140, chain.fixture.recipientAddress);
    expect(() => chain.acceptBroadcast(raw)).toThrow('self recipient');
    expect(chain.accepted).toEqual([]);
  });

  it.each(['outpoint', 'owner', 'fake-witness', 'sighash', 'signature'])(
    'rejects a foreign or invalid %s without consuming its current outpoint',
    async (mutation) => {
      const chain = createPendingNativeChain();
      const before = chain.current();
      const tx = bitcoin.Transaction.fromHex(await signedRaw(chain));
      if (mutation === 'outpoint') tx.ins[0].hash = Buffer.alloc(32, 99);
      if (mutation === 'owner')
        tx.ins[0].witness[1] = Buffer.from(
          importFixturePsbt(chain.fixture.mixed).data.inputs[1]
            .bip32Derivation[0].pubkey
        );
      if (mutation === 'fake-witness') tx.ins[0].witness[0] = Buffer.from([0]);
      if (mutation === 'sighash') {
        const encoded = Buffer.from(tx.ins[0].witness[0]);
        encoded[encoded.length - 1] = bitcoin.Transaction.SIGHASH_NONE;
        tx.ins[0].witness[0] = encoded;
      }
      if (mutation === 'signature') {
        const decoded = bitcoin.script.signature.decode(tx.ins[0].witness[0]);
        decoded.signature[31] ^= 1;
        tx.ins[0].witness[0] = bitcoin.script.signature.encode(
          decoded.signature,
          decoded.hashType
        );
      }
      expect(() => chain.acceptBroadcast(tx.toHex())).toThrow();
      expect(chain.current()).toEqual(before);
      expect(chain.accepted).toEqual([]);
    }
  );

  it.each(['', '00', 'not-hex', '00'.repeat(20000)])(
    'rejects malformed raw hex without accepting a transaction',
    (raw) => {
      const chain = createPendingNativeChain();
      expect(() => chain.acceptBroadcast(raw)).toThrow();
      expect(chain.accepted).toEqual([]);
    }
  );
});

describe('opt-in synthetic broadcast route', () => {
  const routeFixture = async (enabled = true) => {
    const chain = createPendingNativeChain();
    let handler!: (route: any) => Promise<unknown>;
    const context = {
      route: jest.fn(async (_pattern, callback) => {
        handler = callback;
      }),
    };
    const callback = jest.fn(chain.acceptBroadcast);
    const counters = await installUtxoFixtureRoutes(
      context as any,
      chain.fixture,
      'http://127.0.0.1:12345',
      enabled ? { onSyntheticBroadcast: callback } : {}
    );
    const request = async (url: string, method: string, raw: string) => {
      const route = {
        request: () => ({
          url: () => url,
          method: () => method,
          postData: () => raw,
          postDataJSON: () => {
            throw new Error('Plain text raw transaction');
          },
        }),
        continue: jest.fn(),
        abort: jest.fn(),
        fulfill: jest.fn(),
      };
      await handler(route);
      return route;
    };
    return { chain, counters, callback, request };
  };

  it('locally acknowledges only the exact opt-in POST with a valid witness', async () => {
    const f = await routeFixture();
    const raw = await signedRaw(f.chain);
    const route = await f.request(host + '/api/v2/sendtx/', 'POST', raw);
    expect(route.fulfill).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({ result: f.chain.current().txid }),
      })
    );
    expect(route.continue).not.toHaveBeenCalled();
    expect(f.counters.syntheticBroadcasts).toHaveLength(1);
    const replay = await f.request(host + '/api/v2/sendtx/', 'POST', raw);
    expect(replay.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(f.counters.syntheticBroadcasts).toHaveLength(1);
  });

  it.each([
    ['https://foreign.invalid/api/v2/sendtx/', 'POST', '00'],
    [host + '/api/v2/sendtx/?foreign=1', 'POST', '00'],
    [host + '/api/v2/sendtx/', 'PUT', '00'],
    [host + '/api/v2/sendtx/', 'GET', '00'],
    [host + '/api/v2/other', 'POST', '00'],
    [host + '/api/v2/sendtx/', 'POST', 'malformed'],
    [host + '/api/v2/sendtx/', 'POST', '00'],
  ])('aborts and records unsafe input %s %s', async (url, method, raw) => {
    const f = await routeFixture();
    const route = await f.request(url, method, raw);
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
    expect(f.counters.deniedUnknown).toHaveLength(1);
    expect(f.counters.syntheticBroadcasts).toEqual([]);
    expect(f.chain.accepted).toEqual([]);
  });

  it('keeps the existing default fixture write-blocked even for a valid synthetic transaction', async () => {
    const f = await routeFixture(false);
    const route = await f.request(
      host + '/api/v2/sendtx/',
      'POST',
      await signedRaw(f.chain)
    );
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(f.callback).not.toHaveBeenCalled();
    expect(f.counters.deniedWrites).toEqual(['/api/v2/sendtx/']);
  });
});
