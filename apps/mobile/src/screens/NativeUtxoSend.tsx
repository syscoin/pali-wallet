import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SYSX_ASSET_DECIMALS,
  SYSX_ASSET_GUID,
} from '../../../../source/shared/syscoinAssetIds';

import { formatBaseUnits } from '../core/amounts';
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
import { NativeLedgerConnectionModal } from './NativeLedger';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { IdleTextInput } from './IdleActivityBoundary';

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
  if (code === 'INVALID_INPUT')
    return 'Enter a valid address and amount for this network.';
  if (code === 'CANCELLED' || code === 'NOT_READY')
    return 'This review is no longer available. Open a new review to continue.';
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
}: {
  accountLabel: string;
  ledgerConnection?: NativeLedgerConnectionView;
  initialDraft?: Readonly<{ recipient: string; amount: string; max?: boolean }>;
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
  const [max, setMax] = useState(initialDraft?.max ?? false);
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
  const owner = useRef({ revision: 0 });
  const inFlight = useRef(false);
  const closing = useRef(false);
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
      lifetime.revision++;
      local?.cancel();
    };
  }, [open]);
  const close = () => {
    if (closing.current) return;
    Keyboard.dismiss();
    if (review && !busy) {
      send?.cancel();
      setReview(null);
      setError('');
      return;
    }
    send?.cancel();
    if (!beforeClose) { onBack(); return; }
    closing.current = true;
    setClosingHardware(true);
    const revision = owner.current.revision;
    void Promise.resolve().then(beforeClose).then(() => {
      if (owner.current.revision === revision) onBack();
    }, () => {
      if (owner.current.revision === revision) {
        closing.current = false;
        setClosingHardware(false);
        setError('The hardware request is still closing. Try again.');
      }
    });
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
    const revision = owner.current.revision,
      current = () => revision === owner.current.revision;
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
        if (current()) setBusy(false);
      });
  };
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
    if (assetGuid === SYSX_ASSET_GUID)
      return `${formatBaseUnits(rawAmount, SYSX_ASSET_DECIMALS)} SYSX`;
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
  const footer = outcome ? (
    <Button title="Done" onPress={close} />
  ) : review ? undefined : (
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
          });
          if (current()) setReview(next);
        });
      }}
      testID="native-utxo-review"
    />
  );
  const confirm = review && (
    <Button
      title={review.retryTxid ? 'Resend saved transfer' : 'Confirm and send'}
      disabled={busy || !review.retryTxid && !ledgerReady}
      onPress={() => {
        if (!review.retryTxid && ledgerConnection && !ledgerConnection.isConnected()) return;
        run(async (current) => {
          setReview(null);
          try {
            const { txid } = await send!.confirm(review);
            if (current()) setOutcome({ txid, phase: 'submitted' });
          } catch (cause) {
            // The signed bytes may be durable even if expiry prevented POST.
            if (current())
              void send!
                .list()
                .then((records) => {
                  if (current()) setSaved([...records].reverse());
                })
                .catch(() => undefined);
            throw cause;
          }
        });
      }}
      testID="native-utxo-confirm"
    />
  );
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen footer={footer}>
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
                  variant="quiet"
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
                      ? review.assetDisplay?.symbol ??
                        (recipient.asset.assetGuid === SYSX_ASSET_GUID
                          ? 'SYSX'
                          : 'asset')
                      : network.symbol
                  }
                  fallbackSymbol={
                    recipient?.asset
                      ? review.assetDisplay?.symbol ??
                        (recipient.asset.assetGuid === SYSX_ASSET_GUID
                          ? 'SYSX'
                          : 'SPT')
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
              {confirm}
            </>
          ) : (
            <>
              <Card style={s.insetCard}>
                <Text style={styles.muted}>Recipient address</Text>
                <IdleTextInput
                  accessibilityLabel="Recipient address"
                  value={address}
                  onChangeText={setAddress}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={128}
                  style={s.input}
                />
                <Text style={styles.muted}>Amount in {symbol}</Text>
                <IdleTextInput
                  accessibilityLabel={`Amount in ${symbol}`}
                  value={max ? 'Max' : amount}
                  onChangeText={(value) => {
                    setMax(false);
                    setAmount(value);
                  }}
                  editable={!busy}
                  keyboardType="decimal-pad"
                  autoComplete="off"
                  maxLength={40}
                  style={s.input}
                />
                {!asset && (
                  <Button
                    title={max ? 'Enter amount' : 'Use maximum'}
                    variant="quiet"
                    disabled={busy}
                    onPress={() => setMax(!max)}
                  />
                )}
              </Card>
              {saved.length > 0 && (
                <Card style={s.insetCard}>
                  <Text style={styles.muted}>Saved transfers</Text>
                  {saved.slice(0, savedLimit).map(({ txid, accepted }) => (
                    <Button
                      key={txid}
                      title={`${
                        accepted ? 'Submitted' : 'Check transfer'
                      } ${txid.slice(0, 8)}…`}
                      variant="quiet"
                      disabled={busy}
                      onPress={() => checkStatus(txid)}
                    />
                  ))}
                  {saved.length > savedLimit && (
                    <Button
                      title="Show more"
                      variant="quiet"
                      disabled={busy}
                      onPress={() => setSavedLimit(savedLimit + 6)}
                    />
                  )}
                </Card>
              )}
            </>
          )}
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
        </Screen>
      </KeyboardAvoidingView>
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
  hero: { alignItems: 'center', gap: 12, paddingVertical: 12 },
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
