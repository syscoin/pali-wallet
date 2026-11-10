import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NativeConnectionsSnapshot } from '../../src/connections/types';
import type { NativeSmartPreparationReview } from '../../src/connections/smartPreparationRequests';
import { NativeSmartPreparationReview as PreparationReview } from '../../src/screens/NativeSmartPreparationReview';
import { Screen, Text } from '../../src/ui';

type Controller = React.ComponentProps<typeof PreparationReview>['controller'];
type Call = { method: 'approve' | 'reject'; id: string; revision?: number; externalOwnersAcknowledged?: boolean };
const query = new URLSearchParams(window.location.search);
const mode = query.get('preparation-mode') ?? 'lazy';
const owner = `0x${'22'.repeat(20)}`, secondOwner = `0x${'44'.repeat(20)}`;
const saved = `0x${'33'.repeat(20)}`;

const initialReview = Object.freeze<NativeSmartPreparationReview>({
  id: 'public-smart-preparation', revision: 7, appName: 'Example account app', origin: 'https://app.example.test',
  verification: { validation: 'UNKNOWN', isScam: false }, label: 'App smart account',
  requestedAuthenticatorId: mode === 'unavailable' ? 'p256-webauthn' : 'ecdsa',
  networkLabel: 'Ethereum', chainId: '1', expiresAt: Date.now() + 600_000,
  busy: false, error: mode === 'unavailable' || mode === 'saved-failure' ? 'PREPARATION_UNAVAILABLE' : null,
  externalOwners: mode === 'configured' ? Object.freeze([owner, secondOwner]) : Object.freeze([]),
  requestedOwners: mode === 'configured' ? Object.freeze([owner, secondOwner]) : Object.freeze([]),
  requestedThreshold: mode === 'configured' ? 2 : null, accountAddress: mode === 'saved-failure' ? saved : null,
  operation: null, canRetry: false,
});

const baseSnapshot = Object.freeze<NativeConnectionsSnapshot>({
  revision: 7, status: 'ready', pairingExpiresAt: null,
  network: { id: 'ethereum', label: 'Ethereum', chainId: '1' },
  accounts: [], selectedAccountId: null, proposals: [], sessions: [],
  preparationReview: null, signingReview: null, psbtReview: null,
  sentryReview: null, controlReview: null, callsStatus: null, error: null,
});

declare global { interface Window { __nativeSmartPreparationFixture: { calls(): readonly Call[] } } }

/** Actual creation-consent UI, public data only; no allocation, storage or signing capability. */
export function NativeSmartPreparationFixture() {
  const [closed, setClosed] = useState(false);
  const alive = useRef(true), calls = useRef<Call[]>([]);
  const controller = useMemo<Controller>(() => ({
    getSnapshot: () => ({ ...baseSnapshot, preparationReview: alive.current ? initialReview : null }),
    async approveSmartPreparation(id, revision, externalOwnersAcknowledged) {
      if (!alive.current || id !== initialReview.id || revision !== initialReview.revision || initialReview.error ||
          (initialReview.externalOwners.length > 0 && !externalOwnersAcknowledged)) throw Error('Public fixture request is unavailable');
      calls.current.push({ method: 'approve', id, revision, externalOwnersAcknowledged });
    },
    async confirmSmartPreparationPayer() { throw Error('No signing operation exists in this public fixture'); },
    async retrySmartPreparationMetadata() { throw Error('No submitted operation exists in this public fixture'); },
    async rejectSmartPreparation(id) {
      if (!alive.current || id !== initialReview.id) return;
      calls.current.push({ method: 'reject', id }); alive.current = false; setClosed(true);
    },
  }), []);
  useLayoutEffect(() => {
    alive.current = true;
    window.__nativeSmartPreparationFixture = { calls: () => calls.current.map(call => ({ ...call })) };
    return () => { alive.current = false; };
  }, []);
  return closed ? <Screen><Text>Smart account request closed</Text></Screen>
    : <PreparationReview review={initialReview} controller={controller} />;
}
