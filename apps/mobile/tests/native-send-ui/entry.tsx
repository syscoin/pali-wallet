import { NativeSentryFixture } from './nativeSentryFixture';
import { NativeSmartCurrencyFixture } from './nativeSmartCurrencyFixture';
import { NativeNoteImportFixture } from './nativeNoteImportFixture';
import { NativeSmartDappFixture } from './nativeSmartDappFixture';
import { UTXO_NETWORKS } from '../../src/core/utxoNetworks.ts';
import './fixturePlatform';
// Isolated browser fixture: the production app never imports this entrypoint.
import React, { useSyncExternalStore } from 'react';
import { NativeNetworkPortfolioFixture } from './nativeNetworkPortfolioFixture';
import { NativeFaucetFixture } from './nativeFaucetFixture';
import { NativeTokenPortfolioFixture } from './nativeTokenPortfolioFixture';
import { NativeUtxoSendFixture } from './nativeUtxoSendFixture';
import { Erc20SendFixture } from './erc20SendFixture';
import { NetworkPickerFixture } from './networkPickerFixture';
import { NativeConnectionsFixture } from './nativeConnectionsFixture';
import { createLedgerConnectionFixture } from './nativeLedgerConnectionFixture';
import { NativeLedgerFixture } from './nativeLedgerFixture';
import { NativeMessageReviewFixture } from './nativeMessageReviewFixture';
import { NativeTransactionReviewFixture } from './nativeTransactionReviewFixture';
import { NativeSmartAccountOperationFixture } from './nativeSmartAccountDeploymentFixture';
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
import { NativeSend, type NativeRecipientPicker } from '../../src/screens/NativeSend';
import { parseDecimalAmount } from '../../src/core/amounts';
import type {
  NativeTransferSnapshot,
  NativeTransferView,
} from '../../src/custody/transfers';

