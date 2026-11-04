// Isolated browser fixture: the production app never imports this entrypoint.
import React from 'react';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeSend } from '../../src/screens/NativeSend';
import { parseDecimalAmount } from '../../src/core/amounts';
import type {
  NativeTransferSnapshot,
  NativeTransferView,
} from '../../src/custody/transfers';

const recipient = '0x1111111111111111111111111111111111111111';
const idle = (): NativeTransferSnapshot => ({
  phase: 'idle', review: null, hash: null, message: null,
});
let snapshot = idle();
let sequence = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(value: NativeTransferSnapshot) => void>();
const confirmations: { id: string; password: string }[] = [];
const publish = (next: NativeTransferSnapshot) => {
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener(snapshot);
};
const controller: NativeTransferView = {
  getSnapshot: () => snapshot,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  cancel() {
    clearTimeout(expiry);
    publish(idle());
  },
  async recover() {},
  async prepare(to, amount) {
    clearTimeout(expiry);
    const amountUnits = parseDecimalAmount(amount, 18).toString();
    publish({
      phase: 'review', hash: null, message: null,
      review: Object.freeze({
        id: `fixture-review-${++sequence}`,
        from: '0x2222222222222222222222222222222222222222',
        recipient: to,
        amountUnits,
        maximumFeeUnits: '63000',
        totalUnits: (BigInt(amountUnits) + 63000n).toString(),
        gasLimit: '21000', maximumFeePerGas: '3', priorityFeePerGas: '1',
        nonce: '0', retry: false,
      }),
    });
    expiry = setTimeout(() => publish(idle()), 90000);
  },
  async confirm(id, password) {
    if (snapshot.review?.id !== id || !password) throw Error('Invalid fixture confirmation');
    confirmations.push({ id, password });
    clearTimeout(expiry);
    publish({ phase: 'pending', review: null, hash: '0x' + '1'.repeat(64), message: null });
  },
};

declare global {
  interface Window {
    __nativeSendFixture: {
      replaceReview(): Promise<void>;
      refreshReview(): void;
      reviewId(): string | null;
      confirmations(): readonly { id: string; password: string }[];
    };
  }
}
window.__nativeSendFixture = {
  replaceReview: () => controller.prepare(recipient, '0.002'),
  refreshReview: () => publish({
    ...snapshot,
    review: snapshot.review ? Object.freeze({ ...snapshot.review }) : null,
    message: 'Fixture status refreshed',
  }),
  reviewId: () => snapshot.review?.id ?? null,
  confirmations: () => confirmations,
};

function Fixture() {
  return <SafeAreaProvider><NativeSend controller={controller} onBack={() => undefined} /></SafeAreaProvider>;
}
registerRootComponent(Fixture);
