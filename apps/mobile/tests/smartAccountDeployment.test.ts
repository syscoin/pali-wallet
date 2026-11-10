import { freshSmartOperationDeadline } from './nonSuiteSigningHandoff.ts';
import { createSmartAccountCallsExecutions, normalizeDappCallsRequest } from '../../../source/shared/dappCalls.ts';
import { buildSmartAccountErc20Transfer } from '../../../source/utils/smartAccount/erc20Transfer.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NativeSmartAccountOperation,
  type PreparedSmartAccountOperation,
} from '../src/smartAccount/operation.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import {
  encodeSmartAccountGasLimits,
  encodeSmartAccountGasFees,
} from '../../../source/utils/smartAccount/account.ts';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';

const address = '0x1111111111111111111111111111111111111111';
const hash = '0x' + 'ab'.repeat(32);
const prepared = {
  actionHash: hash,
  userOperation: {
    accountGasLimits: encodeSmartAccountGasLimits({
      callGasLimit: 1,
      verificationGasLimit: 1,
    }),
    gasFees: encodeSmartAccountGasFees({
      maxFeePerGas: 2,
      maxPriorityFeePerGas: 1,
    }),
    preVerificationGas: '1',
    paymasterAndData: '0x',
  },
} as PreparedSmartAccountOperation;
const transaction: PreparedEvmTransaction = {
  chainId: '1',
  from: address,
  to: address,
  nonce: '0',
  value: '0',
  data: '0x',
  gasLimit: '21000',
  type: 2,
  maxFeePerGas: '2',
  maxPriorityFeePerGas: '1',
  accessList: [],
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(authorizationExpiresAt = freshSmartOperationDeadline()) {
  let current = true,
    now = 0,
    signed = 0,
    submitted = 0,
    authorizePayer = 0,
    prepares = 0;
  let held: Promise<void> | undefined;
  const model = new NativeSmartAccountOperation(
    { background() {}, authorizationExpiresAt,
      account: address,
      intent: { kind: 'deploy' },
      network: getNativeNetwork('ethereum'),
      assertCurrent() {
        assert(current, 'owner changed');
      },
      async prepare() {
        prepares++;
        await held;
        return { kind: 'authorization', intent: { kind: 'deploy' }, operation: prepared };
      },
      async sign(value) {
        assert.equal(value, prepared);
        signed++;
        return '0xsignature';
      },
      async submit(value, signature, signal, guard, review, onBroadcast) {
        assert.equal(value, prepared);
        assert.equal(signature, '0xsignature');
        guard();
        await review(
          {
            purpose: 'submit-operation',
            transaction,
            coveredFeeUnits: '0', maximumFeeUnits: '42000',
            maximumTotalUnits: '42000',
          },
          () => {
            authorizePayer++;
          }
        );
        assert.equal(signal.aborted, false);
        guard();
        submitted++;
        onBroadcast(hash, 'submit-operation');
        return hash;
      },
    },
    () => now
  );
  return {
    model,
    counts: () => ({ signed, submitted, authorizePayer, prepares }),
    revoke() {
      current = false;
    },
    advance() {
      now = 1_000_000;
    },
    hold(value: Promise<void>) {
      held = value;
    },
  };
}

test('deployment requires separate exact UserOperation and payer approvals', async () => {
  const f = fixture();
  try {
    await f.model.prepare();
    assert.equal(f.model.getSnapshot().phase, 'authorize');
    assert.equal(f.model.getSnapshot().maximumPrefundUnits, '6');
    assert.deepEqual(f.counts(), {
      signed: 0,
      submitted: 0,
      authorizePayer: 0,
      prepares: 1,
    });
    await f.model.authorize(-1);
    assert.equal(f.counts().signed, 0);
    const sending = f.model.authorize(f.model.getSnapshot().revision);
    await flush();
    assert.equal(f.model.getSnapshot().phase, 'review-fee');
    assert.equal(f.model.getSnapshot().userOperationSubmissionStarted, false);
    assert.equal(f.counts().signed, 1);
    assert.equal(f.counts().submitted, 0);
    f.model.confirmPayer(-1);
    assert.equal(f.counts().authorizePayer, 0);
    f.model.confirmPayer(f.model.getSnapshot().payerReview!.id);
    await sending;
    assert.equal(f.model.getSnapshot().phase, 'complete');
    assert.equal(f.model.getSnapshot().transactionHash, hash);
    assert.equal(f.model.getSnapshot().userOperationSubmissionStarted, true);
    assert.deepEqual(f.counts(), {
      signed: 1,
      submitted: 1,
      authorizePayer: 1,
      prepares: 1,
    });
  } finally {
    f.model.dispose();
  }
});

for (const event of ['lock', 'expiry', 'cancel'] as const)
  test(`${event} retires payer review without signing a replacement`, async () => {
    const f = fixture();
    try {
      await f.model.prepare();
      const sending = f.model.authorize(f.model.getSnapshot().revision);
      await flush();
      const id = f.model.getSnapshot().payerReview!.id;
      if (event === 'lock') f.revoke();
      else if (event === 'expiry') f.advance();
      else f.model.cancel();
      f.model.confirmPayer(id);
      await sending;
      assert.equal(f.model.getSnapshot().phase, 'failed');
      assert.match(
        f.model.getSnapshot().error!,
        /Check the account and Activity/
      );
      assert.equal(f.counts().signed, 1);
      assert.equal(f.counts().submitted, 0);
      await f.model.authorize(f.model.getSnapshot().revision);
      assert.equal(f.counts().signed, 1);
    } finally {
      f.model.dispose();
    }
  });

test('preparation admission prevents duplicate work and ignores completion after dispose', async () => {
  const f = fixture();
  let release!: () => void;
  f.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  const first = f.model.prepare();
  await f.model.prepare();
  assert.equal(f.counts().prepares, 1);
  f.model.dispose();
  release();
  await first;
  assert.equal(f.counts().signed, 0);
  assert.equal(f.model.getSnapshot().phase, 'preparing');
});

for (const event of ['cancel', 'expiry'] as const)
  test(`a late broadcast acknowledgement preserves ${event} while recording the hash`, async (context) => {
    if (event === 'expiry')
      context.mock.timers.enable({ apis: ['setTimeout'] });
    let clock = 0;
    let broadcast: ((value: string, purpose: 'submit-operation') => void) | undefined;
    let finish: (() => void) | undefined;
    const model = new NativeSmartAccountOperation(
      { background() {}, authorizationExpiresAt: freshSmartOperationDeadline(),
        account: address,
      intent: { kind: 'deploy' },
        network: getNativeNetwork('ethereum'),
        assertCurrent() {},
        async prepare() {
          return { kind: 'authorization', intent: { kind: 'deploy' }, operation: prepared };
        },
        async sign() {
          return '0xsignature';
        },
        async submit(
          _prepared,
          _signature,
          _signal,
          _guard,
          _review,
          onBroadcast
        ) {
          broadcast = onBroadcast;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return hash;
        },
      },
      () => clock
    );
    try {
      await model.prepare();
      const sending = model.authorize(model.getSnapshot().revision);
      await flush();
      assert(broadcast);
      if (event === 'expiry') {
        clock = 1_000_000;
        context.mock.timers.tick(15 * 60 * 1000);
      } else {
        model.cancel();
      }
      assert.equal(model.getSnapshot().phase, 'failed');
      broadcast(hash, 'submit-operation');
      assert.equal(model.getSnapshot().phase, 'failed');
      assert.equal(model.getSnapshot().transactionHash, hash);
      finish!();
      await sending;
      assert.equal(model.getSnapshot().phase, 'failed');
    } finally {
      finish?.();
      model.dispose();
    }
  });


test('native MAX cannot authorize a self-consistent ERC20 operation returned by its host', async () => {
  const recipient = '0x2222222222222222222222222222222222222222';
  const token = { contractAddress: '0x5555555555555555555555555555555555555555', decimals: 18, name: 'Token', symbol: 'TKN' };
  const execution = { ...buildSmartAccountErc20Transfer(token.contractAddress, recipient, '1'), nonce: '0' };
  let signed = 0;
  const model = new NativeSmartAccountOperation({ background() {}, authorizationExpiresAt: freshSmartOperationDeadline(),
    account: address, network: getNativeNetwork('ethereum'), intent: { kind: 'native-max', recipient }, assertCurrent() {},
    async prepare() { return { kind: 'authorization', intent: { kind: 'erc20-transfer', token, recipient, amountUnits: '1' },
      operation: { ...prepared, execution, executions: [execution] } }; },
    async sign() { signed++; return '0x'; }, async submit() { return hash; },
  });
  try {
    await model.prepare();
    assert.equal(model.getSnapshot().phase, 'failed');
    await model.authorize(model.getSnapshot().revision);
    assert.equal(signed, 0);
  } finally { model.dispose(); }
});


for (const cancel of [false, true]) test(`pending Smart preparation remains cancellable (${cancel ? 'cancel' : 'resume'})`, async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let waiting = true, preparations = 0, signatures = 0;
  const model = new NativeSmartAccountOperation({ background() {}, authorizationExpiresAt: freshSmartOperationDeadline(),
    account: address, intent: { kind: 'deploy' }, network: getNativeNetwork('ethereum'), assertCurrent() {},
    async prepare() {
      preparations++;
      if (waiting) throw new Error('SMART_ACCOUNT_PENDING_STATE');
      return { kind: 'authorization', intent: { kind: 'deploy' }, operation: prepared };
    },
    async sign() { signatures++; return '0x1234'; },
    async submit() { return hash; },
  });
  try {
    const opening = model.prepare(); await flush();
    assert.equal(model.getSnapshot().phase, 'preparing');
    assert.match(model.getSnapshot().error!, /earlier pending operation/);
    assert.equal(preparations, 1); assert.equal(signatures, 0);
    if (cancel) model.dispose();
    else { waiting = false; context.mock.timers.tick(2000); }
    await opening;
    assert.equal(signatures, 0);
    assert.equal(preparations, cancel ? 1 : 2);
    if (!cancel) assert.equal(model.getSnapshot().phase, 'authorize');
  } finally { model.dispose(); }
});