const recipient = '0x1111111111111111111111111111111111111111';
const sender = '0x2222222222222222222222222222222222222222';
const route = new URLSearchParams(window.location.search);
const ledgerConnection = route.has('ledger-send') && !route.has('utxo-send') ? createLedgerConnectionFixture(sender) : undefined;
const replacementMode = route.has('cancel-transfer') ? 'cancel' : route.has('speed-up-transfer') ? 'speed-up' : undefined;
const replacement = replacementMode && { mode: replacementMode, hash: '0x' + '3'.repeat(64) } as const;
const collectibleStandard = route.get('collectible');
const collectibleAddress = '0x3333333333333333333333333333333333333333';
const collectible = collectibleStandard === '721'
  ? { tokenStandard: 'ERC-721' as const, contractAddress: collectibleAddress }
  : collectibleStandard === '1155'
  ? { tokenStandard: 'ERC-1155' as const, contractAddress: collectibleAddress, tokenId: ((1n << 256n) - 1n).toString() }
  : undefined;
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
  async recover() {
    if (route.has('ledger-replay')) {
      publishReview(recipient, '1000000000000000');
      publish({ ...snapshot, review: { ...snapshot.review!, retry: true } });
    }
  },
  async loadMorePredecessors() {},
  async prepareToken() {
    throw Error('Token path uses its dedicated fixture');
  },
  async prepareCollectible(saved, to, tokenId, amountUnits) {
    if (saved !== collectible) throw Error('Unexpected fixture draft');
    const from = sender;
    publish({
      ...idle(),
      phase: 'review',
      review: {
        context: sendContext, id: `fixture-review-${++sequence}`, from,
        recipient: saved.contractAddress, amountUnits: '0', maximumFeeUnits: '63000',
        totalUnits: '63000', gasLimit: '21000', maximumFeePerGas: '3',
        priorityFeePerGas: '1', nonce: '0', retry: false,
        collectible: {
          kind: 'nft-transfer', chainId: '1', from, contractAddress: saved.contractAddress,
          recipient: to, tokenId, amountUnits, tokenStandard: saved.tokenStandard,
        },
      },
    });
  },
  async prepareCancellation(hash) {
    if (route.has('cancel-queued')) throw Error('CANCELLATION_QUEUED');
    publishReview(sender, '0', { mode: 'cancel', originalHash: hash, originalMaximumFeeUnits: '63000' });
  },
  async prepareSavedCancellation(hash) {
    await this.prepareCancellation(hash);
  },
  async prepareSpeedUp(hash) {
    publishReview('0x1111111111111111111111111111111111111111', '1000000000000000000', {
      mode: 'speed-up', originalHash: hash, originalMaximumFeeUnits: '63000',
    });
  },
  async prepare(to, amount, nonce) {
    publishReview(to, parseDecimalAmount(amount, 18).toString(), undefined, nonce);
  },
  async confirm(id) {
    if (snapshot.review?.id !== id) throw Error('Invalid fixture confirmation');
    if (route.has('storage-full')) {
      clearTimeout(expiry);
      publish({ ...snapshot, hash: route.has('speed-up-transfer') ? replacement!.hash : null, phase: route.has('speed-up-transfer') ? 'unknown' : 'idle', review: null, message: route.has('speed-up-transfer') ? 'This new transaction was not submitted because Pali could not save it within its local transaction storage limit. Check the earlier transaction in Activity.' : 'This transaction was not submitted because Pali could not save it within its local transaction storage limit. Check Activity.' });
      throw Error('SIGNED_STORAGE_FULL');
    }
    const quoteFailure = new URLSearchParams(window.location.search).get(
      'quoteFailure'
    );
    if (quoteFailure === 'saved-expired') {
      clearTimeout(expiry);
      publish({
        ...snapshot,
        phase: 'unknown',
        review: null,
        hash: '0x' + '1'.repeat(64),
        message: 'Your signed transaction is saved. Check it before sending again.',
      });
      throw Error('EXPIRED');
    }
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
    const { context, collectible } = snapshot.review;
    clearTimeout(expiry);
    publish({
      context,
      phase: 'pending',
      collectible,
      review: null,
      hash: '0x' + '1'.repeat(64),
      message: null,
      intent: null,
    });
  },
};

function publishReview(to: string, amountUnits: string,
  replacement?: NonNullable<NativeTransferSnapshot['review']>['replacement'], nonce?: string) {
  clearTimeout(expiry);
  const gas = replacement ? 42000n : 21000n;
  const maximumFee = gas * 3n;
  publish({
    ...idle(),
    phase: 'review',
    review: Object.freeze({
      context: sendContext,
      id: `fixture-review-${++sequence}`,
      from: sender,
      recipient: to,
      amountUnits,
      maximumFeeUnits: maximumFee.toString(),
      totalUnits: (BigInt(amountUnits) + maximumFee).toString(),
      gasLimit: gas.toString(),
      maximumFeePerGas: '3',
      priorityFeePerGas: '1',
      nonce: nonce ?? '0',
      ...(nonce === undefined ? {} : { nonceOverride: Number(nonce) }),
      retry: false,
      ...(replacement ? { replacement } : {}),
    }),
  });
  expiry = setTimeout(() => publish(idle()), 90000);
}

function createRecipientPicker(name: string): NativeRecipientPicker {
  const picker: NativeRecipientPicker = {
    current: () => localRecipientPicker === picker,
    accounts: () => [
      { label: name, address: recipient },
      { label: name, address: '0x' + '4'.repeat(40) },
    ],
  };
  return picker;
}
let localRecipientPicker = route.has('local-recipient') ? createRecipientPicker('Savings account') : undefined;

