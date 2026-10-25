import { useCallback, useEffect, useRef, useState } from 'react';

import { useController } from 'hooks/useController';
import type { IPrivateNoteView } from 'utils/privacy/privateVaultTypes';
import { PRIVACY_POOLS } from 'utils/privacy/registry';

// Keep only the non-secret projection returned by the background vault.
export function readPrivateNote(value: unknown): IPrivateNoteView {
  const note = value as IPrivateNoteView | null;
  const pool = PRIVACY_POOLS.find(({ id }) => id === note?.poolId);
  if (
    !note ||
    typeof note.id !== 'string' ||
    !note.id ||
    note.id.length > 128 ||
    !pool ||
    note.amount !== pool.amount ||
    !Number.isSafeInteger(note.createdAt) ||
    note.createdAt < 0 ||
    !['verified', 'spent', 'waiting', 'not-found'].includes(note.phase) ||
    (note.blockNumber !== undefined &&
      (!Number.isSafeInteger(note.blockNumber) || note.blockNumber < 0))
  ) {
    throw new Error('privacy_note_response_invalid');
  }
  return {
    id: note.id,
    poolId: pool.id,
    amount: pool.amount,
    createdAt: note.createdAt,
    phase: note.phase,
    ...(note.blockNumber === undefined
      ? {}
      : { blockNumber: note.blockNumber }),
  };
}

export function usePrivateNotes() {
  const { controllerEmitter } = useController();
  const [notes, setNotes] = useState<IPrivateNoteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const owner = useRef({ active: false, pending: false, request: 0 });
  const isActive = useCallback(
    () => owner.current.active && document.visibilityState !== 'hidden',
    []
  );
  const refresh = useCallback(
    async (quiet = false) => {
      if (!isActive() || (quiet && owner.current.pending)) return;
      const request = ++owner.current.request;
      owner.current.pending = true;
      if (!quiet) setLoading(true);
      try {
        const response = await controllerEmitter(
          ['privateVault', 'getNotes'],
          [],
          10000,
          false
        );
        if (!isActive() || owner.current.request !== request) return;
        const envelope = response as { notes?: unknown } | null;
        if (!envelope || !Array.isArray(envelope.notes)) {
          throw new Error('privacy_note_response_invalid');
        }
        const next = envelope.notes.map(readPrivateNote);
        if (new Set(next.map(({ id }) => id)).size !== next.length) {
          throw new Error('privacy_note_response_invalid');
        }
        setNotes(next);
        setUnavailable(false);
      } catch {
        if (isActive() && owner.current.request === request)
          setUnavailable(true);
      } finally {
        if (isActive() && owner.current.request === request) {
          owner.current.pending = false;
          setLoading(false);
        }
      }
    },
    [controllerEmitter, isActive]
  );

  useEffect(() => {
    owner.current.active = true;
    void refresh();
    return () => {
      owner.current.active = false;
      owner.current.pending = false;
      owner.current.request += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!notes.length) return;
    // This only rereads the background's local cache. Keep existing rows on
    // screen, and never overlap a pending refresh or poll an unused vault.
    const timer = setInterval(() => void refresh(true), 15000);
    return () => clearInterval(timer);
  }, [notes.length, refresh]);

  const remember = useCallback(
    (value: unknown) => {
      const note = readPrivateNote(value);
      if (isActive()) {
        // A list request begun before this import must not erase the new entry.
        owner.current.request += 1;
        owner.current.pending = false;
        setLoading(false);
        setUnavailable(false);
        setNotes((current) => [
          note,
          ...current.filter(({ id }) => id !== note.id),
        ]);
      }
    },
    [isActive]
  );

  return { controllerEmitter, loading, notes, refresh, remember, unavailable };
}
