import type { IEncryptedPrivateRecord } from '@sidhujag/sysweb3-keyring';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import {
  getSLHDSAKeyId,
  SLH_DSA_PARAMETER_SET,
} from '../../../../source/utils/slhDsa/constants.ts';
import { getSLHDSADerivationLabel } from '../../../../source/utils/slhDsa/derivation.ts';
import { normalizeSLHDSAPublicKeyField } from '../../../../source/utils/slhDsa/hex.ts';
import type {
  NativeSlhPublicState,
  NativeSlhPublicStates,
} from '../smartAccount/slhDsaRuntime.ts';
import { encodeAccountRecord } from '../storage/accountRecordKey.ts';
import { PUBLIC_SESSION_RECORD_KEY, decodePublicSessionRecord, encodePublicSessionRecord } from '../storage/publicSessionRecordKey.ts';
import type { WalletIdentityRead } from '../storage/types.ts';
import type { NativeAccountRecord } from './walletCatalogue.ts';

export const NATIVE_PUBLIC_SESSION_KEY = PUBLIC_SESSION_RECORD_KEY;
export const NATIVE_PUBLIC_RECORD_DOMAINS = Object.freeze([
  'org.syscoin.pali.evm.signed.root.v1',
  'org.syscoin.pali.evm.signed.chunk.v1',
  'org.syscoin.pali.utxo.signed.root.v1',
  'org.syscoin.pali.utxo.signed.chunk.v1',
]);
type PublicStateRow = Readonly<{
  keyId: string;
  state: NativeSlhPublicState;
  seal: string;
}>;
export type NativePublicSessionRecord = Readonly<{
  version: 1;
  checkpoint: IEncryptedPrivateRecord;
  slhStates: readonly PublicStateRow[];
}>;
type CheckpointKeyring = Readonly<{
  createPublicSessionCheckpoint(
    input: Readonly<{
      walletBindingId: string;
      publicState: Uint8Array;
      recordDomains: readonly string[];
    }>,
    guard: () => void
  ): Promise<IEncryptedPrivateRecord>;
}>;
const invalid = (): never => {
  throw Error('NATIVE_PUBLIC_SESSION_INVALID');
};
const fields = (
  value: unknown,
  names: readonly string[]
): Record<string, any> => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    return invalid();
  return value as Record<string, any>;
};
function publicRows(states: NativeSlhPublicStates): readonly PublicStateRow[] {
  return [...states]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([keyId, row]) =>
      Object.freeze({ keyId, state: row.state, seal: row.seal })
    );
}
export function captureNativePublicSessionRecord(
  input: unknown
): NativePublicSessionRecord {
  const value = fields(decodePublicSessionRecord(encodePublicSessionRecord(input)), [
    'version',
    'checkpoint',
    'slhStates',
  ]);
  if (
    value.version !== 1 ||
    !Array.isArray(value.slhStates) ||
    value.slhStates.length > 4096
  )
    return invalid();
  const checkpoint = fields(value.checkpoint, [
    'version',
    'domain',
    'recordId',
    'profileId',
    'nonce',
    'ciphertext',
  ]);
  if (
    checkpoint.version !== 1 ||
    checkpoint.domain !== 'sysweb3.public-session.v1' ||
    !/^[0-9a-f]{64}$/.test(checkpoint.recordId) ||
    !/^0x[0-9a-f]{64}$/.test(checkpoint.profileId) ||
    typeof checkpoint.nonce !== 'string' ||
    typeof checkpoint.ciphertext !== 'string'
  )
    return invalid();
  const seen = new Set<string>();
  const slhStates = value.slhStates.map((input: unknown) => {
    const row = fields(input, ['keyId', 'state', 'seal']);
    const state = fields(row.state, [
      'accountIndex',
      'derivationLabel',
      'keyId',
      'parameterSet',
      'pkRoot',
      'pkSeed',
      'signatureCount',
      'signatureLimit',
    ]);
    if (
      typeof row.keyId !== 'string' ||
      seen.has(row.keyId) ||
      typeof row.seal !== 'string' ||
      !row.seal ||
      state.keyId !== row.keyId ||
      state.parameterSet !== SLH_DSA_PARAMETER_SET ||
      !Number.isSafeInteger(state.accountIndex) ||
      state.accountIndex < 0 ||
      state.derivationLabel !== getSLHDSADerivationLabel(state.accountIndex) ||
      !Number.isSafeInteger(state.signatureCount) ||
      !Number.isSafeInteger(state.signatureLimit) ||
      state.signatureCount < 0 ||
      state.signatureLimit < state.signatureCount ||
      getSLHDSAKeyId({
        pkRoot: normalizeSLHDSAPublicKeyField(state.pkRoot),
        pkSeed: normalizeSLHDSAPublicKeyField(state.pkSeed),
      }) !== row.keyId
    )
      return invalid();
    seen.add(row.keyId);
    return Object.freeze({
      keyId: row.keyId,
      state: Object.freeze(state) as NativeSlhPublicState,
      seal: row.seal,
    });
  });
  return Object.freeze({
    version: 1,
    checkpoint: Object.freeze(checkpoint) as IEncryptedPrivateRecord,
    slhStates: Object.freeze(slhStates),
  });
}

