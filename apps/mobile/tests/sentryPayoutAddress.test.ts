import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeOutputScriptAddress } from '../../../source/shared/outputScriptAddress.ts';
import { decodeSentryPayoutAddress } from '../src/screens/sentryPayoutAddress.ts';

const vectors = [
  ['76a914' + '11'.repeat(20) + '88ac', 'SNrExv4meNtf7QKvwj5EWudgZUrE14xFqc', 'TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV'],
  ['a914' + '11'.repeat(20) + '87', '33FFrcn4Tv1qgGEuXPkkPdr44DuWp3RzPo', '2MtoTvMi65NXBt3sTCXNd1aqKGa7gXsX8CC'],
  ['0014' + '11'.repeat(20), 'sys1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3lhcnfs', 'tsys1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3g9m666'],
  ['0020' + '11'.repeat(32), 'sys1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs22f06x', 'tsys1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsp9d39n'],
] as const;

for (const [script, mainnet, testnet] of vectors) test(`Sentry payout decodes ${script.slice(0, 6)} using the approved network`, () => {
  assert.equal(decodeSentryPayoutAddress(script, 'mainnet'), mainnet);
  assert.equal(decodeSentryPayoutAddress(script, 'testnet'), testnet);
  assert.equal(decodeSentryPayoutAddress(script.toUpperCase(), 'mainnet'), mainnet);
});

test('unknown network, malformed hex and non-address scripts never invent a payout address', () => {
  for (const value of ['', '0x0014' + '11'.repeat(20), '001', 'zz', '51', '6a02abcd', '00'.repeat(10_001)])
    assert.equal(decodeSentryPayoutAddress(value, 'mainnet'), null);
  assert.equal(decodeSentryPayoutAddress(vectors[0][0], 'unknown' as never), null);
  assert.equal(decodeOutputScriptAddress(vectors[0][0], undefined as never), null);
});
