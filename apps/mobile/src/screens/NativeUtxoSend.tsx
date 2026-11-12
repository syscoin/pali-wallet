import { AUTOMATIC_FEE, type UtxoFeeChoice } from '../../../../source/shared/transactionFeeChoice';
import { NetworkFeeSheet } from './NetworkFeeSheet';
import { nativeI18n, useNativeTranslation } from '../platform/localization';
import { normalizeDecimalInput } from '../../../../source/shared/decimalInput';
import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isAssetAmountEqualToBalance, toEightDecimalBuilderAmount } from '../../../../source/utils/syscoinAssetAmount';
import { snapshotUtxoRbf } from '../../../../source/shared/utxoTransactionOptions';

import { formatBaseUnits } from '../core/amounts';
import {
  Button,
  Card,
  Coin,
  colors,
  Header,
  IconButton,
  Notice,
  Screen,
  styles,
  Text,
} from '../ui';
import { NativeLedgerConnectionModal } from './NativeLedger';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { IdleTextInput } from './IdleActivityBoundary';
import { UtxoRecipientQrScanner } from './UtxoRecipientQrScanner';
import type { NativeOperationCredential } from '../custody/types';
import type { NativeUnsignedSendDraft } from './sendNetworkDraft';

import type { UtxoNetwork } from '../core/utxoNetworks';
import type {
  NativeUtxoAsset,
  NativeUtxoReview,
  NativeUtxoSend,
} from '../custody/utxoSend';
const t = nativeI18n.t.bind(nativeI18n);

type ReviewedTransferSummary = Readonly<{
  recipient: NativeUtxoReview['outputs'][number];
  recipientLabel: string;
  assetDisplay?: NativeUtxoAsset;
  feeSatoshis: string;
}>;

type Outcome = Readonly<{
  txid: string;
  phase: 'submitted' | 'seen' | 'confirmed' | 'unknown';
  summary?: ReviewedTransferSummary;
}>;

function summarizeReview(review: NativeUtxoReview): ReviewedTransferSummary {
  const recipient = review.outputs[0]!;
  return Object.freeze({
    recipientLabel: review.retryTxid ? t('mobile.sendAssetViews.utxo.output1') : t('assetTransfer.recipient'),
    recipient: Object.freeze({
      address: recipient.address,
      amountSatoshis: recipient.amountSatoshis,
      ...(recipient.asset ? { asset: Object.freeze({ ...recipient.asset }) } : {}),
    }),
    ...(review.assetDisplay ? { assetDisplay: Object.freeze({ ...review.assetDisplay }) } : {}),
    feeSatoshis: review.feeSatoshis,
  });
}

function describe(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_CREDENTIAL') return t('mobile.accounts.invalidCredential');
  if (code === 'DEVICE_UNLOCK_UNAVAILABLE') return t('mobile.accounts.invalidCredential');
  if (code === 'AUTH_THROTTLED') return t('mobile.sendAssetViews.utxo.tooManyUnsuccessfulAuthorizationAttemptsWaitAFewMinutesThen');
  if (code === 'INVALID_INPUT')
    return t('mobile.sendAssetViews.utxo.enterAValidAddressAndAmountForThisNetwork');
  if (code === 'CANCELLED' || code === 'NOT_READY')
    return t('mobile.sendAssetViews.utxo.thisReviewIsNoLongerAvailableOpenANewReview');
  if (code === 'UTXO_OPTIONS_CHANGED') return t('mobile.sendAssetViews.utxo.transactionOptionsChangedReviewANewQuote');
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'UTXO_SIGNED_OUTPOINT_PENDING')
      return t('mobile.sendAssetViews.utxo.aSavedTransferUsesTheseFundsCheckItsStatusBefore');
    if (error.code === 'UTXO_POSSIBLE_SENTRY_COLLATERAL')
      return t('mobile.sendAssetViews.utxo.thisTransferWouldSpendAPossibleSentryCollateralOutput');
  }
  return t('mobile.sendAssetViews.utxo.paliCouldNotCompleteThisRequestTryAgainOrCheck');
}

