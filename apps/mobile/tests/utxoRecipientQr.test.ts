import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUtxoAddress } from '../src/core/utxoAddresses.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { screenFixture } from './screenFixture.ts';

const bitcoin = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const syscoin = 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58';
test('recipient scanner accepts only raw public addresses for its exact selected UTXO network', () => {
  const fixture = screenFixture(new URL('../src/screens/UtxoRecipientQrScanner.tsx', import.meta.url), 'UtxoRecipientQrScanner', {
    '../core/utxoAddresses': { normalizeUtxoAddress }, './QrScanner': { QrScanner: 'QrScanner' },
  });
  try {
    const render = (network: string) => fixture.render({ network: getUtxoNetwork(network), onScan() {}, onClose() {} });
    const btc = render('bitcoin');
    assert.equal(btc.props.parse(bitcoin), bitcoin);
    assert.equal(btc.props.parse(bitcoin.toUpperCase()), bitcoin);
    for (const input of [syscoin, `bitcoin:${bitcoin}?amount=1`, ` ${bitcoin}`, '0x' + '11'.repeat(20)]) assert.equal(btc.props.parse(input), null);
    const sys = render('syscoin');
    assert.equal(sys.props.parse(syscoin), syscoin); assert.equal(sys.props.parse(bitcoin), null);
  } finally { fixture.close(); }
});
