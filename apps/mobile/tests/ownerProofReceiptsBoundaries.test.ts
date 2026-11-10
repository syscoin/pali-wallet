import assert from 'node:assert/strict';
import test from 'node:test';
import { TypedDataEncoder } from 'ethers/hash';
import { computeAddress } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import type { ISmartAccountMetadata } from '../../../source/types/network.ts';
import { encodeEcdsaValidatorInitData } from '../../../source/utils/smartAccount/account.ts';
import { getSmartAccountSigningPlan } from '../../../source/utils/smartAccount/authenticatorDispatch.ts';
import {
  assertSmartAccountOwnerSigningIntent,
  createSmartAccountTypedSigningIntent,
  type SmartAccountOwnerSigningIntent,
} from '../../../source/utils/smartAccount/ownerSigningIntent.ts';
import {
  NativeOwnerProofReceipts,
  type NativeOwnerProofCapture,
  type NativeOwnerProofHandle,
  type NativeOwnerProofIdentity,
  type NativeOwnerProofRequest,
} from '../src/smartAccount/ownerProofReceipts.ts';

const validator = '0x1111111111111111111111111111111111111111';
const account = '0x2222222222222222222222222222222222222222';
const otherHash = '0x' + 'ab'.repeat(32);
const noop = () => {};

function fixture() {
  const wallets = [new Wallet('0x' + '31'.repeat(32)), new Wallet('0x' + '42'.repeat(32))];
  const owners: NativeOwnerProofIdentity[] = wallets.map((wallet, id) => ({
    id,
    type: 'Trezor',
    address: wallet.address,
    publicKey: wallet.signingKey.publicKey,
  }));
  const data = encodeEcdsaValidatorInitData(owners.map(owner => owner.address), 2);
  const metadata: ISmartAccountMetadata = {
    chainId: 1,
    contractVersion: '1',
    deploymentSalt: '0x' + '00'.repeat(32),
    isDeployed: true,
    auth: { module: 'ecdsa', validator, data },
    installedModules: [{
      type: 'validator', id: 'ecdsa', address: validator, data,
      config: { owners: owners.map(owner => owner.address), threshold: 2 },
    }],
  };
  const plan = getSmartAccountSigningPlan(metadata, {
    ecdsa: owners,
    p256WebAuthn: false,
    slhDsa: false,
  });
  assert(plan, 'The actual shared plan must select both configured ECDSA owners');
  assert.deepEqual(plan.authenticators[0]!.owners, owners.map(({ id, type, address }) => ({ id, type, address })));
  const domain = { name: 'Pali owner proof boundary fixture', version: '1', chainId: 1, verifyingContract: account };
  const types = { Operation: [{ name: 'account', type: 'address' }, { name: 'nonce', type: 'uint256' }] };
  const message = { account, nonce: 7 };
  const intent = createSmartAccountTypedSigningIntent('user-operation', { domain, types, message }, TypedDataEncoder.hash(domain, types, message));
  let now = 1000, live = true, afterClock: (() => void) | undefined;
  const guard = () => { if (!live) throw Error('Fixture owner retired'); };
  const receipts = new NativeOwnerProofReceipts({ now: () => { afterClock?.(); return now; } });
  const input: NativeOwnerProofCapture = { binding: 'exact-account-network-wire-policy-and-owner-plan', intent, plan, owners, expiresAt: 2000 };
  const captured = receipts.capture(input, guard);
  const requests = captured.steps.map(step => ({ binding: input.binding, intent, step }));
  const signatures = wallets.map(wallet => wallet.signingKey.sign(intent.actionHash).serialized);
  const recordFirst = () => receipts.record(captured.handle, requests[0]!, signatures[0]!, guard);
  const retired = () => {
    assert.throws(() => receipts.read(captured.handle, requests[0]!, guard), /retired/);
    assert.throws(() => receipts.record(captured.handle, requests[0]!, signatures[0]!, guard), /retired/);
  };
  return {
    receipts, input, captured, requests, signatures, wallets, owners, intent, guard, recordFirst, retired,
    setClock(value: number) { now = value; },
    setLive(value: boolean) { live = value; },
    afterClock(callback?: () => void) { afterClock = callback; },
  };
}

