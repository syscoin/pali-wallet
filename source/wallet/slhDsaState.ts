import {
  SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT,
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SECRET_KEY_LENGTH,
  SLH_DSA_SIGNATURE_LIMIT,
  SLH_DSA_STATE_VERSION,
  getSLHDSAStateStorageKey,
} from '../utils/slhDsa/constants';
import { normalizeSLHDSAPublicKeyField } from '../utils/slhDsa/hex';

import type { SlhDsaStateCrypto } from './slhDsaStateCrypto';
import type { SLHDSAProvisionedState } from '../utils/slhDsa/types';

export const validateSLHDSAProvisionedState = (
  state: SLHDSAProvisionedState
) => {
  if (
    !state ||
    state.version !== SLH_DSA_STATE_VERSION ||
    state.parameterSet !== SLH_DSA_PARAMETER_SET ||
    typeof state.keyId !== 'string' ||
    !state.keyId ||
    !Number.isSafeInteger(state.signatureCount) ||
    state.signatureCount < 0 ||
    state.signatureCount > SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT ||
    state.signatureLimit !== SLH_DSA_SIGNATURE_LIMIT ||
    typeof state.pkRoot !== 'string' ||
    typeof state.pkSeed !== 'string' ||
    (state.secretKeyHex !== undefined &&
      !new RegExp(`^0x[0-9a-fA-F]{${SLH_DSA_SECRET_KEY_LENGTH * 2}}$`).test(
        state.secretKeyHex
      ))
  ) {
    throw new Error(
      'Invalid SLH-DSA local signer state; usage history is unsafe'
    );
  }
  normalizeSLHDSAPublicKeyField(state.pkRoot);
  normalizeSLHDSAPublicKeyField(state.pkSeed);
};

type EncryptedSLHDSAStateEnvelope = {
  cipherText: string;
  keyId: string;
  updatedAt: number;
  version: number;
};

export type SLHDSASessionStateCrypto = SlhDsaStateCrypto;

export const createSLHDSAProvisionedState = ({
  accountIndex,
  derivationLabel,
  keyId,
  pkRoot,
  pkSeed,
  secretKeyHex,
}: {
  accountIndex: number;
  derivationLabel: string;
  keyId: string;
  pkRoot: string;
  pkSeed: string;
  secretKeyHex?: string;
}): SLHDSAProvisionedState => {
  const now = Date.now();
  return {
    accountIndex,
    createdAt: now,
    derivationLabel,
    keyId,
    parameterSet: SLH_DSA_PARAMETER_SET,
    pkRoot: normalizeSLHDSAPublicKeyField(pkRoot),
    pkSeed: normalizeSLHDSAPublicKeyField(pkSeed),
    secretKeyHex,
    signatureCount: 0,
    signatureLimit: SLH_DSA_SIGNATURE_LIMIT,
    updatedAt: now,
    version: SLH_DSA_STATE_VERSION,
  };
};

/** This is the key/session owner, separate from a UI or dapp request lifetime. */
export type SlhDsaStateOwner = () => void;
export type SlhDsaStateEntry =
  | Readonly<{ present: false }>
  | Readonly<{ present: true; value: unknown }>;
export type SlhDsaStateTransaction = Readonly<{
  read(key: string): Promise<SlhDsaStateEntry>;
  remove(key: string): Promise<void>;
  write(key: string, value: unknown): Promise<void>;
}>;
export type SlhDsaStateStorage = Readonly<{
  mutate<T>(
    assertOwner: SlhDsaStateOwner,
    run: (transaction: SlhDsaStateTransaction) => Promise<T>
  ): Promise<T>;
  read(key: string): Promise<SlhDsaStateEntry>;
}>;

export function assertSlhDsaStateOwner(assertOwner: SlhDsaStateOwner): void {
  const result: unknown = assertOwner();
  if (result === undefined) return;
  if (result && (typeof result === 'object' || typeof result === 'function'))
    void Promise.resolve(result).catch(() => undefined);
  throw new Error('SLH-DSA state owner must be synchronous');
}

