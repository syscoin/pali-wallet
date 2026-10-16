import * as ecc from '@bitcoinerlab/secp256k1';
import { utils as sys } from 'syscoinjs-lib';

import {
  createUtxoFixture,
  UTXO_FIXTURE_PATH,
  UtxoFixtureReadState,
} from './utxoFixture';

const bitcoin = sys.bitcoinjs;
const network = sys.syscoinNetworks.testnet;
export const PENDING_NATIVE_SUMMARY = '9775331';
export const PENDING_NATIVE_FUNDING = '6547561';

/** Local transaction/indexer model, never a Core or public-chain acceptor. */
export function createPendingNativeChain() {
  const fixture = createUtxoFixture(PENDING_NATIVE_FUNDING);
  const ownedScript = Buffer.from(fixture.parentTxs[0].outs[0].script);
  let current = {
    txid: fixture.parentTxs[0].getId(),
    value: BigInt(PENDING_NATIVE_FUNDING),
  };
  const rawTransactions: Record<string, unknown> = {};
  const transactions: unknown[] = [];
  const accepted: Array<{
    feeSatoshis: string;
    grossSatoshis: string;
    parentTxid: string;
    recipientSatoshis: string;
    sighash: number;
    txid: string;
  }> = [];
  const seen = new Set<string>();

  const acceptBroadcast = (raw: string): { result: string } => {
    if (
      typeof raw !== 'string' ||
      raw.length > 32768 ||
      !/^(?:[0-9a-f]{2})+$/i.test(raw)
    )
      throw new Error('Malformed synthetic transaction hex');
    const tx = bitcoin.Transaction.fromHex(raw);
    if (tx.toHex().toLowerCase() !== raw.toLowerCase())
      throw new Error('Noncanonical synthetic transaction');
    const txid = tx.getId();
    if (seen.has(txid)) throw new Error('Synthetic transaction replay');
    if (
      tx.ins.length !== 1 ||
      Buffer.from(tx.ins[0].hash).reverse().toString('hex') !== current.txid ||
      tx.ins[0].index !== 0
    )
      throw new Error('Must spend the exact current synthetic outpoint');
    if (
      tx.outs.length !== 1 ||
      !Buffer.from(tx.outs[0].script).equals(ownedScript)
    )
      throw new Error('Only the synthetic self recipient is permitted');
    const value = BigInt(tx.outs[0].value);
    const fee = current.value - value;
    if (value <= BigInt(0) || fee <= BigInt(0) || fee > BigInt(1000))
      throw new Error(
        'Synthetic fee must be positive and at most 1000 satoshis'
      );
    const input = tx.ins[0];
    if (input.script.length || input.witness.length !== 2)
      throw new Error('Expected a native two-item P2WPKH witness');
    const [encoded, pubkey] = input.witness;
    const payment = bitcoin.payments.p2wpkh({ pubkey, network });
    if (!Buffer.from(payment.output!).equals(ownedScript))
      throw new Error('Foreign synthetic witness owner');
    const signature = bitcoin.script.signature.decode(encoded);
    if (signature.hashType !== bitcoin.Transaction.SIGHASH_ALL)
      throw new Error('Synthetic witness must use SIGHASH_ALL');
    const digest = tx.hashForWitnessV0(
      0,
      bitcoin.payments.p2pkh({ pubkey, network }).output!,
      current.value,
      signature.hashType
    );
    if (!ecc.verify(digest, pubkey, signature.signature))
      throw new Error('Invalid synthetic ECDSA witness');

    // No state changes occur until every input/output/signature check succeeds.
    const row = {
      txid,
      hex: raw,
      confirmations: 0,
      blockHeight: 0,
      blockTime: 1700000000 + accepted.length,
      fees: fee.toString(),
      valueIn: current.value.toString(),
      value: value.toString(),
      vin: [
        {
          txid: current.txid,
          vout: 0,
          value: current.value.toString(),
          addresses: [fixture.userAddress],
          isAddress: true,
        },
      ],
      vout: [
        {
          n: 0,
          value: value.toString(),
          hex: ownedScript.toString('hex'),
          addresses: [fixture.userAddress],
          isAddress: true,
        },
      ],
    };
    accepted.push({
      txid,
      parentTxid: current.txid,
      grossSatoshis: current.value.toString(),
      recipientSatoshis: value.toString(),
      feeSatoshis: fee.toString(),
      sighash: signature.hashType,
    });
    seen.add(txid);
    rawTransactions[txid] = row;
    transactions.unshift(row);
    current = { txid, value };
    return { result: txid };
  };
  const readState = (): UtxoFixtureReadState => ({
    // First quote deliberately sees the human-sized summary/funding mismatch.
    // Basic omits mempool aggregation; proper tokenBalances reads include the
    // current signed delta after the first synthetic receipt.
    balance: PENDING_NATIVE_SUMMARY,
    unconfirmedBalance: accepted.length
      ? (current.value - BigInt(PENDING_NATIVE_SUMMARY)).toString()
      : '0',
    omitUnconfirmedBalance: true,
    unconfirmedTxs: 3 + accepted.length,
    utxos: [
      {
        txid: current.txid,
        vout: 0,
        value: current.value.toString(),
        height: accepted.length ? 0 : 1,
        confirmations: accepted.length ? 0 : 1,
        address: fixture.userAddress,
        path: UTXO_FIXTURE_PATH,
      },
    ],
    rawTransactions: { ...rawTransactions },
    transactions: [...transactions],
  });
  return {
    fixture,
    accepted,
    acceptBroadcast,
    readState,
    current: () => ({ txid: current.txid, value: current.value.toString() }),
  };
}