test('receipt construction requires an explicit clock function without accessors or extra state', () => {
  for (const options of [undefined, null, {}, { now: 1000 }, { now: () => 1000, privateState: 'must not retain' }])
    assert.throws(() => new NativeOwnerProofReceipts(options as never));
  let accessed = 0;
  const accessor = Object.defineProperty({}, 'now', { enumerable: true, get() { accessed++; return () => 1000; } });
  assert.throws(() => new NativeOwnerProofReceipts(accessor as never), /Invalid owner proof receipt data/);
  assert.equal(accessed, 0);
});

test('capture requires a synchronous current-owner guard and rejects asynchronous or invalid clocks', () => {
  const f = fixture();
  for (const guard of [undefined, null, async () => {}, () => false, () => Promise.reject(Error('Rejected async guard'))])
    assert.throws(() => f.receipts.capture(f.input, guard as never));
  for (const now of [undefined, NaN, Infinity, -1, 0.5, '1000', Promise.resolve(1000)]) {
    const receipts = new NativeOwnerProofReceipts({ now: (() => now) as never });
    assert.throws(() => receipts.capture(f.input, noop), /Invalid owner proof clock/);
  }
});

for (const access of ['read', 'record'] as const) test(`${access} rechecks authority after the clock and permanently retires stale receipts`, () => {
  const f = fixture(); f.recordFirst();
  f.afterClock(() => f.setLive(false));
  assert.throws(() => access === 'read'
    ? f.receipts.read(f.captured.handle, f.requests[0]!, f.guard)
    : f.receipts.record(f.captured.handle, f.requests[1]!, f.signatures[1]!, f.guard), /Fixture owner retired/);
  f.afterClock(); f.setLive(true); f.retired();
});

for (const access of ['read', 'record'] as const) test(`${access} rejects a non-synchronous current guard and clears the retained prefix`, () => {
  const f = fixture(); f.recordFirst();
  const asynchronous = async () => {};
  assert.throws(() => access === 'read'
    ? f.receipts.read(f.captured.handle, f.requests[0]!, asynchronous)
    : f.receipts.record(f.captured.handle, f.requests[1]!, f.signatures[1]!, asynchronous), /guard must be synchronous/);
  f.retired();
});

for (const access of ['read', 'record'] as const) test(`${access} cannot release or accept a proof after its final guard synchronously retires the handle`, () => {
  const measured = fixture();
  if (access === 'read') measured.recordFirst();
  let checkpoints = 0;
  const countGuard = () => { measured.guard(); checkpoints++; };
  if (access === 'read') measured.receipts.read(measured.captured.handle, measured.requests[0]!, countGuard);
  else measured.receipts.record(measured.captured.handle, measured.requests[0]!, measured.signatures[0]!, countGuard);
  assert(checkpoints > 0);

  const f = fixture();
  if (access === 'read') f.recordFirst();
  let reached = 0;
  const retireAtFinalGuard = () => {
    f.guard();
    if (++reached === checkpoints) f.receipts.retire(f.captured.handle);
  };
  assert.throws(() => access === 'read'
    ? f.receipts.read(f.captured.handle, f.requests[0]!, retireAtFinalGuard)
    : f.receipts.record(f.captured.handle, f.requests[0]!, f.signatures[0]!, retireAtFinalGuard), /retired/);
  assert.equal(reached, checkpoints);
  f.retired();
});

test('a changed exact binding retires completed owner proofs instead of returning or extending them', () => {
  const f = fixture(); f.recordFirst();
  assert.throws(() => f.receipts.read(f.captured.handle, { ...f.requests[0]!, binding: f.input.binding + ':changed-policy' }, f.guard), /context changed/);
  f.retired();
});

test('a valid changed signing purpose with the same action hash cannot reuse a proof', () => {
  const f = fixture(); f.recordFirst();
  const intent: SmartAccountOwnerSigningIntent = { ...f.intent, purpose: 'erc7739-typed-data' };
  assertSmartAccountOwnerSigningIntent(intent);
  assert.equal(intent.actionHash, f.intent.actionHash);
  assert.throws(() => f.receipts.read(f.captured.handle, { ...f.requests[0]!, intent }, f.guard), /context changed/);
  f.retired();
});

