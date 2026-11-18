import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, Interface } from 'ethers/abi';
import { keccak256 } from 'ethers/crypto';
import { getPrivacyPool } from '../../../source/utils/privacy/registry.ts';
import { createPrivateVaultSession } from '../../../source/wallet/privateVault.ts';
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
function fixture() {
  let current = true, canonical = blockHash, chain = '0x1';
  let onRead = (_method: string) => {};
  const signal = new AbortController(), calls: { method: string; params: unknown[] }[] = [];
  const network = createNativeNetwork({ id: 'saved-ethereum', name: 'Saved Ethereum', kind: 'evm', chainId: '1', slip44: 60,
    rpcUrl: 'https://privacy-fixture.invalid/rpc', symbol: 'ETH', decimals: 18, testnet: false });
  const check = () => { if (!current) throw Error('session changed'); };
  const unused = async (): Promise<never> => { throw Error('Proof reader cannot access private record codecs'); };
  const session = createPrivateVaultSession({ assertCurrent: check, generation: 1, keyring: { getPrivateRecordProfileId: unused, encryptPrivateRecord: unused, decryptPrivateRecord: unused } });
  const encoded = abi.encodeEventLog(abi.getEvent('Withdrawal')!, [recipient, identity.nullifierHash, zero, 0]);
  const rpc = new EvmTransferReadRpc(network, { fetch: async (_url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body)); calls.push({ method, params });
    onRead(method);
    let result: unknown;
    if (method === 'eth_chainId') result = chain;
    else if (method === 'eth_getBlockByNumber') result = params[0] === '0x70'
      ? { number: '0x70', hash: canonical } : { number: '0x80', hash: anchor };
    else if (method === 'eth_getTransactionReceipt') result = { transactionHash: hash, blockHash, blockNumber: '0x70',
      status: '0x1', logs: [{ address: pool.address, transactionHash: hash, blockHash, blockNumber: '0x70', removed: false, ...encoded }] };
    else if (method === 'eth_getTransactionByHash') result = { hash, blockHash, blockNumber: '0x70', from: account, nonce: '0x2',
      to: pool.address, value: '0x0', chainId: '0x1', input };
    else throw Error('Unexpected RPC ' + method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  } });
  const ports = createNativeNoteMaintenanceProofs({ network, signal: signal.signal, assertCurrent: check, rpc });
  return { ports, session, signal, calls, rpc, check, onRead(value: typeof onRead) { onRead = value; }, setChain(value: string) { chain = value; }, setCurrent(value: boolean) { current = value; }, reorg() { canonical = word(100); } };
}
test('native completion uses the shared finalized event/nonce verifier and rechecks its original RPC before removal', async () => {
  const f = fixture();
  const lease = await f.ports.prepareCompletionProof(identity, withdrawal, f.session);
  assert.equal(f.calls.length, 7); assert(!f.calls.some(call => JSON.stringify(call.params).includes(identity.nullifierHash)));
  await lease.revalidate(); assert.equal(f.calls.length, 14);
  assert.equal(f.calls.filter(call => call.method === 'eth_chainId').length, 2);
  assert.deepEqual(f.calls.filter(call => call.method === 'eth_getTransactionReceipt' ||
    call.method === 'eth_getTransactionByHash').map(call => call.params), [[hash], [hash], [hash], [hash]]);
  f.reorg(); await assert.rejects(lease.revalidate(), /privacy_spent_proof_unavailable/);
});
test('each maintenance run rechecks chain identity before disclosing a transaction', async () => {
  const f = fixture();
  const lease = await f.ports.prepareCompletionProof(identity, withdrawal, f.session);
  const before = f.calls.length;
  f.setChain('0x2');
  await assert.rejects(lease.revalidate());
  assert.deepEqual(f.calls.slice(before).map(call => call.method), ['eth_chainId']);
});

test('maintenance transport denies unsupported methods and malformed parameters before any RPC', async () => {
  const f = fixture();
  for (const [method, params] of [
    ['eth_sendRawTransaction', ['0x1234']],
    ['eth_getBalance', [account, 'latest']],
    ['eth_chainId', ['unexpected']],
    ['eth_getTransactionByHash', ['bad-hash']],
    ['eth_getTransactionCount', [account, '0x10']],
    ['eth_call', [{ to: account, data: '0x' }, '0x10']],
  ] as const) await assert.rejects(async () => f.rpc.noteMaintenanceRead(method, params, f.signal.signal, f.check));
  assert.equal(f.calls.length, 0);
});

test('an aborted or failed maintenance read cannot produce a completion proof', async () => {
  for (const failure of ['abort', 'failure']) {
    const f = fixture();
    f.onRead(method => {
      if (method !== 'eth_getTransactionReceipt') return;
      if (failure === 'abort') f.signal.abort();
      else throw new Error('transport failed');
    });
    await assert.rejects(f.ports.prepareCompletionProof(identity, withdrawal, f.session));
    assert(!f.calls.some(call => call.method === 'eth_getTransactionByHash'));
  }
});
test('native maintenance refuses unknown attempts, revoked sessions and aborts without additional RPC', async () => {
  const f = fixture();
  await assert.rejects(f.ports.prepareCompletionProof(identity, { ...withdrawal, phase: 'unknown' }, f.session));
  assert.equal(f.calls.length, 0); f.setCurrent(false);
  await assert.rejects(f.ports.prepareCompletionProof(identity, withdrawal, f.session)); assert.equal(f.calls.length, 0);
  f.setCurrent(true); f.signal.abort();
  await assert.rejects(f.ports.prepareCompletionProof(identity, withdrawal, f.session)); assert.equal(f.calls.length, 0);
});
