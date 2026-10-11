import { chromeStorage } from 'utils/storageAPI';

// Recovery owns the durable snapshot until the restored Redux vault is usable.
// This survives a failed same-worker restoration; a cold worker starts closed
// again when it reconciles the retained journal.
export const walletPersistenceGate = { blocked: false };

export const assertWalletPersistenceAllowed = () => {
  if (walletPersistenceGate.blocked)
    throw new Error('Wallet recovery must finish before saving state');
};

export const saveState = async (appState: any) => {
  assertWalletPersistenceAllowed();
  try {
    await chromeStorage.setItem('state', appState);
  } catch (e) {
    console.error('<!> Error saving state', e);
  }
};

export const saveSlip44State = async (slip44: number, vaultState: any) => {
  assertWalletPersistenceAllowed();
  try {
    await chromeStorage.setItem(`state-vault-${slip44}`, vaultState);
  } catch (error) {
    console.error(
      `[PaliStorage] ❌ Failed to save slip44 vault ${slip44}:`,
      error
    );
    throw error;
  }
};

export const saveCommittedWalletState = async (
  slip44: number,
  vaultState: any,
  mainState?: any
) => {
  assertWalletPersistenceAllowed();
  const items: Record<string, any> = {
    [`state-vault-${slip44}`]: vaultState,
  };

  if (mainState) {
    items.state = mainState;
  }

  await chromeStorage.setItems(items);
};

export const savePasskeyCredentialProfileState = async (
  slip44: number,
  passkeyCredentialProfile: any
) => {
  assertWalletPersistenceAllowed();
  try {
    await chromeStorage.setItem(`state-vault-${slip44}-passkey-profile`, {
      passkeyCredentialProfile: passkeyCredentialProfile || null,
    });
  } catch (error) {
    console.error(
      `[PaliStorage] ❌ Failed to save passkey credential profile ${slip44}:`,
      error
    );
    throw error;
  }
};

export const loadState = async () => {
  try {
    const serializedState = await chromeStorage.getItem('state');
    if (serializedState === null) {
      return undefined;
    }
    return serializedState;
  } catch (e) {
    console.error('<!> Error getting state', e);
    return null;
  }
};

export const loadSlip44State = async (slip44: number) => {
  try {
    const serializedState = await chromeStorage.getItem(
      `state-vault-${slip44}`
    );

    if (serializedState) {
      return serializedState;
    } else {
      return null;
    }
  } catch (error) {
    console.error(
      `[PaliStorage] ❌ Failed to load slip44 vault ${slip44}:`,
      error
    );
    // Absence may initialize a new vault; a failed read must never do so.
    throw error;
  }
};

export const loadPasskeyCredentialProfileState = async (slip44: number) => {
  try {
    const serializedState = await chromeStorage.getItem(
      `state-vault-${slip44}-passkey-profile`
    );

    return serializedState || null;
  } catch (error) {
    console.error(
      `[PaliStorage] ❌ Failed to load passkey credential profile ${slip44}:`,
      error
    );
    // Do not overwrite an unreadable profile with an empty/embedded fallback.
    throw error;
  }
};

export const getIsMigratedVersion = async (version: string) => {
  if (!version) {
    console.warn('getMigratedVersion ---> Invalid version');
    return;
  }

  const serializedState = await chromeStorage.getItem(version);

  return serializedState !== null;
};

export const setMigratedVersions = async (version: string) => {
  if (!version) {
    console.warn('setMigratedVersions ---> Invalid version');
    return;
  }

  try {
    await chromeStorage.setItem(version, 'migrated');
  } catch (err) {
    console.log({ err });
  }
};
