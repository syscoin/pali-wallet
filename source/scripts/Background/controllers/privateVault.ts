import { walletPersistenceMutex } from 'utils/asyncMutex';
import { identifyClassicNote, IClassicNoteIdentity } from 'utils/privacy/note';
import type {
  IPrivacyNoteReader,
  IPrivateNoteStatus,
  IPrivateNoteView,
  IPrivateVaultController,
} from 'utils/privacy/privateVaultTypes';
import { getPrivacyPool } from 'utils/privacy/registry';
import { chromeStorage } from 'utils/storageAPI';

import type {
  IEncryptedPrivateRecord,
  KeyringManager,
} from '@sidhujag/sysweb3-keyring';

export const PRIVATE_VAULT_STORAGE_PREFIX = 'state-private-vault-v1:';
export const PRIVATE_VAULT_DOMAIN = 'org.syscoin.pali.privacy.notes.v1';
const MAX_NOTES = 128;
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const PROFILE = /^0x[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PUBLIC_ERRORS = new Set([
  'privacy_note_invalid',
  'privacy_note_limit',
  'privacy_note_missing',
  'privacy_note_not_found',
  'privacy_vault_corrupt',
  'privacy_vault_locked',
  'privacy_vault_session_changed',
  'privacy_vault_unavailable',
  'privacy_verification_pending',
]);

export interface IPrivateVaultSession {
  assertCurrent: () => void;
  generation: number;
  keyring: Pick<
    KeyringManager,
    | 'getPrivateRecordProfileId'
    | 'encryptPrivateRecord'
    | 'decryptPrivateRecord'
  >;
}

interface IHost {
  authenticate: (
    password: string,
    session: IPrivateVaultSession,
    reveal: () => Promise<string>
  ) => Promise<string>;
  captureSession: () => IPrivateVaultSession;
  readNote: IPrivacyNoteReader;
}

interface IStoredNote {
  createdAt: number;
  id: string;
  note: string;
}
interface IManifest {
  notes: IStoredNote[];
  version: 1;
}
interface IContext {
  profileId: string;
  session: IPrivateVaultSession;
}
interface IDependencies {
  identify?: typeof identifyClassicNote;
  mutex?: Pick<typeof walletPersistenceMutex, 'runExclusive'>;
  now?: () => number;
  randomId?: () => string;
  storage?: Pick<typeof chromeStorage, 'getItem' | 'setItem'>;
}

const publicError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : '';
  if (PUBLIC_ERRORS.has(message)) return new Error(message);
  if (message === 'Private record session changed')
    return new Error('privacy_vault_session_changed');
  if (
    message === 'Invalid password' ||
    /^Too many failed attempts\. Please wait \d+ seconds before trying again\.$/.test(
      message
    )
  )
    return new Error(message);
  return new Error('privacy_vault_unavailable');
};

