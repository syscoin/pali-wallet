jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');

import { assertPsbtAccountScope } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt-account-scope';
import http from 'http';

import {
  createUtxoFixture,
  exportFixturePsbt,
  fixtureRead,
  importFixturePsbt,
  startUtxoFixtureServer,
  verifyCompletedSponsor,
  verifyFixtureSignature,
} from '../../e2e/harness/utxoFixture';

describe('offline UTXO browser fixture', () => {
  it('contains real deterministic parents and a valid user-only signature', async () => {
    const f = createUtxoFixture();
    const psbt = await f.signUserOffline(importFixturePsbt(f.single));
    expect(
      verifyFixtureSignature(f, exportFixturePsbt(psbt), false)
    ).toBeTruthy();
  });

  it('preserves unsigned sponsor input and verifies both real signatures after completion', async () => {
    const f = createUtxoFixture();
    const psbt = await f.signUserOffline(importFixturePsbt(f.mixed));
    verifyFixtureSignature(f, exportFixturePsbt(psbt), true);
    const witness = Buffer.from(psbt.data.inputs[0].finalScriptWitness);
    f.finishSponsor(psbt);
    expect(
      Buffer.from(psbt.data.inputs[0].finalScriptWitness).equals(witness)
    ).toBe(true);
    expect(verifyCompletedSponsor(f, psbt)).toMatch(/^[0-9a-f]{64}$/);
    psbt.data.inputs[0].finalScriptWitness[5] ^= 1;
    expect(() =>
      verifyFixtureSignature(f, exportFixturePsbt(psbt), true)
    ).toThrow();
  });

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
    verifyFixtureSignature(f, exportFixturePsbt(signed), true);
  });

  it('rejects changed outputs and an already signed sponsor input', async () => {
    const f = createUtxoFixture();
    const psbt = await f.signUserOffline(importFixturePsbt(f.mixed));
    f.finishSponsor(psbt);
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
