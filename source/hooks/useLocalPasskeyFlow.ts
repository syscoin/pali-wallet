import { useCallback, useEffect, useRef, useState } from 'react';

import { runLocalPasskeyCeremony } from '../utils/passkey/localUnlockCeremony';
import {
  localPasskeyError,
  type LocalPasskeyController,
  type LocalPasskeyStep,
} from '../wallet/localPasskeyTypes';

export type LocalPasskeyAction = 'enroll' | 'unlock' | 'disable';

/** Owns one document's flow, including a begin request whose id has not arrived. */
export function useLocalPasskeyFlow(
  controller: LocalPasskeyController,
  onComplete?: (action: LocalPasskeyAction) => void | Promise<void>
) {
  const owner = useRef({ mounted: false, sequence: 0, controller });
  const active = useRef<{
    abort: AbortController;
    id?: string;
    source: LocalPasskeyController;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const cancel = useCallback(() => {
    const current = active.current;
    active.current = null;
    owner.current.sequence++;
    current?.abort.abort();
    if (current) void current.source.cancel(current.id).catch(() => undefined);
    if (owner.current.mounted) setBusy(false);
  }, []);
  useEffect(() => {
    const current = owner.current;
    current.mounted = true;
    current.controller = controller;
    setBusy(false);
    setError(false);
    return () => {
      current.mounted = false;
      cancel();
      void controller.dispose().catch(() => undefined);
    };
  }, [controller, cancel]);

  const run = async (kind: LocalPasskeyAction, password = '') => {
    if (
      !owner.current.mounted ||
      owner.current.controller !== controller ||
      active.current
    )
      return false;
    const captured = owner.current.sequence;
    const current = {
      abort: new AbortController(),
      id: undefined as string | undefined,
      source: controller,
    };
    const completed = onComplete;
    active.current = current;
    setBusy(true);
    setError(false);
    const check = () => {
      if (
        !owner.current.mounted ||
        owner.current.controller !== controller ||
        owner.current.sequence !== captured ||
        active.current !== current ||
        current.abort.signal.aborted
      )
        throw localPasskeyError();
    };
    try {
      check();
      if (kind === 'disable') {
        await controller.disable(password);
        password = '';
        check();
      } else {
        let step: LocalPasskeyStep;
        try {
          step =
            kind === 'enroll'
              ? await controller.beginEnrollment(password)
              : await controller.beginUnlock();
        } finally {
          password = '';
        }
        current.id = step.operationId;
        check();
        let ceremonies = 0;
        while (step.kind !== 'complete') {
          if (
            ++ceremonies > (kind === 'enroll' ? 2 : 1) ||
            step.operationId !== current.id ||
            (kind === 'enroll'
              ? step.kind !== (ceremonies === 1 ? 'create' : 'get')
              : step.kind !== 'get')
          )
            throw localPasskeyError();
          const response = await runLocalPasskeyCeremony(
            step,
            current.abort.signal,
            check
          );
          check();
          step = await controller.complete(
            step.operationId,
            step.ceremonyId,
            response
          );
          check();
        }
        if (step.operationId !== current.id || step.success !== true)
          throw localPasskeyError();
      }
      check();
      await completed?.(kind);
      return true;
    } catch {
      if (
        owner.current.mounted &&
        owner.current.sequence === captured &&
        active.current === current
      )
        setError(true);
      return false;
    } finally {
      password = '';
      current.abort.abort();
      if (current.id) void controller.cancel(current.id).catch(() => undefined);
      if (active.current === current) {
        active.current = null;
        if (owner.current.mounted) setBusy(false);
      }
    }
  };
  return {
    busy,
    error,
    cancel,
    enroll: (password: string) => run('enroll', password),
    unlock: () => run('unlock'),
    disable: (password: string) => run('disable', password),
  };
}
