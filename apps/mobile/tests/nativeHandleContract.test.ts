import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyNativeHandleContract } from '../qualification/native-handle-contract.ts';

function fixture() {
  let closes = 0;
  class Key { constructor() { throw Error('native-only key'); } }
  class Context {
    constructor() { throw Error('native-only context'); }
    importKey(kind: string, usages: string[], bytes: Uint8Array): object {
      assert.equal(kind, 'AES-GCM');
      assert.deepEqual(usages, ['encrypt']);
      assert.equal(bytes.length, 32);
      return Object.create(Key.prototype);
    }
    close() { closes++; }
  }
  return {
    module: { Key, Context, createContext: (): Context => Object.create(Context.prototype) },
    closes: () => closes,
  };
}

test('native handle contract requires rejecting constructors and factory-created class instances', () => {
  const f = fixture();
  qualifyNativeHandleContract(f.module);
  assert.equal(f.closes(), 1);
});

test('either directly constructible handle fails before the native factory runs', () => {
  for (const name of ['Key', 'Context'] as const) {
    const f = fixture();
    assert.throws(() => qualifyNativeHandleContract({
      ...f.module, [name]: class {}, createContext: () => { throw Error('factory must not run'); },
    }), /QUALIFICATION_NATIVE_HANDLE_CONSTRUCTION_ALLOWED/);
    assert.equal(f.closes(), 0);
  }
});

test('missing classes cannot pass by merely throwing on an invalid construct call', () => {
  const f = fixture();
  for (const value of [undefined, {}, () => undefined]) {
    assert.throws(() => qualifyNativeHandleContract({ ...f.module, Key: value }),
      /QUALIFICATION_NATIVE_HANDLE_CLASSES_MISSING/);
  }
});

test('factory class mismatch fails qualification and closes the created context', () => {
  const f = fixture();
  const context = f.module.createContext();
  context.importKey = () => ({});
  assert.throws(() => qualifyNativeHandleContract({ ...f.module, createContext: () => context }),
    /QUALIFICATION_NATIVE_KEY_CLASS_MISMATCH/);
  assert.equal(f.closes(), 1);
  let invalidContextClosed = false;
  assert.throws(() => qualifyNativeHandleContract({ ...f.module, createContext: () => ({
    importKey: () => ({}), close: () => { invalidContextClosed = true; },
  }) }), /QUALIFICATION_NATIVE_CONTEXT_CLASS_MISMATCH/);
  assert(invalidContextClosed);
});
