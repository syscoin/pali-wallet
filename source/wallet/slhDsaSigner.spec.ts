import {
  getSLHDSAKeyId,
  SLH_DSA_PARAMETER_SET,
} from '../utils/slhDsa/constants';

import { createSlhDsaSigner, type SlhDsaExecution } from './slhDsaSigner';
import {
  createSLHDSAProvisionedState,
  createSlhDsaStateStore,
  type SlhDsaStateStorage,
} from './slhDsaState';

const publicKey = {
  pkSeed: `0x${'11'.repeat(16)}${'00'.repeat(16)}`,
  pkRoot: `0x${'22'.repeat(16)}${'00'.repeat(16)}`,
  secretKeyHex: `0x${'33'.repeat(64)}`,
};
const keyId = getSLHDSAKeyId(publicKey);
const params = {
  keyId,
  pkRoot: publicKey.pkRoot,
  pkSeed: publicKey.pkSeed,
  parameterSet: SLH_DSA_PARAMETER_SET,
  actionHash: `0x${'44'.repeat(32)}`,
};
const signature = `0x${'55'.repeat(3856)}`;
const crypto = {
  encrypt: (plain: string) => plain,
  decrypt: (cipher: string) => cipher,
};
const state = () =>
  createSLHDSAProvisionedState({
    ...publicKey,
    keyId,
    accountIndex: 0,
    derivationLabel: 'public fixture',
  });

function fixture(
  execution: SlhDsaExecution = {
    prepareKeypair: jest.fn(async () => publicKey),
    signActionHash: jest.fn(async (_request, assertSession) => {
      assertSession();
      return signature;
    }),
  }
) {
  const rows = new Map<string, unknown>();
  const read: SlhDsaStateStorage['read'] = async (key) =>
    rows.has(key)
      ? { present: true, value: rows.get(key) }
      : { present: false };
  const stateStore = createSlhDsaStateStore({
    read,
    mutate: async (assertOwner, run) => {
      assertOwner();
      const result = await run({
        read,
        write: async (key, value) => {
          rows.set(key, structuredClone(value));
        },
        remove: async (key) => {
          rows.delete(key);
        },
      });
      assertOwner();
      return result;
    },
  });
  const signer = createSlhDsaSigner({ stateStore, execution, now: () => 42 });
  return { signer, stateStore, execution };
}

it('isolates runtime state and generation between explicit host instances', async () => {
  const first = fixture(),
    second = fixture();
  for (const { signer } of [first, second]) {
    signer.configureSLHDSASessionStateCrypto(crypto);
    await signer.registerRuntimeSLHDSAState(
      state(),
      signer.getSLHDSASessionGeneration()
    );
  }
  await first.signer.signSLHDSAActionHashLocal(
    params,
    first.signer.getSLHDSASessionGeneration()
  );
  const current = () => undefined;
  expect(
    (await first.stateStore.load({ keyId, crypto, assertOwner: current }))
      ?.signatureCount
  ).toBe(1);
  expect(
    (await second.stateStore.load({ keyId, crypto, assertOwner: current }))
      ?.signatureCount
  ).toBe(0);
  expect(
    (await first.stateStore.load({ keyId, crypto, assertOwner: current }))
      ?.updatedAt
  ).toBe(42);
  first.signer.clearRuntimeSLHDSAStates();
  expect(first.signer.getSLHDSASessionGeneration()).toBe(1);
  expect(second.signer.getSLHDSASessionGeneration()).toBe(0);
  await expect(
    first.signer.signSLHDSAActionHashLocal(params, 0)
  ).rejects.toThrow('session changed');
  await expect(
    second.signer.signSLHDSAActionHashLocal(params, 0)
  ).resolves.toBe(signature);
});

it('requires state crypto configuration before execution', async () => {
  const { signer, execution } = fixture();
  signer.putRuntimeSLHDSAState(state(), 0);
  await expect(signer.signSLHDSAActionHashLocal(params, 0)).rejects.toThrow(
    'encryption is not available'
  );
  expect(execution.signActionHash).not.toHaveBeenCalled();
  await expect(
    signer.registerRuntimeSLHDSAState(state(), undefined as never)
  ).rejects.toThrow('session changed');
});

it('forwards dispatch consent but keeps accounting under the signer session', async () => {
  let approved = true;
  const approval = {
    assertCurrent: () => {
      if (!approved) throw new Error('request retired');
    },
    checkDocument: async () => undefined,
  };
  const sign = jest.fn(async (_request, assertSession, capturedApproval) => {
    expect(capturedApproval).toBe(approval);
    assertSession();
    approved = false;
    return signature;
  });
  const { signer, stateStore } = fixture({
    prepareKeypair: jest.fn(async () => publicKey),
    signActionHash: sign,
  });
  signer.configureSLHDSASessionStateCrypto(crypto);
  await signer.registerRuntimeSLHDSAState(state(), 0);
  await signer.signSLHDSAActionHashLocal(params, 0, approval);
  expect(() => approval.assertCurrent()).toThrow('request retired');
  expect(
    (await stateStore.load({ keyId, crypto, assertOwner: () => undefined }))
      ?.signatureCount
  ).toBe(1);
});
