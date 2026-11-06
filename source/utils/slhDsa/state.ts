import {
  assertSlhDsaStateOwner,
  createSlhDsaStateStore,
  type SlhDsaStateStorage,
} from '../../wallet/slhDsaState';
import { assertWalletPersistenceAllowed } from 'state/paliStorage';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

export {
  createSLHDSAProvisionedState,
  validateSLHDSAProvisionedState,
  type SLHDSASessionStateCrypto,
} from '../../wallet/slhDsaState';

const read: SlhDsaStateStorage['read'] = async (key) => {
  const records = await chromeStorage.getItems([key]);
  return Object.hasOwn(records, key)
    ? { present: true, value: records[key] }
    : { present: false };
};

const store = createSlhDsaStateStore({
  read,
  mutate: (assertOwner, run) =>
    walletPersistenceMutex.runExclusive(async () => {
      assertWalletPersistenceAllowed();
      assertSlhDsaStateOwner(assertOwner);
      const result = await run({
        read,
        write: (key, value) => chromeStorage.setItem(key, value),
        remove: (key) => chromeStorage.removeItem(key),
      });
      assertWalletPersistenceAllowed();
      assertSlhDsaStateOwner(assertOwner);
      return result;
    }),
});

export const saveEncryptedSLHDSAState = store.save;
export const loadEncryptedSLHDSAState = store.load;
export const removeEncryptedSLHDSAState = store.remove;
