import {
  assertImportedRecoveryAccount,
  importedRecoveryStorageKey,
  IMPORTED_RECOVERY_DOMAIN,
  type ImportedRecoveryEntry,
} from '../wallet/importedAccountRecovery';
import {
  INetworkType,
  KeyringAccountType,
  type IKeyringAccountState,
} from 'types/network';
import { chromeStorage } from 'utils/storageAPI';

import { walletPersistenceGate } from './paliStorage';
import store, {
  persistAccountCreation,
  persistAccountRemoval,
  persistAccountLabel,
} from './store';
import vaultReducer, { restoreVaultSnapshot } from './vault';
import vaultCache from './vaultCache';
import { setActiveSlip44 } from './vaultGlobal';

const profileId = `0x${'a'.repeat(64)}`;
const vaultKey = 'state-vault-60';
const account = (id: number): IKeyringAccountState => ({
  id,
  address: `public-${id}`,
  xpub: `public-key-${id}`,
  xprv: 'encrypted-test-key',
  label: `Imported ${id}`,
  isImported: true,
  isLedgerWallet: false,
  isTrezorWallet: false,
  balances: { ethereum: 0, syscoin: 0 },
});
const entry = (id: number): ImportedRecoveryEntry => ({
  version: 1,
  identity: {
    kind: 'ethereum',
    slip44: 60,
    id,
    address: account(id).address,
    xpub: account(id).xpub,
  },
  envelope: {
    version: 1,
    domain: IMPORTED_RECOVERY_DOMAIN,
    recordId: `imported:60:${id}`,
    profileId,
    nonce: 'AAAAAAAAAAAAAAAA',
    ciphertext:
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
});

describe('atomic private imported-recovery records', () => {
  let disk: Record<string, any>;
  let writes: jest.SpyInstance;
  let active: boolean;
  const guard = () => {
    if (!active) throw Error('Session changed');
  };
  const add = (id = 0, value = entry(id)) =>
    persistAccountCreation(
      account(id),
      KeyringAccountType.Imported,
      guard,
      () => true,
      { assertAccount: assertImportedRecoveryAccount, entry: value }
    );
  const remove = (id: number, value = entry(id)) =>
    persistAccountRemoval(
      {
        accountId: id,
        accountType: KeyringAccountType.Imported,
        grants: [],
        isSameWallet: () => true,
        retireSessions: jest.fn(),
        importedRecovery: {
          assertAccount: assertImportedRecoveryAccount,
          identity: value.identity,
          profileId,
        },
      },
      guard
    );

  beforeEach(() => {
    walletPersistenceGate.blocked = false;
    vaultCache.clearCache();
    active = true;
    const initial = structuredClone(
      vaultReducer(undefined, { type: 'fixture' })
    );
    initial.activeNetwork = {
      kind: INetworkType.Ethereum,
      chainId: 1,
      slip44: 60,
      url: 'https://offline.invalid',
      currency: 'ETH',
      label: 'Fixture',
    };
    initial.accounts.HDAccount[0] = {
      ...initial.accounts.HDAccount[0],
      address: 'hd-anchor',
      xpub: 'hd-pub',
      xprv: 'encrypted-hd',
    };
    store.dispatch(restoreVaultSnapshot(initial));
    store.dispatch(setActiveSlip44(60));
    disk = { [vaultKey]: structuredClone(initial) };
    jest
      .spyOn(chromeStorage, 'getItems')
      .mockImplementation(async (keys) =>
        Object.fromEntries(
          keys
            .filter((key) => Object.hasOwn(disk, key))
            .map((key) => [key, structuredClone(disk[key])])
        )
      );
    writes = jest
      .spyOn(chromeStorage, 'setItems')
      .mockImplementation(async (items) => {
        Object.assign(disk, structuredClone(items));
      });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    vaultCache.clearCache();
    walletPersistenceGate.blocked = false;
  });

  it('commits account and private copy in one batch without adding an envelope to public account state', async () => {
    await add();
    expect(writes).toHaveBeenCalledTimes(1);
    const batch = writes.mock.calls[0][0];
    expect(batch[vaultKey].accounts.Imported[0].xprv).toBe(
      'encrypted-test-key'
    );
    expect(batch[importedRecoveryStorageKey(entry(0))]).toEqual(entry(0));
    expect(store.getState().vault.accounts.Imported[0]).not.toHaveProperty(
      'envelope'
    );
    expect(JSON.stringify(store.getState().vault)).not.toContain(
      IMPORTED_RECOVERY_DOMAIN
    );
  });

  it('does not publish either record when the storage batch rejects', async () => {
    writes.mockRejectedValueOnce(Error('Storage refusal'));
    await expect(add()).rejects.toThrow('Storage refusal');
    expect(store.getState().vault.accounts.Imported[0]).toBeUndefined();
    expect(disk[importedRecoveryStorageKey(entry(0))]).toBeUndefined();
  });

  it('captures the existing account validator before reading a retained copy', async () => {
    await add();
    store.dispatch({
      type: 'vault/setActiveAccount',
      payload: { id: 0, type: KeyringAccountType.HDAccount },
    });
    const assertAccount = jest.fn(assertImportedRecoveryAccount);
    const replaced = jest.fn(() => {
      throw Error('Replaced validator');
    });
    const recovery: {
      assertAccount: typeof assertImportedRecoveryAccount;
      identity: ImportedRecoveryEntry['identity'];
      profileId: string;
    } = { assertAccount, identity: entry(0).identity, profileId };
    const read = jest.mocked(chromeStorage.getItems).getMockImplementation()!;
    jest.mocked(chromeStorage.getItems).mockImplementationOnce(async (keys) => {
      recovery.assertAccount = replaced;
      return read(keys);
    });
    await persistAccountRemoval(
      {
        accountId: 0,
        accountType: KeyringAccountType.Imported,
        grants: [],
        isSameWallet: () => true,
        retireSessions: jest.fn(),
        importedRecovery: recovery,
      },
      guard
    );
    expect(assertAccount).toHaveBeenCalledTimes(1);
    expect(assertAccount).toHaveBeenCalledWith(entry(0), entry(0).identity);
    expect(replaced).not.toHaveBeenCalled();
    expect(disk[vaultKey].accounts.Imported[0]).toBeUndefined();
  });

  it('refuses the same account validator failure without writing either record', async () => {
    await add();
    store.dispatch({
      type: 'vault/setActiveAccount',
      payload: { id: 0, type: KeyringAccountType.HDAccount },
    });
    const before = structuredClone(disk);
    writes.mockClear();
    const wrongIdentity = { ...entry(0).identity, xpub: 'different-key' };
    await expect(
      persistAccountRemoval(
        {
          accountId: 0,
          accountType: KeyringAccountType.Imported,
          grants: [],
          isSameWallet: () => true,
          retireSessions: jest.fn(),
          importedRecovery: {
            assertAccount: assertImportedRecoveryAccount,
            identity: wrongIdentity,
            profileId,
          },
        },
        guard
      )
    ).rejects.toThrow('IMPORTED_RECOVERY_INVALID');
    expect(writes).not.toHaveBeenCalled();
    expect(disk).toEqual(before);
    expect(store.getState().vault.accounts.Imported[0]).toBeDefined();
  });

  it('a commit-then-reject cannot let an unrelated rename orphan the private copy', async () => {
    writes.mockImplementationOnce(async (items) => {
      Object.assign(disk, structuredClone(items));
      throw Error('Lost commit acknowledgement');
    });
    await expect(add()).rejects.toThrow('Lost commit acknowledgement');
    let followupBlocked = false;
    try {
      await persistAccountLabel(
        0,
        KeyringAccountType.HDAccount,
        'Unrelated rename',
        guard
      );
    } catch {
      followupBlocked = true;
    }
    const onDisk = Boolean(disk[vaultKey].accounts.Imported[0]);
    const copyOnDisk = Boolean(disk[importedRecoveryStorageKey(entry(0))]);
    expect({ onDisk, copyOnDisk }).toEqual({ onDisk, copyOnDisk: onDisk });
    if (followupBlocked) expect(walletPersistenceGate.blocked).toBe(true);
    else
      expect(Boolean(store.getState().vault.accounts.Imported[0])).toBe(onDisk);
  });

  it('rejects a no-op acknowledgement without changing the original frame', async () => {
    writes.mockResolvedValueOnce(undefined);
    await expect(add()).rejects.toThrow('commit was not acknowledged');
    expect(store.getState().vault.accounts.Imported[0]).toBeUndefined();
    expect(disk[vaultKey].accounts.Imported[0]).toBeUndefined();
    expect(disk[importedRecoveryStorageKey(entry(0))]).toBeUndefined();
  });

  it('repairs the private copy together with the account after revocation during commit', async () => {
    writes.mockImplementationOnce(async (items) => {
      Object.assign(disk, structuredClone(items));
      active = false;
    });
    await expect(add()).rejects.toThrow('Session changed');
    expect(store.getState().vault.accounts.Imported[0]).toBeUndefined();
    expect(disk[vaultKey].accounts.Imported[0]).toBeUndefined();
    expect(disk[importedRecoveryStorageKey(entry(0))]).toBeNull();
  });

  it.each(['account', 'copy'] as const)(
    'repairs an incomplete %s-only acknowledgement before allowing later writes',
    async (part) => {
      writes.mockImplementationOnce(async (items) => {
        const key =
          part === 'account' ? vaultKey : importedRecoveryStorageKey(entry(0));
        disk[key] = structuredClone(items[key]);
      });
      await expect(add()).rejects.toThrow('commit was not acknowledged');
      expect(disk[vaultKey].accounts.Imported[0]).toBeUndefined();
      expect(disk[importedRecoveryStorageKey(entry(0))] ?? null).toBeNull();
      expect(walletPersistenceGate.blocked).toBe(false);
      await persistAccountLabel(
        0,
        KeyringAccountType.HDAccount,
        'Verified repair',
        guard
      );
      expect(disk[vaultKey].accounts.HDAccount[0].label).toBe(
        'Verified repair'
      );
    }
  );

  it('verifies a repair whose acknowledgement also failed', async () => {
    writes.mockImplementationOnce(async (items) => {
      Object.assign(disk, structuredClone(items));
      throw Error('Lost import acknowledgement');
    });
    writes.mockImplementationOnce(async (items) => {
      Object.assign(disk, structuredClone(items));
      throw Error('Lost repair acknowledgement');
    });
    await expect(add()).rejects.toThrow('Lost import acknowledgement');
    expect(disk[vaultKey].accounts.Imported[0]).toBeUndefined();
    expect(disk[importedRecoveryStorageKey(entry(0))]).toBeNull();
    expect(walletPersistenceGate.blocked).toBe(false);
  });

  it.each(['write', 'no-op', 'read'] as const)(
    'blocks future persistence when the repair %s cannot establish a coherent frame',
    async (fault) => {
      writes.mockImplementationOnce(async (items) => {
        disk[importedRecoveryStorageKey(entry(0))] = structuredClone(
          items[importedRecoveryStorageKey(entry(0))]
        );
        throw Error('Partial commit');
      });
      if (fault === 'write')
        writes.mockRejectedValueOnce(Error('Repair refused'));
      if (fault === 'no-op') writes.mockResolvedValueOnce(undefined);
      if (fault === 'read') {
        writes.mockImplementationOnce(async (items) => {
          Object.assign(disk, structuredClone(items));
          jest
            .mocked(chromeStorage.getItems)
            .mockRejectedValueOnce(Error('Repair read unavailable'));
        });
      }
      await expect(add()).rejects.toThrow();
      expect(walletPersistenceGate.blocked).toBe(true);
      const count = writes.mock.calls.length;
      await expect(
        persistAccountLabel(0, KeyringAccountType.HDAccount, 'Blocked', guard)
      ).rejects.toThrow('Wallet recovery must finish');
      expect(writes.mock.calls.length).toBe(count);
    }
  );

  it('repairs a lost acknowledgement even after its UI session is revoked', async () => {
    writes.mockImplementationOnce(async (items) => {
      Object.assign(disk, structuredClone(items));
      active = false;
      throw Error('Lost acknowledgement after lock');
    });
    await expect(add()).rejects.toThrow('Lost acknowledgement after lock');
    expect(disk[vaultKey].accounts.Imported[0]).toBeUndefined();
    expect(disk[importedRecoveryStorageKey(entry(0))]).toBeNull();
    expect(store.getState().vault.accounts.Imported[0]).toBeUndefined();
    expect(walletPersistenceGate.blocked).toBe(false);
  });

  it('does not restore an old frame into a replaced wallet after an acknowledgement failure', async () => {
    let sameWallet = true;
    const replacement = { replacementWallet: true };
    writes.mockImplementationOnce(async () => {
      disk[vaultKey] = replacement;
      sameWallet = false;
      throw Error('Old acknowledgement');
    });
    await expect(
      persistAccountCreation(
        account(0),
        KeyringAccountType.Imported,
        guard,
        () => sameWallet,
        { assertAccount: assertImportedRecoveryAccount, entry: entry(0) }
      )
    ).rejects.toThrow('Old acknowledgement');
    expect(disk[vaultKey]).toEqual(replacement);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(walletPersistenceGate.blocked).toBe(false);
  });

  it('removes only the selected imported copy in the same account-removal batch', async () => {
    await add(0);
    await add(1);
    // Select the retained HD anchor, as normal removal admission requires.
    store.dispatch({
      type: 'vault/setActiveAccount',
      payload: { id: 0, type: KeyringAccountType.HDAccount },
    });
    writes.mockClear();
    await remove(0);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(disk[importedRecoveryStorageKey(entry(0))]).toBeNull();
    expect(disk[importedRecoveryStorageKey(entry(1))]).toEqual(entry(1));
    expect(disk[vaultKey].accounts.Imported[0]).toBeUndefined();
    expect(disk[vaultKey].accounts.Imported[1]).toBeDefined();
  });

  it('restores both the imported account and its copy after a lost removal acknowledgement', async () => {
    await add();
    store.dispatch({
      type: 'vault/setActiveAccount',
      payload: { id: 0, type: KeyringAccountType.HDAccount },
    });
    writes.mockImplementationOnce(async (items) => {
      Object.assign(disk, structuredClone(items));
      throw Error('Lost removal acknowledgement');
    });
    await expect(remove(0)).rejects.toThrow('Lost removal acknowledgement');
    expect(disk[vaultKey].accounts.Imported[0]).toBeDefined();
    expect(disk[importedRecoveryStorageKey(entry(0))]).toEqual(entry(0));
    await persistAccountLabel(
      0,
      KeyringAccountType.HDAccount,
      'After restored removal',
      guard
    );
    expect(disk[vaultKey].accounts.Imported[0]).toBeDefined();
  });

  it.each([true, false])(
    'queued saves wait for a verified repair (repair succeeds=%s)',
    async (succeeds) => {
      let reached!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      writes.mockImplementationOnce(async (items) => {
        disk[importedRecoveryStorageKey(entry(0))] = structuredClone(
          items[importedRecoveryStorageKey(entry(0))]
        );
        throw Error('Partial first write');
      });
      writes.mockImplementationOnce(async (items) => {
        reached();
        await held;
        if (succeeds) Object.assign(disk, structuredClone(items));
      });
      const importing = add().catch((error) => error);
      await entered;
      const rename = persistAccountLabel(
        0,
        KeyringAccountType.HDAccount,
        'Queued rename',
        guard
      ).then(
        () => true,
        () => false
      );
      expect(writes).toHaveBeenCalledTimes(2);
      release();
      expect(await importing).toBeInstanceOf(Error);
      expect(await rename).toBe(succeeds);
      expect(walletPersistenceGate.blocked).toBe(!succeeds);
      expect(writes).toHaveBeenCalledTimes(succeeds ? 3 : 2);
      if (succeeds)
        expect(disk[vaultKey].accounts.HDAccount[0].label).toBe(
          'Queued rename'
        );
    }
  );

  it('does not manufacture a copy when removing a record without one', async () => {
    await persistAccountCreation(
      account(0),
      KeyringAccountType.Imported,
      guard,
      () => true
    );
    store.dispatch({
      type: 'vault/setActiveAccount',
      payload: { id: 0, type: KeyringAccountType.HDAccount },
    });
    await remove(0);
    expect(disk[importedRecoveryStorageKey(entry(0))]).toBeNull();
    expect(disk[vaultKey].accounts.Imported[0]).toBeUndefined();
  });

  it('rejects mismatched or already-present private records before any write', async () => {
    await expect(add(0, entry(1))).rejects.toThrow('account context changed');
    expect(writes).not.toHaveBeenCalled();
    disk[importedRecoveryStorageKey(entry(0))] = entry(0);
    await expect(add()).rejects.toThrow('already exists or changed');
    expect(writes).not.toHaveBeenCalled();
  });
});
