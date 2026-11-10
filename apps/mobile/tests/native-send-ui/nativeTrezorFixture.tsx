import React, { useLayoutEffect, useState } from 'react';
import type {
  NativeTrezorResumeIntent,
  NativeTrezorSnapshot,
  NativeTrezorView,
} from '../../src/custody/trezorAccounts';
import {
  NativeTrezor,
  NativeTrezorResumeNotice,
} from '../../src/screens/NativeTrezor';
import { Text } from '../../src/ui';

const route = new URLSearchParams(window.location.search);
const resume = route.get('resume');
let snapshot: NativeTrezorSnapshot = Object.freeze({
  phase: resume ? 'resume' : 'idle',
  operation:
    resume === 'import'
      ? 'import'
      : resume === 'utxo'
      ? 'utxo-send'
      : resume === 'smart'
      ? 'smart-operation'
      : resume
      ? 'send'
      : null,
  networkLabel: 'Ethereum',
  accountLabel: resume === 'smart' ? 'Smart savings' : resume ? 'Travel Trezor' : '',
  address: resume ? '0x1111111111111111111111111111111111111111' : null,
  signer: resume === 'smart'
    ? { label: 'Travel Trezor signer', address: '0x2222222222222222222222222222222222222222', step: 2, total: 3 }
    : null,
  error: null,
});
const calls: string[] = [];
const listeners = new Set<() => void>();
let resolveOperation: (() => void) | undefined;
let resolveCancel: (() => void) | undefined;
let rejectCancel: (() => void) | undefined;
let lock: (() => void) | undefined;
let mount: (() => void) | undefined;
let refresh: (() => void) | undefined;
const publish = (patch: Partial<NativeTrezorSnapshot>) => {
  snapshot = Object.freeze({ ...snapshot, ...patch });
  for (const listener of listeners) listener();
};
const intent: NativeTrezorResumeIntent = Object.freeze({
  id: 'public-fixture-intent',
  accountId: resume === 'smart' ? 'smart:60:0' : 'Trezor:0',
  networkId: 'ethereum',
  ...(resume === 'smart'
    ? { kind: 'smart-operation' as const }
    : { kind: 'evm' as const, unsignedTransaction: '0xpublic-fixture-envelope' }),
});
const controller: NativeTrezorView = {
  getSnapshot: () => snapshot,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async startImport(label) {
    calls.push(`open:${label}`);
    publish({ phase: 'waiting', operation: 'import', accountLabel: label, signer: null });
    if (route.has('hold'))
      await new Promise<void>((resolve) => {
        resolveOperation = resolve;
      });
  },
  async resumeImport() {
    calls.push('resume:import');
    if (route.has('hold'))
      await new Promise<void>((resolve) => {
        resolveOperation = resolve;
      });
  },
  async resumeSend() {
    calls.push('resume:send');
    return intent;
  },
  background() {calls.push('background');},
  async cancel() {
    calls.push('cancel');
    if (route.has('hold-cancel'))
      await new Promise<void>((resolve, reject) => {
        resolveCancel = resolve;
        rejectCancel = () =>
          reject(new Error('public fixture cleanup failure'));
      });
    publish({ phase: 'idle', operation: null, address: null, signer: null });
  },
};
declare global {
  interface Window {
    __nativeTrezorFixture: {
      calls(): string[];
      snapshot(): NativeTrezorSnapshot;
      resolveOperation(): void;
      resolveCancel(): void;
      rejectCancel(): void;
      lock(): void;
      returnFromSuite(): void;
      mount(): void;
      refreshParent(): void;
    };
  }
}
window.__nativeTrezorFixture = {
  calls: () => calls.slice(),
  snapshot: () => snapshot,
  resolveOperation: () => resolveOperation?.(),
  resolveCancel: () => resolveCancel?.(),
  rejectCancel: () => rejectCancel?.(),
  lock: () => lock?.(),
  returnFromSuite: () => publish({ phase: 'resume' }),
  mount: () => mount?.(),
  refreshParent: () => refresh?.(),
};

/** Component-only fixture: no wallet, signing, native transport or network access. */
export function NativeTrezorFixture() {
  const [page, setPage] = useState('trezor');
  const [, setRevision] = useState(0);
  useLayoutEffect(() => {
    lock = () => setPage('locked');
    mount = () => setPage('trezor');
    refresh = () => setRevision((value) => value + 1);
    return () => {
      lock = mount = refresh = undefined;
    };
  }, []);
  if (route.has('notice'))
    return (
      <NativeTrezorResumeNotice
        controller={controller}
        onResume={() => {
          calls.push('navigate:resume');
          setPage('trezor');
        }}
      />
    );
  if (page !== 'trezor')
    return (
      <Text>
        {page === 'closed'
          ? 'Trezor screen closed'
          : page === 'imported'
          ? 'Trezor account added'
          : page === 'review'
          ? 'Fresh transaction review'
          : 'Wallet locked'}
      </Text>
    );
  return (
    <NativeTrezor
      controller={controller}
      onBack={() => {
        calls.push('navigate:back');
        setPage('closed');
      }}
      onImported={() => {
        calls.push('navigate:imported');
        setPage('imported');
      }}
      onResumeSend={(value) => {
        if (value !== intent)
          throw new Error('Unexpected public resume intent');
        calls.push('navigate:review');
        setPage('review');
      }}
    />
  );
}