/** Local-only custody. No plaintext manifest is retained between operations. */
export function createPrivateVaultController(
  host: IHost,
  dependencies: IDependencies = {}
): IPrivateVaultController {
  const storage = dependencies.storage || chromeStorage;
  const mutex = dependencies.mutex || walletPersistenceMutex;
  const identify = dependencies.identify || identifyClassicNote;
  const now = dependencies.now || Date.now;
  const randomId = dependencies.randomId || (() => crypto.randomUUID());

  const checked = async <T>(
    context: IContext,
    value: Promise<T>
  ): Promise<T> => {
    const result = await value;
    try {
      context.session.assertCurrent();
    } catch (error) {
      if (result instanceof Uint8Array) result.fill(0);
      throw error;
    }
    return result;
  };

  const capture = async (): Promise<IContext> => {
    const session = host.captureSession();
    session.assertCurrent();
    const profileId = await session.keyring.getPrivateRecordProfileId();
    session.assertCurrent();
    if (
      typeof profileId !== 'string' ||
      profileId.length !== 66 ||
      !PROFILE.test(profileId)
    )
      throw new Error('privacy_vault_unavailable');
    return { session, profileId };
  };

  const assertProfile = async (context: IContext) => {
    context.session.assertCurrent();
    const current = await checked(
      context,
      context.session.keyring.getPrivateRecordProfileId()
    );
    if (current !== context.profileId)
      throw new Error('privacy_vault_session_changed');
  };

  const nextId = () => {
    const id = randomId();
    if (typeof id !== 'string' || id.length !== 36 || !UUID.test(id))
      throw new Error('privacy_vault_unavailable');
    return id;
  };

  const load = async (
    context: IContext
  ): Promise<{
    manifest: IManifest;
    recordId?: string;
  }> => {
    const envelope = await checked(
      context,
      storage.getItem(PRIVATE_VAULT_STORAGE_PREFIX + context.profileId)
    );
    if (envelope === null || envelope === undefined)
      return { manifest: { version: 1, notes: [] } };
    if (
      typeof envelope !== 'object' ||
      envelope.version !== 1 ||
      envelope.domain !== PRIVATE_VAULT_DOMAIN ||
      envelope.profileId !== context.profileId ||
      typeof envelope.recordId !== 'string' ||
      envelope.recordId.length !== 36 ||
      !UUID.test(envelope.recordId)
    )
      throw new Error('privacy_vault_corrupt');
    const plaintext = await checked(
      context,
      context.session.keyring.decryptPrivateRecord({
        domain: PRIVATE_VAULT_DOMAIN,
        recordId: envelope.recordId,
        envelope: envelope as IEncryptedPrivateRecord,
      })
    );
    try {
      if (
        !(plaintext instanceof Uint8Array) ||
        plaintext.length > MAX_PLAINTEXT_BYTES
      )
        throw new Error('privacy_vault_corrupt');
      const data = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
      );
      if (
        !data ||
        data.version !== 1 ||
        !Array.isArray(data.notes) ||
        data.notes.length > MAX_NOTES
      )
        throw new Error('privacy_vault_corrupt');
      const ids = new Set<string>();
      const commitments = new Set<string>();
      const notes = data.notes.map((entry: IStoredNote) => {
        if (
          !entry ||
          typeof entry.id !== 'string' ||
          entry.id.length !== 36 ||
          !UUID.test(entry.id) ||
          ids.has(entry.id) ||
          !Number.isSafeInteger(entry.createdAt) ||
          entry.createdAt < 0 ||
          typeof entry.note !== 'string' ||
          entry.note.length > 256 ||
          entry.note !== entry.note.trim().toLowerCase()
        )
          throw new Error('privacy_vault_corrupt');
        const identity = identify(entry.note);
        const key = `${identity.poolId}:${identity.commitment}`;
        if (commitments.has(key)) throw new Error('privacy_vault_corrupt');
        commitments.add(key);
        ids.add(entry.id);
        return { id: entry.id, note: entry.note, createdAt: entry.createdAt };
      });
      return { manifest: { version: 1, notes }, recordId: envelope.recordId };
    } catch {
      throw new Error('privacy_vault_corrupt');
    } finally {
      plaintext.fill(0);
    }
  };

  const readStatus = async (
    context: IContext,
    identity: IClassicNoteIdentity
  ): Promise<IPrivateNoteStatus> => {
    const status = await checked(context, host.readNote(identity));
    if (
      !status ||
      !['verified', 'spent', 'waiting', 'not-found'].includes(status.phase) ||
      (status.blockNumber !== undefined &&
        (!Number.isSafeInteger(status.blockNumber) || status.blockNumber < 0))
    )
      throw new Error('privacy_vault_unavailable');
    return {
      phase: status.phase,
      ...(status.blockNumber === undefined
        ? {}
        : { blockNumber: status.blockNumber }),
    };
  };

  const view = (
    note: IStoredNote,
    identity: IClassicNoteIdentity,
    status: IPrivateNoteStatus
  ): IPrivateNoteView => ({
    id: note.id,
    poolId: identity.poolId,
    amount: getPrivacyPool(identity.poolId).amount,
    createdAt: note.createdAt,
    ...status,
  });

  return {
    getNotes: async () => {
      try {
        const context = await capture();
        return await mutex.runExclusive(async () => {
          context.session.assertCurrent();
          const { manifest } = await load(context);
          const notes: IPrivateNoteView[] = [];
          for (const note of manifest.notes) {
            const identity = identify(note.note);
            notes.push(
              view(note, identity, await readStatus(context, identity))
            );
          }
          await assertProfile(context);
          return { notes };
        });
      } catch (error) {
        throw publicError(error);
      }
    },
    importNote: async (rawNote) => {
      try {
        const identity = identify(rawNote);
        const normalized = rawNote.trim().toLowerCase();
        const context = await capture();
        return await mutex.runExclusive(async () => {
          context.session.assertCurrent();
          const { manifest, recordId } = await load(context);
          const status = await readStatus(context, identity);
          if (status.phase === 'waiting')
            throw new Error('privacy_verification_pending');
          if (status.phase === 'not-found')
            throw new Error('privacy_note_not_found');
          const existing = manifest.notes.find((entry) => {
            const candidate = identify(entry.note);
            return (
              candidate.poolId === identity.poolId &&
              candidate.commitment === identity.commitment
            );
          });
          if (existing) {
            await assertProfile(context);
            return view(existing, identity, status);
          }
          if (manifest.notes.length >= MAX_NOTES)
            throw new Error('privacy_note_limit');
          const note: IStoredNote = {
            id: nextId(),
            note: normalized,
            createdAt: now(),
          };
          if (
            !Number.isSafeInteger(note.createdAt) ||
            note.createdAt < 0 ||
            manifest.notes.some((item) => item.id === note.id)
          )
            throw new Error('privacy_vault_unavailable');
          const plaintext = new TextEncoder().encode(
            JSON.stringify({ version: 1, notes: [...manifest.notes, note] })
          );
          try {
            if (plaintext.length > MAX_PLAINTEXT_BYTES)
              throw new Error('privacy_note_limit');
            const envelope = await checked(
              context,
              context.session.keyring.encryptPrivateRecord({
                domain: PRIVATE_VAULT_DOMAIN,
                recordId: recordId || nextId(),
                plaintext,
              })
            );
            if (
              envelope.profileId !== context.profileId ||
              envelope.domain !== PRIVATE_VAULT_DOMAIN
            )
              throw new Error('privacy_vault_session_changed');
            await assertProfile(context);
            // Encryption can yield while the user clears or replaces the public
            // snapshot. Admit only against the currently verified local view.
            const admission = await readStatus(context, identity);
            if (admission.phase === 'waiting')
              throw new Error('privacy_verification_pending');
            if (admission.phase === 'not-found')
              throw new Error('privacy_note_not_found');
            await checked(
              context,
              storage.setItem(
                PRIVATE_VAULT_STORAGE_PREFIX + context.profileId,
                envelope
              )
            );
            await assertProfile(context);
            // A successful write owns the note even if its public view changed
            // during storage. Report that current view without discarding it.
            return view(note, identity, await readStatus(context, identity));
          } finally {
            plaintext.fill(0);
          }
        });
      } catch (error) {
        throw publicError(error);
      }
    },
    revealNote: async (id, password) => {
      try {
        if (typeof id !== 'string' || id.length !== 36 || !UUID.test(id))
          throw new Error('privacy_note_missing');
        const context = await capture();
        const result = await host.authenticate(password, context.session, () =>
          mutex.runExclusive(async () => {
            context.session.assertCurrent();
            const { manifest } = await load(context);
            const note = manifest.notes.find((entry) => entry.id === id);
            if (!note) throw new Error('privacy_note_missing');
            await assertProfile(context);
            return note.note;
          })
        );
        await assertProfile(context);
        return result;
      } catch (error) {
        throw publicError(error);
      }
    },
  };
}
