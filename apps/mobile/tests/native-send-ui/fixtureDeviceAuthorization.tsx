import React, { useSyncExternalStore } from 'react';
import { Modal, View } from 'react-native';
import { Button, Card, Text } from '../../src/ui';

type Pending = Readonly<{
  signal: AbortSignal;
  approve(): void;
  refuse(): void;
  cancel(): void;
}>;
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };

/** Browser-only presentation port. It grants no native credential or signing proof. */
export const fixtureDeviceAuthorization = Object.freeze({
  cancel: () => pending?.cancel(),
  isAnyPromptActive: () => pending !== null && !pending.signal.aborted,
  isActive: (signal: AbortSignal) => pending?.signal === signal && !signal.aborted,
  request(_purpose: string, signal: AbortSignal, check: () => void): Promise<void> {
    check();
    if (pending || signal.aborted) return Promise.reject(Error('CANCELLED'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (failure?: Error) => {
        if (settled) return;
        settled = true; signal.removeEventListener('abort', abort);
        if (pending === owner) { pending = null; publish(); }
        if (failure) { reject(failure); return; }
        try { check(); if (signal.aborted) throw Error('CANCELLED'); resolve(); }
        catch (cause) { reject(cause); }
      };
      const abort = () => finish(Error('CANCELLED'));
      const owner: Pending = Object.freeze({ signal,
        approve: () => finish(), refuse: () => finish(Error('DEVICE_UNLOCK_UNAVAILABLE')), cancel: () => finish(Error('CANCELLED')) });
      pending = owner; signal.addEventListener('abort', abort, { once: true }); publish();
      if (signal.aborted) abort();
    });
  },
});

export function FixtureDeviceAuthorization() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => pending, () => null);
  if (!current) return null;
  return <Modal transparent visible onRequestClose={current.refuse}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#000a' }}>
      <Card><Text>Test device authorization</Text>
        <Text>Browser fixture only. No native credentials or signing.</Text>
        <Button title="Approve test device" onPress={current.approve} />
        <Button title="Cancel test device" variant="secondary" onPress={current.refuse} />
      </Card>
    </View>
  </Modal>;
}
