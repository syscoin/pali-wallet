import { Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import {
  LiveSmartAccountGuard,
  LIVE_SA_CHAIN_ID,
  LIVE_SA_ENTRYPOINT,
  LIVE_SA_GUARDIAN_MODULE,
  LIVE_SA_MAX_FEE_WEI,
  LIVE_SA_MAX_PREFUND_WEI,
} from '../../e2e/harness/liveSmartAccountGuard';
import {
  PALI_ENTRYPOINT_V09_ABI,
  PALI_GUARDIAN_RECOVERY_MODULE_ABI,
} from '../../source/utils/smartAccount/contracts';
import {
  PALI_CANONICAL_ENTRYPOINT_ADDRESS,
  PALI_MODULE_CANONICAL_ADDRESSES,
} from '../../source/utils/smartAccount/deployment';

// Public deterministic offline fixtures only. Never fund these test keys.
const payer = new Wallet(`0x${'11'.repeat(32)}`);
const secondPayer = new Wallet(`0x${'22'.repeat(32)}`);
const foreignPayer = new Wallet(`0x${'33'.repeat(32)}`);
const SA = `0x${'aa'.repeat(20)}`;
const FOREIGN = `0x${'bb'.repeat(20)}`;
const ZERO = `0x${'00'.repeat(32)}`;
const entryPoint = new Interface(PALI_ENTRYPOINT_V09_ABI);
const recovery = new Interface(PALI_GUARDIAN_RECOVERY_MODULE_ABI);

const newGuard = (options: Record<string, unknown> = {}) => {
  const guard = new LiveSmartAccountGuard({
    payers: [
      { address: payer.address, nextNonce: 0 },
      { address: secondPayer.address, nextNonce: 0 },
    ],
    ...options,
  });
  guard.addSmartAccount(SA);
  return guard;
};

const raw = (overrides: Record<string, unknown> = {}, wallet = payer) =>
  wallet.signTransaction({
    chainId: LIVE_SA_CHAIN_ID,
    data: '0x',
    gasLimit: BigInt(21000),
    maxFeePerGas: BigInt(1),
    maxPriorityFeePerGas: BigInt(0),
    nonce: 0,
    to: SA,
    type: 2,
    value: BigInt(1),
    ...overrides,
  });

const userOp = (sender = SA) => ({
  accountGasLimits: ZERO,
  callData: '0x1234',
  gasFees: ZERO,
  initCode: '0x',
  nonce: BigInt(7),
  paymasterAndData: '0x',
  preVerificationGas: BigInt(130000),
  sender,
  signature: '0x5678',
});
const handleOps = (ops = [userOp()], beneficiary = payer.address) =>
  entryPoint.encodeFunctionData('handleOps', [ops, beneficiary]);
const guardianCall = (operation: string, account = SA) =>
  recovery.encodeFunctionData(operation, [
    account,
    ZERO,
    ZERO,
    '0x1234',
    ...(operation === 'scheduleRecovery'
      ? [[{ guardian: payer.address, signature: '0x5678' }]]
      : []),
  ]);

describe('pure live smart-account QA publication guard', () => {
  it('pins only the current source testnet contracts and fixed chain', () => {
    expect(LIVE_SA_CHAIN_ID.toString()).toBe('57057');
    expect(LIVE_SA_ENTRYPOINT.toLowerCase()).toBe(
      PALI_CANONICAL_ENTRYPOINT_ADDRESS.toLowerCase()
    );
    expect(LIVE_SA_GUARDIAN_MODULE.toLowerCase()).toBe(
      PALI_MODULE_CANONICAL_ADDRESSES['guardian-recovery']!.toLowerCase()
    );
  });

  it('reserves a signed own-SA prefund before publication and acknowledges it only once', async () => {
    const guard = newGuard();
    const signed = await raw();
    const intent = guard.reserve(signed);
    expect(intent).toMatchObject({
      chainId: '57057',
      feeUpperBoundWei: '21000',
      from: payer.address.toLowerCase(),
      kind: 'native-prefund',
      nonce: 0,
      to: SA,
      valueWei: '1',
    });
    expect(Object.isFrozen(intent)).toBe(true);
    expect(guard.snapshot()).toMatchObject({
      feeUpperBoundWei: '21000',
      pendingHash: intent.hash,
      prefundWei: '1',
    });
    expect(guard.snapshot().originals[0].status).toBe('reserved');
    expect(() => guard.ack(`0x${'00'.repeat(32)}`)).toThrow('No matching');
    guard.ack(intent.hash);
    expect(guard.snapshot().originals[0].status).toBe('published');
    expect(() => guard.ack(intent.hash)).toThrow('No matching');
  });

  it('allows plain prefunding only for root-listed EOAs and registered fresh SAs', async () => {
    const guard = newGuard();
    const intent = guard.reserve(await raw({ to: secondPayer.address }));
    expect(intent.to).toBe(secondPayer.address.toLowerCase());
    const empty = new LiveSmartAccountGuard({
      payers: [{ address: payer.address, nextNonce: 0 }],
    });
    const unregistered = await raw();
    expect(() => empty.reserve(unregistered)).toThrow('destination');
  });

  it('accepts a legacy fee envelope and reserves its exact gas-price bound', async () => {
    const guard = newGuard();
    const intent = guard.reserve(
      await raw({
        gasPrice: BigInt(2),
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        type: 0,
      })
    );
    expect(intent.type).toBe(0);
    expect(intent.maxFeePerGasWei).toBe('2');
    expect(intent.feeUpperBoundWei).toBe('42000');
  });

  it('permits one UserOperation to a registered SA with zero attached value', async () => {
    const guard = newGuard();
    const intent = guard.reserve(
      await raw({ data: handleOps(), to: LIVE_SA_ENTRYPOINT, value: BigInt(0) })
    );
    expect(intent).toMatchObject({
      account: SA,
      beneficiary: payer.address.toLowerCase(),
      kind: 'handleOps',
      userOperationNonce: '7',
      valueWei: '0',
    });
  });

  it.each(['scheduleRecovery', 'executeRecovery', 'cancelRecovery'])(
    'permits only the registered target for %s',
    async (operation) => {
      const guard = newGuard();
      const intent = guard.reserve(
        await raw({
          data: guardianCall(operation),
          to: LIVE_SA_GUARDIAN_MODULE,
          value: BigInt(0),
        })
      );
      expect(intent).toMatchObject({
        account: SA,
        kind: 'guardian-recovery',
        operation,
      });
    }
  );

  it.each([
    ['wrong chain', { chainId: BigInt(1) }, 'Wrong chain'],
    ['unknown destination', { to: FOREIGN }, 'destination'],
    ['unexpected nonce', { nonce: 9 }, 'nonce'],
    [
      'deployment',
      { to: null, data: '0x1234', value: BigInt(0) },
      'Contract creation',
    ],
    ['non-prefund zero value', { value: BigInt(0) }, 'destination/value'],
    [
      'unknown selector',
      { to: LIVE_SA_ENTRYPOINT, data: '0x12345678', value: BigInt(0) },
      'selector',
    ],
    ['arbitrary own-SA call', { data: '0x1234' }, 'destination'],
    ['zero gas', { gasLimit: BigInt(0) }, 'gas/fee'],
    ['excessive fee', { maxFeePerGas: LIVE_SA_MAX_FEE_WEI }, 'fee bound'],
    [
      'excessive prefund',
      { value: LIVE_SA_MAX_PREFUND_WEI + BigInt(1) },
      'prefund bound',
    ],
  ])(
    'rejects %s without consuming a reservation',
    async (_name, overrides, error) => {
      const guard = newGuard();
      const signed = await raw(overrides as Record<string, unknown>);
      expect(() => guard.reserve(signed)).toThrow(error as string);
      expect(guard.snapshot().originals).toEqual([]);
      expect(guard.reserve(await raw()).nonce).toBe(0);
    }
  );

  it('rejects a signature from an unapproved payer', async () => {
    const guard = newGuard();
    const signed = await raw({}, foreignPayer);
    expect(() => guard.reserve(signed)).toThrow('payer');
    expect(guard.snapshot().originals).toEqual([]);
  });

  it('rejects unsigned and malformed raw bytes', async () => {
    const guard = newGuard();
    expect(() => guard.reserve('0x1234')).toThrow('valid signed');
    const signed = Transaction.from(await raw());
    expect(() => guard.reserve(signed.unsignedSerialized)).toThrow(
      'valid signed'
    );
  });

  it.each([
    ['empty UserOperation list', { data: handleOps([]) }, 'one UserOperation'],
    [
      'multiple UserOperations',
      { data: handleOps([userOp(), userOp()]) },
      'one UserOperation',
    ],
    [
      'unregistered sender',
      { data: handleOps([userOp(FOREIGN)]) },
      'Unapproved',
    ],
    [
      'foreign beneficiary',
      { data: handleOps([userOp()], FOREIGN) },
      'Unapproved',
    ],
    ['attached value', { value: BigInt(1) }, 'attached value'],
    ['trailing ABI bytes', { data: handleOps() + '00' }, 'noncanonical'],
  ])('rejects EntryPoint %s', async (_name, overrides, error) => {
    const guard = newGuard();
    const signed = await raw({
      data: handleOps(),
      to: LIVE_SA_ENTRYPOINT,
      value: BigInt(0),
      ...(overrides as Record<string, unknown>),
    });
    expect(() => guard.reserve(signed)).toThrow(error as string);
  });

  it.each([
    [
      'foreign target',
      { data: guardianCall('scheduleRecovery', FOREIGN) },
      'Unapproved',
    ],
    ['attached value', { value: BigInt(1) }, 'attached value'],
    ['unknown selector', { data: '0x12345678' }, 'selector'],
  ])('rejects recovery %s', async (_name, overrides, error) => {
    const guard = newGuard();
    const signed = await raw({
      data: guardianCall('scheduleRecovery'),
      to: LIVE_SA_GUARDIAN_MODULE,
      value: BigInt(0),
      ...(overrides as Record<string, unknown>),
    });
    expect(() => guard.reserve(signed)).toThrow(error as string);
  });

  it('never allows a second hash for an occupied sender/nonce or a duplicate original hash', async () => {
    const guard = newGuard();
    const signed = await raw();
    const first = guard.reserve(signed);
    guard.ack(first.hash);
    expect(() => guard.reserve(signed)).toThrow('Duplicate');
    const replacement = await raw({ maxFeePerGas: BigInt(2) });
    expect(() => guard.reserve(replacement)).toThrow('Duplicate');
  });

  it('enforces aggregate fee/prefund caps inclusively across acknowledged originals', async () => {
    const guard = newGuard({ maxFeeWei: BigInt(42000) });
    for (const nonce of [0, 1]) {
      const intent = guard.reserve(
        await raw({ nonce, value: LIVE_SA_MAX_PREFUND_WEI / BigInt(2) })
      );
      guard.ack(intent.hash);
    }
    expect(guard.snapshot().feeUpperBoundWei).toBe('42000');
    expect(guard.snapshot().prefundWei).toBe(
      LIVE_SA_MAX_PREFUND_WEI.toString()
    );
    const beyond = await raw({ nonce: 2 });
    expect(() => guard.reserve(beyond)).toThrow('fee bound');

    const prefundGuard = newGuard();
    const maximum = prefundGuard.reserve(
      await raw({ value: LIVE_SA_MAX_PREFUND_WEI })
    );
    prefundGuard.ack(maximum.hash);
    const extra = await raw({ nonce: 1 });
    expect(() => prefundGuard.reserve(extra)).toThrow('prefund bound');
  });

  it('allows only lowered caps and enforces the original-count bound', async () => {
    expect(() => newGuard({ maxOriginals: 61 })).toThrow('bounds');
    expect(() =>
      newGuard({ maxFeeWei: LIVE_SA_MAX_FEE_WEI + BigInt(1) })
    ).toThrow('fee bound');
    expect(() =>
      newGuard({ maxPrefundWei: LIVE_SA_MAX_PREFUND_WEI + BigInt(1) })
    ).toThrow('prefund bound');
    const guard = newGuard({ maxOriginals: 1 });
    const first = guard.reserve(await raw());
    guard.ack(first.hash);
    const second = await raw({ nonce: 1 });
    expect(() => guard.reserve(second)).toThrow('count bound');
  });

  it('blocks all new originals and allowlist changes while publication is unresolved', async () => {
    const guard = newGuard();
    const first = guard.reserve(await raw());
    const next = await raw({ nonce: 1 });
    expect(() => guard.reserve(next)).toThrow('Unresolved publication');
    expect(() => guard.addSmartAccount(FOREIGN)).toThrow('Cannot add');
    guard.markUnknown(first.hash);
    expect(() => guard.ack(first.hash)).toThrow('explicit reconciliation');
    expect(() => guard.reserve(next)).toThrow('Unresolved publication');
    guard.reconcile(first.hash, 'published');
    expect(guard.reserve(next).nonce).toBe(1);
  });

  it('retains reservation/budgets and stops a payer after an explicit not-published reconciliation', async () => {
    const guard = newGuard();
    const first = guard.reserve(await raw());
    guard.markUnknown(first.hash);
    guard.reconcile(first.hash, 'not-published');
    expect(guard.snapshot()).toMatchObject({
      feeUpperBoundWei: '21000',
      pendingHash: null,
      prefundWei: '1',
      stoppedPayers: [payer.address.toLowerCase()],
    });
    const next = await raw({ nonce: 1 });
    expect(() => guard.reserve(next)).toThrow('stopped payer');
    const other = guard.reserve(await raw({}, secondPayer));
    guard.ack(other.hash);
    expect(guard.snapshot().originals.map((row) => row.status)).toEqual([
      'not-published',
      'published',
    ]);
    expect(guard.snapshot().feeUpperBoundWei).toBe('42000');
  });

  it('does not let returned snapshots mutate the occupied ledger', async () => {
    const guard = newGuard();
    const first = guard.reserve(await raw());
    const snapshot = guard.snapshot();
    snapshot.originals[0].status = 'published';
    snapshot.originals.length = 0;
    expect(guard.snapshot().originals[0].status).toBe('reserved');
    expect(guard.snapshot().pendingHash).toBe(first.hash);
  });
});
