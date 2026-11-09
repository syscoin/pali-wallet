import type { NativePortfolioAccount } from '../portfolio/nativePortfolio';
import type { NativeRecipientResolution, NativeRecipientResolver } from '../portfolio/nativeRecipientResolver';
import { NativeTokenMaximum } from './NativeTokenMaximum';
import type { NativeTokenView } from '../portfolio/nativeTokens';
import { NativeLedgerConnectionModal } from './NativeLedger';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { IdlePressable, IdleTextInput } from './IdleActivityBoundary';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatBaseUnits } from '../core/amounts';
import {
  formatTokenUnits,
  parseErc20Units,
  type Erc20Metadata,
} from '../../../../source/shared/erc20';
import {
  findLocalEvmRecipientChoices,
  type EvmRecipientChoice,
} from '../../../../source/shared/evmRecipientChoices';
import { normalizeNftTokenId } from '../../../../source/utils/nftTokenId';
import { ASSET_STATE_SAVED_MESSAGE, ASSET_STATE_WAIT_MESSAGE, SIGNED_STORAGE_FULL_MESSAGE, SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE, type NativeTransferView } from '../custody/transfers';
import type { NativeReplacementMode } from '../custody/transferRpc';
import type { SavedCollectible } from '../portfolio/tokenRegistry';
import {
  type NativeSendContext,
} from '../custody/networkContext';
import {
  Button,
  Card,
  Coin,
  colors,
  Header,
  Notice,
  Screen,
  styles,
  Text,
} from '../ui';

export const nativeTransferFailure = (
  error: unknown,
  context: NativeSendContext,
  asset: 'coin' | 'token' | 'collectible',
  hasSavedTransaction: boolean,
  cancellation: boolean
) => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'ENS_UNAVAILABLE') return 'This ENS name could not be resolved. Check the name and try again.';
  if (code === 'RECIPIENT_EXPIRED') return 'The recipient lookup expired or changed. Review the transfer again.';
  if (code === 'SIGNED_STORAGE_FULL') return hasSavedTransaction ? SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE : SIGNED_STORAGE_FULL_MESSAGE;
  if (code === 'CANCELLATION_QUEUED')
    return hasSavedTransaction
      ? 'Your signed transaction is saved. It must wait for earlier transactions. Check Activity before retrying.'
      : 'This cancellation must wait for earlier transactions. Check Activity before trying again.';
  if (code === 'INVALID_NONCE') return 'Enter a valid whole number for the nonce.';
  if (code === 'NONCE_RETAINED') return 'A saved transaction uses this nonce. Choose another nonce or check Activity.';
  if (code === 'NONCE_UNAVAILABLE')
    return hasSavedTransaction ? 'Check the saved transaction in Activity.'
      : 'This nonce has already been used on-chain. Choose another or leave it blank.';
  if (code === 'INVALID_INPUT')
    return asset === 'collectible'
      ? `Enter a valid ${context.name} recipient address.`
      : `Enter ${context.networkId === 'ethereum' ? 'an' : 'a'} ${
          context.name
        } address and an amount greater than zero.`;
  if (code === 'ASSET_STATE_WAIT')
    return hasSavedTransaction
      ? ASSET_STATE_SAVED_MESSAGE
      : ASSET_STATE_WAIT_MESSAGE;
  if (code === 'EXPIRED')
    return hasSavedTransaction
      ? 'Your signed transaction is saved. Check it before sending again.'
      : cancellation ? 'This cancellation is unavailable. Check the original transaction or try again.'
      : 'Network conditions changed or this review expired. Review the transfer again.';
  if (code === 'INSUFFICIENT_BALANCE') {
    if (asset === 'collectible')
      return `Not enough ${context.symbol} for the execution fee limit.`;
    return asset !== 'coin' || cancellation
      ? `Not enough ${context.symbol} for the maximum network fee.`
      : `Not enough ${context.symbol} for the amount and maximum network fee.`;
  }
  if (code === 'INSUFFICIENT_TOKEN_BALANCE')
    return 'Not enough tokens for this transfer.';
  if (code === 'TOKEN_CHANGED')
    return 'Token precision changed. Review the token before sending again.';
  if (code === 'TOKEN_TRANSFER_REJECTED')
    return 'The token contract rejected this transfer.';
  if (['COLLECTIBLE_CHANGED', 'INSUFFICIENT_NFT_BALANCE', 'NFT_TRANSFER_REJECTED'].includes(code))
    return ''; // Show the controller's specific collectible error.
  if (code === 'BUSY') return 'Wait for the current request to finish.';
  if (code === 'CANCELLED' || code === 'NOT_READY')
    return 'Your wallet was locked. Unlock to continue.';
  if (code === 'PENDING_TRANSFER') return '';
  return hasSavedTransaction
    ? 'This request could not be completed. Check your pending transaction before sending again.'
    : 'This request could not be completed. Try again or check Activity for an existing transaction.';
};

export type NativeRecipientPicker = Readonly<{
  accounts(): readonly EvmRecipientChoice[];
  current(): boolean;
}>;

type RecipientPickerSession = Readonly<{
  owner: NativeRecipientPicker;
  accounts: readonly EvmRecipientChoice[];
}>;