test('a valid changed typed-data wire payload with an identical digest cannot reuse a proof', () => {
  const f = fixture(); f.recordFirst();
  assert.equal(f.intent.representation, 'eip712');
  if (f.intent.representation !== 'eip712') return;
  const intent: SmartAccountOwnerSigningIntent = {
    ...f.intent,
    typedData: { ...f.intent.typedData, message: { ...f.intent.typedData.message, nonce: '0x7' } },
  };
  assertSmartAccountOwnerSigningIntent(intent);
  assert.equal(intent.actionHash, f.intent.actionHash);
  assert.throws(() => f.receipts.read(f.captured.handle, { ...f.requests[0]!, intent }, f.guard), /context changed/);
  f.retired();
});

test('expiry at the original deadline retires a handle permanently even if the clock later moves back', () => {
  const f = fixture(); f.recordFirst(); f.setClock(f.captured.expiresAt);
  assert.throws(() => f.receipts.read(f.captured.handle, f.requests[0]!, f.guard), /expired/);
  f.setClock(1000); f.retired();
  const fresh = f.receipts.capture(f.input, f.guard);
  assert.notEqual(fresh.handle, f.captured.handle);
  assert.equal(f.receipts.read(fresh.handle, { ...f.requests[0]!, step: fresh.steps[0]! }, f.guard), null);
});

test('explicit retirement is idempotent and cannot be undone by a new capture or a copied opaque handle', () => {
  const f = fixture(); f.recordFirst();
  f.receipts.retire(f.captured.handle); f.receipts.retire(f.captured.handle); f.retired();
  const next = f.receipts.capture(f.input, f.guard);
  assert.notEqual(next.handle, f.captured.handle); f.retired();
  const copied = JSON.parse(JSON.stringify(next.handle)) as NativeOwnerProofHandle;
  assert.throws(() => f.receipts.read(copied, f.requests[0]!, f.guard), /retired/);
  assert.equal(f.receipts.read(next.handle, { ...f.requests[0]!, step: next.steps[0]! }, f.guard), null);
});

test('expired capture input cannot mint a fresh handle by reusing an earlier clock snapshot', () => {
  const f = fixture(); f.setClock(f.input.expiresAt);
  assert.throws(() => f.receipts.capture(f.input, f.guard), /expired/);
});

const invalidSignatures = [
  ['empty bytes', () => '0x'],
  ['truncated wire bytes', (f: ReturnType<typeof fixture>) => f.signatures[1]!.slice(0, -2)],
  ['all-zero wire bytes', () => '0x' + '00'.repeat(65)],
  ['a different action hash', (f: ReturnType<typeof fixture>) => f.wallets[1]!.signingKey.sign(otherHash).serialized],
  ['a different signing owner', (f: ReturnType<typeof fixture>) => f.signatures[0]!],
  ['normalized recovery id', (f: ReturnType<typeof fixture>) => f.signatures[1]!.slice(0, -2) + (f.signatures[1]!.endsWith('1b') ? '00' : '01')],
] as const;
for (const [reason, signature] of invalidSignatures) test(`record refuses ${reason} and destroys the verified prefix`, () => {
  const f = fixture(); f.recordFirst();
  assert.throws(() => f.receipts.record(f.captured.handle, f.requests[1]!, signature(f), f.guard), /signature is invalid/);
  f.retired();
});

test('the next occurrence cannot be requested before its predecessor is verified', () => {
  const f = fixture();
  assert.throws(() => f.receipts.read(f.captured.handle, f.requests[1]!, f.guard), /order changed/);
  f.retired();
});

test('recording the same occurrence again cannot overwrite or renew its existing proof', () => {
  const f = fixture(); f.recordFirst();
  assert.throws(() => f.receipts.record(f.captured.handle, f.requests[0]!, f.signatures[0]!, f.guard), /order changed/);
  f.retired();
});