export function NativeUtxoSendScreen({
  accountLabel,
  asset,
  network,
  open,
  onBack,
  ledgerConnection,
  initialDraft,
  beforeClose,
  maximumAmount,
  availableAmount,
  onChangeNetwork,
  draftNotice,
  onViewTransaction,
}: {
  accountLabel: string;
  ledgerConnection?: NativeLedgerConnectionView;
  initialDraft?: Readonly<{ recipient: string; amount: string; max?: boolean; rbf?: boolean }>;
  maximumAmount?: string;
  availableAmount?: string;
  onChangeNetwork?(draft: Extract<NativeUnsignedSendDraft, { kind: 'utxo' }>): void;
  draftNotice?: string;
  onViewTransaction?(txid: string): void;
  beforeClose?(): Promise<void>;
  asset?: NativeUtxoAsset;
  network: UtxoNetwork;
  open(assertCurrent: () => void): Promise<NativeUtxoSend>;
  onBack(): void;
}) {
  useNativeTranslation();
  const [ledgerPicker, setLedgerPicker] = useState<NativeLedgerConnectionView | null>(null);
  const ledgerReady = useSyncExternalStore(
    (listener) => ledgerConnection?.subscribe(listener) ?? (() => undefined),
    () => ledgerConnection?.isConnected() ?? true,
    () => false,
  );
  const [send, setSend] = useState<NativeUtxoSend | null>(null);
  const [address, setAddress] = useState(initialDraft?.recipient ?? '');
  const [amount, setAmount] = useState(initialDraft?.amount ?? '');
  const [maximumSelected, setMax] = useState((initialDraft?.max ?? false) && (!asset ||
    maximumAmount !== undefined && isAssetAmountEqualToBalance(initialDraft?.amount ?? '', maximumAmount, asset.decimals)));
  const max = maximumSelected && (!asset || maximumAmount !== undefined &&
    isAssetAmountEqualToBalance(amount, maximumAmount, asset.decimals));
  const [rbf, setRbf] = useState(snapshotUtxoRbf(initialDraft?.rbf));
  const [advanced, setAdvanced] = useState(false);
  const [feeSelection, setFeeSelection] = useState({ open, network, choice: AUTOMATIC_FEE as UtxoFeeChoice });
  const feeChoice = feeSelection.open === open && feeSelection.network === network ? feeSelection.choice : AUTOMATIC_FEE;
  const [feeDialog, setFeeDialog] = useState<{ open: typeof open; network: UtxoNetwork } | null>(null);
  const feeOpen = feeDialog?.open === open && feeDialog.network === network;
  const [working, setBusy] = useState(true);
  const [closingHardware, setClosingHardware] = useState(false);
  const busy = working || closingHardware;
  const [review, setReview] = useState<NativeUtxoReview | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saved, setSaved] = useState<
    readonly Readonly<{ txid: string; accepted: boolean }>[]
  >([]);
  const [savedLimit, setSavedLimit] = useState(6);
  const [error, setError] = useState('');
  const currentReview = useRef<NativeUtxoReview | null>(null);
  useLayoutEffect(() => {
    currentReview.current = review;
    return () => { currentReview.current = null; };
  }, [review]);
  const currentOutcome = useRef(outcome);
  useLayoutEffect(() => { currentOutcome.current = outcome; }, [outcome]);
  const owner = useRef({ revision: 0 });
  const draftRevision = useRef(0);
  const inFlight = useRef(false);
  const closing = useRef(false);
  type ScanOwner = { network: UtxoNetwork; open: typeof open; revision: number; draft: number };
  const [scanner, setScanner] = useState<ScanOwner | null>(null);
  const scannerOwner = useRef<ScanOwner | null>(null);
  const currentNetwork = useRef({ network, open });
  const screenActive = useRef(false);
  useLayoutEffect(() => {
    screenActive.current = true;
    return () => { screenActive.current = false; scannerOwner.current = null; };
  }, [open]);
  useLayoutEffect(() => { currentNetwork.current = { network, open }; }, [network, open]);
  const closeScanner = () => { scannerOwner.current = null; setScanner(null); };
  useEffect(() => {
    const lifetime = owner.current;
    const revision = ++lifetime.revision;
    let local: NativeUtxoSend | undefined;
    const check = () => {
      if (lifetime.revision !== revision) throw new Error('CANCELLED');
    };
    void open(check)
      .then(async (opened) => {
        local = opened;
        if (lifetime.revision !== revision) {
          opened.cancel();
          return;
        }
        setSend(opened);
        const records = await opened.refreshSaved();
        check();
        setSaved([...records].reverse());
      })
      .catch((cause) => {
        if (lifetime.revision === revision) setError(describe(cause));
      })
      .finally(() => {
        if (lifetime.revision === revision) setBusy(false);
      });
    return () => {
      scannerOwner.current = null;
      lifetime.revision++;
      local?.cancel();
    };
  }, [open]);
  const leave = (done: () => void) => {
    if (closing.current) return;
    closeScanner(); Keyboard.dismiss();
    screenActive.current = false;
    send?.cancel();
    if (!beforeClose) { done(); return; }
    closing.current = true;
    setClosingHardware(true);
    const revision = owner.current.revision;
    void Promise.resolve().then(beforeClose).then(() => {
      if (owner.current.revision === revision) done();
    }, () => {
      if (owner.current.revision === revision) {
        screenActive.current = true;
        closing.current = false;
        setClosingHardware(false);
        setError(t('mobile.sendAssetViews.evm.theHardwareRequestIsStillClosingTryAgain'));
      }
    });
  };
  const close = () => {
    if (review && !busy) {
      closeScanner(); send?.cancel(); setReview(null); setError(''); return;
    }
    leave(onBack);
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        close();
        return true;
      }
    );
    return () => subscription.remove();
  });
  const run = (work: (current: () => boolean) => Promise<void>, summary?: ReviewedTransferSummary) => {
    if (inFlight.current || closing.current) return;
    const revision = owner.current.revision, draft = draftRevision.current,
      current = () => revision === owner.current.revision && draft === draftRevision.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    Keyboard.dismiss();
    void work(current)
      .catch((cause) => {
        if (!current()) return;
        if (
          cause &&
          typeof cause === 'object' &&
          'code' in cause &&
          cause.code === 'UTXO_SUBMISSION_UNKNOWN' &&
          'txid' in cause &&
          typeof cause.txid === 'string'
        ) {
          setOutcome({ phase: 'unknown', txid: cause.txid, ...(summary ? { summary } : {}) });
          return;
        }
        setError(describe(cause));
      })
      .finally(() => {
        inFlight.current = false;
        if (revision === owner.current.revision) setBusy(false);
      });
  };
  const invalidateDraft = () => {
    closeScanner();
    draftRevision.current++;
    send?.cancel();
    setReview(null);
    setError('');
  };
  let assetMaximumAvailable = false;
  if (asset && maximumAmount !== undefined) {
    try { toEightDecimalBuilderAmount(maximumAmount, asset.decimals); assetMaximumAvailable = true; } catch { /* Unavailable or zero inventory cannot select MAX. */ }
  }
  const symbol = asset?.symbol ?? network.symbol;
  const units = (value: string) =>
    `${formatBaseUnits(value, network.decimals)} ${network.symbol}`;
  const assetUnits = ({
    assetGuid,
    rawAmount,
  }: NonNullable<NativeUtxoReview['outputs'][number]['asset']>, display = review?.assetDisplay) => {
    if (display?.assetGuid === assetGuid)
      return `${formatBaseUnits(rawAmount, display.decimals)} ${
        display.symbol
      }`;
    return t('mobile.sendAssetViews.utxo.assetBaseUnits', { amount: rawAmount, assetId: assetGuid });
  };
  const recipient = review?.outputs[0];
  const amountHero = (summary: ReviewedTransferSummary, outcome = false) => (
    <View style={s.hero}>
      <Coin
        id={summary.recipient.asset ? 'spt' : network.id}
        asset={summary.recipient.asset ? { kind: 'spt', chainId: network.chainId, assetGuid: summary.recipient.asset.assetGuid, decimals: summary.assetDisplay?.decimals } : undefined}
        fallbackSymbol={summary.recipient.asset ? summary.assetDisplay?.symbol ?? 'SPT' : undefined}
        size={46}
      />
      <Text style={s.amount} testID={outcome ? 'native-utxo-outcome-amount' : undefined}>
        {summary.recipient.asset
          ? assetUnits(summary.recipient.asset, summary.assetDisplay)
          : units(summary.recipient.amountSatoshis)}
      </Text>
    </View>
  );
  const subtitle = `${accountLabel} · ${network.name}${network.testnet ? ` · ${t('mobile.common.testNetwork')}` : ''}`;
  const checkStatus = (txid: string) =>
    run(async (current) => {
      const phase = await send!.check(txid);
      if (!current()) return;
      setOutcome(previous => ({ txid, phase, ...(previous?.txid === txid && previous.summary ? { summary: previous.summary } : {}) }));
      const records = await send!.list();
      if (current()) setSaved([...records].reverse());
    });
  const confirmAuthenticated = (credential: NativeOperationCredential) => {
    if (!review || !send || currentReview.current !== review) return;
    const approved = review;
    const summary = summarizeReview(approved);
    run(async (current) => {
      try {
        const { txid } = await send.confirm(approved, credential);
        if (current()) { setReview(null); setOutcome({ txid, phase: 'submitted', summary }); }
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        if (current() && !['INVALID_CREDENTIAL', 'DEVICE_UNLOCK_UNAVAILABLE', 'AUTH_THROTTLED'].includes(code)) {
          setReview(null);
          void send.list().then(records => { if (current()) setSaved([...records].reverse()); }).catch(() => undefined);
        }
        throw cause;
      }
    }, summary);
  };
  const confirm = review && (
    <Button
      title={review.retryTxid ? t('mobile.sendAssetViews.utxo.resendSavedTransfer') : t('mobile.sendAssetViews.evm.confirmAndSend')}
      disabled={busy || !review.retryTxid && !ledgerReady}
      onPress={() => {
        if (!review.retryTxid && ledgerConnection && !ledgerConnection.isConnected()) return;
        setError(''); confirmAuthenticated({ method: 'device' });
      }}
      testID="native-utxo-confirm"
    />
  );
  const footer = outcome ? (
    <View style={s.card}>
      {onViewTransaction && outcome.phase !== 'unknown' && <Button title={t('mobile.sendAssetViews.evm.viewTransaction')} disabled={busy} onPress={() => {
        if (!screenActive.current || inFlight.current || currentOutcome.current !== outcome || currentNetwork.current.network !== network) return;
        onViewTransaction(outcome.txid);
      }} />}
      <Button title={t('privacy.deposit.done')} variant={onViewTransaction && outcome.phase !== 'unknown' ? 'secondary' : 'primary'} onPress={close} />
    </View>
  ) : review ? confirm : (
    <Button
      title={t('mobile.smartSendViews.reviewTransfer')}
      disabled={!send || busy || !address.trim() || !(amount || max)}
      onPress={() => {
        run(async (current) => {
          const next = await send!.prepare({
            recipient: address,
            amount,
            max,
            asset,
            rbf,
            feeChoice,
          });
          if (current()) setReview(next);
        });
      }}
      testID="native-utxo-review"
    />
  );
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen footer={footer} scrollResetKey={outcome ? `outcome:${outcome.txid}` : review ? `review:${review.retryTxid ?? 'new'}` : 'draft'} gap={16}>
          <Header
            title={
              outcome
                ? t('mobile.sendAssetViews.evm.transferStatus')
                : review
                ? t('mobile.smartSendViews.reviewTransfer')
                : t('mobile.smartSendViews.sendSymbol', { symbol })
            }
            subtitle={subtitle}
            onBack={close}
          />
          {busy && (
            <ActivityIndicator
              accessibilityLabel={t('mobile.sendAssetViews.utxo.working')}
              color={colors.pink}
            />
          )}
          {!!error && (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
          {ledgerConnection && !ledgerReady && review && !review.retryTxid && !outcome && <Button
            title={t('mobile.accounts.connectLedger')} disabled={busy}
            onPress={() => { Keyboard.dismiss(); setLedgerPicker(ledgerConnection); }}
          />}
          {outcome ? (
            <>
              {outcome.summary && amountHero(outcome.summary, true)}
              <Notice
                title={
                  outcome.phase === 'confirmed'
                    ? t('send.confirmed')
                    : outcome.phase === 'unknown'
                    ? t('mobile.connections.psbt.submissionTitle')
                    : t('mobile.sendAssetViews.utxo.submitted')
                }
                body={
                  outcome.phase === 'unknown'
                    ? t('mobile.sendAssetViews.utxo.thisTransferIsSavedCheckItsStatusBeforeSendingIt')
                    : t('mobile.sendAssetViews.utxo.youCanCheckTheLatestNetworkStatusHere')
                }
                tone={outcome.phase === 'unknown' ? 'amber' : undefined}
              />
              <Card>
                {outcome.summary && <>
                  <Text style={styles.muted}>{outcome.summary.recipientLabel}</Text>
                  <Text selectable style={s.address} testID="native-utxo-outcome-recipient">
                    {outcome.summary.recipient.address}
                  </Text>
                  {outcome.summary.recipient.asset && <>
                    <Text style={styles.muted}>{t('mobile.activityViews.utxoActivityScreen.assetId')}</Text>
                    <Text>{outcome.summary.recipient.asset.assetGuid}</Text>
                    <Text style={styles.muted}>{t('mobile.sendAssetViews.utxo.nativeAmountSentWithAsset')}</Text>
                    <Text testID="native-utxo-outcome-carrier">{units(outcome.summary.recipient.amountSatoshis)}</Text>
                  </>}
                  <Text style={styles.muted}>{t('send.networkFee')}</Text>
                  <Text testID="native-utxo-outcome-fee">{units(outcome.summary.feeSatoshis)}</Text>
                  <Text style={styles.muted}>{t('send.transactionId')}</Text>
                </>}
                <Text selectable style={s.address}>
                  {outcome.txid}
                </Text>
              </Card>
              <Button
                title={t('settings.smartAccountInfrastructureCheckStatus')}
                variant="secondary"
                disabled={busy}
                onPress={() => checkStatus(outcome.txid)}
              />
              {outcome.phase === 'unknown' && (
                <Button
                  title={t('send.savedUtxo.review')}
                variant="secondary" size="compact"
                  disabled={busy}
                  onPress={() => {
                    run(async (current) => {
                      const next = await send!.prepareRetry(outcome.txid);
                      if (current()) {
                        setOutcome(null);
                        setReview(next);
                      }
                    });
                  }}
                />
              )}
            </>
          ) : review ? (
            <>
              {amountHero(summarizeReview(review))}
              <Card style={s.insetCard}>
                <Text style={styles.muted}>
                  {review.retryTxid ? t('mobile.sendAssetViews.utxo.output1') : t('assetTransfer.recipient')}
                </Text>
                <Text
                  selectable
                  style={s.address}
                  testID="native-utxo-recipient"
                >
                  {recipient!.address}
                </Text>
                {recipient?.asset && (
                  <>
                    <Text style={styles.muted}>{t('mobile.activityViews.utxoActivityScreen.assetId')}</Text>
                    <Text>{recipient.asset.assetGuid}</Text>
                    <Text style={styles.muted}>
                      {t('mobile.sendAssetViews.utxo.nativeAmountSentWithAsset')}</Text>
                    <Text>{units(recipient.amountSatoshis)}</Text>
                  </>
                )}
                {review.retryProviderOrigin && (
                  <>
                    <Text style={styles.muted}>{t('mobile.sendAssetViews.utxo.originalProvider')}</Text>
                    <Text selectable style={s.address}>
                      {review.retryProviderOrigin}
                    </Text>
                  </>
                )}
                <Text style={styles.muted}>{t('send.networkFee')}</Text>
                <Text testID="native-utxo-fee">
                  {units(review.feeSatoshis)}
                </Text>
                <Text style={styles.muted}>{t('mobile.sendAssetViews.utxo.replacebyfee')}</Text>
                <Text>{review.transactionOptions.rbf ? t('components.enabled') : t('components.disabled')}</Text>
                {review.transactionOptions.zdag !== undefined && <>
                  <Text style={styles.muted}>{'Z-DAG'}</Text>
                  <Text>{review.transactionOptions.zdag ? t('components.enabled') : t('components.disabled')}</Text>
                </>}
                {review.transactionOptions.zdagUnavailable && <Notice title={t('mobile.sendAssetViews.utxo.zDAGUnavailable')}
                  body={t('mobile.sendAssetViews.utxo.zDAGIsUnavailableForThisTransactionSizeReplacebyfeeIsEnabled')} tone="amber" />}
                {review.outputs.slice(1).map((output, index) => (
                  <View key={index} style={s.card}>
                    <Text style={styles.muted}>
                      {review.retryTxid ? t('mobile.sendAssetViews.utxo.outputIndex', { index: index + 2 }) : t('buttons.change')} ·{' '}
                      {units(output.amountSatoshis)}
                    </Text>
                    {output.asset && <Text>{assetUnits(output.asset)}</Text>}
                    <Text selectable style={s.address}>
                      {output.address}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          ) : (
            <>
              <Card style={s.networkCard}>
                <Coin id={network.id} size={32} />
                <View style={s.networkText}><Text style={s.networkName}>{network.name}</Text><Text style={s.available}>{network.symbol}</Text></View>
                {onChangeNetwork && <Button title={t('buttons.change')} variant="secondary" size="compact" disabled={busy}
                  onPress={() => {
                    if (!screenActive.current || currentNetwork.current.network !== network || currentNetwork.current.open !== open || inFlight.current || closing.current) return;
                    const draft = Object.freeze({ kind: 'utxo' as const, recipient: address, amount, max, rbf });
                    leave(() => onChangeNetwork(draft));
                  }} />}
              </Card>
              {draftNotice && <Text accessibilityLiveRegion="polite" style={styles.muted}>{draftNotice}</Text>}
              <Card style={s.insetCard}>
                <Text style={styles.muted}>{t('blacklist.recipientDescription')}</Text>
                <View style={s.recipientField}>
                <IdleTextInput
                  accessibilityLabel={t('blacklist.recipientDescription')}
                  value={address}
                  onChangeText={(value) => { invalidateDraft(); setAddress(value); }}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={128}
                  style={s.recipientInput}
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                />
                <IconButton label={t('mobile.smartSendViews.scanRecipientAddress')} icon="scan" disabled={busy || !send}
                  onPress={() => {
                    if (!screenActive.current || currentNetwork.current.network !== network || currentNetwork.current.open !== open || busy || !send || inFlight.current || closing.current) return;
                    const next = { network, open, revision: owner.current.revision, draft: draftRevision.current };
                    scannerOwner.current = next; setScanner(next);
                  }} />
                </View>
                <View style={s.amountRow}>
                  <Text style={styles.muted}>{t('mobile.smartSendViews.amountInSymbol', { symbol })}</Text>
                  {(!asset || maximumAmount !== undefined) && <Button
                    title={max ? t('mobile.sendAssetViews.utxo.enterAmount') : 'MAX'} variant="secondary" size="compact"
                    disabled={busy || !!asset && !assetMaximumAvailable}
                    onPress={() => {
                      invalidateDraft();
                      if (asset && !max) {
                        if (!assetMaximumAvailable || maximumAmount === undefined) return;
                        setAmount(maximumAmount);
                      }
                      setMax(!max);
                    }} />}
                </View>
                <Text style={s.available} numberOfLines={1} accessibilityLabel={t('mobile.sendAssetViews.utxo.availableAmount', { amount: availableAmount ?? t('settings.unavailable').toLocaleLowerCase(nativeI18n.resolvedLanguage), symbol })}>
                  {t('mobile.smartSendViews.available')}{' '}{availableAmount ?? '—'} {symbol}
                </Text>
                <IdleTextInput
                  accessibilityLabel={t('mobile.smartSendViews.amountInSymbol', { symbol })}
                  value={max && !asset ? t('send.max') : amount}
                  onChangeText={(value) => {
                    invalidateDraft();
                    setMax(false);
                    setAmount(normalizeDecimalInput(value, nativeI18n.resolvedLanguage ?? nativeI18n.language));
                  }}
                  editable={!busy}
                  keyboardType="decimal-pad"
                  autoComplete="off"
                  maxLength={40}
                  style={s.input}
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                />
              </Card>
              <Button title={`${t('send.networkFee')} · ${t(feeChoice.kind === 'custom' ? 'mobile.feeChoice.custom' : feeChoice.kind === 'automatic' ? 'mobile.sendAssetViews.evm.automatic' : `send.${feeChoice.kind}`)}`}
                variant="secondary" size="compact" icon="settings" disabled={busy || !send} onPress={() => { closeScanner(); setFeeDialog({ open, network }); }} />
              <Button title={advanced ? t('mobile.sendAssetViews.evm.hideAdvancedOptions') : t('mobile.sendAssetViews.evm.advancedOptions')} variant="secondary" size="compact" icon={advanced ? 'chevron-up' : 'chevron-down'}
                disabled={busy} expanded={advanced} onPress={() => setAdvanced(!advanced)} />
              {advanced && <Card style={s.insetCard}>
                <Button title={asset ? `Z-DAG ${(rbf ? t('components.disabled') : t('components.enabled')).toLocaleLowerCase(nativeI18n.resolvedLanguage)}` : t('mobile.sendAssetViews.utxo.rbfStatus', { status: (rbf ? t('components.enabled') : t('components.disabled')).toLocaleLowerCase(nativeI18n.resolvedLanguage) })}
                  variant="secondary" size="compact" disabled={busy}
                  onPress={() => { invalidateDraft(); setRbf(!rbf); }} />
                <Text style={styles.muted}>{asset
                  ? t('mobile.sendAssetViews.utxo.enableZDAGForFasterAssetTransfersAvoidUsingItFor')
                  : t('mobile.sendAssetViews.utxo.replacebyfeeAllowsThisTransactionToBeReplacedWithAHigher')}</Text>
              </Card>}
              {saved.length > 0 && (
                <Card style={s.insetCard}>
                  <Text style={styles.muted}>{t('send.savedUtxo.title')}</Text>
                  {saved.slice(0, savedLimit).map(({ txid, accepted }) => (
                    <Button
                      key={txid}
                      title={`${
                        accepted ? t('mobile.sendAssetViews.utxo.submitted') : t('send.savedUtxo.check')
                      } ${txid.slice(0, 8)}…`}
                      variant="secondary" size="compact"
                      disabled={busy}
                      onPress={() => checkStatus(txid)}
                    />
                  ))}
                  {saved.length > savedLimit && (
                    <Button
                      title={t('mobile.sendAssetViews.utxo.showMore')}
                      variant="secondary" size="compact"
                      disabled={busy}
                      onPress={() => setSavedLimit(savedLimit + 6)}
                    />
                  )}
                </Card>
              )}
            </>
          )}
        </Screen>
      </KeyboardAvoidingView>
      {feeOpen && send && <NetworkFeeSheet key={`${network.id}:${accountLabel}`} mode="utxo" choice={feeChoice}
        load={signal => send.feeRecommendations(signal)} onClose={() => { if (screenActive.current) setFeeDialog(null); }}
        onApply={choice => {
          if (!screenActive.current || currentNetwork.current.network !== network || currentNetwork.current.open !== open) return;
          invalidateDraft(); setFeeSelection({ open, network, choice }); setFeeDialog(null);
        }} />}
      {scanner && scanner.network === network && scanner.open === open && !review && !outcome && <Modal
        visible animationType="slide" onRequestClose={closeScanner}>
        <UtxoRecipientQrScanner network={scanner.network} onClose={closeScanner} onScan={value => {
          if (!screenActive.current || scannerOwner.current !== scanner || currentNetwork.current.network !== scanner.network || currentNetwork.current.open !== scanner.open ||
              owner.current.revision !== scanner.revision || draftRevision.current !== scanner.draft || inFlight.current || closing.current) return;
          invalidateDraft(); setAddress(value);
        }} />
      </Modal>}
      {ledgerPicker && ledgerPicker === ledgerConnection && <NativeLedgerConnectionModal
        controller={ledgerPicker}
        onClose={() => setLedgerPicker(null)}
        onFinished={() => {
          setLedgerPicker(null);
        }}
      />}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  card: { gap: 12 },
  insetCard: { gap: 12, padding: 16 },
  networkCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  networkText: { flex: 1, minWidth: 0, gap: 3 },
  networkName: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  available: { fontSize: 13, lineHeight: 19, color: colors.muted },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  recipientField: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingRight: 2 },
  recipientInput: { flex: 1, minWidth: 0, minHeight: 48, color: colors.text, padding: 12 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 4 },
  amount: { textAlign: 'center', fontSize: 28, fontWeight: '700' },
  address: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 22,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
    padding: 12,
  },
});
