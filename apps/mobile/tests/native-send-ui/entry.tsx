import './fixturePlatform';
// Isolated browser fixture: the production app never imports this entrypoint.
import React, { useSyncExternalStore } from 'react';
import { NativeNetworkPortfolioFixture } from './nativeNetworkPortfolioFixture';
import { NativeFaucetFixture } from './nativeFaucetFixture';
import { NativeTokenPortfolioFixture } from './nativeTokenPortfolioFixture';
import { Erc20SendFixture } from './erc20SendFixture';
import { NetworkPickerFixture } from './networkPickerFixture';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  getNativeSendContext,
  NATIVE_NETWORKS,
} from '../../src/custody/networkContext';
import { NativeCustodyFeedback } from '../../src/screens/NativeCustodyFeedback';
import type { CustodyErrorCode } from '../../src/custody/types';
import { Text } from '../../src/ui';
import { NativeAccounts } from '../../src/screens/NativeAccounts';
import type {
  NativeAccountView,
  NativeAccountRequest,
} from '../../src/custody/accounts';
import type { NativeWalletCatalogueSnapshot } from '../../src/custody/walletCatalogue';
import { NativeSend } from '../../src/screens/NativeSend';
import { parseDecimalAmount } from '../../src/core/amounts';
import type {
  NativeTransferSnapshot,
  NativeTransferView,
} from '../../src/custody/transfers';

const recipient = '0x1111111111111111111111111111111111111111';
let sendContext = getNativeSendContext(
  new URLSearchParams(window.location.search).has('zksys-send')
    ? 'zksys-testnet'
    : new URLSearchParams(window.location.search).has('nevm-send')
    ? 'syscoin-nevm-testnet'
    : 'ethereum'
);
const idle = (): NativeTransferSnapshot => ({
  context: sendContext,
  phase: 'idle',
  review: null,
  hash: null,
  message: null,
  intent: null,
});
let snapshot = idle();
let sequence = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(value: NativeTransferSnapshot) => void>();
const confirmations: { id: string }[] = [];
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
  async loadMorePredecessors() {},
  async prepareToken() {
    throw Error('Token path uses its dedicated fixture');
  },
  async prepare(to, amount) {
    clearTimeout(expiry);
    const amountUnits = parseDecimalAmount(amount, 18).toString();
    publish({
      context: sendContext,
      phase: 'review',
      hash: null,
      message: null,
      intent: null,
      review: Object.freeze({
        context: sendContext,
        id: `fixture-review-${++sequence}`,
        from: '0x2222222222222222222222222222222222222222',
        recipient: to,
        amountUnits,
        maximumFeeUnits: '63000',
        totalUnits: (BigInt(amountUnits) + 63000n).toString(),
        gasLimit: '21000',
        maximumFeePerGas: '3',
        priorityFeePerGas: '1',
        nonce: '0',
        retry: false,
      }),
    });
    expiry = setTimeout(() => publish(idle()), 90000);
  },
  async confirm(id) {
    if (snapshot.review?.id !== id) throw Error('Invalid fixture confirmation');
    const quoteFailure = new URLSearchParams(window.location.search).get(
      'quoteFailure'
    );
    if (quoteFailure) {
      clearTimeout(expiry);
      const expired = quoteFailure === 'base-fee' || quoteFailure === 'nonce';
      publish({
        ...snapshot,
        phase: expired ? 'idle' : 'unavailable',
        review: null,
        hash: null,
        message: expired
          ? 'The review expired or network conditions changed. Review the transfer again.'
          : 'The request could not be completed. Try again or check Activity for an existing transaction.',
      });
      throw Error(expired ? 'EXPIRED' : 'FAILED');
    }
    confirmations.push({ id });
    const context = snapshot.review.context;
    clearTimeout(expiry);
    publish({
      context,
      phase: 'pending',
      review: null,
      hash: '0x' + '1'.repeat(64),
      message: null,
      intent: null,
    });
  },
};

declare global {
  interface Window {
    __nativeSendFixture: {
      replaceReview(): Promise<void>;
      refreshReview(): void;
      reviewId(): string | null;
      confirmations(): readonly { id: string }[];
      changeContext(): void;
      settle(status: 'confirmed' | 'reverted' | 'nonce-consumed'): void;
    };
  }
}
window.__nativeSendFixture = {
  replaceReview: () => controller.prepare(recipient, '0.002'),
  refreshReview: () =>
    publish({
      ...snapshot,
      review: snapshot.review ? Object.freeze({ ...snapshot.review }) : null,
      message: 'Fixture status refreshed',
    }),
  reviewId: () => snapshot.review?.id ?? null,
  confirmations: () => confirmations,
  changeContext: () => {
    sendContext = getNativeSendContext('ethereum');
    publish({ ...snapshot, context: sendContext });
  },
  settle: (phase) => publish({ ...snapshot, phase }),
};

const accountAddress = (index: number) =>
  '0x' + (index + 1).toString(16).padStart(40, '0');
