jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');

import { SyscoinTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin';
import { assertPsbtAccountScope } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt-account-scope';
import http from 'http';
import { utils as sys } from 'syscoinjs-lib';

import {
  createUtxoFixture,
  exportFixturePsbt,
  fixtureRead,
  importFixturePsbt,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
  verifyCompletedSponsor,
  verifyFixtureSignature,
} from '../../e2e/harness/utxoFixture';

const mockBlockbookLookup = jest.fn((..._args: unknown[]) => {
  void _args;
  throw new Error('Offline fixture must not request Blockbook');
});
jest.mock('@sidhujag/sysweb3-keyring/cjs/utils/blockbook-cache', () => ({
  fetchBackendAccountCached: (...args: unknown[]) =>
    mockBlockbookLookup(...args),
}));

async function signWithCurrentKeyring(f: ReturnType<typeof createUtxoFixture>) {
  const hd = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
  const state = {
    activeAccountId: 0,
    activeAccountType: 'HDAccount',
    accounts: {
      HDAccount: { 0: { address: f.userAddress, xpub: f.userXpub } },
    },
    activeNetwork: {
      kind: 'syscoin',
      slip44: 1,
      currency: 'sys',
      chainId: 5700,
      url: 'https://offline.invalid',
    },
  };
  const transactions = new SyscoinTransactions(
    () => ({ hd }),
    () => ({ hd }),
    () => state,
    async () => f.userAddress,
    {},
    {},
    () => () => undefined
  );
  mockBlockbookLookup.mockClear();
  const result = await transactions.signPSBT({ psbt: f.mixed });
  expect(mockBlockbookLookup).not.toHaveBeenCalled();
  return result;
}

describe('offline UTXO browser fixture', () => {
  it('counterfactual: the unscoped same-seed HD signer can sign both accounts', async () => {
    const f = createUtxoFixture();
    const signed = await f.signUserOffline(importFixturePsbt(f.mixed));
    expect(signed.data.inputs[1].finalScriptWitness).toBeDefined();
    expect(verifyCompletedSponsor(f, signed)).toMatch(/^[0-9a-f]{64}$/);
    expect(() =>
      verifyFixtureSignature(f, exportFixturePsbt(signed), true)
    ).toThrow('sponsor input');
  });

  it('contains real deterministic parents and a valid user-only signature', async () => {
    const f = createUtxoFixture();
    const psbt = await f.signUserOffline(importFixturePsbt(f.single));
    expect(
      verifyFixtureSignature(f, exportFixturePsbt(psbt), false)
    ).toBeTruthy();
  });

  it('rejects an extra stack item after an otherwise valid user witness', async () => {
    const f = createUtxoFixture();
    const signed = await f.signUserOffline(importFixturePsbt(f.single));
    const response = exportFixturePsbt(signed);
    expect(verifyFixtureSignature(f, response, false)).toBeTruthy();
    const mutated = importFixturePsbt(response);
    const original = Buffer.from(mutated.data.inputs[0].finalScriptWitness);
    expect(original[0]).toBe(2);
    mutated.data.inputs[0].finalScriptWitness = Buffer.concat([
      Buffer.from([3]),
      original.subarray(1),
      Buffer.from([1, 0x42]),
    ]);
    // The two original items are byte-for-byte intact; only an item was added.
    expect(
      Buffer.from(mutated.data.inputs[0].finalScriptWitness).subarray(
        1,
        original.length
      )
    ).toEqual(original.subarray(1));
    expect(() =>
      verifyFixtureSignature(f, exportFixturePsbt(mutated), false)
    ).toThrow('Unexpected user witness item count');
    expect(verifyFixtureSignature(f, response, false)).toBeTruthy();
  });

  it('preserves unsigned sponsor input and verifies both real signatures after completion', async () => {
    const f = createUtxoFixture();
    const response = await signWithCurrentKeyring(f);
    const psbt = verifyFixtureSignature(f, response, true);
    expect(psbt.data.inputs[1].bip32Derivation).toEqual(
      importFixturePsbt(f.mixed).data.inputs[1].bip32Derivation
    );
    // Corrupt only the user's scalar, keeping valid DER and the sponsor unsigned.
    const corrupted = importFixturePsbt(response);
    const originalWitness = Buffer.from(
      corrupted.data.inputs[0].finalScriptWitness
    );
    expect(originalWitness[0]).toBe(2);
    const encodedLength = originalWitness[1];
    const decoded = sys.bitcoinjs.script.signature.decode(
      originalWitness.subarray(2, 2 + encodedLength)
    );
    decoded.signature[31] ^= 1;
    const encoded = sys.bitcoinjs.script.signature.encode(
      decoded.signature,
      decoded.hashType
    );
    corrupted.data.inputs[0].finalScriptWitness = Buffer.concat([
      Buffer.from([2, encoded.length]),
      encoded,
      originalWitness.subarray(2 + encodedLength),
    ]);
    expect(() =>
      verifyFixtureSignature(f, exportFixturePsbt(corrupted), true)
    ).toThrow('Invalid user witness');

    const witness = Buffer.from(psbt.data.inputs[0].finalScriptWitness);
    f.finishSponsor(psbt);
    expect(
      Buffer.from(psbt.data.inputs[0].finalScriptWitness).equals(witness)
    ).toBe(true);
    expect(verifyCompletedSponsor(f, psbt)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(['missing', 'fingerprint', 'path', 'public key'])(
    'rejects a response with %s sponsor derivation metadata',
    async (mutation) => {
      const f = createUtxoFixture();
      const psbt = importFixturePsbt(await signWithCurrentKeyring(f));
      const external = psbt.data.inputs[1];
      if (mutation === 'missing') {
        delete external.bip32Derivation;
      } else if (mutation === 'fingerprint') {
        external.bip32Derivation[0].masterFingerprint[0] ^= 1;
      } else if (mutation === 'path') {
        external.bip32Derivation[0].path = "m/84'/1'/1'/0/1";
      } else {
        external.bip32Derivation[0].pubkey = importFixturePsbt(
          f.mixed
        ).data.inputs[0].bip32Derivation[0].pubkey;
      }
      expect(() =>
        verifyFixtureSignature(f, exportFixturePsbt(psbt), true)
      ).toThrow('sponsor derivation metadata');
    }
  );

  it('passes the real keyring account-scope guard without authorizing the sponsor input', async () => {
    const f = createUtxoFixture(),
      psbt = importFixturePsbt(f.mixed);
    assertPsbtAccountScope(psbt, {
      account: { address: f.userAddress, xpub: f.userXpub },
      accountId: 0,
      accountType: 'HDAccount',
      network: { slip44: 1, currency: 'sys', chainId: 5700 },
    } as any);
    const signed = await f.signUserOffline(psbt);
    // This internal guard intentionally strips metadata. The public signPSBT
    // response restores it and is checked by the shared browser verifier above.
    expect(signed.data.inputs[1].bip32Derivation).toBeUndefined();
    expect(signed.data.inputs[1].finalScriptWitness).toBeUndefined();
    expect(signed.data.inputs[1].partialSig).toBeUndefined();
    expect(verifyCompletedSponsor(f, f.finishSponsor(signed))).toMatch(
      /^[0-9a-f]{64}$/
    );
  });

  it('rejects changed outputs and an already signed sponsor input', async () => {
    const f = createUtxoFixture();
    const psbt = await f.signUserOffline(importFixturePsbt(f.mixed));
    expect(() =>
      verifyFixtureSignature(f, exportFixturePsbt(psbt), true)
    ).toThrow('sponsor input');
    expect(() => verifyFixtureSignature(f, f.mixed, false)).toThrow(
      'unsigned transaction'
    );
  });

  it('never serves a send endpoint, write method, unknown parent or unrelated origin', () => {
    const f = createUtxoFixture(),
      host = 'https://blockbook-dev.syscoin.org';
    expect(
      fixtureRead(f, host + '/api/v2/tx/' + f.parentTxs[0].getId(), 'GET')
    ).toMatchObject({ hex: f.parentTxs[0].toHex() });
    for (const [url, method] of [
      [host + '/api/v2/sendtx/', 'POST'],
      [host + '/api/v2/sendtx/00', 'GET'],
      [host + '/api/v2/tx/' + '00'.repeat(32), 'GET'],
      [host + '/api/v2/xpub/unrelated-wallet', 'GET'],
      ['https://example.com/api/v2/', 'GET'],
      [host + '/api/v2/', 'POST'],
    ])
      expect(fixtureRead(f, url, method)).toBeUndefined();
  });

  it('launch-time proxy denies HTTP forwarding and HTTPS CONNECT on loopback only', async () => {
    const server = await startUtxoFixtureServer();
    const request = (method: string, target: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(server.url, { method, path: target });
        req.on('response', (response) => {
          response.resume();
          resolve(response.statusCode!);
        });
        req.on('connect', (response, socket) => {
          socket.destroy();
          resolve(response.statusCode!);
        });
        req.on('error', reject);
        req.end();
      });
    try {
      expect(await request('GET', server.url + '/')).toBe(200);
      expect(
        await request('POST', 'http://unreachable.invalid/api/v2/sendtx/')
      ).toBe(403);
      expect(await request('CONNECT', 'unreachable.invalid:443')).toBe(403);
      expect(server.blocked).toEqual(['POST', 'CONNECT']);
    } finally {
      await server.close();
    }
  });
});
