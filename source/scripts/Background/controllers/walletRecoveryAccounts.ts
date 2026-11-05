import * as recoverySdk from '@sidhujag/sysweb3-keyring/cjs/software.js';

import {
  getSentryVaultId,
  listSentryKeys,
  loadSentryKey,
} from '../../../utils/sentry/keyStore';
import { getSLHDSAStateStorageKey } from '../../../utils/slhDsa/constants';
import { loadEncryptedSLHDSAState } from '../../../utils/slhDsa/state';
import { assertCompleteHDAccountData } from '../../../wallet/accountRecords';
import { stageAccountRecovery } from '../../../wallet/accountRecovery';
import {
  EVM_SIGNED_RECORD_PREFIX,
  EvmSignedRecords,
} from '../../../wallet/evmSignedRecords';
import {
  IMPORTED_RECOVERY_STORAGE_PREFIX,
  importedRecoveryStorageKey,
  snapshotImportedRecoveryEntry,
} from '../../../wallet/importedAccountRecovery';
import {
  PRIVATE_VAULT_STORAGE_PREFIX,
  readPrivateVaultBundle,
} from '../../../wallet/privateVaultInspection';
import { createSlhDsaProfileStateCrypto } from '../../../wallet/slhDsaStateCrypto';

import type { RecoveryAccountGroup } from '../../../wallet/accountRecovery';

type Records = Record<string, any>;
const invalid = (): never => {
  throw new Error('Saved wallet recovery data is incomplete');
};

const recoveryVaultSource = (records: Records, key: string): any => {
  const isolated = records[key];
  if (isolated !== undefined && isolated !== null) return isolated;
  const active = records.state?.vaultGlobal?.activeSlip44;
  return key === `state-vault-${active}` ? records.state?.vault : undefined;
};

/** Use ordinary startup's isolated precedence, including its active inline fallback. */
export function recoveryAccountGroups(
  records: Records
): RecoveryAccountGroup[] {
  const entries = Object.entries(records).filter(
    ([key, value]) =>
      /^state-vault-(0|[1-9][0-9]*)$/.test(key) &&
      value !== null &&
      value !== undefined
  );
  const active = records.state?.vaultGlobal?.activeSlip44;
  if (Number.isSafeInteger(active) && active >= 0) {
    const key = `state-vault-${active}`;
    if (records[key] === undefined || records[key] === null) {
      const inline = recoveryVaultSource(records, key);
      if (inline !== undefined && inline !== null) entries.push([key, inline]);
    }
  }
  const groups = entries.map(([key, value]) => {
    const slip44 = Number(key.slice('state-vault-'.length));
    if (
      !Number.isSafeInteger(slip44) ||
      value?.activeNetwork?.slip44 !== slip44 ||
      !value.activeAccount ||
      !value.accounts
    )
      return invalid();
    if (
      Object.keys(value.accounts).sort().join(',') !==
      'HDAccount,Imported,Ledger,SmartAccount,Trezor'
    )
      return invalid();
    assertCompleteHDAccountData(value.accounts.HDAccount);
    if (!value.accounts[value.activeAccount.type]?.[value.activeAccount.id])
      return invalid();
    return {
      key,
      accounts: value.accounts,
      activeAccount: value.activeAccount,
      activeNetwork: value.activeNetwork,
    } as RecoveryAccountGroup;
  });
  if (
    !groups.length ||
    !groups.some(
      (group) =>
        group.activeNetwork.slip44 === records.state?.vaultGlobal?.activeSlip44
    )
  )
    return invalid();
  return groups;
}

/** Platform reads are retained here; all key reconstruction is shared with native. */
export async function prepareExtensionAccountRecovery(
  before: Records,
  password: string,
  phrase: string,
  assertCurrent: () => void
): Promise<Records> {
  const groups = recoveryAccountGroups(before);
  const imported = Object.entries(before)
    .filter(
      ([key, value]) =>
        key.startsWith(IMPORTED_RECOVERY_STORAGE_PREFIX) &&
        value !== null &&
        value !== undefined
    )
    .map(([key, value]) => {
      const entry = snapshotImportedRecoveryEntry(value);
      if (key !== importedRecoveryStorageKey(entry)) return invalid();
      return entry;
    });
  const staged = await stageAccountRecovery(
    { groups, imported, password, phrase },
    {
      assertCurrent,
      // This module is registered during worker installation. A nested SDK
      // chunk cannot first be loaded by importScripts after MV3 installation.
      loadSdk: async () => recoverySdk,
      validateRetained: async ({ keyring, profileId }) => {
        for (const [key, value] of Object.entries(before)) {
          assertCurrent();
          if (value === null || value === undefined) continue;
          if (key.startsWith('pali-slh-dsa-state:')) {
            if (
              typeof value.keyId !== 'string' ||
              key !== getSLHDSAStateStorageKey(value.keyId)
            )
              return invalid();
            const state = await loadEncryptedSLHDSAState({
              keyId: value.keyId,
              crypto: createSlhDsaProfileStateCrypto(keyring, assertCurrent),
            });
            if (!state) return invalid();
          }
          if (key.startsWith(PRIVATE_VAULT_STORAGE_PREFIX)) {
            if (key !== `${PRIVATE_VAULT_STORAGE_PREFIX}${profileId}`)
              return invalid();
            await readPrivateVaultBundle(value, {
              keyring,
              assertCurrent,
              generation: 0,
            });
          }
          if (key.startsWith(EVM_SIGNED_RECORD_PREFIX)) {
            if (
              key !== `${EVM_SIGNED_RECORD_PREFIX}${profileId}` ||
              typeof value !== 'string'
            )
              return invalid();
            const reader = new EvmSignedRecords({
              read: async (profile) =>
                profile === profileId ? value : undefined,
              compareAndSet: async () => invalid(),
            });
            await reader.validate({ keyring, assertCurrent });
          }
        }
        const vaultIds = new Set(
          await Promise.all(
            groups
              .filter((group) => group.accounts.HDAccount[0])
              .map((group) =>
                getSentryVaultId(group.accounts.HDAccount[0].xpub)
              )
          )
        );
        for (const [key, value] of Object.entries(before)) {
          if (
            !key.startsWith('sentry-operator-v1:') ||
            value === null ||
            value === undefined
          )
            continue;
          if (
            !vaultIds.has(value.vaultId) ||
            key !== `sentry-operator-v1:${value.vaultId}:${value.network}`
          )
            return invalid();
          for (const summary of await listSentryKeys(
            value.vaultId,
            value.network
          )) {
            await loadSentryKey({
              vaultId: value.vaultId,
              network: value.network,
              id: summary.id,
              seed: phrase,
              assertCurrent,
            });
          }
        }
        assertCurrent();
      },
    }
  );
  assertCurrent();
  const after: Records = {
    ...before,
    'sysweb3-vault': staged.pair.vault,
    'sysweb3-vault-keys': staged.pair.keys,
  };
  for (const group of staged.groups)
    after[group.key] = {
      ...recoveryVaultSource(before, group.key),
      accounts: group.accounts,
    };
  // The isolated vault remains authoritative, as in normal startup. If the
  // saved main state also carries its active vault, keep the copy coherent.
  const active = `state-vault-${before.state.vaultGlobal.activeSlip44}`;
  if (before.state.vault)
    after.state = {
      ...before.state,
      vault: { ...before.state.vault, accounts: after[active].accounts },
    };
  return after;
}
