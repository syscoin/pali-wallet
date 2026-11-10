import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, Interface } from 'ethers/abi';
import { keccak256 } from 'ethers/crypto';
import { getPrivacyPool } from '../../../source/utils/privacy/registry.ts';
import type { IPrivateVaultSession } from '../../../source/wallet/privateVault.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { createNativeNoteMaintenanceProofs } from '../src/custody/noteMaintenance.ts';

const word = (n: number) => '0x' + n.toString(16).padStart(64, '0');
const account = '0x' + '11'.repeat(20), recipient = '0x' + '22'.repeat(20), pool = getPrivacyPool('eth-1');
const identity = { poolId: 'eth-1', commitment: word(7), nullifierHash: word(8) } as const;
const hash = word(9), blockHash = word(10), anchor = word(11), root = word(12);
const abi = new Interface(['event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)',
  'function withdraw(bytes proof,bytes32 root,bytes32 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund)']);
const proof = '0x' + '12'.repeat(256), zero = '0x' + '00'.repeat(20);
const input = abi.encodeFunctionData('withdraw', [proof, root, identity.nullifierHash, recipient, zero, 0, 0]);
const withdrawal = { attemptHash: word(13), createdAt: 10, inputHash: keccak256(AbiCoder.defaultAbiCoder().encode(Array(6).fill('uint256'), [root, identity.nullifierHash, recipient, zero, 0, 0])), intentId: 'public-fixture',
  mode: 'direct', nonce: '2', phase: 'submitted', proofHash: keccak256(proof), transactionHash: hash, from: account } as const;
function fixture(reverted = false) {
  let current = true, spent = false, known = false, canonical = blockHash;
  const signal = new AbortController(), calls: { method: string; params: unknown[] }[] = [];
  const network = createNativeNetwork({ id: 'saved-ethereum', name: 'Saved Ethereum', kind: 'evm', chainId: '1', slip44: 60,
    rpcUrl: 'https://privacy-fixture.invalid/rpc', symbol: 'ETH', decimals: 18, testnet: false });
  const check = () => { if (!current) throw Error('session changed'); };
  const session = { assertCurrent: check, generation: 1, keyring: {} } as IPrivateVaultSession;
  const encoded = abi.encodeEventLog(abi.getEvent('Withdrawal')!, [recipient, identity.nullifierHash, zero, 0]);
  const rpc = new EvmTransferReadRpc(network, { fetch: async (_url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body)); calls.push({ method, params });
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getBlockByNumber') result = params[0] === '0x70'
      ? { number: '0x70', hash: canonical } : { number: '0x80', hash: anchor };
    else if (method === 'eth_getTransactionReceipt') result = { transactionHash: hash, blockHash, blockNumber: '0x70',
      status: reverted ? '0x0' : '0x1', logs: [{ address: pool.address, transactionHash: hash, blockHash, blockNumber: '0x70', removed: false, ...encoded }] };
    else if (method === 'eth_getTransactionByHash') result = { hash, blockHash, blockNumber: '0x70', from: account, nonce: '0x2',
      to: pool.address, value: '0x0', chainId: '0x1', input };
    else if (method === 'eth_call') result = (String(params[0].data).includes(identity.nullifierHash.slice(2)) ? spent : known) ? word(1) : word(0);
    else throw Error('Unexpected RPC ' + method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  } });
  const ports = createNativeNoteMaintenanceProofs({ network, signal: signal.signal, assertCurrent: check, rpc });
  return { ports, session, signal, calls, setCurrent(value: boolean) { current = value; }, setSpent(value: boolean) { spent = value; }, setKnown(value: boolean) { known = value; }, reorg() { canonical = word(100); } };
}
test('native completion uses the shared finalized event/nonce verifier and rechecks its original RPC before removal', async () => {
  const f = fixture();
  const lease = await f.ports.prepareCompletionProof(identity, withdrawal, undefined, f.session);
  assert(f.calls.length > 0); assert(!f.calls.some(call => JSON.stringify(call.params).includes(identity.nullifierHash)));
  await lease.revalidate(); f.reorg(); await assert.rejects(lease.revalidate(), /privacy_spent_proof_unavailable/);
});
test('native recovery requires the same failed transaction, evicted original root and unspent nullifier', async () => {
  const f = fixture(true);
  const lease = await f.ports.prepareWithdrawalRecovery(identity, withdrawal, f.session);
  assert.equal(lease.receipt.root, root); await lease.revalidate();
  f.setKnown(true); await assert.rejects(lease.revalidate(), /privacy_withdrawal_recovery_unavailable/);
  f.setKnown(false); f.setSpent(true);
  await assert.rejects(f.ports.prepareWithdrawalRecovery(identity, withdrawal, f.session), /privacy_withdrawal_recovery_unavailable/);
});
test('native maintenance refuses unknown attempts, revoked sessions and aborts without additional RPC', async () => {
  const f = fixture();
  await assert.rejects(f.ports.prepareCompletionProof(identity, { ...withdrawal, phase: 'unknown' }, undefined, f.session));
  assert.equal(f.calls.length, 0); f.setCurrent(false);
  await assert.rejects(f.ports.prepareCompletionProof(identity, withdrawal, undefined, f.session)); assert.equal(f.calls.length, 0);
  f.setCurrent(true); f.signal.abort();
  await assert.rejects(f.ports.prepareWithdrawalRecovery(identity, withdrawal, f.session)); assert.equal(f.calls.length, 0);
});
