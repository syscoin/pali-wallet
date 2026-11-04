// Isolated browser fixture: the production app never imports this entrypoint.
import React, { useSyncExternalStore } from 'react';
import { NativeNetworkPortfolioFixture } from './nativeNetworkPortfolioFixture';
import { NetworkPickerFixture } from './networkPickerFixture';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NATIVE_NETWORKS } from '../../src/custody/networkContext';
import { NativeCustodyFeedback } from '../../src/screens/NativeCustodyFeedback';
import type { CustodyErrorCode } from '../../src/custody/types';
import { Text } from '../../src/ui';
import { NativeAccounts } from '../../src/screens/NativeAccounts';
import type { NativeAccountView, NativeAccountRequest } from '../../src/custody/accounts';
import type { NativeWalletCatalogueSnapshot } from '../../src/custody/walletCatalogue';
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

const accountAddress = (index: number) => '0x' + (index + 1).toString(16).padStart(40, '0');
let accountSnapshot: NativeWalletCatalogueSnapshot | null = Object.freeze<NativeWalletCatalogueSnapshot>({
  revision: 0, removed: [], active: { accountId: 'hd:60:0', networkId: 'ethereum' },
  networks: NATIVE_NETWORKS,
  accounts: [0, 1].map((index) => ({ id: `hd:60:${index}`, type: 'HDAccount' as const, index, slip44: 60 as const, address: accountAddress(index), label: `Account ${index + 1}` })),
});
let accountContext = 0;
let accountFailure: CustodyErrorCode | null = null;
let nextIndex = 2;
const accountListeners = new Set<() => void>();
const accountRequests: NativeAccountRequest[] = [];
const accountController: NativeAccountView = {
  getSnapshot: () => accountSnapshot,
  getContextRevision: () => accountContext,
  subscribe(listener) { accountListeners.add(listener); return () => accountListeners.delete(listener); },
  cancel() {},
  async execute(request, contextRevision, catalogueRevision) {
    if (!accountSnapshot || contextRevision !== accountContext || catalogueRevision !== accountSnapshot.revision) throw Error('CANCELLED');
    accountRequests.push(request);
    const injectedFailure = new URLSearchParams(window.location.search).get('failure');
    if (injectedFailure === 'limit') throw Error('ACCOUNT_LIMIT');
    if (injectedFailure === 'credential' || injectedFailure === 'uncertain') {
      accountContext++; accountSnapshot = null;
      accountFailure = injectedFailure === 'credential' ? 'INVALID_CREDENTIAL' : 'UNAVAILABLE';
      for (const listener of accountListeners) listener();
      throw Error(accountFailure);
    }
    const old = accountSnapshot;
    accountContext++;
    accountSnapshot = null;
    for (const listener of accountListeners) listener();
    await Promise.resolve();
    let accounts = [...old.accounts], removed = [...old.removed], active = old.active;
    if (request.kind === 'create' || request.kind === 'restore') {
      const index = request.kind === 'create' ? nextIndex++ : request.index;
      accounts.push({ id: `hd:60:${index}`, index, type: 'HDAccount', slip44: 60, address: accountAddress(index), label: request.label });
      removed = removed.filter((item) => item.index !== index);
      active = { accountId: `hd:60:${index}`, networkId: 'ethereum' };
    } else if (request.kind === 'select') active = { accountId: request.id, networkId: 'ethereum' };
    else if (request.kind === 'rename') accounts = accounts.map((account) => account.id === request.id ? { ...account, label: request.label } : account);
    else if (request.kind === 'remove') {
      const account = accounts.find((item) => item.id === request.id)!;
      removed.push({ id: account.id, index: account.index });
      accounts = accounts.filter((item) => item.id !== request.id);
    }
    accountSnapshot = Object.freeze({ ...old, revision: old.revision + 1, accounts, removed, active });
    for (const listener of accountListeners) listener();
  },
};
declare global { interface Window { __nativeAccountsFixture: { requests(): readonly NativeAccountRequest[]; contextRevision(): number; revise(): void }; } }
window.__nativeAccountsFixture = {
  requests: () => accountRequests,
  contextRevision: () => accountContext,
  revise() {
    if (accountSnapshot) accountSnapshot = Object.freeze({ ...accountSnapshot, revision: accountSnapshot.revision + 1 });
    accountContext++;
    for (const listener of accountListeners) listener();
  },
};

function Fixture() {
  const failure = useSyncExternalStore(accountController.subscribe, () => accountFailure, () => accountFailure);
  return <SafeAreaProvider>{new URLSearchParams(window.location.search).has('network-portfolio') ? <NativeNetworkPortfolioFixture /> : new URLSearchParams(window.location.search).has('networks') ? <NetworkPickerFixture /> : new URLSearchParams(window.location.search).has('accounts')
    ? failure ? <><Text>Wallet locked</Text><NativeCustodyFeedback error={failure} /></> : <NativeAccounts controller={accountController} onBack={() => undefined} />
    : <NativeSend controller={controller} onBack={() => undefined} />}</SafeAreaProvider>;
}
registerRootComponent(Fixture);