function snapshotEnvelope(
  value: unknown,
  keyId: string
): EncryptedSLHDSAStateEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid SLH-DSA encrypted state; usage history is unsafe');
  const fields = ['cipherText', 'keyId', 'updatedAt', 'version'];
  const own = Reflect.ownKeys(value);
  if (
    own.length !== fields.length ||
    own.some((field) => typeof field !== 'string' || !fields.includes(field))
  )
    throw new Error('Invalid SLH-DSA encrypted state; usage history is unsafe');
  const snapshot: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      throw new Error(
        'Invalid SLH-DSA encrypted state; usage history is unsafe'
      );
    snapshot[field] = descriptor.value;
  }
  if (
    snapshot.keyId !== keyId ||
    snapshot.version !== SLH_DSA_STATE_VERSION ||
    typeof snapshot.cipherText !== 'string' ||
    !snapshot.cipherText ||
    !Number.isSafeInteger(snapshot.updatedAt) ||
    (snapshot.updatedAt as number) < 0
  )
    throw new Error('Invalid SLH-DSA encrypted state; usage history is unsafe');
  return snapshot as EncryptedSLHDSAStateEnvelope;
}

/** Shared state bytes and ordering. Each host supplies its existing commit barrier. */
export function createSlhDsaStateStore(storage: SlhDsaStateStorage) {
  const { read, mutate } = storage;
  if (typeof read !== 'function' || typeof mutate !== 'function')
    throw new Error('SLH-DSA state storage is unavailable');

  const readEnvelope = async (
    keyId: string,
    assertOwner: SlhDsaStateOwner,
    reader: SlhDsaStateStorage['read'] = read
  ): Promise<EncryptedSLHDSAStateEnvelope | null> => {
    assertSlhDsaStateOwner(assertOwner);
    const entry = await reader(getSLHDSAStateStorageKey(keyId));
    assertSlhDsaStateOwner(assertOwner);
    return entry.present ? snapshotEnvelope(entry.value, keyId) : null;
  };

  return Object.freeze({
    async save(
      state: SLHDSAProvisionedState,
      crypto: Pick<SLHDSASessionStateCrypto, 'encrypt'>,
      assertOwner: SlhDsaStateOwner
    ): Promise<void> {
      assertSlhDsaStateOwner(assertOwner);
      validateSLHDSAProvisionedState(state);
      const keyId = state.keyId;
      const storageKey = getSLHDSAStateStorageKey(keyId);
      const plainText = JSON.stringify(state);
      const cipherText = await crypto.encrypt(plainText, keyId);
      assertSlhDsaStateOwner(assertOwner);
      if (typeof cipherText !== 'string' || !cipherText)
        throw new Error(
          'Invalid SLH-DSA encrypted state; usage history is unsafe'
        );
      const envelope: EncryptedSLHDSAStateEnvelope = {
        cipherText,
        keyId,
        updatedAt: Date.now(),
        version: SLH_DSA_STATE_VERSION,
      };
      // Encryption stays outside the host mutation barrier. The same owner
      // binds write and readback, including usage accounting after UI retirement.
      await mutate(assertOwner, async (transaction) => {
        assertSlhDsaStateOwner(assertOwner);
        await transaction.write(storageKey, envelope);
        assertSlhDsaStateOwner(assertOwner);
        const saved = await readEnvelope(keyId, assertOwner, transaction.read);
        if (!saved || JSON.stringify(saved) !== JSON.stringify(envelope))
          throw new Error(
            `Failed to persist SLH-DSA encrypted local signer state at ${storageKey}`
          );
      });
      assertSlhDsaStateOwner(assertOwner);
    },
    async load({
      crypto,
      keyId,
      assertOwner,
    }: {
      assertOwner: SlhDsaStateOwner;
      crypto: Pick<SLHDSASessionStateCrypto, 'decrypt'>;
      keyId: string;
    }): Promise<SLHDSAProvisionedState | null> {
      const envelope = await readEnvelope(keyId, assertOwner);
      if (!envelope) return null;
      const plainText = await crypto.decrypt(envelope.cipherText, keyId);
      assertSlhDsaStateOwner(assertOwner);
      const state = JSON.parse(plainText);
      validateSLHDSAProvisionedState(state);
      if (state.keyId !== keyId)
        throw new Error(
          'SLH-DSA local signer state belongs to a different key'
        );
      return state;
    },
    async remove(keyId: string, assertOwner: SlhDsaStateOwner): Promise<void> {
      assertSlhDsaStateOwner(assertOwner);
      await mutate(assertOwner, async (transaction) => {
        assertSlhDsaStateOwner(assertOwner);
        await transaction.remove(getSLHDSAStateStorageKey(keyId));
        assertSlhDsaStateOwner(assertOwner);
      });
      assertSlhDsaStateOwner(assertOwner);
    },
  });
}