let accountSnapshot: NativeWalletCatalogueSnapshot | null =
  Object.freeze<NativeWalletCatalogueSnapshot>({
    revision: 0,
    removed: [],
    active: { accountId: 'hd:60:0', networkId: 'ethereum' },
    networks: NATIVE_NETWORKS,
    accounts: [0, 1].map((index) => ({
      id: `hd:60:${index}`,
      type: 'HDAccount' as const,
      index,
      slip44: 60 as const,
      address: accountAddress(index),
      label: `Account ${index + 1}`,
    })),
  });
let accountContext = 0;
let accountFailure: CustodyErrorCode | null = null;
let nextIndex = 2;
const accountListeners = new Set<() => void>();
const accountRequests: NativeAccountRequest[] = [];
const accountController: NativeAccountView = {
  getSnapshot: () => accountSnapshot,
  getContextRevision: () => accountContext,
  subscribe(listener) {
    accountListeners.add(listener);
    return () => accountListeners.delete(listener);
  },
  cancel() {},
  async execute(request, contextRevision, catalogueRevision) {
    if (
      !accountSnapshot ||
      contextRevision !== accountContext ||
      catalogueRevision !== accountSnapshot.revision
    )
      throw Error('CANCELLED');
    accountRequests.push(request);
    const injectedFailure = new URLSearchParams(window.location.search).get(
      'failure'
    );
    if (injectedFailure === 'limit') throw Error('ACCOUNT_LIMIT');
    if (injectedFailure === 'credential' || injectedFailure === 'uncertain') {
      accountContext++;
      accountSnapshot = null;
      accountFailure =
        injectedFailure === 'credential' ? 'INVALID_CREDENTIAL' : 'UNAVAILABLE';
      for (const listener of accountListeners) listener();
      throw Error(accountFailure);
    }
    const old = accountSnapshot;
    accountContext++;
    accountSnapshot = null;
    for (const listener of accountListeners) listener();
    await Promise.resolve();
    let accounts = [...old.accounts],
      removed = [...old.removed],
      active = old.active;
    if (request.kind === 'create' || request.kind === 'restore') {
      const index = request.kind === 'create' ? nextIndex++ : request.index;
      accounts.push({
        id: `hd:60:${index}`,
        index,
        type: 'HDAccount',
        slip44: 60,
        address: accountAddress(index),
        label: request.label,
      });
      removed = removed.filter((item) => item.index !== index);
      active = { accountId: `hd:60:${index}`, networkId: 'ethereum' };
    } else if (request.kind === 'select')
      active = { accountId: request.id, networkId: 'ethereum' };
    else if (request.kind === 'rename')
      accounts = accounts.map((account) =>
        account.id === request.id
          ? { ...account, label: request.label }
          : account
      );
    else if (request.kind === 'remove') {
      const account = accounts.find((item) => item.id === request.id)!;
      removed.push({ id: account.id, index: account.index });
      accounts = accounts.filter((item) => item.id !== request.id);
    }
    accountSnapshot = Object.freeze({
      ...old,
      revision: old.revision + 1,
      accounts,
      removed,
      active,
    });
    for (const listener of accountListeners) listener();
  },
};
declare global {
  interface Window {
    __nativeAccountsFixture: {
      requests(): readonly NativeAccountRequest[];
      contextRevision(): number;
      revise(): void;
    };
  }
}
window.__nativeAccountsFixture = {
  requests: () => accountRequests,
  contextRevision: () => accountContext,
  revise() {
    if (accountSnapshot)
      accountSnapshot = Object.freeze({
        ...accountSnapshot,
        revision: accountSnapshot.revision + 1,
      });
    accountContext++;
    for (const listener of accountListeners) listener();
  },
};

function Fixture() {
  const failure = useSyncExternalStore(
    accountController.subscribe,
    () => accountFailure,
    () => accountFailure
  );
  return (
    <SafeAreaProvider>
      {new URLSearchParams(window.location.search).has('faucet') ? (
        <NativeFaucetFixture />
      ) : new URLSearchParams(window.location.search).has('erc20-send') ? (
        <Erc20SendFixture />
      ) : new URLSearchParams(window.location.search).has('token-portfolio') ? (
        <NativeTokenPortfolioFixture />
      ) : new URLSearchParams(window.location.search).has(
          'network-portfolio'
        ) ? (
        <NativeNetworkPortfolioFixture />
      ) : new URLSearchParams(window.location.search).has('networks') ? (
        <NetworkPickerFixture />
      ) : new URLSearchParams(window.location.search).has('accounts') ? (
        failure ? (
          <>
            <Text>Wallet locked</Text>
            <NativeCustodyFeedback error={failure} />
          </>
        ) : (
          <NativeAccounts
            controller={accountController}
            onBack={() => undefined}
          />
        )
      ) : (
        <NativeSend
          controller={controller}
          context={sendContext}
          onBack={() => undefined}
        />
      )}
    </SafeAreaProvider>
  );
}
registerRootComponent(Fixture);
