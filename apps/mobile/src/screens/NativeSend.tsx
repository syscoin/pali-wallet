import { AUTOMATIC_FEE, snapshotEvmFeeChoice, type EvmFeeChoice } from '../../../../source/shared/transactionFeeChoice';
import { NetworkFeeSheet } from './NetworkFeeSheet';
import { nativeI18n, useNativeTranslation } from '../platform/localization';
import { normalizeDecimalInput } from '../../../../source/shared/decimalInput';
import { sameNativePortfolioAccount, type NativePortfolioAccount } from '../portfolio/nativePortfolio';
import type { NativeUnsignedSendDraft } from './sendNetworkDraft';
import type { NativeOperationCredential } from '../custody/types';
import { RecipientQrScanner } from './RecipientQrScanner';
import { SendNetworkCard } from './SendNetworkCard';
import { SendAssetSelector, type SendAssetItem } from './SendAssetSelector';
import type { NativeRecipientResolution, NativeRecipientResolver } from '../portfolio/nativeRecipientResolver';
import { NativeTokenMaximum, nativeTokenAvailableAmount } from './NativeTokenMaximum';
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
import { ASSET_STATE_SAVED_MESSAGE, ASSET_STATE_WAIT_MESSAGE, SIGNED_STORAGE_FULL_MESSAGE, SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE,
  type NativeTransferReview, type NativeTransferView } from '../custody/transfers';
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
  Icon,
  IconButton,
  Notice,
  Screen,
  styles,
  Text,
} from '../ui';
const t = nativeI18n.t.bind(nativeI18n);
const savedTransferMessages = [ASSET_STATE_SAVED_MESSAGE, SIGNED_STORAGE_FULL_MESSAGE, SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE];
const displayTransferMessage = (message: string | null) => {
  switch (message) {
    case ASSET_STATE_SAVED_MESSAGE: return t('mobile.sendAssetViews.evm.asset_state_saved_message');
    case ASSET_STATE_WAIT_MESSAGE: return t('mobile.sendAssetViews.evm.asset_state_wait_message');
    case SIGNED_STORAGE_FULL_MESSAGE: return t('send.signedStorageFull');
    case SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE: return t('mobile.sendAssetViews.evm.signed_storage_full_previous_message');
    default: return message;
  }
};

export const nativeTransferFailure = (
  error: unknown,
  context: NativeSendContext,
  asset: 'coin' | 'token' | 'collectible',
  hasSavedTransaction: boolean,
  cancellation: boolean
) => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'ENS_UNAVAILABLE') return t('mobile.sendAssetViews.evm.thisENSNameCouldNotBeResolvedCheckTheName');
  if (code === 'RECIPIENT_EXPIRED') return t('mobile.smartSendViews.theRecipientLookupExpiredOrChangedReviewTheTransferAgain');
  if (code === 'INVALID_CREDENTIAL') return t('mobile.accounts.invalidCredential');
  if (code === 'AUTH_THROTTLED') return t('mobile.sendAssetViews.evm.tooManyUnsuccessfulAuthorizationAttemptsWaitAFewMinutesBefore');
  if (code === 'DEVICE_UNLOCK_UNAVAILABLE') return t('mobile.accounts.invalidCredential');
  if (code === 'SIGNED_STORAGE_FULL') return hasSavedTransaction ? SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE : SIGNED_STORAGE_FULL_MESSAGE;
  if (code === 'CANCELLATION_QUEUED')
    return hasSavedTransaction
      ? t('mobile.sendAssetViews.evm.yourSignedTransactionIsSavedItMustWaitForEarlier')
      : t('mobile.sendAssetViews.evm.thisCancellationMustWaitForEarlierTransactionsCheckActivityBefore');
  if (code === 'INVALID_NONCE') return t('mobile.sendAssetViews.evm.enterAValidWholeNumberForTheNonce');
  if (code === 'NONCE_RETAINED') return t('mobile.sendAssetViews.evm.aSavedTransactionUsesThisNonceChooseAnotherNonceOr');
  if (code === 'NONCE_UNAVAILABLE')
    return hasSavedTransaction ? t('mobile.sendAssetViews.evm.checkTheSavedTransactionInActivity')
      : t('mobile.sendAssetViews.evm.thisNonceHasAlreadyBeenUsedOnchainChooseAnotherOr');
  if (code === 'INVALID_INPUT')
    return asset === 'collectible'
      ? t('mobile.sendAssetViews.evm.validRecipient', { network: context.name })
      : t('mobile.sendAssetViews.evm.validAddressAmount', { network: context.name });
  if (code === 'ASSET_STATE_WAIT')
    return hasSavedTransaction
      ? ASSET_STATE_SAVED_MESSAGE
      : ASSET_STATE_WAIT_MESSAGE;
  if (code === 'EXPIRED')
    return hasSavedTransaction
      ? t('mobile.sendAssetViews.evm.yourSignedTransactionIsSavedCheckItBeforeSendingAgain')
      : cancellation ? t('mobile.sendAssetViews.evm.thisCancellationIsUnavailableCheckTheOriginalTransactionOrTry')
      : t('mobile.sendAssetViews.evm.networkConditionsChangedOrThisReviewExpiredReviewTheTransfer');
  if (code === 'INSUFFICIENT_BALANCE') {
    if (asset === 'collectible')
      return t('mobile.sendAssetViews.evm.notEnoughForTheExecutionFeeLimit', { symbol: context.symbol });
    return asset !== 'coin' || cancellation
      ? t('mobile.sendAssetViews.evm.notEnoughForTheMaximumNetworkFee', { symbol: context.symbol })
      : t('mobile.sendAssetViews.evm.notEnoughForTheAmountAndMaximumNetworkFee', { symbol: context.symbol });
  }
  if (code === 'INSUFFICIENT_TOKEN_BALANCE')
    return t('mobile.sendAssetViews.evm.notEnoughTokensForThisTransfer');
  if (code === 'TOKEN_CHANGED')
    return t('mobile.sendAssetViews.evm.tokenPrecisionChangedReviewTheTokenBeforeSendingAgain');
  if (code === 'TOKEN_TRANSFER_REJECTED')
    return t('mobile.sendAssetViews.evm.theTokenContractRejectedThisTransfer');
  if (['COLLECTIBLE_CHANGED', 'INSUFFICIENT_NFT_BALANCE', 'NFT_TRANSFER_REJECTED'].includes(code))
    return ''; // Show the controller's specific collectible error.
  if (code === 'BUSY') return t('mobile.sendAssetViews.evm.waitForTheCurrentRequestToFinish');
  if (code === 'CANCELLED' || code === 'NOT_READY')
    return t('mobile.sendAssetViews.evm.yourWalletWasLockedUnlockToContinue');
  if (code === 'PENDING_TRANSFER') return '';
  if (code === 'MAX_PENDING') return t('mobile.sendAssetViews.evm.mAXIsUnavailableWhileAnOutgoingTransactionIsPendingCheck');
  return hasSavedTransaction
    ? t('mobile.sendAssetViews.evm.thisRequestCouldNotBeCompletedCheckYourPendingTransaction')
    : t('mobile.sendAssetViews.evm.thisRequestCouldNotBeCompletedTryAgainOrCheck');
};

