import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { normalizeNftTokenId } from '../../../../source/utils/nftTokenId';
import type { SavedCollectible } from '../portfolio/tokenRegistry';
import {
  formatTokenUnits,
  parseErc20Units,
  type Erc20Metadata,
} from '../../../../source/shared/erc20';
import type { NativeTokenView } from '../portfolio/nativeTokens';
import type { NativeRecipientResolution, NativeRecipientResolver } from '../portfolio/nativeRecipientResolver';
import {
  NativePortfolioController,
  type NativePortfolioAccount,
  type PublicCustodySource,
} from '../portfolio/nativePortfolio';
import type { BalanceReader } from '../core/watchOnlyAuthority';
import { formatBaseUnits } from '../core/amounts';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  NativeSmartAccountAmount,
  NativeSmartAccountOperation,
} from '../smartAccount/operation';
import type { NativeSendContext } from '../custody/networkContext';
import { NativeSendInput, nativeTransferFailure } from './NativeSend';
import { NativeTokenMaximum } from './NativeTokenMaximum';
import { NativeSmartAccountOperationScreen } from './NativeSmartAccountOperation';
import { Button, colors, Header, Notice, Screen, styles, Text } from '../ui';

const emptySubscribe = () => () => undefined;
const emptyInventory = () => null;
type SendOwner = {
  active: boolean;
  returning: boolean;
  operation: NativeSmartAccountOperation | null;
  busy: boolean;
  opening?: Promise<void>;
  disposing?: Promise<void>;
};
function disposeSend(owner: SendOwner): Promise<void> {
  owner.disposing ??= Promise.resolve(owner.opening)
    .catch(() => undefined)
    .then(() => owner.operation?.dispose());
  return owner.disposing;
}

