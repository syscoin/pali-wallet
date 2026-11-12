import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import store from 'state/store';
import { getWalletNavigationScope } from 'utils/navigationState';

import {
  getControllerStatus,
  subscribeControllerStatus,
} from './controllerStatus';

type Ticket = Readonly<{
  context: string;
  epoch: number;
  location: string;
  scope: string;
}>;
type Disclosure = Readonly<{ secret: string; ticket: Ticket }>;
const walletScope = () => JSON.stringify(getWalletNavigationScope());

/** A disclosure belongs only to this visible document and its current wallet context. */
export function useSecretDisclosure(context: string, onRetire: () => void) {
  const [disclosure, setDisclosure] = useState<Disclosure>();
  const owner = useRef({ live: false, active: true, epoch: 0, context });
  const retireCallback = useRef(onRetire);
  useLayoutEffect(() => {
    retireCallback.current = onRetire;
  }, [onRetire]);
  const reset = useCallback(() => {
    owner.current.epoch++;
    setDisclosure(undefined);
  }, []);
  const current = useCallback((ticket: Ticket) => {
    const status = getControllerStatus();
    return (
      owner.current.live &&
      owner.current.active &&
      ticket.epoch === owner.current.epoch &&
      ticket.context === owner.current.context &&
      ticket.scope === walletScope() &&
      ticket.location === window.location.href &&
      document.visibilityState !== 'hidden' &&
      status.isUnlocked &&
      !status.isLoading &&
      !status.connectionUnavailable
    );
  }, []);

  useLayoutEffect(() => {
    owner.current.live = true;
    owner.current.active = document.visibilityState !== 'hidden';
    owner.current.context = context;
    const retire = () => {
      reset();
      retireCallback.current();
    };
    retire();
    let previousScope = walletScope();
    const checkScope = () => {
      const next = walletScope();
      if (next !== previousScope) {
        previousScope = next;
        retire();
      }
    };
    const checkStatus = () => {
      const status = getControllerStatus();
      if (
        !status.isUnlocked ||
        status.isLoading ||
        status.connectionUnavailable
      )
        retire();
    };
    const hide = () => {
      owner.current.active = false;
      retire();
    };
    const focus = () => {
      owner.current.active = document.visibilityState !== 'hidden';
    };
    const visibility = () =>
      document.visibilityState === 'hidden' ? hide() : focus();
    const unsubscribe = store.subscribe(checkScope);
    const unsubscribeStatus = subscribeControllerStatus(checkStatus);
    window.addEventListener('blur', hide);
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', hide);
    window.addEventListener('hashchange', retire);
    window.addEventListener('popstate', retire);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      owner.current.live = false;
      owner.current.epoch++;
      unsubscribe();
      unsubscribeStatus();
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('hashchange', retire);
      window.removeEventListener('popstate', retire);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [context, reset]);

  const read = useCallback(
    async (readSecret: () => Promise<string>): Promise<Disclosure> => {
      const starting = {
        epoch: owner.current.epoch,
        context,
        scope: walletScope(),
        location: window.location.href,
      };
      if (!current(starting)) throw new Error('CANCELLED');
      reset();
      const ticket = Object.freeze({ ...starting, epoch: owner.current.epoch });
      const secret = await readSecret();
      if (!current(ticket)) throw new Error('CANCELLED');
      if (typeof secret !== 'string' || !secret)
        throw new Error('Secret unavailable');
      return { secret, ticket };
    },
    [context, current, reset]
  );
  const accept = useCallback(
    (value: Disclosure) => {
      if (value && current(value.ticket)) setDisclosure(value);
    },
    [current]
  );
  return {
    secret:
      // Rendered secrets also pass the synchronous live disclosure guard.
      disclosure?.ticket.context === context && current(disclosure.ticket)
        ? disclosure.secret
        : undefined,
    read,
    accept,
    reset,
    isCurrent: () => !!disclosure && current(disclosure.ticket),
  };
}
