jest.mock('../utils/slhDsa/derivation', () => ({
  deriveSLHDSASeedMaterial: jest.fn(async () => ({
    seed48Hex: `0x${'11'.repeat(16)}${'22'.repeat(16)}${'33'.repeat(16)}`,
  })),
}));

import {
  getSLHDSAKeyId,
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LENGTH,
  SLH_DSA_XMSS_TREE_CACHE_LENGTH,
} from '../utils/slhDsa/constants';
import { bytesToHex, normalizeSLHDSAPublicKeyField } from '../utils/slhDsa/hex';

import {
  createSlhDsaExecution,
  type SlhDsaExecutionHost,
} from './slhDsaExecution';
import { createSlhDsaSigner } from './slhDsaSigner';
import { createSlhDsaStateStore, type SlhDsaStateStorage } from './slhDsaState';
import type { SLHDSAProvisionedState } from '../utils/slhDsa/types';

type Tree = { id: number; root: Uint8Array };
type Host = {
  -readonly [K in keyof SlhDsaExecutionHost<
    Tree,
    Uint8Array
  >]: SlhDsaExecutionHost<Tree, Uint8Array>[K];
};
const fields = {
  pkSeed: normalizeSLHDSAPublicKeyField(`0x${'33'.repeat(16)}`),
  pkRoot: normalizeSLHDSAPublicKeyField(`0x${'44'.repeat(16)}`),
};
const payload = () => ({
  ...fields,
  keyId: getSLHDSAKeyId(fields),
  actionHash: `0x${'aa'.repeat(32)}`,
  secretKeyHex: `0x${'11'.repeat(16)}${'22'.repeat(16)}${'33'.repeat(
    16
  )}${'44'.repeat(16)}`,
});
const gate = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const shard = (index: number) => ({
  treeIndex: index,
  shard: new Uint8Array([
    ...new Uint8Array(400).fill(index),
    ...new Uint8Array(16).fill(index + 32),
  ]),
});

