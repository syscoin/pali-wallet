jest.unmock('syscoinjs-lib');

import { utils as sys } from 'syscoinjs-lib';

import {
  createSptFixture,
  SPT_BALANCE_UNITS,
  SPT_GUID,
  sptFixtureRead,
} from '../../e2e/harness/sptFixture';

describe('offline SPT fixture', () => {
  it('binds the displayed asset balance and spendable prevout to the same bytes', () => {
    const f = createSptFixture();
    const account: any = sptFixtureRead(
      f,
      `https://blockbook-dev.syscoin.org/api/v2/xpub/${f.userXpub}`,
      'GET'
    );
    const utxos: any = sptFixtureRead(
      f,
      `https://blockbook-dev.syscoin.org/api/v2/utxo/${f.userXpub}`,
      'GET'
    );
    expect(account.tokensAsset[0].balance).toBe(SPT_BALANCE_UNITS);
    expect(account.tokensAsset[0].assetGuid).toBe(SPT_GUID);
    expect(utxos.utxos).toHaveLength(1);
    expect(utxos.utxos[0].txid).toBe(f.parentTxs[0].getId());
    expect(utxos.utxos[0].assetInfo.value).toBe(SPT_BALANCE_UNITS);
    expect(f.parentTxs[0].version).toBe(142);
    expect(f.parentTxs[0].outs[0].value).toBe(BigInt(100000));
    expect(Buffer.from(f.parentTxs[0].outs[0].script)).toEqual(
      Buffer.from(
        sys.bitcoinjs.address.toOutputScript(
          f.userAddress,
          sys.syscoinNetworks.testnet
        )
      )
    );
  });
  it('never supplies a send endpoint, POST, foreign origin or foreign account', () => {
    const f = createSptFixture();
    for (const [url, method] of [
      ['https://blockbook-dev.syscoin.org/api/v2/sendtx/', 'POST'],
      ['https://blockbook-dev.syscoin.org/api/v2/sendtx/test', 'GET'],
      ['https://foreign.invalid/api/v2/asset/123456', 'GET'],
      ['https://blockbook-dev.syscoin.org/api/v2/xpub/unrelated', 'GET'],
    ])
      expect(sptFixtureRead(f, url, method)).toBeUndefined();
  });

  it('passes the wrapped asset response through the installed SDK sanitizer', () => {
    const f = createSptFixture();
    const response = sptFixtureRead(
      f,
      `https://blockbook-dev.syscoin.org/api/v2/utxo/${f.userXpub}`,
      'GET'
    );
    const sanitized = sys.sanitizeBlockbookUTXOs(
      f.userXpub,
      response,
      sys.syscoinNetworks.testnet,
      { rbf: true },
      new Map([[SPT_GUID, {}]])
    );
    expect(sanitized.utxos).toHaveLength(1);
    expect(sanitized.utxos[0].txId).toBe(f.parentTxs[0].getId());
    expect(sanitized.utxos[0].assetInfo.value.toString()).toBe(
      SPT_BALANCE_UNITS
    );
    expect(sanitized.assets.get(SPT_GUID).precision).toBe(8);
  });
});
