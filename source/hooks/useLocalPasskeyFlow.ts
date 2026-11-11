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
  createController: () => LocalPasskeyController,
  onComplete?: (action: LocalPasskeyAction) => void | Promise<void>
) {
  type Owner = {
    controller: LocalPasskeyController;
    createController: () => LocalPasskeyController;
    mounted: boolean;
    sequence: number;
  };
  const owner = useRef<Owner | null>(null);
  const active = useRef<{
    abort: AbortController;
    id?: string;
    owner: Owner;
    source: LocalPasskeyController;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const cancel = useCallback(() => {
    const mounted = owner.current;
    if (!mounted || mounted.createController !== createController) return;
    const current = active.current;
    if (current && current.owner !== mounted) return;
    active.current = null;
    mounted.sequence++;
    current?.abort.abort();
    if (current) void current.source.cancel(current.id).catch(() => undefined);
    if (mounted.mounted) setBusy(false);
  }, [createController]);
  useEffect(() => {
    const current: Owner = {
      mounted: true,
      sequence: 0,
      createController,
      controller: createController(),
    };
    owner.current = current;
    setBusy(false);
    setError(false);
    return () => {
      current.mounted = false;
      current.sequence++;
      const operation = active.current;
      if (operation?.owner === current) {
        active.current = null;
        operation.abort.abort();
        void current.controller.cancel(operation.id).catch(() => undefined);
      }
      if (owner.current === current) owner.current = null;
      void current.controller.dispose().catch(() => undefined);
    };
  }, [createController]);
  const status = useCallback(async () => {
    const current = owner.current;
    if (!current?.mounted || current.createController !== createController)
      throw localPasskeyError();
    const value = await current.controller.status();
    if (owner.current !== current || !current.mounted)
      throw localPasskeyError();
    return value;
  }, [createController]);

  const run = async (kind: LocalPasskeyAction, password = '') => {
    const mounted = owner.current;
    if (
      !mounted?.mounted ||
      mounted.createController !== createController ||
      active.current
    )
      return false;
    const captured = mounted.sequence;
    const controller = mounted.controller;
    const current = {
      owner: mounted,
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
        !mounted.mounted ||
        owner.current !== mounted ||
        mounted.sequence !== captured ||
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
        mounted.mounted &&
        owner.current === mounted &&
        mounted.sequence === captured &&
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
        if (owner.current === mounted && mounted.mounted) setBusy(false);
      }
    }
  };
  return {
    busy,
    error,
    cancel,
    status,
    enroll: (password: string) => run('enroll', password),
    unlock: () => run('unlock'),
    disable: (password: string) => run('disable', password),
  };
}