declare global {
  interface Window {
    __nativeSendFixture: {
      replaceReview(): Promise<void>;
      expireReview(): void;
      refreshReview(): void;
      reviewId(): string | null;
      confirmations(): readonly { id: string }[];
      changeContext(): void;
      replaceRecipientScope(name: string): void;
      retireRecipientScope(): void;
      settle(status: 'confirmed' | 'reverted' | 'nonce-consumed'): void;
    };
  }
}
window.__nativeSendFixture = {
  expireReview: () => { clearTimeout(expiry); publish(idle()); },
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
  replaceRecipientScope(name) {
    localRecipientPicker = createRecipientPicker(name);
    publish(idle());
  },
  retireRecipientScope() { localRecipientPicker = undefined; },
  settle: (phase) => publish({ ...snapshot, phase }),
};

const accountAddress = (index: number) =>
  '0x' + (index + 1).toString(16).padStart(40, '0');
let accountSnapshot: NativeWalletCatalogueSnapshot | null =
  Object.freeze<NativeWalletCatalogueSnapshot>({
    revision: 0,
    active: { accountId: 'hd:60:0', networkId: 'ethereum' },
    networks: NATIVE_NETWORKS, utxoNetworks: UTXO_NETWORKS,
    accounts: Array.from({length: new URLSearchParams(window.location.search).has('many-accounts') ? 1000 : 2}, (_, index) => ({
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
    let accounts = [...old.accounts], active = old.active;
    if (request.kind === 'create') {
      let index = 0; const occupied = new Set(accounts.map((row) => row.index)); while (occupied.has(index)) index++;
      accounts.push({
        id: `hd:60:${index}`,
        index,
        type: 'HDAccount',
        slip44: 60,
        address: accountAddress(index),
        label: request.label,
      });
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
      accounts = accounts.filter((item) => item.id !== request.id);
    }
    accountSnapshot = Object.freeze({
      ...old,
      revision: old.revision + 1,
      accounts,
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
      count(): number;
      revise(): void;
    };
  }
}
window.__nativeAccountsFixture = {
  requests: () => accountRequests,
  contextRevision: () => accountContext,
  count: () => accountSnapshot?.accounts.length ?? 0,
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
  const recipientPicker = useSyncExternalStore(
    controller.subscribe,
    () => localRecipientPicker,
    () => localRecipientPicker
  );
  return (
    <SafeAreaProvider>
      {new URLSearchParams(window.location.search).has('sentry') ? (
        <NativeSentryFixture />
      ) : new URLSearchParams(window.location.search).has('smart-dapp') ? (
        <NativeSmartDappFixture />
      ) : new URLSearchParams(window.location.search).has('note-import') ? (
        <NativeNoteImportFixture />
      ) : new URLSearchParams(window.location.search).has('smart-currency') ? (
        <NativeSmartCurrencyFixture />
      ) : new URLSearchParams(window.location.search).has('smart-deployment') ? (
        <NativeSmartAccountOperationFixture />
      ) : new URLSearchParams(window.location.search).has('ledger') ? (
        <NativeLedgerFixture />
      ) : new URLSearchParams(window.location.search).has('transaction-review') ? (
        <NativeTransactionReviewFixture />
      ) : new URLSearchParams(window.location.search).has('message-review') ? (
        <NativeMessageReviewFixture />
      ) : new URLSearchParams(window.location.search).has('connections') ? (
        <NativeConnectionsFixture />
      ) : new URLSearchParams(window.location.search).has('faucet') ? (
        <NativeFaucetFixture />
      ) : new URLSearchParams(window.location.search).has('utxo-send') ? (
        <NativeUtxoSendFixture />
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
          account={{ address: sender, network: sendContext.networkId, revision: 1 }}
          savedHash={route.has('ledger-replay') ? '0x' + '3'.repeat(64) : undefined}
          controller={controller}
          ledgerConnection={ledgerConnection}
          context={sendContext}
          replacement={replacement}
          recipientPicker={recipientPicker}
          collectible={collectible}
          onBack={() => undefined}
        />
      )}
    </SafeAreaProvider>
  );
}
registerRootComponent(Fixture);