export type NativeRecipientPicker = Readonly<{
  accounts(): readonly EvmRecipientChoice[];
  current(): boolean;
}>;

type RecipientPickerSession = Readonly<{
  owner: NativeRecipientPicker;
  accounts: readonly EvmRecipientChoice[];
}>;

export function NativeSendInput({ label, value, onChange, onEdit, busy, keyboardType = 'default', max = 1024, placeholder, trailing }: {
  label: string;
  value: string;
  onChange(value: string): void;
  onEdit?(): void;
  busy: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  max?: number;
  placeholder?: string;
  trailing?: React.ReactNode;
}) {
  const { i18n } = useNativeTranslation();
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={trailing ? s.inputWithAction : undefined}><IdleTextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(next) => {
          onChange(keyboardType === 'decimal-pad' ? normalizeDecimalInput(next, i18n.resolvedLanguage ?? i18n.language) : next);
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
        returnKeyType="done"
        onSubmitEditing={() => Keyboard.dismiss()}
        maxLength={max}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        selectionColor={colors.pink}
        style={[s.input, !!trailing && s.inputWithActionField]}
      />
      {trailing}</View>
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
  max?: boolean;
  advanced?: boolean;
  feeChoice?: EvmFeeChoice;
}>;

export function NativeSend({
  controller,
  onBack,
  accountLabel = t('mobile.sendAssetViews.evm.account1'),
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
  onChangeNetwork,
  draftNotice,
  onViewTransaction,
  availableAmount,
  assetChoices,
  onChangeAsset,
}: {
  controller: NativeTransferView;
  onChangeNetwork?(draft: Extract<NativeUnsignedSendDraft, { kind: 'evm' }>): void;
  draftNotice?: string;
  onViewTransaction?(hash: string): void;
  availableAmount?: string;
  assetChoices?: readonly SendAssetItem[];
  onChangeAsset?(draft: Extract<NativeUnsignedSendDraft, { kind: 'evm' }>, token?: Erc20Metadata): void;
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
  useNativeTranslation();
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
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const feeScope = JSON.stringify([account.address, account.network, account.revision, context.registrationHash]);
  const [feeSelection, setFeeSelection] = useState({ scope: feeScope, controller, choice: snapshotEvmFeeChoice(initialDraft?.feeChoice ?? AUTOMATIC_FEE) });
  const feeChoice = feeSelection.scope === feeScope && feeSelection.controller === controller ? feeSelection.choice : AUTOMATIC_FEE;
  const [feeDialog, setFeeDialog] = useState<{ scope: string; controller: NativeTransferView } | null>(null);
  const feeOpen = feeDialog?.scope === feeScope && feeDialog.controller === controller;
  const readTokenInventory = !!token || assetPickerOpen && !assetChoices;
  useLayoutEffect(
    () => readTokenInventory ? tokenView?.connect() : undefined,
    [readTokenInventory, tokenView]
  );
  const [maximum, setMaximum] = useState(initialDraft?.max ?? false);
  const [tokenDetails, setTokenDetails] = useState(false);
  const [receipt, setReceipt] = useState<Readonly<{ controller: NativeTransferView; hash: string; review: NativeTransferReview }> | null>(null);
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
  const [amount, setAmountState] = useState(initialDraft?.amount ?? initialAmount);
  const [tokenId, setTokenIdState] = useState(initialDraft?.tokenId ?? '');
  const [advanced, setAdvancedState] = useState(initialDraft?.advanced ?? !!initialDraft);
  const [nonce, setNonceState] = useState(initialDraft?.nonce ?? '');
  const [error, setError] = useState('');
  const [leavePrompt, setLeavePrompt] = useState<{ review: typeof snapshot.review; fallback: typeof snapshot | null } | null>(null);
  const leaving = useRef(false);
  const lifetime = useRef({ alive: true, epoch: 0 });
  type AuthenticationReview = { review: NonNullable<typeof snapshot.review>; epoch: number;
    account: NativePortfolioAccount; registrationHash: string; submitted: boolean };
  const authenticationOwner = useRef<AuthenticationReview | null>(null);
  const [authenticationBusy, setAuthenticationBusy] = useState(false);
  const latestRecipientOwner = useRef({ controller, account, context, recipientResolver, recipient, amount, tokenId, nonce, advanced, token, collectible });
  const [scanner, setScanner] = useState<{ scope: typeof latestRecipientOwner.current; epoch: number; account: NativePortfolioAccount; registrationHash: string } | null>(null);
  const scannerOwner = useRef<typeof scanner>(null);
  const [resolving, setResolving] = useState(false);
  const [resolvedRecipient, setResolvedRecipient] = useState<NativeRecipientResolution | null>(null);
  const resolution = useRef<{
    abort: AbortController;
    ticket?: NativeRecipientResolution;
    authorized: boolean;
    review?: NonNullable<typeof snapshot.review>;
  } | null>(null);
  useLayoutEffect(() => {
    latestRecipientOwner.current = { controller, account, context, recipientResolver, recipient, amount, tokenId, nonce, advanced, token, collectible };
  }, [controller, account, context, recipientResolver, recipient, amount, tokenId, nonce, advanced, token, collectible]);
  const closeScanner = () => { scannerOwner.current = null; setScanner(null); };
  const setAmount = (value: string) => { closeScanner(); setAmountState(value); };
  const setTokenId = (value: string) => { closeScanner(); setTokenIdState(value); };
  const setAdvanced = (value: boolean) => { closeScanner(); setAdvancedState(value); };
  const setNonce = (value: string) => { closeScanner(); setNonceState(value); };
  const retireResolution = useCallback((cancelReview = true) => {
    const held = resolution.current;
    resolution.current = null;
    held?.abort.abort();
    held?.ticket?.dispose();
    if (cancelReview && held && !held.authorized) controller.cancel();
    setResolving(false);
    setResolvedRecipient(null);
  }, [controller]);
  const setRecipient = (value: string) => {
    closeScanner();
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
  const busy = authenticationBusy || resolving || closingHardware || ['preparing', 'signing', 'submitting'].includes(snapshot.phase);
  const promptMatches = (current: typeof snapshot) => !!leavePrompt &&
    current.phase === 'submitting' && current.review === leavePrompt.review &&
    (leavePrompt.review !== null || current === leavePrompt.fallback);
  const review = snapshot.review;
  useLayoutEffect(() => {
    // A quote owns its lookup only until that exact review is retired. Release
    // the ticket without cancelling any successor work in the controller.
    const held = resolution.current;
    if (held?.review && held.review !== review) retireResolution(false);
  }, [review, resolving, retireResolution]);
  const replacementHash = replacement?.hash;
  const replacementMode = replacement?.mode;
  const cancellation = replacementMode === 'cancel' || replacementMode === 'cancel-saved';
  const prepareReplacement = replacementMode === 'cancel-saved' ? controller.prepareSavedCancellation
    : cancellation ? controller.prepareCancellation : controller.prepareSpeedUp;
  const reviewCancellation = review?.replacement?.mode === 'cancel';
  const capturedContext = review?.context ?? snapshot.context ?? context;
  const networkLabel = `${capturedContext.name}${capturedContext.testnet ? ` · ${t('mobile.common.testNetwork')}` : ''}`;
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
      <View style={s.networkCard}>
        <Coin id="custom-token" asset={{ kind: 'evm', chainId: capturedContext.chainId, contractAddress: asset.contractAddress, decimals: asset.decimals }} registrationHash={capturedContext.registrationHash} fallbackSymbol={asset.symbol} size={32} />
        <View style={s.networkDescription}><Text numberOfLines={1}>{asset.name}</Text><Text style={s.hint}>{asset.symbol} · {capturedContext.name}</Text></View>
        <Button title={t('send.details')} variant="quiet" size="compact" expanded={tokenDetails} onPress={() => setTokenDetails(value => !value)} />
      </View>
      <Text style={s.hint}>{t('mobile.smartSendViews.customTokenUnverifiedIssuerMetadata')}</Text>
      {tokenDetails && <><Text style={s.label}>{t('mobile.smartSendViews.tokenContract')}</Text>
        <Text selectable style={s.address} testID="native-send-token-contract">{asset.contractAddress}</Text>
        <Text style={s.label}>{t('settings.decimals')}</Text><Text testID="native-send-token-decimals">{asset.decimals}</Text></>}
    </Card>
  );
  const collectibleIdentity = (asset: {
    contractAddress: string;
    tokenStandard: SavedCollectible['tokenStandard'];
    tokenId?: string;
    amountUnits?: string;
  }) => (
    <Card style={s.summary}>
      <Coin id="collectible" asset={{ kind: 'evm', chainId: capturedContext.chainId, contractAddress: asset.contractAddress }} registrationHash={capturedContext.registrationHash} fallbackSymbol="NFT" size={36} />
      <Text style={s.label}>{t('mobile.smartSendViews.collectibleContract')}{' '}{asset.tokenStandard}</Text>
      <Text selectable style={s.address} testID="native-send-collectible-contract">
        {asset.contractAddress}
      </Text>
      {asset.tokenId !== undefined && (
        <>
          <Text style={s.label}>{t('send.tokenId')}</Text>
          <Text selectable style={s.address} testID="native-send-collectible-id">
            {asset.tokenId}
          </Text>
        </>
      )}
      {asset.amountUnits !== undefined && (
        <>
          <Text style={s.label}>{t('mobile.activityViews.nativeActivity.quantity')}</Text>
          <Text
            selectable
            style={s.address}
            accessibilityLabel={t('mobile.sendAssetViews.evm.collectiblesAmount', { count: asset.amountUnits === '1' ? 1 : 2, amount: asset.amountUnits })}
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
    scannerOwner.current = null;
    setScanner(null);
    authenticationOwner.current = null;
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
        setError(t('mobile.sendAssetViews.evm.theHardwareRequestIsStillClosingTryAgain'));
      }
    });
  }, [beforeClose, controller, retirePicker, retireResolution, setError, setScanner]);
  const close = useCallback(() => {
    if (!lifetime.current.alive || leaving.current) return;
    const current = controller.getSnapshot();
    if (current.phase === 'submitting') {
      Keyboard.dismiss();
      setLeavePrompt({ review: current.review, fallback: current.review === null ? current : null });
      return;
    }
    if (current.phase === 'review' && current.review && !current.review.retry && !current.review.replacement) {
      authenticationOwner.current = null;
      setAuthenticationBusy(false);
      setError('');
      controller.cancel();
      return;
    }
    finishClose();
  }, [controller, finishClose, setLeavePrompt, setError]);
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
      scannerOwner.current = null;
      authenticationOwner.current = null;
      current.alive = false;
      current.epoch++;
      controller.cancel();
      back.remove();
    };
  }, [controller, close]);
  const run = async (operation: () => Promise<void>, isCurrent = () => true) => {
    if (busy) return;
    const captured = lifetime.current.epoch;
    setError('');
    try {
      await operation();
    } catch (cause) {
      if (lifetime.current.alive && captured === lifetime.current.epoch && isCurrent()) {
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
            ? t('mobile.sendAssetViews.evm.thisCancellationMustWaitForEarlierTransactionsCheckActivityBefore')
            : cause instanceof Error && cause.message === 'INSUFFICIENT_BALANCE'
            ? t('mobile.sendAssetViews.evm.theAccountCannotCoverTheReplacementAmountAndMaximumFee')
            : replacementMode === 'cancel-saved'
              ? t('mobile.sendAssetViews.evm.paliCouldNotVerifyThatThisSavedTransactionCanStill')
              : t('mobile.sendAssetViews.evm.paliCouldNotVerifyThatThisTransactionIsStillPending'));
      });
      return;
    }
    if (savedHash) void controller.recover(true, savedHash).catch(() => undefined);
  }, [controller, savedHash, replacementHash, replacementMode, prepareReplacement]);
  const submit = () => {
    if (!review || controller.getSnapshot().review !== review || busy || authenticationOwner.current?.submitted ||
        !review.retry && ledgerConnection && !ledgerConnection.isConnected()) return;
    const held = resolution.current;
    if (held?.ticket && !review.retry) {
      try {
        held.ticket.assertCurrent();
        if (recipient.trim() !== held.ticket.input ||
            (reviewedCollectible?.recipient ?? review.recipient).toLowerCase() !== held.ticket.address.toLowerCase()) throw new Error('RECIPIENT_EXPIRED');
      } catch {
        retireResolution();
        setError(t('mobile.smartSendViews.theRecipientLookupExpiredOrChangedReviewTheTransferAgain'));
        return;
      }
    }
    Keyboard.dismiss();
    const next = { review, epoch: lifetime.current.epoch, account,
      registrationHash: context.registrationHash, submitted: false };
    authenticationOwner.current = next;
    setError('');
    void confirmAuthentication(next, { method: 'device' });
  };
  const authenticationCurrent = (held: AuthenticationReview) => {
    const latest = latestRecipientOwner.current;
    return lifetime.current.alive && authenticationOwner.current === held && lifetime.current.epoch === held.epoch &&
      latest.controller === controller && latest.account.address === held.account.address &&
      latest.account.network === held.account.network && latest.account.revision === held.account.revision &&
      latest.context.registrationHash === held.registrationHash && controller.getSnapshot().phase === 'review' &&
      controller.getSnapshot().review === held.review;
  };
  const confirmAuthentication = async (held: AuthenticationReview, credential: NativeOperationCredential) => {
    if (!authenticationCurrent(held) || held.submitted || busy) return;
    const resolved = resolution.current;
    if (resolved?.ticket && !held.review.retry) {
      try { resolved.ticket.assertCurrent(); resolved.authorized = true; }
      catch { retireResolution(); authenticationOwner.current = null;
        setError(t('mobile.smartSendViews.theRecipientLookupExpiredOrChangedReviewTheTransferAgain')); return; }
    }
    held.submitted = true;
    setAuthenticationBusy(true);
    await run(() => controller.confirm(held.review.id, credential), () => authenticationOwner.current === held);
    if (!lifetime.current.alive || authenticationOwner.current !== held || lifetime.current.epoch !== held.epoch) return;
    const result = controller.getSnapshot();
    if (result.hash && result.context?.registrationHash === held.review.context.registrationHash)
      setReceipt({ controller, hash: result.hash, review: held.review });
    held.submitted = false;
    setAuthenticationBusy(false);
    if (!authenticationCurrent(held)) { authenticationOwner.current = null; }
  };
  const prepare = () => {
    retirePicker();
    const chosenOwner = recipientDraft.owner;
    if (chosenOwner && (chosenOwner !== recipientPicker || !chosenOwner.current())) {
      setRecipient('');
      setError(t('mobile.sendAssetViews.evm.chooseAnAccountAgainOrEnterARecipientAddress'));
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
      const held: NonNullable<(typeof resolution)['current']> = { abort: new AbortController(), authorized: false };
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
              setError(t('mobile.smartSendViews.theRecipientLookupExpiredOrChangedReviewTheTransferAgain'));
            }
          }, { once: true });
          setResolvedRecipient(ticket);
          await operation(ticket.address);
          check();
          ticket.assertCurrent();
          const review = controller.getSnapshot().review;
          if (!review || (review.collectible?.recipient ?? review.recipient).toLowerCase() !== ticket.address.toLowerCase()) throw new Error('RECIPIENT_EXPIRED');
          held.review = review;
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
        ? controller.prepareToken(token.contractAddress, address, amount, nonceOverride, feeChoice)
        : maximum ? controller.prepareMaximum(address, nonceOverride, feeChoice)
        : controller.prepare(address, amount, nonceOverride, feeChoice));
      return;
    }
    let id: string;
    try {
      id = draftCollectible.tokenStandard === 'ERC-1155'
        ? draftCollectible.tokenId
        : normalizeNftTokenId(tokenId.trim());
    } catch {
      setError(t('mobile.smartSendViews.enterAValidTokenId'));
      return;
    }
    let quantity: string;
    try {
      quantity = draftCollectible.tokenStandard === 'ERC-1155'
        ? parseErc20Units(amount.trim())
        : '1';
      if (quantity === '0') throw new Error('Quantity must be positive');
    } catch {
      setError(t('mobile.smartSendViews.enterAWholeQuantityGreaterThanZero'));
      return;
    }
    Keyboard.dismiss();
    prepareRecipient((address) => controller.prepareCollectible(draftCollectible, address, id, quantity, nonceOverride, feeChoice));
  };
  const clearCollectibleError = () => {
    if (draftCollectible && error) setError('');
  };
  const knownOutcome = ['pending', 'confirmed', 'reverted'].includes(snapshot.phase);
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
  const availableBalanceAmount = token ? nativeTokenAvailableAmount(token, account, tokenSnapshot) : availableAmount;
  const availableBalanceSymbol = token?.symbol ?? capturedContext.symbol;
  const availableBalanceLabel = typeof availableBalanceAmount === 'string'
    ? t('mobile.sendAssetViews.utxo.availableAmount', { amount: availableBalanceAmount, symbol: availableBalanceSymbol })
    : `${t(token && tokenSnapshot?.status === 'loading' ? 'mobile.activityViews.nativeSptAssets.loadingBalance' : 'mobile.accountPortfolio.balanceUnavailable')} · ${availableBalanceSymbol}`;
  const footer = review ? <>
              <Button
                title={reviewCancellation ? t('mobile.sendAssetViews.evm.submitCancellation') : review.replacement ? t('mobile.sendAssetViews.evm.submitSpeedUp') : review.retry ? t('mobile.sendAssetViews.evm.resendSignedTransaction') : t('mobile.sendAssetViews.evm.confirmAndSend')}
                disabled={busy || !review.retry && !ledgerReady}
                onPress={() => submit()}
                testID="native-send-confirm"
              />
  </> : hasOutcome && knownOutcome ? <>
    {onViewTransaction && <Button title={t('mobile.sendAssetViews.evm.viewTransaction')} onPress={() => {
      if (lifetime.current.alive && snapshot.hash && controller.getSnapshot().hash === snapshot.hash) onViewTransaction(snapshot.hash);
    }} />}
    <Button title={t('privacy.deposit.done')} variant={onViewTransaction ? 'secondary' : 'primary'} onPress={close} />
  </> : hasOutcome ? <Button title={replacementHash ? t('mobile.sendAssetViews.evm.backToActivity') : t('mobile.sendAssetViews.evm.backToWallet')} variant="secondary" onPress={close} /> : !replacementHash ? (
    <Button title={t('mobile.smartSendViews.reviewTransfer')} disabled={busy || !recipient.trim() ||
      (draftCollectible?.tokenStandard === 'ERC-721' ? !tokenId.trim() : !amount && !maximum)}
      onPress={prepare} testID="native-send-review" />
  ) : undefined;
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen footer={footer} scrollResetKey={review ? `review:${review.id}` : hasOutcome ? `outcome:${snapshot.hash}` : 'draft'} gap={16}>
          <Header
            title={
              cancellation
                ? hasOutcome ? t('mobile.sendAssetViews.evm.cancellationStatus') : t('transactions.replay.reviewCancellation')
                : replacementHash
                ? hasOutcome ? t('mobile.sendAssetViews.evm.speedUpStatus') : t('mobile.sendAssetViews.evm.reviewSpeedUp')
                : review
                ? (review.retry ? t('transactions.replay.review') : reviewedCollectible ? t('mobile.sendAssetViews.evm.reviewCollectible') : t('mobile.smartSendViews.reviewTransfer'))
                : hasOutcome
                ? t('mobile.sendAssetViews.evm.transferStatus')
                : draftCollectible
                ? t('mobile.smartSendViews.sendCollectible')
                : token
                ? t('mobile.smartSendViews.sendSymbol', { symbol: token.symbol })
                : t('mobile.smartSendViews.sendSymbol', { symbol: capturedContext.symbol })
            }
            subtitle={`${accountLabel} · ${networkLabel}`}
            onBack={close}
          />
          {busy && (
            <View style={s.progress}>
              <ActivityIndicator color={colors.pink} />
              <Text style={styles.muted}>
                {resolving ? t('mobile.sendAssetViews.evm.resolvingENSRecipient') : snapshot.phase === 'signing'
                  ? t('mobile.sendAssetViews.evm.authenticatingAndSigning')
                  : snapshot.phase === 'submitting'
                  ? t('mobile.sendAssetViews.evm.submittingTheTransaction')
                  : t('mobile.sendAssetViews.evm.checkingTheNetwork')}
              </Text>
            </View>
          )}
          {!!error && !(hasOutcome && savedTransferMessages.includes(error) && error === snapshot.message) && (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={s.error}
            >
              {displayTransferMessage(error)}
            </Text>
          )}
          {!error && snapshot.message && !hasOutcome && !review && (
            <Text accessibilityRole="alert" style={s.error}>
              {displayTransferMessage(snapshot.message)}
            </Text>
          )}
          {capturedContext.testnet && (
            <Notice
              title={t('mobile.common.testNetwork')}
              body={t('mobile.sendAssetViews.evm.testFundsNotice', { network: capturedContext.name, chainId: capturedContext.chainId })}
              tone="amber"
            />
          )}
          {review ? (
            <>
              {reviewedCollectible ? collectibleIdentity(reviewedCollectible) : (
                <View style={s.hero}>
                  <Coin
                    id={reviewedToken ? 'custom-token' : capturedContext.networkId}
                    asset={reviewedToken ? { kind: 'evm', chainId: capturedContext.chainId, contractAddress: reviewedToken.contractAddress, decimals: reviewedToken.decimals } : undefined}
                    registrationHash={capturedContext.registrationHash}
                    fallbackSymbol={reviewedToken?.symbol ?? capturedContext.symbol}
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
                <Text style={s.label}>{t('mobile.sendAssetViews.evm.pREVIOUSTRANSACTIONNONCE')}{' '}{review.replay.missingNonce}</Text>
                <Text style={s.hint}>{t('mobile.sendAssetViews.evm.thisTransactionIsWaitingForAnEarlierNonce')}</Text>
                {!review.replay.predecessorCount && <Text style={s.hint}>{t('mobile.sendAssetViews.evm.noEarlierTransactionIsAvailableToRetryOnThisDevice')}</Text>}
                {review.replay.predecessors.map(candidate => <Button key={candidate.hash} variant="secondary"
                  title={`${candidate.operation === 'cancel' ? t('transactions.cancellation') : candidate.operation === 'speed-up' ? t('mobile.sendAssetViews.evm.replacement') : t('notifications.transaction')} ${candidate.hash.slice(0, 10)}…`}
                  onPress={() => void run(() => controller.recover(true, candidate.hash))} />)}
                {review.replay.predecessors.length < review.replay.predecessorCount && <Button title={t('mobile.sendAssetViews.evm.loadMoreSavedTransactions')} variant="secondary" size="compact" disabled={busy}
                  onPress={() => void run(() => controller.loadMorePredecessors())} />}
              </Card>}
              <Card style={s.summary}>
                {resolvedRecipient && !review.retry && !review.replacement && <>
                  <Text style={s.label}>{t('mobile.sendAssetViews.evm.eNSNAME')}</Text>
                  <Text selectable style={s.address}>{resolvedRecipient.input}</Text>
                  <Text style={s.label}>{t('mobile.sendAssetViews.evm.rESOLVEDADDRESS')}</Text>
                </>}
                <Text style={s.label}>{reviewCancellation ? t('mobile.sendAssetViews.evm.tOYOURADDRESS') : reviewedCollectible ? t('assetTransfer.recipient') : t('send.to')}</Text>
                <Text
                  selectable
                  style={s.address}
                  testID="native-send-recipient"
                >
                  {reviewedCollectible?.recipient ?? review.recipient}
                </Text>
                {review.nonceOverride !== undefined && <>
                  <View style={s.separator} />
                  <Text style={s.label}>{t('mobile.sendAssetViews.evm.mANUALNONCE')}</Text>
                  <Text testID="native-send-reviewed-nonce">{review.nonce}</Text>
                  <Text style={s.hint}>{t('mobile.sendAssetViews.evm.thisCanReplaceAPendingTransactionWithTheSameNonce')}</Text>
                </>}
                <View style={s.separator} />
                <Text style={s.label}>{t('mobile.sendAssetViews.evm.eXECUTIONFEELIMIT')}</Text>
                <Text testID="native-send-fee">
                  {formatBaseUnits(review.maximumFeeUnits, 18)}{' '}
                  {capturedContext.symbol}
                </Text>
                {!reviewedToken && !reviewedCollectible && !reviewCancellation && (
                  <>
                    <View style={s.separator} />
                    <Text style={s.label}>{t('mobile.sendAssetViews.evm.aMOUNTEXECUTIONFEELIMIT')}</Text>
                    <Text>
                      {formatBaseUnits(review.totalUnits, 18)}{' '}
                      {capturedContext.symbol}
                    </Text>
                  </>
                )}
                <Text style={s.hint}>
                  {t('mobile.sendAssetViews.evm.theFinalFeeDependsOnNetworkExecutionThisReviewLimits')}</Text>
              </Card>
              {reviewedToken && tokenIdentity(reviewedToken)}
              {reviewedToken && (
                <Notice
                  title={t('assetTransfer.token-transfer')}
                  body={t('mobile.sendAssetViews.evm.tokenFeeNotice', { symbol: capturedContext.symbol })}
                  tone="amber"
                />
              )}
              {review.replacement && <Card style={s.summary}>
                <Text style={s.label}>{t('mobile.sendAssetViews.evm.oRIGINALTRANSACTIONNONCE')}{' '}{review.nonce}</Text>
                <Text selectable style={s.address}>{review.replacement.originalHash}</Text>
                {review.execution && <>
                  <Text>{review.execution.kind === 'contract-creation' ? t('mobile.dappConsent.transactionReview.contractDeployment') : review.execution.kind === 'contract-call' ? t('mobile.dappConsent.transactionReview.contractInteraction') : t('transactions.methodNames.transfer')}</Text>
                  {review.execution.dataBytes > 0 && <Text style={s.hint}>{review.execution.dataBytes} {t('mobile.sendAssetViews.evm.bytesOfUnchangedContractData')}</Text>}
                  {review.execution.accessListEntries > 0 && <Text style={s.hint}>{review.execution.accessListEntries} {t('mobile.sendAssetViews.evm.unchangedAccesslistEntries')}</Text>}
                  {review.execution.smartAccount && <>
                    <Text style={s.label}>{t('receive.smartAccount')}</Text><Text selectable style={s.address}>{review.execution.smartAccount}</Text>
                    <Text style={s.label}>{t('mobile.sendAssetViews.evm.oRIGINALFEEPAYER')}</Text><Text selectable style={s.address}>{review.from}</Text>
                  </>}
                </>}
                {!reviewCancellation && <Text style={s.hint}>
                  {t('mobile.sendAssetViews.evm.originalExecutionFeeLimit')}{' '}{formatBaseUnits(review.replacement.originalMaximumFeeUnits, 18)} {capturedContext.symbol}
                </Text>}
                <Text style={s.hint}>{reviewCancellation
                  ? t('mobile.sendAssetViews.evm.thisSendsZeroToYourOwnAddressWithAHigher')
                  : t('mobile.sendAssetViews.evm.onlyTheNetworkFeeChangesTheOriginalRecipientValueAnd')}</Text>
              </Card>}
              {review.replay && <Card style={s.summary}>
                <Text style={s.label}>{t('mobile.sendAssetViews.evm.sAVEDTRANSACTIONNONCE')}{' '}{review.nonce}</Text>
                <Text selectable style={s.address}>{review.replay.hash}</Text>
                <Text style={s.hint}>{t('mobile.sendAssetViews.evm.connection')}{' '}{new URL(capturedContext.rpcUrl).host}</Text>
                <Text>{review.replay.operation === 'cancel' ? t('transactions.cancellation') : review.replay.operation === 'speed-up' ? t('mobile.sendAssetViews.evm.feeReplacement') : review.replay.to === null ? t('transactions.replay.creation') : review.replay.dataBytes ? t('mobile.dappConsent.transactionReview.contractInteraction') : t('transactions.methodNames.transfer')}</Text>
                {review.replay.dataBytes > 0 && <Text style={s.hint}>{review.replay.selector ?? t('mobile.sendAssetViews.evm.contractData')} · {review.replay.dataBytes} {t('transactions.replay.bytes')}</Text>}
                {!!review.replay.accessListEntries && <Text style={s.hint}>{review.replay.accessListEntries} {t('mobile.sendAssetViews.evm.accesslistEntries')}</Text>}
                {review.replay.tokenTransfer && !reviewedToken && <Text>{t('mobile.sendAssetViews.evm.tokenBaseUnits')}{' '}{review.replay.tokenTransfer.amountUnits}</Text>}
                <Text style={s.hint} testID="native-replay-same-nonce-warning">
                  {t('transactions.replay.sameNonceWarning')}</Text>
              </Card>}
              {!review.replacement && <Text style={s.hint}>
                {t('mobile.sendAssetViews.evm.confirmTheFullAddressAndNetworkBeforeSendingCompletedTransfers')}</Text>}
              {ledgerConnection && !review.retry && !ledgerReady && <Button
                title={t('mobile.accounts.connectLedger')} disabled={busy}
                onPress={() => { Keyboard.dismiss(); setLedgerPicker(ledgerConnection); }}
              />}

            </>
          ) : hasOutcome ? (
            <>
              <View style={s.hero}>
                {snapshot.phase === 'pending' || snapshot.phase === 'confirmed' ? <View style={s.submittedIcon}><Icon name="check" size={32} color={colors.blue} /></View> : <Coin
                  id={outcomeToken || outcomeCollectible ? 'custom-token' : capturedContext.networkId}
                  size={46}
                />}
                <Text style={s.title}>
                  {snapshot.phase === 'confirmed'
                    ? cancellation
                      ? t('mobile.sendAssetViews.evm.cancellationConfirmed')
                      : replacementHash ? t('mobile.sendAssetViews.evm.replacementConfirmed')
                      : outcomeToken || outcomeCollectible
                      ? t('mobile.connections.transactionConfirmed')
                      : t('mobile.sendAssetViews.evm.transferConfirmed')
                    : snapshot.phase === 'reverted'
                    ? cancellation ? t('mobile.sendAssetViews.evm.cancellationReverted') : replacementHash ? t('mobile.sendAssetViews.evm.replacementReverted') : t('mobile.sendAssetViews.evm.transferReverted')
                    : snapshot.phase === 'nonce-consumed'
                    ? t('mobile.sendAssetViews.evm.checkAccountHistory')
                    : snapshot.phase === 'unknown'
                    ? snapshot.message === SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE ? t('mobile.sendAssetViews.evm.checkEarlierTransaction') : snapshot.message === ASSET_STATE_SAVED_MESSAGE ? t('mobile.sendAssetViews.evm.savedNotSubmitted') : t('mobile.sendAssetViews.evm.checkingSubmission')
                    : snapshot.phase === 'unavailable'
                    ? t('mobile.sendAssetViews.evm.statusUnavailable')
                    : cancellation ? t('mobile.sendAssetViews.evm.cancellationSubmitted') : replacementHash ? t('mobile.sendAssetViews.evm.replacementSubmitted') : t('privacy.deposit.submitted')}
                </Text>
              </View>
              {receipt?.controller === controller && receipt.hash === snapshot.hash && <Card style={s.summary}>
                <Text style={s.label}>{t('send.amount')}</Text>
                <Text testID="native-send-receipt-amount">{receipt.review.collectible
                  ? t('mobile.sendAssetViews.evm.collectiblesAmount', { count: receipt.review.collectible.amountUnits === '1' ? 1 : 2, amount: receipt.review.collectible.amountUnits })
                  : `${receipt.review.intent ? formatTokenUnits(receipt.review.amountUnits, receipt.review.intent.token.decimals) : formatBaseUnits(receipt.review.amountUnits, 18)} ${receipt.review.intent?.token.symbol ?? capturedContext.symbol}`}</Text>
                <Text style={s.label}>{t('send.to')}</Text>
                <Text selectable style={s.address}>{receipt.review.collectible?.recipient ?? receipt.review.recipient}</Text>
                <Text style={s.hint}>{capturedContext.name}</Text>
              </Card>}
              {outcomeToken && tokenIdentity(outcomeToken)}
              {outcomeCollectible && collectibleIdentity(outcomeCollectible)}
              <View
                accessibilityRole={savedTransferMessages.includes(snapshot.message ?? '') ? 'alert' : undefined}
                accessibilityLiveRegion={savedTransferMessages.includes(snapshot.message ?? '') ? 'polite' : undefined}
              >
                <Notice
                  title={
                    snapshot.phase === 'unknown'
                      ? t('mobile.sendAssetViews.evm.keepThisTransaction')
                      : t('mobile.sendAssetViews.evm.transactionLabel', { network: capturedContext.name })
                  }
                  body={
                    displayTransferMessage(snapshot.message) ?? (snapshot.phase === 'pending'
                      ? t('mobile.sendAssetViews.evm.viewThisTransactionInActivityToTrackConfirmation')
                      : t('mobile.sendAssetViews.evm.checkTheTransactionStatusBeforeSendingAgain'))
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
                <Text style={s.label}>{t('transactions.replay.hash')}</Text>
                <Text selectable style={s.address} testID="native-send-hash">
                  {snapshot.hash}
                </Text>
              </Card>
              {!knownOutcome && <Button
                title={t('settings.smartAccountInfrastructureCheckStatus')}
                variant="primary"
                disabled={busy}
                onPress={() => void run(() => controller.recover(false, snapshot.hash ?? undefined))}
              />}
              {snapshot.phase === 'unknown' && !snapshot.inspectionOnly && (
                <Button
                  title={t('mobile.sendAssetViews.evm.reviewRetry')}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void run(() => controller.recover(true, snapshot.hash ?? undefined))}
                />
              )}
            </>
          ) : replacementHash ? (
            !busy && <Button title={t('mobile.sendAssetViews.evm.checkAgain')} variant="secondary" onPress={() => void run(() => prepareReplacement(replacementHash))} />
          ) : (
            <>
              {onChangeAsset && !draftCollectible ? <SendAssetSelector context={capturedContext} token={token} nativeAvailable={availableAmount}
                items={tokenSnapshot?.status === 'ready' && sameNativePortfolioAccount(tokenSnapshot.account, account) ? tokenSnapshot.items : assetChoices ?? []}
                loading={assetPickerOpen && !assetChoices && tokenSnapshot?.status === 'loading'}
                unavailable={!assetChoices && tokenSnapshot?.status === 'error'} open={assetPickerOpen} busy={busy}
                onOpen={() => { if (!busy && lifetime.current.alive) { closeScanner(); setAssetPickerOpen(true); } }}
                onClose={() => setAssetPickerOpen(false)} onSelect={next => {
                  if (busy || !lifetime.current.alive) return;
                  setAssetPickerOpen(false);
                  onChangeAsset(Object.freeze({ kind: 'evm', recipient, amount, nonce, tokenId, max: maximum, advanced }), next);
                }} /> : <SendNetworkCard context={capturedContext} disabled={busy} onChange={onChangeNetwork ? () => {
                  if (busy || !lifetime.current.alive) return;
                  closeScanner(); onChangeNetwork(Object.freeze({ kind: 'evm', recipient, amount, nonce, tokenId, max: maximum, advanced }));
                } : undefined} />}
              {draftNotice && <Text accessibilityLiveRegion="polite" style={styles.muted}>{draftNotice}</Text>}
              <NativeSendInput
                label={draftCollectible ? t('blacklist.recipientDescription') : t('mobile.sendAssetViews.evm.addressLabel', { network: capturedContext.name })}
                value={recipient}
                onChange={setRecipient}
                onEdit={clearCollectibleError}
                busy={busy}
                max={255}
                placeholder="0x… or name.eth"
                trailing={<IconButton label={t('mobile.smartSendViews.scanRecipientAddress')} icon="scan" disabled={busy} onPress={() => {
                  if (busy || !lifetime.current.alive || controller.getSnapshot().review) return;
                  retirePicker(); Keyboard.dismiss();
                  const next = { scope: latestRecipientOwner.current, epoch: lifetime.current.epoch, account, registrationHash: context.registrationHash };
                  scannerOwner.current = next; setScanner(next);
                }} />}
              />
              {recipientPicker && !savedHash && !replacementHash && !token && !draftCollectible && (
                <>
                  <Button
                    title={picker ? t('mobile.settings.hide') : t('mobile.sendAssetViews.evm.chooseAccount')}
                    variant="secondary"
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
                        label={t('mobile.sendAssetViews.evm.findAccount')}
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
                      )) : <Text style={styles.muted}>{t('mobile.sendAssetViews.evm.noMatchingAccounts')}</Text>}
                    </Card>
                  )}
                </>
              )}
              {draftCollectible ? (
                <>
                  {collectibleIdentity(draftCollectible)}
                  {draftCollectible.tokenStandard === 'ERC-721'
                    ? <NativeSendInput label={t('send.tokenId')} value={tokenId} onChange={setTokenId}
                        onEdit={clearCollectibleError} busy={busy} keyboardType="number-pad" max={257} />
                    : <NativeSendInput label={t('mobile.activityViews.nativeActivity.quantity')} value={amount} onChange={setAmount}
                        onEdit={clearCollectibleError} busy={busy} keyboardType="number-pad" max={79} />}
                </>
              ) : (
                <>
                  {token && tokenIdentity(token)}
                  <NativeSendInput label={t('mobile.smartSendViews.amountInSymbol', { symbol: token?.symbol ?? capturedContext.symbol })} value={amount}
                    onChange={(value) => { setMaximum(false); setAmount(value); }} busy={busy} keyboardType="decimal-pad" max={token ? 334 : 100}
                    trailing={token ? <NativeTokenMaximum
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
                    /> : <Button title={maximum ? t('mobile.portfolioCopy.maxSelected') : 'MAX'} variant="secondary" size="compact"
                      disabled={busy || !availableAmount || !/[1-9]/.test(availableAmount)} onPress={() => {
                        if (!lifetime.current.alive || busy || !availableAmount || latestRecipientOwner.current.account !== account ||
                          latestRecipientOwner.current.context.registrationHash !== context.registrationHash) return;
                        setMaximum(true);
                        setAmount(availableAmount);
                      }} />} />
                  <Text style={styles.muted} accessibilityLabel={availableBalanceLabel}>
                    {t('mobile.smartSendViews.available')}{' '}{token ? nativeTokenAvailableAmount(token, account, tokenSnapshot) ?? '—' : availableAmount ?? '—'} {token?.symbol ?? capturedContext.symbol}
                  </Text>
                </>
              )}
              <Button title={`${t('send.networkFee')} · ${t(feeChoice.kind === 'custom' ? 'mobile.feeChoice.custom' : feeChoice.kind === 'automatic' ? 'mobile.sendAssetViews.evm.automatic' : `send.${feeChoice.kind}`)}`}
                variant="secondary" icon="settings" size="compact" disabled={busy} onPress={() => { closeScanner(); setFeeDialog({ scope: feeScope, controller }); }} />
              <Button title={advanced ? t('mobile.sendAssetViews.evm.hideAdvancedOptions') : t('mobile.sendAssetViews.evm.advancedOptions')} variant="secondary" icon={advanced ? 'chevron-up' : 'chevron-down'} size="compact"
                disabled={busy} expanded={advanced} onPress={() => {
                  if (advanced) {
                    setNonce('');
                    setError('');
                  }
                  setAdvanced(!advanced);
                }} />
              {advanced && <>
                <NativeSendInput label={t('mobile.sendAssetViews.evm.transactionNonce')} value={nonce} onChange={setNonce}
                  busy={busy} keyboardType="number-pad" max={64} placeholder={t('mobile.sendAssetViews.evm.automatic')}
                  onEdit={() => { if (error) setError(''); }} />
                <Text style={s.hint}>{t('mobile.sendAssetViews.evm.leaveBlankForAutomaticSelectionAHigherNonceCanWait')}</Text>
              </>}
            </>
          )}
          {typeof __DEV__ !== 'undefined' && __DEV__ && <Text style={s.buildLabel}>
            {t('mobile.common.development')}</Text>}
        </Screen>
      </KeyboardAvoidingView>
      {feeOpen && <NetworkFeeSheet key={`${account.address}:${account.network}:${account.revision}:${context.registrationHash}`}
        mode="evm" choice={feeChoice} load={signal => controller.feeRecommendations(signal)}
        onClose={() => { if (lifetime.current.alive) setFeeDialog(null); }}
        onApply={choice => {
          if (!lifetime.current.alive || latestRecipientOwner.current.controller !== controller || latestRecipientOwner.current.account !== account ||
              latestRecipientOwner.current.context.registrationHash !== context.registrationHash) return;
          retireResolution(); controller.cancel(); setFeeSelection({ scope: feeScope, controller, choice }); setFeeDialog(null); setError('');
        }} />}
      {ledgerPicker && ledgerPicker === ledgerConnection && <NativeLedgerConnectionModal
        controller={ledgerPicker}
        onClose={() => setLedgerPicker(null)}
        onFinished={() => setLedgerPicker(null)}
      />}
      {scanner && scanner.account.address === account.address && scanner.account.network === account.network &&
        scanner.account.revision === account.revision && scanner.registrationHash === context.registrationHash && <Modal visible animationType="slide" onRequestClose={closeScanner}>
        <RecipientQrScanner onClose={closeScanner} onScan={address => {
          const current = latestRecipientOwner.current, captured = scanner.scope;
          if (!lifetime.current.alive || scannerOwner.current !== scanner || lifetime.current.epoch !== scanner.epoch ||
              current.controller !== captured.controller || !sameNativePortfolioAccount(current.account, captured.account) ||
              current.context.registrationHash !== captured.context.registrationHash || current.recipientResolver !== captured.recipientResolver ||
              current.recipient !== captured.recipient || current.amount !== captured.amount || current.tokenId !== captured.tokenId ||
              current.nonce !== captured.nonce || current.advanced !== captured.advanced || current.token !== captured.token || current.collectible !== captured.collectible ||
              controller.getSnapshot().review ||
              ['preparing', 'signing', 'submitting'].includes(controller.getSnapshot().phase)) return;
          closeScanner(); setRecipient(address);
        }} />
      </Modal>}
      <Modal
        visible={promptMatches(snapshot)}
        transparent
        animationType="fade"
        onRequestClose={() => setLeavePrompt(null)}
      >
        <SafeAreaView style={s.leaveOverlay} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={s.leaveContent}>
            <Card style={s.leaveCard}>
              <Text accessibilityRole="header" style={s.leaveTitle}>{t('mobile.sendAssetViews.evm.submissionInProgress')}</Text>
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                {t('mobile.sendAssetViews.evm.thisTransactionMayAlreadyHaveBeenSentCheckActivityBefore')}</Text>
              <Button title={t('mobile.sendAssetViews.evm.stay')} onPress={() => setLeavePrompt(null)} />
              <Button title={t('mobile.sendAssetViews.evm.leave')} variant="secondary" onPress={leaveDuringSubmission} />
            </Card>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  submittedIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  networkCard: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  networkDescription: { flex: 1, minWidth: 0, gap: 2 }, networkName: { fontSize: 14, fontWeight: '600', color: colors.text },
  inputWithAction: { flexDirection: 'row', alignItems: 'center', paddingRight: 4, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12 },
  inputWithActionField: { flex: 1, minWidth: 0, borderWidth: 0, backgroundColor: 'transparent' },
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
  summary: { padding: 16, gap: 8 },
  address: { fontSize: 14, lineHeight: 24 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 4 },
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
  progress: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  error: { color: colors.red, fontSize: 13, lineHeight: 21 },
  buildLabel: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
  },
});