/** No labels, balance caches or active selection can attest new account/key identity. */
export function nativePublicSessionManifest(
  records: NativeAccountRecord,
  identity: WalletIdentityRead,
  slhStates: readonly PublicStateRow[]
): Uint8Array {
  if (!identity.root || records.walletFingerprint !== identity.walletBindingId)
    return invalid();
  const publicMutable = new Set([
    'label',
    'balances',
    'nativeBalanceCache',
    'evmTxCountByChainId',
    'smartAccountUserOpScanByChainId',
  ]);
  const groups = records.groups.map((group) => ({
    key: group.key,
    kind: group.activeNetwork.kind,
    slip44: group.activeNetwork.slip44,
    accounts: Object.fromEntries(
      Object.entries(group.accounts).map(([kind, accounts]) => [
        kind,
        Object.fromEntries(
          Object.entries(accounts).map(([id, account]) => [
            id,
            Object.fromEntries(
              Object.entries(account).filter(([key]) => !publicMutable.has(key)).map(([key, value]) => [key,
                key === 'smartAccount' && value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([name]) =>
                  !['auth', 'availableModules', 'installedModules', 'isDeployed', 'customModules'].includes(name))) : value])
            ),
          ])
        ),
      ])
    ),
  }));
  const value = {
    version: 1,
    walletBindingId: identity.walletBindingId,
    root: identity.root,
    groups,
    networks: records.networks,
    recovery: records.recovery,
    slhStates,
  };
  const canonical = (input: any): any =>
    Array.isArray(input)
      ? input.map(canonical)
      : input && typeof input === 'object'
      ? Object.fromEntries(
          Object.keys(input)
            .sort()
            .map((key) => [key, canonical(input[key])])
        )
      : input;
  return new TextEncoder().encode(encodeAccountRecord(canonical(value)));
}

export async function createNativePublicSessionRecord(
  keyring: CheckpointKeyring,
  records: NativeAccountRecord,
  identity: WalletIdentityRead,
  states: NativeSlhPublicStates,
  guard: () => void
): Promise<NativePublicSessionRecord> {
  assertSynchronousEvmFeeGuard(guard);
  const slhStates = publicRows(states),
    publicState = nativePublicSessionManifest(records, identity, slhStates);
  try {
    const checkpoint = await keyring.createPublicSessionCheckpoint(
      {
        walletBindingId: identity.walletBindingId,
        publicState,
        recordDomains: NATIVE_PUBLIC_RECORD_DOMAINS,
      },
      guard
    );
    assertSynchronousEvmFeeGuard(guard);
    return captureNativePublicSessionRecord({
      version: 1,
      checkpoint,
      slhStates,
    });
  } finally {
    publicState.fill(0);
  }
}
export function nativePublicSessionRestoreRequest(
  record: NativePublicSessionRecord,
  records: NativeAccountRecord,
  identity: WalletIdentityRead
) {
  return Object.freeze({
    checkpoint: record.checkpoint,
    walletBindingId: identity.walletBindingId,
    publicState: nativePublicSessionManifest(
      records,
      identity,
      record.slhStates
    ),
    recordDomains: NATIVE_PUBLIC_RECORD_DOMAINS,
  });
}
/** Only use after SDK authenticated the exact manifest including these public rows. */
export function nativePublicSessionSlhStates(
  record: NativePublicSessionRecord
): NativeSlhPublicStates {
  return new Map(
    record.slhStates.map((row) => [
      row.keyId,
      Object.freeze({ state: row.state, seal: row.seal }),
    ])
  );
}
