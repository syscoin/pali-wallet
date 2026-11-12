import { utils as syscoinUtils } from 'syscoinjs-lib';
import { isSentryKeyValidationBusy } from '../core/sentryKeyValidation.ts';

import type { SentryNetwork } from '../../../../source/shared/sentryNetworks.ts';
import {
  normalizeSentryKeyImportEntries,
  parseSentryKeyBatch,
  type SentryImportIssue,
} from '../../../../source/utils/sentry/importBatch.ts';
import {
  createSentryKeyVault,
  isAllowedSentryKeyRoleScheme,
  isSentryAuthorityPublicKey,
  type ISentryKeyVaultHost,
  type SentryAuthorityKey,
  type SentryAuthorityScheme,
  type SentryKeySummary,
} from '../../../../source/wallet/sentryKeyVault.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { normalizeSentryServiceSettings, readSentryServiceSettings, type SentryServiceSettings } from '../../../../source/shared/sentrySettings.ts';

type Role = SentryAuthorityKey['role'];
type PublicKey = Readonly<SentryKeySummary>;
type Secret = Uint8Array<ArrayBuffer>;
type KeyDetails = Readonly<Omit<SentryAuthorityKey, 'secretKey'>>;
type PreparedKey = Readonly<{ key: KeyDetails; label: string; secret: Secret }>;
export type SentryKeyImportReview = Readonly<{
  expiresAt: number;
  network: SentryNetwork;
  keys: readonly Readonly<Omit<SentryKeySummary, 'id' | 'network'>>[];
}>;
export type SentryKeyRemovalReview = Readonly<{ expiresAt: number; key: PublicKey }>;
/**
 * Borrow exact-sized input only until this call returns. The executor must
 * copy synchronously and settle only after any started native work has
 * drained and erased its copy, even after cancellation.
 */
export type DeriveSentryPublicKey = (
  role: Role,
  scheme: SentryAuthorityScheme,
  secretKey: Secret,
  signal: AbortSignal
) => Promise<string>;

export class NativeSentryKeysError extends Error {
  readonly code:
    | 'INVALID_INPUT'
    | 'DUPLICATE'
    | 'CANCELLED'
    | 'BUSY'
    | 'BACKUP_REQUIRED';
  readonly issues: readonly SentryImportIssue[];
  constructor(
    code: NativeSentryKeysError['code'],
    issues: readonly SentryImportIssue[] = []
  ) {
    super(code);
    this.name = 'NativeSentryKeysError';
    this.code = code;
    this.issues = Object.freeze(
      issues.map(({ line, reason }) => Object.freeze({ line, reason }))
    );
  }
}

const REVIEW_MS = 90_000;
const toSecretHex = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
const changed = () => new NativeSentryKeysError('CANCELLED');
const invalid = (issues?: readonly SentryImportIssue[]) =>
  new NativeSentryKeysError('INVALID_INPUT', issues);
type Approval = Readonly<{
  controller: AbortController;
  deadline: number;
  secrets: Secret[];
}>;
type Pending = Readonly<{ approval: Approval }> &
  (
    | {
        kind: 'import';
        review: SentryKeyImportReview;
        keys: readonly PreparedKey[];
      }
    | { kind: 'remove'; review: SentryKeyRemovalReview }
  );

type Ports = Readonly<{
  assertCurrent(): void;
  authenticate(check: () => void, signal: AbortSignal): Promise<void>;
  derivePublicKey: DeriveSentryPublicKey;
  lifetime: AbortSignal;
  network: SentryNetwork;
  readSeed(check: () => void, signal: AbortSignal): Promise<string>;
  run<T>(operation: () => Promise<T>): Promise<T>;
  vaultHost: ISentryKeyVaultHost;
  vaultId: string;
  readSettings(): Promise<unknown>;
  writeSettings(settings: SentryServiceSettings, assertCurrent: () => void): Promise<void>;
}>;

