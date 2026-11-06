import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSLHDSAProvisionedState,
  createSlhDsaStateStore,
  type SlhDsaStateStorage,
} from '../../../source/wallet/slhDsaState.ts';

test('shared SLH state round trips directly without browser globals or a module resolver', async () => {
  assert.equal(typeof (globalThis as { chrome?: unknown }).chrome, 'undefined');
  const rows = new Map<string, unknown>();
  let current = true;
  const assertOwner = () => {
    if (!current) throw new Error('retired owner');
  };
  const read: SlhDsaStateStorage['read'] = async (key) =>
    rows.has(key)
      ? { present: true, value: rows.get(key) }
      : { present: false };
  const store = createSlhDsaStateStore({
    read,
    async mutate(owner, run) {
      owner();
      const result = await run({
        read,
        async write(key, value) {
          rows.set(key, structuredClone(value));
        },
        async remove(key) {
          rows.delete(key);
        },
      });
      owner();
      return result;
    },
  });
  // Public fixture codec only. Native encryption has a separate qualification.
  const crypto = {
    async encrypt(value: string, keyId: string) {
      return JSON.stringify({ keyId, value });
    },
    async decrypt(envelope: string, keyId: string) {
      const parsed = JSON.parse(envelope);
      assert.equal(parsed.keyId, keyId);
      return parsed.value;
    },
  };
  const state = createSLHDSAProvisionedState({
    keyId: 'public-node-fixture',
    accountIndex: 0,
    derivationLabel: 'public fixture',
    pkRoot: '0x' + '11'.repeat(16),
    pkSeed: '0x' + '22'.repeat(16),
    secretKeyHex: '0x' + '33'.repeat(64),
  });
  state.signatureCount = 7;
  await store.save(state, crypto, assertOwner);
  assert.deepEqual(
    await store.load({ crypto, keyId: state.keyId, assertOwner }),
    state
  );
  const retained = structuredClone([...rows]);
  current = false;
  await assert.rejects(
    store.save({ ...state, signatureCount: 8 }, crypto, assertOwner),
    /retired owner/
  );
  await assert.rejects(
    store.load({ crypto, keyId: state.keyId, assertOwner }),
    /retired owner/
  );
  assert.deepEqual([...rows], retained);
  current = true;
  await store.remove(state.keyId, assertOwner);
  assert.equal(
    await store.load({ crypto, keyId: state.keyId, assertOwner }),
    null
  );
});