const changedSteps: readonly [string, (request: NativeOwnerProofRequest, f: ReturnType<typeof fixture>) => NativeOwnerProofRequest][] = [
  ['ordinal', request => ({ ...request, step: { ...request.step, ordinal: request.step.ordinal + 1 } })],
  ['validator', request => ({ ...request, step: { ...request.step, validator: account } })],
  ['child position', request => ({ ...request, step: { ...request.step, childIndex: request.step.childIndex + 1 } })],
  ['owner type', request => ({ ...request, step: { ...request.step, owner: { ...request.step.owner, type: 'Ledger' } } })],
  ['owner id', request => ({ ...request, step: { ...request.step, owner: { ...request.step.owner, id: 99 } } })],
  ['owner address', (request, f) => ({ ...request, step: { ...request.step, owner: { ...request.step.owner, address: f.owners[1]!.address } } })],
  ['owner public key', (request, f) => ({ ...request, step: { ...request.step, owner: { ...request.step.owner, publicKey: f.owners[1]!.publicKey } } })],
];
for (const [field, change] of changedSteps) test(`a changed ${field} cannot select a retained occurrence`, () => {
  const f = fixture(); f.recordFirst();
  assert.throws(() => f.receipts.read(f.captured.handle, change(f.requests[0]!, f), f.guard), /context changed|public key does not match owner/);
  f.retired();
});

test('capture rejects another wallet’s valid compressed public key for an unchanged claimed owner', () => {
  const f = fixture();
  const publicKey = f.wallets[1]!.signingKey.compressedPublicKey;
  assert.equal(computeAddress(publicKey), f.owners[1]!.address);
  assert.notEqual(computeAddress(publicKey), f.owners[0]!.address);
  const owners = [{ ...f.owners[0]!, publicKey }, f.owners[1]!];
  assert.throws(() => f.receipts.capture({ ...f.input, owners }, f.guard), /public key does not match owner/);
});

test('capture rejects a correctly sized compressed encoding that is not a curve point', () => {
  const f = fixture();
  const publicKey = '0x02' + 'ff'.repeat(32);
  assert.throws(() => computeAddress(publicKey));
  const owners = [{ ...f.owners[0]!, publicKey }, f.owners[1]!];
  assert.throws(() => f.receipts.capture({ ...f.input, owners }, f.guard));
});

test('capture rejects accessor and private-extra fields without invoking accessors', () => {
  const f = fixture(); let reads = 0;
  const capture = Object.defineProperty({ ...f.input }, 'intent', { enumerable: true, get() { reads++; return f.intent; } });
  assert.throws(() => f.receipts.capture(capture, f.guard), /Invalid owner proof receipt data/);
  assert.equal(reads, 0);
  assert.throws(() => f.receipts.capture({ ...f.input, privateKey: 'must not retain' } as NativeOwnerProofCapture, f.guard), /Invalid owner proof receipt data/);
  assert.throws(() => f.receipts.capture({ ...f.input, owners: [{ ...f.owners[0]!, privateKey: 'must not retain' }, f.owners[1]!] } as NativeOwnerProofCapture, f.guard), /Invalid owner proof receipt data/);
  const intent = Object.defineProperty({ ...f.intent }, 'actionHash', { enumerable: true, get() { reads++; return f.intent.actionHash; } });
  assert.throws(() => f.receipts.capture({ ...f.input, intent }, f.guard), /accessor/);
  assert.equal(reads, 0);
});

test('unexpected request fields or identity accessors retire a handle without evaluating private data', () => {
  for (const accessor of [false, true]) {
    const f = fixture(); f.recordFirst(); let reads = 0;
    const request = accessor
      ? { ...f.requests[0]!, step: { ...f.requests[0]!.step, owner: Object.defineProperty({ ...f.owners[0]! }, 'publicKey', { enumerable: true, get() { reads++; return f.owners[0]!.publicKey; } }) } }
      : { ...f.requests[0]!, privateContext: 'must not retain' };
    assert.throws(() => f.receipts.read(f.captured.handle, request, f.guard), /Invalid owner proof receipt data/);
    assert.equal(reads, 0); f.retired();
  }
});