export function NativeSendInput({ label, value, onChange, onEdit, busy, keyboardType = 'default', max = 1024, placeholder }: {
  label: string;
  value: string;
  onChange(value: string): void;
  onEdit?(): void;
  busy: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  max?: number;
  placeholder?: string;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <IdleTextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(next) => {
          onChange(next);
          onEdit?.();
        }}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="noExcludeDescendants"
        textContentType="none"
        keyboardType={keyboardType}
        maxLength={max}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        selectionColor={colors.pink}
        style={s.input}
      />
    </View>
  );
}

const emptyTokenSubscribe = () => () => undefined;
const emptyTokenSnapshot = () => null;

export type NativeSendInitialDraft = Readonly<{
  recipient: string;
  amount: string;
  tokenId?: string;
  nonce: string;
}>;

export function NativeSend({
  controller,
  onBack,
  accountLabel = 'Account 1',
  account,
  token,
  tokenView,
  collectible,
  context,
  savedHash,
  replacement,
  recipientPicker,
  ledgerConnection,
  initialDraft,
  beforeClose,
  recipientResolver,
}: {
  controller: NativeTransferView;
  ledgerConnection?: NativeLedgerConnectionView;
  initialDraft?: NativeSendInitialDraft;
  beforeClose?(): Promise<void>;
  recipientResolver?: NativeRecipientResolver;
  onBack(): void;
  accountLabel?: string;
  account: NativePortfolioAccount;
  token?: Erc20Metadata;
  tokenView?: Pick<NativeTokenView, 'subscribe' | 'getSnapshot' | 'connect'>;
  collectible?: SavedCollectible;
  context: NativeSendContext;
  savedHash?: string;
  recipientPicker?: NativeRecipientPicker;
  replacement?: Readonly<{ hash: string; mode: NativeReplacementMode | 'cancel-saved' }>;
}) {
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot()
  );
  const tokenSnapshot = useSyncExternalStore(
    tokenView?.subscribe ?? emptyTokenSubscribe,
    tokenView?.getSnapshot ?? emptyTokenSnapshot,
    tokenView?.getSnapshot ?? emptyTokenSnapshot
  );
  useLayoutEffect(
    () => token ? tokenView?.connect() : undefined,
    [token, tokenView]
  );
  const [maximum, setMaximum] = useState(false);
  const [ledgerPicker, setLedgerPicker] = useState<NativeLedgerConnectionView | null>(null);
  const ledgerReady = useSyncExternalStore(
    (listener) => ledgerConnection?.subscribe(listener) ?? (() => undefined),
    () => ledgerConnection?.isConnected() ?? true,
    () => false,
  );
  const draftCollectible = savedHash || token ? undefined : collectible;
  const initialAmount = draftCollectible?.tokenStandard === 'ERC-1155' ? '1' : '';
  const [recipientDraft, setRecipientDraft] = useState<{
    value: string;
    owner?: NativeRecipientPicker;
  }>({ value: initialDraft?.recipient ?? '' });
  const recipient = recipientDraft.owner && recipientDraft.owner !== recipientPicker
    ? '' : recipientDraft.value;
  const activePicker = useRef<RecipientPickerSession | null>(null);
  const [openPicker, setOpenPicker] = useState<Readonly<{
    session: RecipientPickerSession;
    query: string;
  }> | null>(null);
  const picker = openPicker?.session.owner === recipientPicker ? openPicker : null;
  const recipientChoices = picker
    ? findLocalEvmRecipientChoices(picker.session.accounts, picker.query)
    : [];
  const retirePicker = useCallback(() => {
    activePicker.current = null;
    setOpenPicker(null);
  }, []);
  const [amount, setAmount] = useState(initialDraft?.amount ?? initialAmount);
  const [tokenId, setTokenId] = useState(initialDraft?.tokenId ?? '');
  const [advanced, setAdvanced] = useState(!!initialDraft);
  const [nonce, setNonce] = useState(initialDraft?.nonce ?? '');
  const [error, setError] = useState('');
  const [leavePrompt, setLeavePrompt] = useState<{ review: typeof snapshot.review; fallback: typeof snapshot | null } | null>(null);
  const leaving = useRef(false);
  const lifetime = useRef({ alive: true, epoch: 0 });
  const [resolving, setResolving] = useState(false);
  const [resolvedRecipient, setResolvedRecipient] = useState<NativeRecipientResolution | null>(null);
  const resolution = useRef<{
    abort: AbortController;
    ticket?: NativeRecipientResolution;
    authorized: boolean;
  } | null>(null);
  const latestRecipientOwner = useRef({ controller, account, context, recipientResolver, recipient });
  useLayoutEffect(() => {
    latestRecipientOwner.current = { controller, account, context, recipientResolver, recipient };
  }, [controller, account, context, recipientResolver, recipient]);
  const retireResolution = useCallback(() => {
    const held = resolution.current;
    resolution.current = null;
    held?.abort.abort();
    held?.ticket?.dispose();
    if (held && !held.authorized) controller.cancel();
    setResolving(false);
    setResolvedRecipient(null);
  }, [controller]);
  const setRecipient = (value: string) => {
    retireResolution();
    setRecipientDraft({ value });
  };
  useLayoutEffect(() => () => retireResolution(), [retireResolution, account.address,
    account.network, account.revision, context.registrationHash, recipientResolver]);
  const pickerIsCurrent = (session: RecipientPickerSession) =>
    lifetime.current.alive && activePicker.current === session && session.owner.current();
  const latestBack = useRef(onBack);
  useLayoutEffect(() => {
    latestBack.current = onBack;
  }, [onBack]);
  const [closingHardware, setClosingHardware] = useState(false);
  const busy = resolving || closingHardware || ['preparing', 'signing', 'submitting'].includes(snapshot.phase);
  const promptMatches = (current: typeof snapshot) => !!leavePrompt &&
    current.phase === 'submitting' && current.review === leavePrompt.review &&
    (leavePrompt.review !== null || current === leavePrompt.fallback);
  const review = snapshot.review;
  const replacementHash = replacement?.hash;
  const replacementMode = replacement?.mode;
  const cancellation = replacementMode === 'cancel' || replacementMode === 'cancel-saved';
  const prepareReplacement = replacementMode === 'cancel-saved' ? controller.prepareSavedCancellation
    : cancellation ? controller.prepareCancellation : controller.prepareSpeedUp;
  const reviewCancellation = review?.replacement?.mode === 'cancel';
  const capturedContext = review?.context ?? snapshot.context ?? context;
  const networkLabel = `${capturedContext.name}${
    capturedContext.testnet ? ' · Test network' : ''
  }`;
  const reviewedToken = review?.intent?.token;
  const reviewedCollectible = review?.collectible;
  const outcomeToken = snapshot.intent?.token;
  const outcomeCollectible = snapshot.collectible;
  const amountText = review && !reviewedCollectible
    ? reviewedToken
      ? formatTokenUnits(review.amountUnits, reviewedToken.decimals)
      : formatBaseUnits(review.amountUnits, 18)
    : '';
  const tokenIdentity = (asset: Erc20Metadata) => (
    <Card style={s.summary}>
      <Text style={s.label}>
        TOKEN CONTRACT · {capturedContext.name.toUpperCase()}
      </Text>
      <Text selectable style={s.address} testID="native-send-token-contract">
        {asset.contractAddress}
      </Text>
      <Text style={s.hint}>
        {asset.name} · {asset.symbol}
      </Text>
      <Text style={s.label}>DECIMALS</Text>
      <Text testID="native-send-token-decimals">{asset.decimals}</Text>
      <Text style={s.hint}>Custom token · Unverified issuer metadata</Text>
    </Card>
  );
  const collectibleIdentity = (asset: {
    contractAddress: string;
    tokenStandard: SavedCollectible['tokenStandard'];
    tokenId?: string;
    amountUnits?: string;
  }) => (
    <Card style={s.summary}>
      <Text style={s.label}>COLLECTIBLE CONTRACT · {asset.tokenStandard}</Text>
      <Text selectable style={s.address} testID="native-send-collectible-contract">
        {asset.contractAddress}
      </Text>
      {asset.tokenId !== undefined && (
        <>
          <Text style={s.label}>TOKEN ID</Text>
          <Text selectable style={s.address} testID="native-send-collectible-id">
            {asset.tokenId}
          </Text>
        </>
      )}
      {asset.amountUnits !== undefined && (
        <>
          <Text style={s.label}>QUANTITY</Text>
          <Text
            selectable
            style={s.address}
            accessibilityLabel={`${asset.amountUnits} ${asset.amountUnits === '1' ? 'collectible' : 'collectibles'}`}
            testID="native-send-amount"
          >
            {asset.amountUnits}
          </Text>
        </>
      )}
    </Card>
  );
  const finishClose = useCallback(() => {
    if (!lifetime.current.alive || leaving.current) return;
    leaving.current = true;
    retirePicker();
    retireResolution();
    lifetime.current.epoch++;
    const closingEpoch = lifetime.current.epoch;
    controller.cancel();
    Keyboard.dismiss();
    if (!beforeClose) { latestBack.current(); return; }
    setClosingHardware(true);
    void Promise.resolve().then(beforeClose).then(() => {
      if (lifetime.current.alive && lifetime.current.epoch === closingEpoch) latestBack.current();
    }, () => {
      if (lifetime.current.alive && lifetime.current.epoch === closingEpoch) {
        leaving.current = false;
        setClosingHardware(false);
        setError('The hardware request is still closing. Try again.');
      }
    });
  }, [beforeClose, controller, retirePicker, retireResolution]);
  const close = useCallback(() => {
    if (!lifetime.current.alive || leaving.current) return;
    const current = controller.getSnapshot();
    if (current.phase === 'submitting') {
      Keyboard.dismiss();
      setLeavePrompt({ review: current.review, fallback: current.review === null ? current : null });
      return;
    }
    finishClose();
  }, [controller, finishClose, setLeavePrompt]);
  const leaveDuringSubmission = () => {
    // If it completed while the dialog was open, retain the visible outcome.
    if (!promptMatches(controller.getSnapshot())) {
      setLeavePrompt(null);
      return;
    }
    setLeavePrompt(null);
    finishClose();
  };
  useLayoutEffect(() => {
    const current = lifetime.current;
    current.alive = true;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => {
      activePicker.current = null;
      current.alive = false;
      current.epoch++;
      controller.cancel();
      back.remove();
    };
  }, [controller, close]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    const captured = lifetime.current.epoch;
    setError('');
    try {
      await operation();
    } catch (cause) {
      if (lifetime.current.alive && captured === lifetime.current.epoch) {
        const current = controller.getSnapshot();
        if (cause instanceof Error && cause.message === 'EXPIRED' &&
          current.phase === 'unknown' && current.hash &&
          current.message === ASSET_STATE_SAVED_MESSAGE) return;
        const asset = reviewedCollectible || (draftCollectible && !current.hash)
          ? 'collectible'
          : token || current.intent ? 'token' : 'coin';
        setError(nativeTransferFailure(cause, capturedContext, asset, !!current.hash, cancellation));
      }
    }
  };
  useEffect(() => {
    if (replacementHash && replacementMode) {
      const captured = lifetime.current.epoch;
      void prepareReplacement(replacementHash).catch((cause) => {
        if (lifetime.current.alive && captured === lifetime.current.epoch)
          setError(cause instanceof Error && cause.message === 'CANCELLATION_QUEUED'
            ? 'This cancellation must wait for earlier transactions. Check Activity before trying again.'
            : cause instanceof Error && cause.message === 'INSUFFICIENT_BALANCE'
            ? 'The account cannot cover the replacement amount and maximum fee.'
            : replacementMode === 'cancel-saved'
              ? 'Pali could not verify that this saved transaction can still be cancelled.'
              : 'Pali could not verify that this transaction is still pending.');
      });
      return;
    }
    if (savedHash) void controller.recover(true, savedHash).catch(() => undefined);
  }, [controller, savedHash, replacementHash, replacementMode, prepareReplacement]);
  const submit = () => {
    if (!review || controller.getSnapshot().review !== review || busy ||
        !review.retry && ledgerConnection && !ledgerConnection.isConnected()) return;
    const held = resolution.current;
    if (held?.ticket && !review.retry) {
      try {
        held.ticket.assertCurrent();
        if (recipient.trim() !== held.ticket.input ||
            (reviewedCollectible?.recipient ?? review.recipient).toLowerCase() !== held.ticket.address.toLowerCase()) throw new Error('RECIPIENT_EXPIRED');
        held.authorized = true;
      } catch {
        retireResolution();
        setError('The recipient lookup expired or changed. Review the transfer again.');
        return;
      }
    }
    Keyboard.dismiss();
    void run(() => controller.confirm(review.id));
  };
  const prepare = () => {
    retirePicker();
    const chosenOwner = recipientDraft.owner;
    if (chosenOwner && (chosenOwner !== recipientPicker || !chosenOwner.current())) {
      setRecipient('');
      setError('Choose an account again or enter a recipient address.');
      return;
    }
    const nonceOverride = advanced ? nonce.trim() || undefined : undefined;
    const prepareRecipient = (operation: (address: string) => Promise<void>) => {
      const input = recipient.trim();
      if (!input.toLowerCase().endsWith('.eth')) {
        retireResolution();
        void run(() => operation(input));
        return;
      }
      if (resolution.current || busy) return;
      const held = { abort: new AbortController(), authorized: false, ticket: undefined as NativeRecipientResolution | undefined };
      resolution.current = held;
      const captured = latestRecipientOwner.current;
      const epoch = lifetime.current.epoch;
      const check = () => {
        const actual = latestRecipientOwner.current;
        if (!lifetime.current.alive || lifetime.current.epoch !== epoch || resolution.current !== held || held.abort.signal.aborted ||
            actual.controller !== captured.controller || actual.recipient !== captured.recipient ||
            actual.recipientResolver !== captured.recipientResolver || actual.account.address !== captured.account.address ||
            actual.account.network !== captured.account.network || actual.account.revision !== captured.account.revision ||
            actual.context.registrationHash !== captured.context.registrationHash) throw new Error('RECIPIENT_EXPIRED');
      };
      void run(async () => {
        setResolving(true);
        try {
          if (!recipientResolver) throw new Error('ENS_UNAVAILABLE');
          const ticket = await recipientResolver.resolve(input, { account, context }, held.abort.signal, check);
          held.ticket = ticket;
          check();
          ticket.assertCurrent();
          ticket.signal.addEventListener('abort', () => {
            if (resolution.current !== held || held.authorized) return;
            retireResolution();
            if (lifetime.current.alive) {
              setResolving(false);
              setError('The recipient lookup expired or changed. Review the transfer again.');
            }
          }, { once: true });
          setResolvedRecipient(ticket);
          await operation(ticket.address);
          check();
          ticket.assertCurrent();
          const review = controller.getSnapshot().review;
          if (!review || (review.collectible?.recipient ?? review.recipient).toLowerCase() !== ticket.address.toLowerCase()) throw new Error('RECIPIENT_EXPIRED');
        } catch (error) {
          held.ticket?.dispose();
          if (resolution.current !== held) return;
          retireResolution();
          throw error;
        } finally {
          if (resolution.current === held && lifetime.current.alive && lifetime.current.epoch === epoch) setResolving(false);
        }
      });
    };
    if (!draftCollectible) {
      prepareRecipient((address) => token
        ? controller.prepareToken(token.contractAddress, address, amount, nonceOverride)
        : controller.prepare(address, amount, nonceOverride));
      return;
    }
    let id: string;
    try {
      id = draftCollectible.tokenStandard === 'ERC-1155'
        ? draftCollectible.tokenId
        : normalizeNftTokenId(tokenId.trim());
    } catch {
      setError('Enter a valid token ID.');
      return;
    }
    let quantity: string;
    try {
      quantity = draftCollectible.tokenStandard === 'ERC-1155'
        ? parseErc20Units(amount.trim())
        : '1';
      if (quantity === '0') throw new Error('Quantity must be positive');
    } catch {
      setError('Enter a whole quantity greater than zero.');
      return;
    }
    Keyboard.dismiss();
    prepareRecipient((address) => controller.prepareCollectible(draftCollectible, address, id, quantity, nonceOverride));
  };
  const clearCollectibleError = () => {
    if (draftCollectible && error) setError('');
  };
  const terminal = ['confirmed', 'reverted', 'nonce-consumed'].includes(
    snapshot.phase
  );
  const hasOutcome =
    snapshot.hash &&
    [
      'pending',
      'unknown',
      'confirmed',
      'reverted',
      'nonce-consumed',
      'unavailable',
    ].includes(snapshot.phase);
  const footer = !review && !hasOutcome && !replacementHash ? (
    <Button
      title="Review transfer"
      disabled={busy || !recipient.trim() ||
        (draftCollectible?.tokenStandard === 'ERC-721' ? !tokenId.trim() : !amount)}
      onPress={prepare}
      testID="native-send-review"
    />
  ) : undefined;
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen footer={footer}>
          <Header
            title={
              cancellation
                ? hasOutcome ? 'Cancellation status' : 'Review cancellation'
                : replacementHash
                ? hasOutcome ? 'Speed Up status' : 'Review Speed Up'
                : review
                ? (review.retry ? 'Review resend' : reviewedCollectible ? 'Review collectible' : 'Review transfer')
                : hasOutcome
                ? 'Transfer status'
                : draftCollectible
                ? 'Send collectible'
                : token
                ? `Send ${token.symbol}`
                : `Send ${capturedContext.symbol}`
            }
            subtitle={`${accountLabel} · ${networkLabel}`}
            onBack={close}
          />
          {capturedContext.testnet && (
            <Notice
              title="Test network"
              body={`Use test funds only. This transfer is on ${capturedContext.name} (chain ${capturedContext.chainId}).`}
              tone="amber"
            />
          )}
          {review ? (
            <>
              {reviewedCollectible ? collectibleIdentity(reviewedCollectible) : (
                <View style={s.hero}>
                  <Coin
                    id={reviewedToken ? 'custom-token' : capturedContext.networkId}
                    size={46}
                  />
                  <Text
                    style={[s.amount, amountText.length > 16 && s.preciseAmount]}
                    testID="native-send-amount"
                  >
                    {amountText}
                  </Text>
                  <Text style={styles.muted}>
                    {reviewedToken?.symbol ?? capturedContext.symbol} ·{' '}
                    {networkLabel}
                  </Text>
                </View>
              )}
              {review.replay?.missingNonce !== undefined && <Card style={s.summary}>
                <Text style={s.label}>PREVIOUS TRANSACTION · NONCE {review.replay.missingNonce}</Text>
                <Text style={s.hint}>This transaction is waiting for an earlier nonce.</Text>
                {!review.replay.predecessorCount && <Text style={s.hint}>No earlier transaction is available to retry on this device.</Text>}
                {review.replay.predecessors.map(candidate => <Button key={candidate.hash} variant="secondary"
                  title={`${candidate.operation === 'cancel' ? 'Cancellation' : candidate.operation === 'speed-up' ? 'Replacement' : 'Transaction'} ${candidate.hash.slice(0, 10)}…`}
                  onPress={() => void run(() => controller.recover(true, candidate.hash))} />)}
                {review.replay.predecessors.length < review.replay.predecessorCount && <Button title="Load more saved transactions" variant="quiet" disabled={busy}
                  onPress={() => void run(() => controller.loadMorePredecessors())} />}
              </Card>}
              <Card style={s.summary}>
                {resolvedRecipient && !review.retry && !review.replacement && <>
                  <Text style={s.label}>ENS NAME</Text>
                  <Text selectable style={s.address}>{resolvedRecipient.input}</Text>
                  <Text style={s.label}>RESOLVED ADDRESS</Text>
                </>}
                <Text style={s.label}>{reviewCancellation ? 'TO · YOUR ADDRESS' : reviewedCollectible ? 'RECIPIENT' : 'TO'}</Text>
                <Text
                  selectable
                  style={s.address}
                  testID="native-send-recipient"
                >
                  {reviewedCollectible?.recipient ?? review.recipient}
                </Text>
                {review.nonceOverride !== undefined && <>
                  <View style={s.separator} />
                  <Text style={s.label}>MANUAL NONCE</Text>
                  <Text testID="native-send-reviewed-nonce">{review.nonce}</Text>
                  <Text style={s.hint}>This can replace a pending transaction with the same nonce, including one sent from another wallet.</Text>
                </>}
                <View style={s.separator} />
                <Text style={s.label}>EXECUTION FEE LIMIT</Text>
                <Text testID="native-send-fee">
                  {formatBaseUnits(review.maximumFeeUnits, 18)}{' '}
                  {capturedContext.symbol}
                </Text>
                <Text style={s.hint}>
                  The final fee depends on network execution. This review limits the gas price and gas used by this transaction.
                </Text>
                {!reviewedToken && !reviewedCollectible && !reviewCancellation && (
                  <>
                    <View style={s.separator} />
                    <Text style={s.label}>AMOUNT + EXECUTION FEE LIMIT</Text>
                    <Text>
                      {formatBaseUnits(review.totalUnits, 18)}{' '}
                      {capturedContext.symbol}
                    </Text>
                  </>
                )}
              </Card>
              {reviewedToken && tokenIdentity(reviewedToken)}
              {reviewedToken && (
                <Notice
                  title="Token transfer"
                  body={`The token amount and ${capturedContext.symbol} network fee are separate. Token contracts may deduct fees or apply other rules, so the received amount can differ.`}
                  tone="amber"
                />
              )}
              {review.replacement && <Card style={s.summary}>
                <Text style={s.label}>ORIGINAL TRANSACTION · NONCE {review.nonce}</Text>
                <Text selectable style={s.address}>{review.replacement.originalHash}</Text>
                {!reviewCancellation && <Text style={s.hint}>
                  Original execution fee limit: {formatBaseUnits(review.replacement.originalMaximumFeeUnits, 18)} {capturedContext.symbol}
                </Text>}
                <Text style={s.hint}>{reviewCancellation
                  ? 'This sends zero to your own address with a higher fee. The original can still confirm first.'
                  : 'This sends the same payment with updated gas and fee limits. The original can still confirm first.'}</Text>
              </Card>}
              {review.replay && <Card style={s.summary}>
                <Text style={s.label}>SAVED TRANSACTION · NONCE {review.nonce}</Text>
                <Text selectable style={s.address}>{review.replay.hash}</Text>
                <Text style={s.hint}>Connection: {new URL(capturedContext.rpcUrl).host}</Text>
                <Text>{review.replay.operation === 'cancel' ? 'Cancellation' : review.replay.operation === 'speed-up' ? 'Fee replacement' : review.replay.to === null ? 'Contract creation' : review.replay.dataBytes ? 'Contract interaction' : 'Transfer'}</Text>
                {review.replay.dataBytes > 0 && <Text style={s.hint}>{review.replay.selector ?? 'Contract data'} · {review.replay.dataBytes} bytes</Text>}
                {!!review.replay.accessListEntries && <Text style={s.hint}>{review.replay.accessListEntries} access-list entries</Text>}
                {review.replay.tokenTransfer && !reviewedToken && <Text>Token base units: {review.replay.tokenTransfer.amountUnits}</Text>}
                <Text style={s.hint} testID="native-replay-same-nonce-warning">
                  If another transaction uses this nonce, resending may replace it or be rejected. Either transaction may confirm. Check Activity and any other wallet using this account before continuing.
                </Text>
              </Card>}
              {!review.replacement && <Text style={s.hint}>
                Confirm the full address and network before sending. Completed
                transfers cannot be reversed.
              </Text>}
              {ledgerConnection && !review.retry && !ledgerReady && <Button
                title="Connect Ledger" disabled={busy}
                onPress={() => { Keyboard.dismiss(); setLedgerPicker(ledgerConnection); }}
              />}
              <Button
                title={reviewCancellation ? 'Submit cancellation' : review.replacement ? 'Submit Speed Up' : review.retry ? 'Resend signed transaction' : 'Confirm and send'}
                disabled={busy || !review.retry && !ledgerReady}
                onPress={submit}
                testID="native-send-confirm"
              />
              <Button
                title={review.retry || review.replacement ? 'Close review' : 'Edit transfer'}
                variant="quiet"
                disabled={busy}
                onPress={() => {
                  if (replacementHash) close();
                  else if (reviewedCollectible && review.replay) void run(() => controller.recover(false, review.replay?.hash));
                  else controller.cancel();
                }}
              />
            </>
          ) : hasOutcome ? (
            <>
              <View style={s.hero}>
                <Coin
                  id={outcomeToken || outcomeCollectible ? 'custom-token' : capturedContext.networkId}
                  size={46}
                />
                <Text style={s.title}>
                  {snapshot.phase === 'confirmed'
                    ? cancellation
                      ? 'Cancellation confirmed'
                      : replacementHash ? 'Replacement confirmed'
                      : outcomeToken || outcomeCollectible
                      ? 'Transaction confirmed'
                      : 'Transfer confirmed'
                    : snapshot.phase === 'reverted'
                    ? cancellation ? 'Cancellation reverted' : replacementHash ? 'Replacement reverted' : 'Transfer reverted'
                    : snapshot.phase === 'nonce-consumed'
                    ? 'Check account history'
                    : snapshot.phase === 'unknown'
                    ? snapshot.message === SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE ? 'Check earlier transaction' : snapshot.message === ASSET_STATE_SAVED_MESSAGE ? 'Saved, not submitted' : 'Checking submission'
                    : snapshot.phase === 'unavailable'
                    ? 'Status unavailable'
                    : cancellation ? 'Cancellation submitted' : replacementHash ? 'Replacement submitted' : 'Transfer pending'}
                </Text>
              </View>
              {outcomeToken && tokenIdentity(outcomeToken)}
              {outcomeCollectible && collectibleIdentity(outcomeCollectible)}
              <View
                accessibilityRole={[ASSET_STATE_SAVED_MESSAGE, SIGNED_STORAGE_FULL_MESSAGE, SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE].includes(snapshot.message ?? '') ? 'alert' : undefined}
                accessibilityLiveRegion={[ASSET_STATE_SAVED_MESSAGE, SIGNED_STORAGE_FULL_MESSAGE, SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE].includes(snapshot.message ?? '') ? 'polite' : undefined}
              >
                <Notice
                  title={
                    snapshot.phase === 'unknown'
                      ? 'Keep this transaction'
                      : `${capturedContext.name} transaction`
                  }
                  body={
                    snapshot.message ??
                    'Check the transaction status before sending again.'
                  }
                  tone={
                    snapshot.phase === 'unknown' ||
                    snapshot.phase === 'unavailable' ||
                    snapshot.phase === 'reverted' ||
                    snapshot.phase === 'nonce-consumed'
                      ? 'amber'
                      : undefined
                  }
                />
              </View>
              <Card style={s.summary}>
                <Text style={s.label}>TRANSACTION HASH</Text>
                <Text selectable style={s.address} testID="native-send-hash">
                  {snapshot.hash}
                </Text>
              </Card>
              <Button
                title="Check status"
                variant={terminal ? 'secondary' : 'primary'}
                disabled={busy}
                onPress={() => void run(() => controller.recover(false, snapshot.hash ?? undefined))}
              />
              {snapshot.phase === 'unknown' && !snapshot.inspectionOnly && (
                <Button
                  title="Review retry"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void run(() => controller.recover(true, snapshot.hash ?? undefined))}
                />
              )}
              {!replacementHash && ['confirmed', 'reverted', 'nonce-consumed'].includes(
                snapshot.phase
              ) && (
                <Button
                  title="New transfer"
                  onPress={() => {
                    setRecipient('');
                    setAmount(initialAmount);
                    setTokenId('');
                    setAdvanced(false);
                    setNonce('');
                    setError('');
                    controller.cancel();
                  }}
                />
              )}
              <Button title={replacementHash ? 'Back to Activity' : 'Back to wallet'} variant="quiet" onPress={close} />
            </>
          ) : replacementHash ? (
            !busy && <Button title="Check again" variant="secondary" onPress={() => void run(() => prepareReplacement(replacementHash))} />
          ) : (
            <>
              <NativeSendInput
                label={draftCollectible ? 'Recipient address' : `${capturedContext.name} address`}
                value={recipient}
                onChange={setRecipient}
                onEdit={clearCollectibleError}
                busy={busy}
                max={255}
                placeholder="0x… or name.eth"
              />
              {recipientPicker && !savedHash && !replacementHash && !token && !draftCollectible && (
                <>
                  <Button
                    title={picker ? 'Hide accounts' : 'Choose account'}
                    variant="quiet"
                    disabled={busy}
                    onPress={() => {
                      if (picker) {
                        if (activePicker.current === picker.session) retirePicker();
                        return;
                      }
                      if (!lifetime.current.alive || !recipientPicker.current() ||
                          activePicker.current?.owner === recipientPicker) return;
                      const session = { owner: recipientPicker, accounts: recipientPicker.accounts() };
                      activePicker.current = session;
                      setOpenPicker({ session, query: '' });
                    }}
                  />
                  {picker && (
                    <Card style={s.summary}>
                      <NativeSendInput
                        label="Find account"
                        value={picker.query}
                        onChange={(query) => {
                          const { session } = picker;
                          if (pickerIsCurrent(session))
                            setOpenPicker((current) => current?.session === session ? { session, query } : current);
                        }}
                        busy={busy}
                        max={128}
                      />
                      {recipientChoices.length ? recipientChoices.map(({ address, label }) => (
                        <IdlePressable
                          key={address}
                          accessibilityRole="button"
                          accessibilityLabel={`${label}, ${address}`}
                          disabled={busy}
                          style={s.recipientChoice}
                          onPress={() => {
                            if (!pickerIsCurrent(picker.session)) return;
                            retirePicker();
                            setRecipientDraft({ value: address, owner: picker.session.owner });
                            setError('');
                            Keyboard.dismiss();
                          }}
                        >
                          <Text>{label}</Text>
                          <Text style={styles.muted}>{address.slice(0, 10)}…{address.slice(-8)}</Text>
                        </IdlePressable>
                      )) : <Text style={styles.muted}>No matching accounts.</Text>}
                    </Card>
                  )}
                </>
              )}
              {draftCollectible ? (
                <>
                  {collectibleIdentity(draftCollectible)}
                  {draftCollectible.tokenStandard === 'ERC-721'
                    ? <NativeSendInput label="Token ID" value={tokenId} onChange={setTokenId}
                        onEdit={clearCollectibleError} busy={busy} keyboardType="number-pad" max={257} />
                    : <NativeSendInput label="Quantity" value={amount} onChange={setAmount}
                        onEdit={clearCollectibleError} busy={busy} keyboardType="number-pad" max={79} />}
                </>
              ) : (
                <>
                  {token && tokenIdentity(token)}
                  <NativeSendInput label={`Amount in ${token?.symbol ?? capturedContext.symbol}`} value={amount}
                    onChange={(value) => { setMaximum(false); setAmount(value); }} busy={busy} keyboardType="decimal-pad" max={token ? 334 : 100} />
                  {token && (
                    <NativeTokenMaximum
                      owner={account}
                      token={token}
                      snapshot={tokenSnapshot}
                      view={tokenView}
                      selected={maximum}
                      disabled={busy}
                      onSelect={(value) => {
                        setMaximum(true);
                        setAmount(value);
                      }}
                    />
                  )}
                </>
              )}
              <Button title={advanced ? 'Hide advanced options' : 'Advanced options'} variant="quiet"
                disabled={busy} expanded={advanced} onPress={() => {
                  if (advanced) {
                    setNonce('');
                    setError('');
                  }
                  setAdvanced(!advanced);
                }} />
              {advanced && <>
                <NativeSendInput label="Transaction nonce" value={nonce} onChange={setNonce}
                  busy={busy} keyboardType="number-pad" max={64} placeholder="Automatic"
                  onEdit={() => { if (error) setError(''); }} />
                <Text style={s.hint}>Leave blank for automatic selection. A higher nonce can wait for earlier transactions.</Text>
              </>}
            </>
          )}
          {busy && (
            <View style={s.progress}>
              <ActivityIndicator color={colors.pink} />
              <Text style={styles.muted}>
                {resolving ? 'Resolving ENS recipient…' : snapshot.phase === 'signing'
                  ? 'Authenticating and signing…'
                  : snapshot.phase === 'submitting'
                  ? 'Submitting the transaction…'
                  : 'Checking the network…'}
              </Text>
            </View>
          )}
          {!!error && !(hasOutcome && [ASSET_STATE_SAVED_MESSAGE, SIGNED_STORAGE_FULL_MESSAGE, SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE].includes(error) && error === snapshot.message) && (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={s.error}
            >
              {error}
            </Text>
          )}
          {!error && snapshot.message && !hasOutcome && !review && (
            <Text accessibilityRole="alert" style={s.error}>
              {snapshot.message}
            </Text>
          )}
          <Text style={s.buildLabel}>
            Development build · Use a test wallet
          </Text>
        </Screen>
      </KeyboardAvoidingView>
      {ledgerPicker && ledgerPicker === ledgerConnection && <NativeLedgerConnectionModal
        controller={ledgerPicker}
        onClose={() => setLedgerPicker(null)}
        onFinished={() => setLedgerPicker(null)}
      />}
      <Modal
        visible={promptMatches(snapshot)}
        transparent
        animationType="fade"
        onRequestClose={() => setLeavePrompt(null)}
      >
        <SafeAreaView style={s.leaveOverlay} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={s.leaveContent}>
            <Card style={s.leaveCard}>
              <Text accessibilityRole="header" style={s.leaveTitle}>Submission in progress</Text>
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                This transaction may already have been sent. Check Activity before sending again.
              </Text>
              <Button title="Stay" onPress={() => setLeavePrompt(null)} />
              <Button title="Leave" variant="secondary" onPress={leaveDuringSubmission} />
            </Card>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  recipientChoice: { minHeight: 48, justifyContent: 'center', gap: 2, paddingVertical: 6 },
  safeArea: { flex: 1, backgroundColor: colors.bg },
  leaveOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)' },
  leaveContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  leaveCard: { padding: 24, gap: 20 },
  leaveTitle: { fontSize: 24, fontWeight: '600' },
  flex: { flex: 1 },
  field: { gap: 10 },
  label: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 17,
    minHeight: 56,
    fontSize: 16,
  },
  summary: { padding: 18, gap: 10 },
  address: { fontSize: 14, lineHeight: 24 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  hero: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  amount: {
    fontSize: 29,
    lineHeight: 39,
    fontWeight: '600',
    textAlign: 'center',
    alignSelf: 'stretch',
    flexShrink: 1,
    maxWidth: '100%',
  },
  preciseAmount: { fontSize: 22, lineHeight: 32 },
  title: {
    fontSize: 23,
    lineHeight: 32,
    fontWeight: '600',
    textAlign: 'center',
  },
  separator: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  progress: { alignItems: 'center', gap: 12, paddingVertical: 18 },
  error: { color: colors.red, fontSize: 13, lineHeight: 21 },
  buildLabel: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
  },
});
