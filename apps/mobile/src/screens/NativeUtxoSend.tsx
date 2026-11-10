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
import { TransactionAuthentication } from './TransactionAuthentication';
import { UtxoRecipientQrScanner } from './UtxoRecipientQrScanner';
import type { NativeOperationCredential } from '../custody/types';
import type { NativeUnsignedSendDraft } from './sendNetworkDraft';

import type { UtxoNetwork } from '../core/utxoNetworks';
import type {
  NativeUtxoAsset,
  NativeUtxoReview,
  NativeUtxoSend,
} from '../custody/utxoSend';

type Outcome = Readonly<{
  txid: string;
  phase: 'submitted' | 'seen' | 'confirmed' | 'unknown';
}>;

function describe(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_CREDENTIAL') return 'That PIN is incorrect. Please try again.';
  if (code === 'DEVICE_UNLOCK_UNAVAILABLE') return 'Biometric confirmation was not completed. Try again or use your PIN.';
  if (code === 'AUTH_THROTTLED') return 'Too many incorrect PINs. Wait a few minutes, then try again. Your review remains available until it expires.';
  if (code === 'INVALID_INPUT')
    return 'Enter a valid address and amount for this network.';
  if (code === 'CANCELLED' || code === 'NOT_READY')
    return 'This review is no longer available. Open a new review to continue.';
  if (code === 'UTXO_OPTIONS_CHANGED') return 'Transaction options changed. Review a new quote.';
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'UTXO_SIGNED_OUTPOINT_PENDING')
      return 'A saved transfer uses these funds. Check its status before sending again.';
    if (error.code === 'UTXO_POSSIBLE_SENTRY_COLLATERAL')
      return 'This transfer would spend a possible Sentry collateral output.';
  }
  return 'Pali could not complete this request. Try again or check your saved transfers.';
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
  authenticationMethod,
}: {
  authenticationMethod: NativeOperationCredential['method'];
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
  const [authentication, setAuthentication] = useState<{ review: NativeUtxoReview; identity: string; method: NativeOperationCredential['method'] } | null>(null);
  if (authentication && authentication.review !== review) setAuthentication(null);
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
        const records = await opened.list();
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
    closeScanner(); setAuthentication(null); Keyboard.dismiss();
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
        setError('The hardware request is still closing. Try again.');
      }
    });
  };
  const close = () => {
    if (review && !busy) {
      closeScanner(); setAuthentication(null); send?.cancel(); setReview(null); setError(''); return;
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
  const run = (work: (current: () => boolean) => Promise<void>) => {
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
          setOutcome({ phase: 'unknown', txid: cause.txid });
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
  }: NonNullable<NativeUtxoReview['outputs'][number]['asset']>) => {
    const display = review?.assetDisplay;
    if (display?.assetGuid === assetGuid)
      return `${formatBaseUnits(rawAmount, display.decimals)} ${
        display.symbol
      }`;
    return `${rawAmount} base units · Asset ${assetGuid}`;
  };
  const recipient = review?.outputs[0];
  const subtitle = `${accountLabel} · ${network.name}${
    network.testnet ? ' · Test network' : ''
  }`;
  const checkStatus = (txid: string) =>
    run(async (current) => {
      const phase = await send!.check(txid);
      if (current()) setOutcome({ txid, phase });
    });
  const confirmAuthenticated = (credential: NativeOperationCredential) => {
    if (!review || !send || currentReview.current !== review) return;
    const approved = review;
    run(async (current) => {
      try {
        const { txid } = await send.confirm(approved, credential);
        if (current()) { setAuthentication(null); setReview(null); setOutcome({ txid, phase: 'submitted' }); }
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        if (current() && !['INVALID_CREDENTIAL', 'DEVICE_UNLOCK_UNAVAILABLE', 'AUTH_THROTTLED'].includes(code)) {
          setAuthentication(null); setReview(null);
          void send.list().then(records => { if (current()) setSaved([...records].reverse()); }).catch(() => undefined);
        }
        throw cause;
      }
    });
  };
  const confirm = review && (
    <Button
      title={review.retryTxid ? 'Resend saved transfer' : 'Confirm and send'}
      disabled={busy || !review.retryTxid && !ledgerReady}
      onPress={() => {
        if (!review.retryTxid && ledgerConnection && !ledgerConnection.isConnected()) return;
        setError(''); setAuthentication({ review, identity: `${owner.current.revision}:${draftRevision.current}:${review.retryTxid ?? 'new'}`, method: authenticationMethod });
      }}
      testID="native-utxo-confirm"
    />
  );
  const footer = outcome ? (
    <View style={s.card}>
      {onViewTransaction && outcome.phase !== 'unknown' && <Button title="View transaction" disabled={busy} onPress={() => {
        if (!screenActive.current || inFlight.current || currentOutcome.current !== outcome || currentNetwork.current.network !== network) return;
        onViewTransaction(outcome.txid);
      }} />}
      <Button title="Done" variant={onViewTransaction && outcome.phase !== 'unknown' ? 'secondary' : 'primary'} onPress={close} />
    </View>
  ) : review ? confirm : (
    <Button
      title="Review transfer"
      disabled={!send || busy || !address.trim() || !(amount || max)}
      onPress={() => {
        run(async (current) => {
          const next = await send!.prepare({
            recipient: address,
            amount,
            max,
            asset,
            rbf,
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
                ? 'Transfer status'
                : review
                ? 'Review transfer'
                : `Send ${symbol}`
            }
            subtitle={subtitle}
            onBack={close}
          />
          {busy && (
            <ActivityIndicator
              accessibilityLabel="Working"
              color={colors.pink}
            />
          )}
          {!!error && (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
          {ledgerConnection && !ledgerReady && review && !review.retryTxid && !outcome && <Button
            title="Connect Ledger" disabled={busy}
            onPress={() => { Keyboard.dismiss(); setLedgerPicker(ledgerConnection); }}
          />}
          {outcome ? (
            <>
              <Notice
                title={
                  outcome.phase === 'confirmed'
                    ? 'Confirmed'
                    : outcome.phase === 'unknown'
                    ? 'Submission unverified'
                    : 'Submitted'
                }
                body={
                  outcome.phase === 'unknown'
                    ? 'This transfer is saved. Check its status before sending it again.'
                    : 'You can check the latest network status here.'
                }
                tone={outcome.phase === 'unknown' ? 'amber' : undefined}
              />
              <Card>
                <Text selectable style={s.address}>
                  {outcome.txid}
                </Text>
              </Card>
              <Button
                title="Check status"
                variant="secondary"
                disabled={busy}
                onPress={() => checkStatus(outcome.txid)}
              />
              {outcome.phase === 'unknown' && (
                <Button
                  title="Review saved transfer"
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
              <View style={s.hero}>
                <Coin
                  id={
                    recipient?.asset
                      ? review.assetDisplay?.symbol ?? 'asset'
                      : network.symbol
                  }
                  fallbackSymbol={
                    recipient?.asset
                      ? review.assetDisplay?.symbol ?? 'SPT'
                      : undefined
                  }
                  size={46}
                />
                <Text style={s.amount}>
                  {recipient?.asset
                    ? assetUnits(recipient.asset)
                    : units(recipient!.amountSatoshis)}
                </Text>
              </View>
              <Card style={s.insetCard}>
                <Text style={styles.muted}>
                  {review.retryTxid ? 'Output 1' : 'Recipient'}
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
                    <Text style={styles.muted}>Asset ID</Text>
                    <Text>{recipient.asset.assetGuid}</Text>
                    <Text style={styles.muted}>
                      Native amount sent with asset
                    </Text>
                    <Text>{units(recipient.amountSatoshis)}</Text>
                  </>
                )}
                {review.retryProviderOrigin && (
                  <>
                    <Text style={styles.muted}>Original provider</Text>
                    <Text selectable style={s.address}>
                      {review.retryProviderOrigin}
                    </Text>
                  </>
                )}
                <Text style={styles.muted}>Network fee</Text>
                <Text testID="native-utxo-fee">
                  {units(review.feeSatoshis)}
                </Text>
                <Text style={styles.muted}>Replace-by-fee</Text>
                <Text>{review.transactionOptions.rbf ? 'Enabled' : 'Disabled'}</Text>
                {review.transactionOptions.zdag !== undefined && <>
                  <Text style={styles.muted}>Z-DAG</Text>
                  <Text>{review.transactionOptions.zdag ? 'Enabled' : 'Disabled'}</Text>
                </>}
                {review.transactionOptions.zdagUnavailable && <Notice title="Z-DAG unavailable"
                  body="Z-DAG is unavailable for this transaction size. Replace-by-fee is enabled." tone="amber" />}
                {review.outputs.slice(1).map((output, index) => (
                  <View key={index} style={s.card}>
                    <Text style={styles.muted}>
                      {review.retryTxid ? `Output ${index + 2}` : 'Change'} ·{' '}
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
                {onChangeNetwork && <Button title="Change" variant="secondary" size="compact" disabled={busy}
                  onPress={() => {
                    if (!screenActive.current || currentNetwork.current.network !== network || currentNetwork.current.open !== open || inFlight.current || closing.current) return;
                    const draft = Object.freeze({ kind: 'utxo' as const, recipient: address, amount, max, rbf });
                    leave(() => onChangeNetwork(draft));
                  }} />}
              </Card>
              {draftNotice && <Text accessibilityLiveRegion="polite" style={styles.muted}>{draftNotice}</Text>}
              <Card style={s.insetCard}>
                <Text style={styles.muted}>Recipient address</Text>
                <View style={s.recipientField}>
                <IdleTextInput
                  accessibilityLabel="Recipient address"
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
                <IconButton label="Scan recipient address" icon="scan" disabled={busy || !send}
                  onPress={() => {
                    if (!screenActive.current || currentNetwork.current.network !== network || currentNetwork.current.open !== open || busy || !send || inFlight.current || closing.current) return;
                    const next = { network, open, revision: owner.current.revision, draft: draftRevision.current };
                    scannerOwner.current = next; setScanner(next);
                  }} />
                </View>
                <View style={s.amountRow}>
                  <Text style={styles.muted}>Amount in {symbol}</Text>
                  {(!asset || maximumAmount !== undefined) && <Button
                    title={max ? 'Enter amount' : 'MAX'} variant="secondary" size="compact"
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
                <Text style={s.available} numberOfLines={1} accessibilityLabel={`Available ${availableAmount ?? 'unavailable'} ${symbol}`}>
                  Available {availableAmount ?? '—'} {symbol}
                </Text>
                <IdleTextInput
                  accessibilityLabel={`Amount in ${symbol}`}
                  value={max && !asset ? 'Max' : amount}
                  onChangeText={(value) => {
                    invalidateDraft();
                    setMax(false);
                    setAmount(value);
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
              <Button title={advanced ? 'Hide advanced options' : 'Advanced options'} variant="secondary" size="compact" icon={advanced ? 'chevron-up' : 'chevron-down'}
                disabled={busy} expanded={advanced} onPress={() => setAdvanced(!advanced)} />
              {advanced && <Card style={s.insetCard}>
                <Button title={asset ? `Z-DAG ${rbf ? 'disabled' : 'enabled'}` : `Replace-by-fee ${rbf ? 'enabled' : 'disabled'}`}
                  variant="secondary" size="compact" disabled={busy}
                  onPress={() => { invalidateDraft(); setRbf(!rbf); }} />
                <Text style={styles.muted}>{asset
                  ? 'Enable Z-DAG for faster asset transfers. Avoid using it for large amounts. Z-DAG disables replace-by-fee.'
                  : 'Replace-by-fee allows this transaction to be replaced with a higher network fee.'}</Text>
              </Card>}
              {saved.length > 0 && (
                <Card style={s.insetCard}>
                  <Text style={styles.muted}>Saved transfers</Text>
                  {saved.slice(0, savedLimit).map(({ txid, accepted }) => (
                    <Button
                      key={txid}
                      title={`${
                        accepted ? 'Submitted' : 'Check transfer'
                      } ${txid.slice(0, 8)}…`}
                      variant="secondary" size="compact"
                      disabled={busy}
                      onPress={() => checkStatus(txid)}
                    />
                  ))}
                  {saved.length > savedLimit && (
                    <Button
                      title="Show more"
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
      {scanner && scanner.network === network && scanner.open === open && !review && !outcome && <Modal
        visible animationType="slide" onRequestClose={closeScanner}>
        <UtxoRecipientQrScanner network={scanner.network} onClose={closeScanner} onScan={value => {
          if (!screenActive.current || scannerOwner.current !== scanner || currentNetwork.current.network !== scanner.network || currentNetwork.current.open !== scanner.open ||
              owner.current.revision !== scanner.revision || draftRevision.current !== scanner.draft || inFlight.current || closing.current) return;
          invalidateDraft(); setAddress(value);
        }} />
      </Modal>}
      {authentication && authentication.review === review && review && <TransactionAuthentication
        identity={authentication.identity}
        method={authentication.method} busy={busy} error={error}
        onConfirm={confirmAuthenticated} onCancel={() => {
          if (currentReview.current !== review) return;
          if (inFlight.current) { close(); return; }
          setAuthentication(null); setError('');
        }}
      />}
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