export function NativeSmartAccountSend({
  open,
  context,
  accountLabel,
  source,
  reader,
  account,
  token,
  tokenView,
  collectible,
  onBack,
  recipientResolver,
  ledgerConnection,
}: {
  ledgerConnection?: NativeLedgerConnectionView;
  open(
    recipient: string,
    amount: NativeSmartAccountAmount,
    assertCurrent: () => void
  ): Promise<NativeSmartAccountOperation>;
  context: NativeSendContext;
  accountLabel: string;
  source: PublicCustodySource;
  reader: BalanceReader;
  account: NativePortfolioAccount;
  token?: Erc20Metadata;
  collectible?: SavedCollectible;
  tokenView?: Pick<NativeTokenView, 'subscribe' | 'getSnapshot' | 'connect'>;
  onBack(): void;
  recipientResolver?: NativeRecipientResolver;
}) {
  const portfolio = useMemo(
    () => new NativePortfolioController(source, reader),
    [source, reader]
  );
  const balance = useSyncExternalStore(
    portfolio.subscribe,
    portfolio.getSnapshot,
    portfolio.getSnapshot
  );
  const inventory = useSyncExternalStore(
    tokenView?.subscribe ?? emptySubscribe,
    tokenView?.getSnapshot ?? emptyInventory,
    tokenView?.getSnapshot ?? emptyInventory
  );
  useLayoutEffect(
    () =>
      collectible
        ? undefined
        : token
        ? tokenView?.connect()
        : portfolio.connect(),
    [portfolio, token, tokenView, collectible]
  );
  const selectedToken =
    token &&
    inventory?.items.find(
      (item) => item.metadata.contractAddress === token.contractAddress
    );
  const symbol = token?.symbol ?? context.symbol;
  const displayedBalance = token
    ? selectedToken?.status === 'available' && selectedToken.units !== null
      ? formatTokenUnits(selectedToken.units, token.decimals)
      : null
    : balance.status === 'available' && balance.units !== null
    ? formatBaseUnits(balance.units, context.decimals)
    : null;
  const loadingBalance = token
    ? selectedToken?.status === 'loading'
    : balance.status === 'loading';
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState(
    collectible?.tokenStandard === 'ERC-721' ? '1' : ''
  );
  const [tokenId, setTokenId] = useState(
    collectible?.tokenStandard === 'ERC-1155' ? collectible.tokenId : ''
  );
  const [maximum, setMaximum] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [controller, setController] =
    useState<NativeSmartAccountOperation | null>(null);
  const [closing, setClosing] = useState(false);
  const [resolvedRecipient, setResolvedRecipient] = useState<NativeRecipientResolution | null>(null);
  const recipientRequest = useRef<{
    abort: AbortController;
    ticket?: NativeRecipientResolution;
    reviewReleased: boolean;
    unsubscribe?: () => void;
  } | null>(null);
  const latestOwner = useRef({ open, account, context, recipientResolver, recipient });
  useLayoutEffect(() => {
    latestOwner.current = { open, account, context, recipientResolver, recipient };
  }, [open, account, context, recipientResolver, recipient]);
  const retireRecipient = useCallback(() => {
    const held = recipientRequest.current;
    recipientRequest.current = null;
    held?.unsubscribe?.();
    held?.abort.abort();
    held?.ticket?.dispose();
    setResolvedRecipient(null);
  }, []);
  const editRecipient = (value: string) => {
    retireRecipient();
    setRecipient(value);
  };
  useLayoutEffect(() => () => retireRecipient(), [retireRecipient, open, account.address,
    account.network, account.revision, context.registrationHash, recipientResolver]);
  const callbacks = useRef({ onBack });
  useLayoutEffect(() => {
    callbacks.current = { onBack };
  }, [onBack]);
  const owner = useRef<SendOwner>({
    active: true,
    returning: false,
    operation: null as NativeSmartAccountOperation | null,
    busy: false,
  });
  const back = useCallback(() => {
    const current = owner.current;
    if (!current.active) return;
    current.active = false;
    current.returning = true;
    retireRecipient();
    const close = callbacks.current.onBack;
    setClosing(true);
    void disposeSend(current)
      .catch(() => undefined)
      .then(() => {
        if (owner.current === current && current.returning) close();
      });
  }, [retireRecipient]);
  useEffect(() => {
    const current: SendOwner = {
      active: true,
      returning: false,
      operation: null,
      busy: false,
    };
    owner.current = current;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => {
      current.active = false;
      current.returning = false;
      retireRecipient();
      void disposeSend(current).catch(() => undefined);
      hardware.remove();
    };
  }, [back, retireRecipient]);
  const review = async () => {
    const current = owner.current;
    if (!current.active || current.busy) return;
    current.busy = true;
    setBusy(true);
    setError('');
    const held = {
      abort: new AbortController(),
      ticket: undefined as NativeRecipientResolution | undefined,
      reviewReleased: false,
      unsubscribe: undefined as (() => void) | undefined,
    };
    recipientRequest.current = held;
    const captured = latestOwner.current;
    const checkOwner = () => {
      const actual = latestOwner.current;
      if (!current.active || owner.current !== current || recipientRequest.current !== held || held.abort.signal.aborted ||
          actual.open !== captured.open || actual.recipient !== captured.recipient || actual.recipientResolver !== captured.recipientResolver ||
          actual.account.address !== captured.account.address || actual.account.network !== captured.account.network ||
          actual.account.revision !== captured.account.revision || actual.context.registrationHash !== captured.context.registrationHash)
        throw new Error('RECIPIENT_EXPIRED');
    };
    const check = () => {
      checkOwner();
      if (!held.reviewReleased) held.ticket?.assertCurrent();
    };
    try {
      let nftRequest: NativeSmartAccountAmount | undefined;
      if (collectible) {
        let id: string, quantity: string;
        try {
          id = normalizeNftTokenId(tokenId.trim());
        } catch {
          setError('Enter a valid token ID.');
          return;
        }
        try {
          quantity =
            collectible.tokenStandard === 'ERC-721'
              ? '1'
              : parseErc20Units(amount.trim());
          if (quantity === '0') throw new Error('Empty quantity');
        } catch {
          setError('Enter a whole quantity greater than zero.');
          return;
        }
        nftRequest = {
          kind: 'nft',
          collectible,
          tokenId: id,
          amountUnits: quantity,
        };
      }
      let address = recipient.trim();
      if (address.toLowerCase().endsWith('.eth')) {
        if (!recipientResolver) throw new Error('ENS_UNAVAILABLE');
        held.ticket = await recipientResolver.resolve(address, { account, context }, held.abort.signal, checkOwner);
        check();
        const ticket = held.ticket;
        address = ticket.address;
        setResolvedRecipient(ticket);
        ticket.signal.addEventListener('abort', () => {
          if (recipientRequest.current !== held || !current.active || held.reviewReleased) return;
          retireRecipient();
          void Promise.resolve(current.operation?.dispose()).catch(() => undefined);
          setController(null);
          setResolvedRecipient(null);
          setError('The recipient lookup expired or changed. Review the transfer again.');
        }, { once: true });
      }
      check();
      current.opening = open(
        address,
        nftRequest ??
          (token
            ? { kind: 'erc20', contractAddress: token.contractAddress, amount }
            : maximum
            ? { kind: 'maximum' }
            : { kind: 'exact', amount }),
        check
      ).then(async (operation) => {
        current.operation = operation;
        try {
          check();
          if (held.ticket) {
            const releaseRecipientReview = () => {
              const snapshot = operation.getSnapshot();
              if (
                held.reviewReleased || current.operation !== operation ||
                !snapshot.userOperationSubmissionStarted || snapshot.phase === 'failed'
              ) return;
              try {
                checkOwner();
              } catch {
                return;
              }
              // This marker comes from admitted handleOps dispatch, before its
              // transport. Funding and generic waiting phases cannot release ENS.
              held.reviewReleased = true;
              held.unsubscribe?.();
              held.unsubscribe = undefined;
              held.ticket?.dispose();
            };
            held.unsubscribe = operation.subscribe(releaseRecipientReview);
            releaseRecipientReview();
          }
          setController(operation);
        } catch (error) {
          await operation.dispose();
          if (current.operation === operation) current.operation = null;
          throw error;
        }
      });
      await current.opening;
    } catch (error) {
      const owned = recipientRequest.current === held;
      if (owned) retireRecipient();
      else held.ticket?.dispose();
      if (owned && current.active)
        setError(
          nativeTransferFailure(
            error,
            context,
            collectible ? 'collectible' : token ? 'token' : 'coin',
            false,
            false
          )
        );
    } finally {
      if (!recipientRequest.current || recipientRequest.current === held) {
        current.busy = false;
        if (current.active) setBusy(false);
      }
    }
  };
  if (closing)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Screen>
          <Text>Closing transfer review…</Text>
        </Screen>
      </SafeAreaView>
    );
  if (controller && !resolvedRecipient)
    return <NativeSmartAccountOperationScreen ledgerConnection={ledgerConnection} controller={controller} onBack={back} />;
  if (controller)
    return (
      <>
        {resolvedRecipient && <SafeAreaView edges={['top']} style={{ backgroundColor: colors.bg, paddingHorizontal: 24 }}>
          <Text selectable style={styles.muted}>ENS name: {resolvedRecipient.input}</Text>
          <Text selectable style={styles.muted}>Resolved address: {resolvedRecipient.address}</Text>
        </SafeAreaView>}
        <NativeSmartAccountOperationScreen ledgerConnection={ledgerConnection} controller={controller} onBack={back} />
      </>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen footer={
          <Button
            title="Review transfer"
            disabled={
              busy || !recipient || !amount || (!!collectible && !tokenId)
            }
            onPress={() => void review()}
          />
        }>
          <Header title="Send" onBack={back} />
          <Text style={styles.muted}>
            {accountLabel} · {context.name}
          </Text>
          {!collectible && (
            <Text style={styles.muted}>
              {displayedBalance !== null
                ? `Balance ${displayedBalance} ${symbol}`
                : loadingBalance
                ? 'Loading balance…'
                : 'Balance unavailable'}
            </Text>
          )}
          {collectible && (
            <>
              <Text style={styles.muted}>{collectible.tokenStandard}</Text>
              <Text selectable style={styles.muted}>
                {collectible.contractAddress}
              </Text>
            </>
          )}
          {token && (
            <>
              <Text style={styles.muted}>{token.name}</Text>
              <Text selectable style={styles.muted}>
                {token.contractAddress}
              </Text>
            </>
          )}
          <NativeSendInput
            label="Recipient address"
            value={recipient}
            onChange={editRecipient}
            busy={busy}
            placeholder="0x… or name.eth"
          />
          {collectible?.tokenStandard === 'ERC-721' && (
            <NativeSendInput
              label="Token ID"
              value={tokenId}
              onChange={setTokenId}
              busy={busy}
              keyboardType="number-pad"
            />
          )}
          {collectible?.tokenStandard === 'ERC-1155' && (
            <Text style={styles.muted}>Token ID {collectible.tokenId}</Text>
          )}
          {collectible?.tokenStandard !== 'ERC-721' && (
            <>
              <NativeSendInput
                label={collectible ? 'Quantity' : `Amount (${symbol})`}
                value={amount}
                onChange={(value) => {
                  setMaximum(false);
                  setAmount(value);
                }}
                busy={busy}
                keyboardType="decimal-pad"
              />
            </>
          )}
          {token && !collectible && (
            <NativeTokenMaximum
              owner={account}
              token={token}
              snapshot={inventory}
              view={tokenView}
              selected={maximum}
              disabled={busy}
              onSelect={(value) => {
                setMaximum(true);
                setAmount(value);
              }}
            />
          )}
          {!token && !collectible && (
            <Button
              title={maximum ? 'MAX selected' : 'MAX'}
              variant="secondary" size="compact"
              disabled={
                busy ||
                balance.status !== 'available' ||
                !balance.units ||
                BigInt(balance.units) <= BigInt(0)
              }
              onPress={() => {
                if (!busy && balance.units) {
                  setMaximum(true);
                  setAmount(formatBaseUnits(balance.units, context.decimals));
                }
              }}
            />
          )}
          {error ? (
            <Notice title="Check transfer" body={error} tone="amber" />
          ) : null}
          {busy ? <ActivityIndicator color={colors.pink} /> : null}

        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