function fixture() {
  let current = true;
  let id = 0;
  const keys: Uint8Array[] = [];
  const inputKeys: Uint8Array[] = [];
  const temporary: Uint8Array[] = [];
  const seedInputs: Uint8Array[] = [];
  const chunks: { count: number; level: number; start: number }[] = [];
  const released: { erase: boolean; tree: Tree }[] = [];
  const tree = { id: ++id, root: new Uint8Array(16).fill(0x44) };
  const setupDispose = jest.fn();
  const check = () => {
    if (!current) throw new Error('revoked');
  };
  const host: jest.Mocked<Host> = {
    leafConcurrency: 1,
    forsConcurrency: 6,
    allocateTree: jest.fn(() => ({
      id: ++id,
      root: new Uint8Array(16).fill(0x44),
    })),
    releaseTree: jest.fn((releasedTree: Tree, erase: boolean) => {
      released.push({ tree: releasedTree, erase });
    }),
    readTree: jest.fn((cachedTree: Tree, offset: number, length: number) => {
      expect(offset).toBe(SLH_DSA_XMSS_TREE_CACHE_LENGTH - 16);
      expect(length).toBe(16);
      return cachedTree.root.slice();
    }),
    writeTree: jest.fn(),
    loadTree: jest.fn(async (keyId: string) => ({
      tree,
      keyId,
      bytes: SLH_DSA_XMSS_TREE_CACHE_LENGTH,
    })),
    saveTree: jest.fn<
      ReturnType<Host['saveTree']>,
      Parameters<Host['saveTree']>
    >(async () => undefined),
    openSetup: jest.fn((seed: Uint8Array) => {
      seedInputs.push(seed);
      return {
        buildChunk(_tree: Tree, level: number, start: number, count: number) {
          chunks.push({ level, start, count });
          return count;
        },
        dispose: setupDispose,
      };
    }),
    createLeafLanes: jest.fn<
      ReturnType<Host['createLeafLanes']>,
      Parameters<Host['createLeafLanes']>
    >(() => []),
    importKey: jest.fn((bytes: Uint8Array) => {
      inputKeys.push(bytes);
      const key = bytes.slice();
      keys.push(key);
      return key;
    }),
    releaseKey: jest.fn((key: Uint8Array) => {
      key.fill(0);
    }),
    signPrelude: jest.fn(
      (_key: Uint8Array, message: Uint8Array, optrand: Uint8Array) => {
        expect(message).toEqual(
          new Uint8Array([0, 0, ...new Uint8Array(32).fill(0xaa)])
        );
        expect(optrand).toEqual(new Uint8Array(16).fill(0x77));
        temporary.push(message, optrand);
        const prelude = new Uint8Array(46).fill(8);
        temporary.push(prelude);
        return prelude;
      }
    ),
    signForsTree: jest.fn(
      async (key: Uint8Array, _prelude: Uint8Array, index: number) => {
        expect(keys).toContain(key);
        const result = shard(index);
        temporary.push(result.shard);
        return result;
      }
    ),
    finishSignature: jest.fn(
      (
        _key: Uint8Array,
        message: Uint8Array,
        _prelude: Uint8Array,
        signature: Uint8Array,
        roots: Uint8Array,
        cachedTree: Tree
      ) => {
        expect(cachedTree.root).toEqual(new Uint8Array(16).fill(0x44));
        expect(message).toEqual(
          new Uint8Array([0, 0, ...new Uint8Array(32).fill(0xaa)])
        );
        for (let i = 0; i < 6; i++) {
          expect(signature.subarray(i * 400, (i + 1) * 400)).toEqual(
            new Uint8Array(400).fill(i)
          );
          expect(roots.subarray(i * 16, (i + 1) * 16)).toEqual(
            new Uint8Array(16).fill(i + 32)
          );
        }
        const result = new Uint8Array(SLH_DSA_SIGNATURE_LENGTH).fill(9);
        temporary.push(signature, roots, result);
        return result;
      }
    ),
    signCached: jest.fn(
      (
        _key: Uint8Array,
        message: Uint8Array,
        optrand: Uint8Array,
        cachedTree: Tree
      ) => {
        expect(cachedTree.root).toEqual(new Uint8Array(16).fill(0x44));
        expect(message).toEqual(
          new Uint8Array([0, 0, ...new Uint8Array(32).fill(0xaa)])
        );
        expect(optrand).toEqual(new Uint8Array(16).fill(0x77));
        temporary.push(message, optrand);
        const result = new Uint8Array(SLH_DSA_SIGNATURE_LENGTH).fill(7);
        temporary.push(result);
        return result;
      }
    ),
    randomFill: jest.fn((bytes: Uint8Array) => {
      bytes.fill(0x77);
    }),
    yield: jest.fn(async () => undefined),
  };
  const execution = () => createSlhDsaExecution<Tree, Uint8Array>(host);
  return {
    host,
    execution,
    check,
    revoke: () => {
      current = false;
    },
    keys,
    inputKeys,
    temporary,
    seedInputs,
    chunks,
    setupDispose,
    released,
    tree,
  };
}