for (const change of ['order', 'value', 'data']) test(`Smart batch review refuses changed ${change} before authorization`, async () => {
  const intent = { kind: 'dapp-batch' as const, calls: normalizeDappCallsRequest({ version: '2.0.0', calls: [
    { to: address, value: '0x1', data: '0x1234' }, { to: '0x' + '22'.repeat(20), value: '0x2', data: '0x5678' },
  ] }).calls };
  const executions = createSmartAccountCallsExecutions(intent.calls).map(value => ({ ...value, nonce: '0' }));
  if (change === 'order') executions.reverse();
  if (change === 'value') executions[0]!.value = '0x3';
  if (change === 'data') executions[0]!.data = '0xabcd';
  let signed = 0;
  const model = new NativeSmartAccountOperation({ background() {}, authorizationExpiresAt: freshSmartOperationDeadline(), account: address, intent, network: getNativeNetwork('ethereum'), assertCurrent() {},
    async prepare() { return { kind: 'authorization', intent, operation: { ...prepared, executions } }; },
    async sign() { signed++; return '0x'; }, async submit() { throw new Error('No submit'); },
  });
  try { await model.prepare(); assert.equal(model.getSnapshot().phase, 'failed'); assert.equal(signed, 0); }
  finally { model.dispose(); }
});


test('a rebuilt Smart operation cannot renew its original absolute authorization deadline',async()=>{
  const now=Date.now;let clock=now();Date.now=()=>clock;
  const deadline=clock+60000;let f:ReturnType<typeof fixture>|undefined;
  try{
    f=fixture(deadline);assert.equal(f.model.authorizationExpiresAt,deadline);await f.model.dispose();
    clock+=45000;f=fixture(deadline);assert.equal(f.model.authorizationExpiresAt,deadline);await f.model.prepare();
    clock=deadline+1;await f.model.authorize(f.model.getSnapshot().revision);assert.equal(f.counts().signed,0);
    assert.throws(()=>fixture(deadline),/SMART_OPERATION_EXPIRED/);
  }finally{Date.now=now;await f?.model.dispose();}
});