/** One foreground-owned local key review. No operation/signing or secret-return port. */
export function createNativeSentryKeyManagement(ports: Ports) {
  const { derivePublicKey, lifetime, network, vaultId } = ports;
  const vault = createSentryKeyVault(ports.vaultHost);
  let activeApproval: Approval | undefined;
  let pending: Pending | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let settingsOperation: AbortController | undefined;
  let authentication: { signal: AbortSignal } | undefined;
  async function authenticating<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const owned = { signal };
    authentication = owned;
    try { return await work(); }
    finally { if (authentication === owned) authentication = undefined; }
  }

  function retire(approval = activeApproval) {
    if (approval !== activeApproval) return;
    activeApproval = undefined;
    pending = undefined;
    clearTimeout(expiry);
    expiry = undefined;
    if (approval) {
      eraseSecrets(approval);
      approval.controller.abort();
    }
  }

  function eraseSecrets({ secrets }: Approval) {
    for (const secret of secrets) secret.fill(0);
    secrets.length = 0;
  }

  function check(approval?: Approval) {
    const isCurrent = () =>
      !disposed &&
      !lifetime.aborted &&
      (!approval ||
        (approval === activeApproval && performance.now() < approval.deadline));
    try {
      if (!isCurrent()) throw changed();
      const result: unknown = ports.assertCurrent();
      if (result !== undefined) {
        if (result && (typeof result === 'object' || typeof result === 'function'))
          void Promise.resolve(result).catch(() => undefined);
        throw changed();
      }
      if (!isCurrent()) throw changed();
    } catch (error) {
      retire(approval);
      throw error;
    }
  }

  function dispose() {
    disposed = true;
    settingsOperation?.abort();
    lifetime.removeEventListener('abort', dispose);
    retire();
  }
  check();
  lifetime.addEventListener('abort', dispose, { once: true });

  async function prepare<T extends Pending>(
    review: (approval: Approval) => Promise<T>
  ): Promise<T['review']> {
    check();
    retire();
    const approval: Approval = {
      controller: new AbortController(),
      deadline: performance.now() + REVIEW_MS,
      secrets: [],
    };
    activeApproval = approval;
    expiry = setTimeout(() => retire(approval), REVIEW_MS);
    try {
      const next = await review(approval);
      check(approval);
      pending = next;
      return next.review;
    } catch (error) {
      retire(approval);
      throw error;
    }
  }
  async function inventory(approval?: Approval) {
    check(approval);
    const keys = await vault.listSentryKeys(vaultId, network);
    check(approval);
    return Object.freeze(keys.map((key) => Object.freeze(key)));
  }
  function take(
    kind: 'import',
    review: SentryKeyImportReview
  ): Extract<Pending, { kind: 'import' }>;
  function take(
    kind: 'remove',
    review: SentryKeyRemovalReview
  ): Extract<Pending, { kind: 'remove' }>;
  function take(kind: Pending['kind'], review: Pending['review']): Pending {
    check();
    const owned = pending;
    if (!owned || owned.kind !== kind || owned.review !== review)
      throw changed();
    pending = undefined;
    check(owned.approval);
    return owned;
  }
  const keyIdentity = ({
    role,
    scheme,
    publicKey,
  }: Pick<SentryAuthorityKey, 'role' | 'scheme' | 'publicKey'>) =>
    role + ':' + scheme + ':' + publicKey;

  function readEntries(
    input: string,
    scheme: SentryAuthorityScheme,
    approval: Approval
  ) {
    const parsed = parseSentryKeyBatch(input, scheme);
    if (!parsed.entries.length || parsed.issues.length)
      throw invalid(parsed.issues);
    try {
      return normalizeSentryKeyImportEntries(parsed.entries, scheme, (wif) => {
        const privateKey = syscoinUtils.bitcoinjs.ECPair.fromWIF(
          wif,
          syscoinUtils.syscoinNetworks[network]
        ).privateKey;
        if (!privateKey) throw invalid();
        try {
          return toSecretHex(privateKey);
        } finally {
          privateKey.fill(0);
        }
      }).map(({ label, secretKey }, index) => {
        const secret = new Uint8Array(secretKey.length / 2);
        approval.secrets.push(secret);
        for (let offset = 0; offset < secret.length; offset++)
          secret[offset] = Number.parseInt(
            secretKey.slice(offset * 2, offset * 2 + 2),
            16
          );
        return { label, line: parsed.entries[index]!.line, secret };
      });
    } catch {
      throw invalid();
    }
  }

  function derive(
    role: Role,
    scheme: SentryAuthorityScheme,
    secret: Secret,
    approval: Approval
  ) {
    const borrowed = secret.slice();
    try {
      return derivePublicKey(
        role,
        scheme,
        borrowed,
        approval.controller.signal
      );
    } finally {
      borrowed.fill(0);
    }
  }

  function checkSettings(assertCurrent: () => void) {
    check();
    try { assertSynchronousEvmFeeGuard(assertCurrent); }
    catch { throw changed(); }
    check();
  }

  return Object.freeze({
    isAuthenticating: () => !disposed && !lifetime.aborted && !!authentication && !authentication.signal.aborted,
    getSettings(assertCurrent: () => void) {
      checkSettings(assertCurrent);
      return ports.run(async () => {
        checkSettings(assertCurrent);
        const saved = await ports.readSettings();
        checkSettings(assertCurrent);
        return readSentryServiceSettings(saved, network);
      });
    },
    saveSettings(input: SentryServiceSettings, assertRequestCurrent: () => void) {
      const settings = normalizeSentryServiceSettings(input);
      checkSettings(assertRequestCurrent);
      return ports.run(async () => {
        const operation = new AbortController();
        settingsOperation = operation;
        const assertCurrent = () => {
          checkSettings(assertRequestCurrent);
          if (settingsOperation !== operation || operation.signal.aborted) throw changed();
        };
        try {
          assertCurrent();
          await authenticating(operation.signal, () => ports.authenticate(assertCurrent, operation.signal));
          assertCurrent();
          await ports.writeSettings(settings, assertCurrent);
          assertCurrent();
          return settings;
        } finally {
          operation.abort();
          if (settingsOperation === operation) settingsOperation = undefined;
        }
      });
    },
    list() {
      return ports.run(() => inventory());
    },
    prepareImport(input: string, role: Role, scheme: SentryAuthorityScheme) {
      return ports.run(() =>
        prepare(async (approval) => {
          let entries: ReturnType<typeof readEntries>;
          try {
            if (
              typeof input !== 'string' ||
              !isAllowedSentryKeyRoleScheme(role, scheme)
            )
              throw invalid();
            entries = readEntries(input, scheme, approval);
          } finally {
            input = '';
          }
          const known = new Set((await inventory(approval)).map(keyIdentity));
          const keys: PreparedKey[] = [];
          for (const { label, line, secret } of entries) {
            check(approval);
            let publicKey: unknown;
            try {
              publicKey = await derive(role, scheme, secret, approval);
            } catch (error) {
              check(approval);
              if (isSentryKeyValidationBusy(error)) throw new NativeSentryKeysError('BUSY');
              throw invalid([{ line, reason: 'key' }]);
            }
            check(approval);
            if (!isSentryAuthorityPublicKey(scheme, publicKey))
              throw invalid([{ line, reason: 'key' }]);
            const key = { role, scheme, publicKey };
            const identity = keyIdentity(key);
            if (known.has(identity))
              throw new NativeSentryKeysError('DUPLICATE');
            known.add(identity);
            keys.push({ key, label, secret });
          }
          const review: SentryKeyImportReview = Object.freeze({
            expiresAt: approval.deadline,
            network,
            keys: Object.freeze(
              keys.map(({ label, key }) =>
                Object.freeze({
                  label,
                  role: key.role,
                  scheme: key.scheme,
                  publicKey: key.publicKey,
                })
              )
            ),
          });
          return { approval, kind: 'import' as const, review, keys };
        })
      );
    },
    confirmImport(review: SentryKeyImportReview) {
      return ports.run(async () => {
        const owned = take('import', review);
        const assertCurrent = () => check(owned.approval);
        try {
          const seed = await authenticating(owned.approval.controller.signal, () => ports.readSeed(assertCurrent, owned.approval.controller.signal));
          assertCurrent();
          const entries = owned.keys.map(({ key, label, secret }) => ({
            label,
            key: {
              ...key,
              secretKey: toSecretHex(secret),
            },
          }));
          eraseSecrets(owned.approval);
          const saved = await vault.saveSentryKeys({
            assertCurrent,
            entries,
            network,
            seed,
            vaultId,
          });
          assertCurrent();
          return Object.freeze(saved.map((key) => Object.freeze(key)));
        } finally {
          retire(owned.approval);
        }
      });
    },
    prepareRemoval(id: string) {
      return ports.run(() =>
        prepare(async (approval) => {
          const key = (await inventory(approval)).find(
            (item) => item.id === id
          );
          if (!key) throw changed();
          return {
            approval,
            kind: 'remove' as const,
            review: Object.freeze({ expiresAt: approval.deadline, key }),
          };
        })
      );
    },
    confirmRemoval(
      review: SentryKeyRemovalReview,
      hasBackup: boolean
    ) {
      return ports.run(async () => {
        if (hasBackup !== true)
          throw new NativeSentryKeysError('BACKUP_REQUIRED');
        const owned = take('remove', review);
        const assertCurrent = () => check(owned.approval);
        try {
          await authenticating(owned.approval.controller.signal, () => ports.authenticate(assertCurrent, owned.approval.controller.signal));
          assertCurrent();
          const { key } = owned.review;
          const fresh = (await inventory(owned.approval)).find(
            ({ id }) => id === key.id
          );
          if (
            !fresh ||
            keyIdentity(fresh) !== keyIdentity(key) ||
            fresh.label !== key.label
          )
            throw changed();
          await vault.removeSentryKey(vaultId, network, key.id, assertCurrent);
          assertCurrent();
          return Object.freeze({ removedKeyId: key.id });
        } finally {
          retire(owned.approval);
        }
      });
    },
    cancel() { settingsOperation?.abort(); retire(); },
    dispose,
  });
}

export type NativeSentryKeyManagement = ReturnType<
  typeof createNativeSentryKeyManagement
>;