describe('portable custom SLH execution', () => {
  it('assembles all six exact indexed shards, preserves 3856-byte output and erases owned buffers', async () => {
    const f = fixture();
    const result = await f.execution().signActionHash(payload(), f.check);
    expect(result).toEqual({
      ...fields,
      signature: bytesToHex(new Uint8Array(3856).fill(9)),
    });
    expect(f.host.signForsTree.mock.calls.map((call) => call[2])).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(f.host.finishSignature).toHaveBeenCalledTimes(1);
    expect(f.host.signCached).not.toHaveBeenCalled();
    for (const bytes of [...f.keys, ...f.inputKeys, ...f.temporary])
      expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('keeps successful assembly independent of shard completion order', async () => {
    const f = fixture();
    const pending = Array.from({ length: 6 }, () =>
      gate<ReturnType<typeof shard>>()
    );
    f.host.signForsTree.mockImplementation(
      (_key, _prelude, index) => pending[index].promise
    );
    const signing = f.execution().signActionHash(payload(), f.check);
    await tick();
    for (let i = 5; i >= 0; i--) pending[i].resolve(shard(i));
    expect((await signing).signature).toBe(
      bytesToHex(new Uint8Array(3856).fill(9))
    );
  });

  it('drains every started shard before cached fallback and reuses exactly one optrand', async () => {
    const f = fixture();
    const pending = Array.from({ length: 6 }, () =>
      gate<ReturnType<typeof shard>>()
    );
    f.host.signForsTree.mockImplementation(
      (_key, _prelude, index) => pending[index].promise
    );
    const signing = f.execution().signActionHash(payload(), f.check);
    await tick();
    pending[0].reject(new Error('worker unavailable'));
    await tick();
    expect(f.host.signCached).not.toHaveBeenCalled();
    expect(f.host.releaseKey).not.toHaveBeenCalled();
    for (let i = 1; i < 6; i++) pending[i].resolve(shard(i));
    expect((await signing).signature).toBe(
      bytesToHex(new Uint8Array(3856).fill(7))
    );
    expect(f.host.randomFill).toHaveBeenCalledTimes(1);
    expect(f.host.signCached.mock.calls[0][1]).toBe(
      f.host.signPrelude.mock.calls[0][1]
    );
    expect(f.host.signCached.mock.calls[0][2]).toBe(
      f.host.signPrelude.mock.calls[0][2]
    );
  });

  it.each(['wrong-index', 'short-shard'] as const)(
    'rejects malformed %s before assembly and uses the existing cached path',
    async (fault) => {
      const f = fixture();
      f.host.signForsTree.mockImplementation(async (_key, _prelude, index) =>
        fault === 'wrong-index'
          ? { ...shard(index), treeIndex: 0 }
          : { treeIndex: index, shard: new Uint8Array(415) }
      );
      expect(
        (await f.execution().signActionHash(payload(), f.check)).signature
      ).toBe(bytesToHex(new Uint8Array(3856).fill(7)));
      expect(f.host.finishSignature).not.toHaveBeenCalled();
    }
  );

  it('supports one real serialized lane and starts no new work or fallback after revocation', async () => {
    const f = fixture();
    f.host.forsConcurrency = 1;
    const pending = gate<ReturnType<typeof shard>>();
    f.host.signForsTree.mockImplementation(() => pending.promise);
    const signing = f.execution().signActionHash(payload(), f.check);
    await tick();
    f.revoke();
    await tick();
    expect(f.host.releaseKey).not.toHaveBeenCalled();
    pending.resolve(shard(0));
    await expect(signing).rejects.toThrow('revoked');
    expect(f.host.signForsTree).toHaveBeenCalledTimes(1);
    expect(f.host.signCached).not.toHaveBeenCalled();
    expect(f.keys[0].every((byte) => byte === 0)).toBe(true);
  });

  it('completes six shards on a single lane without changing ordering or output', async () => {
    const f = fixture();
    f.host.forsConcurrency = 1;
    expect(
      (await f.execution().signActionHash(payload(), f.check)).signature
    ).toBe(bytesToHex(new Uint8Array(3856).fill(9)));
    expect(f.host.signForsTree.mock.calls.map((call) => call[2])).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it.each(['action', 'key-id', 'metadata'] as const)(
    'refuses mismatched %s before primitive work',
    async (fault) => {
      const f = fixture();
      const request = payload();
      if (fault === 'action') request.actionHash = '0x00';
      if (fault === 'key-id') request.keyId += ':other';
      if (fault === 'metadata')
        request.pkRoot = normalizeSLHDSAPublicKeyField(`0x${'55'.repeat(16)}`);
      await expect(
        f.execution().signActionHash(request, f.check)
      ).rejects.toThrow();
      expect(f.host.importKey).not.toHaveBeenCalled();
      expect(f.host.loadTree).not.toHaveBeenCalled();
    }
  );

  it.each(['root', 'size', 'key-id'] as const)(
    'refuses a wrong cached %s before any signing/fallback',
    async (fault) => {
      const f = fixture();
      if (fault === 'root') f.tree.root.fill(0x55);
      if (fault === 'size')
        f.host.loadTree.mockImplementation(async (keyId) => ({
          tree: f.tree,
          keyId,
          bytes: 1,
        }));
      if (fault === 'key-id')
        f.host.loadTree.mockImplementation(async () => ({
          tree: f.tree,
          keyId: 'other',
          bytes: SLH_DSA_XMSS_TREE_CACHE_LENGTH,
        }));
      await expect(
        f.execution().signActionHash(payload(), f.check)
      ).rejects.toThrow(/cache/);
      expect(f.host.signPrelude).not.toHaveBeenCalled();
      expect(f.host.signCached).not.toHaveBeenCalled();
      expect(f.host.releaseKey).toHaveBeenCalledTimes(1);
      expect(f.host.releaseTree).toHaveBeenCalledWith(f.tree, false);
    }
  );

  it('snapshots request identity and public fields before an asynchronous key import', async () => {
    const f = fixture();
    const pending = gate<Uint8Array>();
    const request = payload();
    f.host.importKey.mockImplementation((bytes) => {
      const key = bytes.slice();
      f.keys.push(key);
      return pending.promise;
    });
    const signing = f.execution().signActionHash(request, f.check);
    request.keyId = 'replacement';
    request.actionHash = '0x00';
    request.pkRoot = '0x00';
    pending.resolve(f.keys[0]);
    expect((await signing).pkRoot).toBe(fields.pkRoot);
    expect(f.host.loadTree).toHaveBeenCalledWith(getSLHDSAKeyId(fields));
  });

  it('reuses the exact active cache and clears it with erasure', async () => {
    const f = fixture();
    const execution = f.execution();
    await execution.signActionHash(payload(), f.check);
    await execution.signActionHash(payload(), f.check);
    expect(f.host.loadTree).toHaveBeenCalledTimes(1);
    await execution.clearXmssCache(f.check);
    expect(f.released).toEqual([{ tree: f.tree, erase: true }]);
  });

  it('retains the existing complete setup geometry/progress with an opaque tree, then signs without loading', async () => {
    const f = fixture();
    const progress: { completed: number; level: number; total: number }[] = [];
    const execution = f.execution();
    const prepared = await execution.prepareKeypair(
      '0xsetup',
      f.check,
      (value) => {
        progress.push(value);
      }
    );
    expect(prepared).toEqual({
      ...fields,
      secretKeyHex: payload().secretKeyHex,
    });
    expect(f.chunks.filter((chunk) => chunk.level === 0)).toHaveLength(8192);
    expect(f.chunks.reduce((sum, chunk) => sum + chunk.count, 0)).toBe(8388607);
    expect(f.chunks[0]).toEqual({ level: 0, start: 0, count: 512 });
    expect(f.chunks[f.chunks.length - 1]).toEqual({
      level: 22,
      start: 0,
      count: 1,
    });
    expect(progress[progress.length - 1]).toEqual({
      completed: 8388607,
      level: 22,
      phase: 'xmss-cache',
      total: 8388607,
    });
    expect(f.host.createLeafLanes).not.toHaveBeenCalled();
    expect(f.setupDispose).toHaveBeenCalledTimes(1);
    expect(f.seedInputs[0].every((byte) => byte === 0)).toBe(true);
    await execution.signActionHash(payload(), f.check);
    expect(f.host.loadTree).not.toHaveBeenCalled();
  });

  it('drains started setup lanes on failure, erases seeds and releases every owned resource', async () => {
    const f = fixture();
    f.host.leafConcurrency = 2;
    const pending = gate<{
      count: number;
      leaves: Uint8Array;
      start: number;
    }>();
    const dispose = [jest.fn(), jest.fn()];
    const first = jest.fn(async () => ({
      start: 1,
      count: 8192,
      leaves: new Uint8Array(16),
    }));
    const second = jest.fn(() => pending.promise);
    f.host.createLeafLanes.mockReturnValue([
      { buildLeaves: first, dispose: dispose[0] },
      { buildLeaves: second, dispose: dispose[1] },
    ]);
    const preparing = f
      .execution()
      .prepareKeypair('0xsetup', f.check, () => undefined);
    await tick();
    expect(f.host.createLeafLanes).toHaveBeenCalledWith(2);
    expect(dispose[0]).not.toHaveBeenCalled();
    pending.resolve({
      start: 8192,
      count: 8192,
      leaves: new Uint8Array(8192 * 16),
    });
    await expect(preparing).rejects.toThrow('unexpected leaf range');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    for (const close of dispose) expect(close).toHaveBeenCalledTimes(1);
    expect(f.setupDispose).toHaveBeenCalledTimes(1);
    expect(f.seedInputs[0].every((byte) => byte === 0)).toBe(true);
    expect(f.released).toHaveLength(1);
    expect(f.host.saveTree).not.toHaveBeenCalled();
  });

  it('refuses an async current-check or a missing primitive before I/O', async () => {
    const f = fixture();
    await expect(
      f
        .execution()
        .signActionHash(
          payload(),
          (async () => undefined) as unknown as () => void
        )
    ).rejects.toThrow('no longer current');
    expect(f.host.randomFill).not.toHaveBeenCalled();
    expect(() =>
      createSlhDsaExecution({
        ...f.host,
        signCached: undefined,
      } as unknown as SlhDsaExecutionHost<Tree, Uint8Array>)
    ).toThrow('primitive is required');
  });

  it('uses the existing signer provision/key-ID/usage path without changing its state contract', async () => {
    const f = fixture();
    const execution = f.execution();
    const saved: SLHDSAProvisionedState[] = [];
    const rows = new Map<string, unknown>();
    const read: SlhDsaStateStorage['read'] = async (key) =>
      rows.has(key)
        ? { present: true, value: rows.get(key) }
        : { present: false };
    const store = createSlhDsaStateStore({
      read,
      mutate: async (check, operation) => {
        check();
        const result = await operation({
          read,
          write: async (key, value) => {
            rows.set(key, value);
          },
          remove: async (key) => {
            rows.delete(key);
          },
        });
        check();
        return result;
      },
    });
    const signer = createSlhDsaSigner({
      now: () => 1234,
      stateStore: {
        load: store.load,
        save: async (state, crypto, check) => {
          await store.save(state, crypto, check);
          saved.push(state);
        },
      },
      execution: {
        prepareKeypair: (request, check) =>
          execution.prepareKeypair(
            request.setupSecretHex,
            check,
            () => undefined
          ),
        signActionHash: async (request, check) =>
          (await execution.signActionHash(request, check)).signature,
      },
    });
    signer.configureSLHDSASessionStateCrypto({
      encrypt: (value) => value,
      decrypt: (value) => value,
    });
    const generation = signer.getSLHDSASessionGeneration();
    const state = await signer.provisionRuntimeSLHDSAStateFromSetupSecret(
      {
        accountIndex: 0,
        derivationLabel: 'account/0',
        setupSecretHex: `0x${'11'.repeat(32)}`,
      },
      generation
    );
    expect(state.keyId).toBe(getSLHDSAKeyId(fields));
    expect(state.parameterSet).toBe(SLH_DSA_PARAMETER_SET);
    const signature = await signer.signSLHDSAActionHashLocal(
      {
        actionHash: payload().actionHash,
        keyId: state.keyId,
        parameterSet: state.parameterSet,
        pkSeed: state.pkSeed,
        pkRoot: state.pkRoot,
      },
      generation
    );
    expect(signature).toBe(bytesToHex(new Uint8Array(3856).fill(9)));
    expect(saved[saved.length - 1].signatureCount).toBe(1);
    expect(f.host.loadTree).not.toHaveBeenCalled();
  });

  it('does not deliver a signature if ownership changes during asynchronous key retirement', async () => {
    const f = fixture();
    const closed = gate<void>();
    f.host.releaseKey.mockImplementation(async (key) => {
      key.fill(0);
      await closed.promise;
    });
    const signing = f.execution().signActionHash(payload(), f.check);
    await tick();
    expect(f.host.releaseKey).toHaveBeenCalledTimes(1);
    f.revoke();
    closed.resolve();
    await expect(signing).rejects.toThrow('revoked');
    expect(f.host.signCached).not.toHaveBeenCalled();
  });

  it('does not replace the old active cache when persistence of a newly prepared tree fails', async () => {
    const f = fixture();
    const execution = f.execution();
    await execution.signActionHash(payload(), f.check);
    f.host.saveTree.mockRejectedValueOnce(
      new Error('cache persistence failed')
    );
    await expect(
      execution.prepareKeypair('0xsetup', f.check, () => undefined)
    ).rejects.toThrow('cache persistence failed');
    expect(f.released).toEqual([
      { tree: expect.objectContaining({ id: 2 }), erase: false },
    ]);
    expect(f.setupDispose).toHaveBeenCalledTimes(1);
    expect(f.seedInputs[0].every((byte) => byte === 0)).toBe(true);
    await execution.clearXmssCache(f.check);
    expect(f.released[1]).toEqual({ tree: f.tree, erase: true });
  });
});
