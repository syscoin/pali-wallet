import React, {
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
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatBaseUnits } from '../core/amounts';
import type { NativeTransferView } from '../custody/transfers';
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

const failure = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_INPUT')
    return 'Enter an Ethereum address and an amount greater than zero.';
  if (code === 'EXPIRED')
    return 'Network conditions changed or this review expired. Review the transfer again.';
  if (code === 'INSUFFICIENT_BALANCE')
    return 'Not enough ETH for the amount and maximum network fee.';
  if (code === 'BUSY') return 'Wait for the current request to finish.';
  if (code === 'CANCELLED' || code === 'NOT_READY')
    return 'Your wallet was locked. Unlock to continue.';
  if (code === 'PENDING_TRANSFER') return '';
  return 'This request could not be completed. Check your pending transaction before sending again.';
};

export function NativeSend({
  controller,
  onBack,
  accountLabel = 'Account 1',
}: {
  controller: NativeTransferView;
  onBack(): void;
  accountLabel?: string;
}) {
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot()
  );
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState('');
  const [passwordReviewId, setPasswordReviewId] = useState(snapshot.review?.id);
  const [error, setError] = useState('');
  if (passwordReviewId !== snapshot.review?.id) {
    // Reset before React commits a replacement or expired review to the screen.
    setPasswordReviewId(snapshot.review?.id);
    setPassword('');
  }
  const lifetime = useRef({ alive: true, epoch: 0 });
  const latestBack = useRef(onBack);
  useLayoutEffect(() => {
    latestBack.current = onBack;
  }, [onBack]);
  const busy = ['preparing', 'signing', 'submitting'].includes(snapshot.phase);
  const review = snapshot.review;
  const amountText = review ? formatBaseUnits(review.amountUnits, 18) : '';
  const close = () => {
    lifetime.current.epoch++;
    setPassword('');
    controller.cancel();
    Keyboard.dismiss();
    onBack();
  };
  useLayoutEffect(() => {
    const current = lifetime.current;
    current.alive = true;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      controller.cancel();
      Keyboard.dismiss();
      latestBack.current();
      return true;
    });
    return () => {
      current.alive = false;
      current.epoch++;
      controller.cancel();
      back.remove();
    };
  }, [controller]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    const captured = lifetime.current.epoch;
    setError('');
    try {
      await operation();
    } catch (cause) {
      if (lifetime.current.alive && captured === lifetime.current.epoch)
        setError(failure(cause));
    }
  };
  useEffect(() => {
    void controller.recover().catch(() => undefined);
  }, [controller]);
  const submit = () => {
    if (!review || !password || busy) return;
    let entered = password;
    setPassword('');
    Keyboard.dismiss();
    void run(async () => {
      try {
        await controller.confirm(review.id, entered);
      } finally {
        entered = '';
      }
    });
  };
  const input = (
    label: string,
    value: string,
    change: (value: string) => void,
    options: { secret?: boolean; decimal?: boolean; max?: number } = {}
  ) => (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="noExcludeDescendants"
        textContentType="none"
        secureTextEntry={options.secret}
        keyboardType={options.decimal ? 'decimal-pad' : 'default'}
        maxLength={options.max ?? 1024}
        placeholderTextColor={colors.muted}
        selectionColor={colors.pink}
        style={s.input}
      />
    </View>
  );
  const terminal = ['confirmed', 'reverted', 'nonce-consumed'].includes(snapshot.phase);
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
  const footer = review ? (
    <Button
      title={review.retry ? 'Confirm retry' : 'Confirm and send'}
      disabled={busy || !password}
      onPress={submit}
      testID="native-send-confirm"
    />
  ) : !hasOutcome ? (
    <Button
      title="Review transfer"
      disabled={busy || !recipient.trim() || !amount}
      onPress={() =>
        void run(() => controller.prepare(recipient.trim(), amount))
      }
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
              review
                ? 'Review transfer'
                : hasOutcome
                ? 'Transfer status'
                : 'Send ETH'
            }
            subtitle={`${accountLabel} · Ethereum`}
            onBack={close}
          />
          {review ? (
            <>
              <View style={s.hero}>
                <Coin id="ethereum" size={46} />
                <Text
                  style={[s.amount, amountText.length > 16 && s.preciseAmount]}
                  testID="native-send-amount"
                >
                  {amountText}
                </Text>
                <Text style={styles.muted}>ETH · Ethereum</Text>
              </View>
              <Card style={s.summary}>
                <Text style={s.label}>TO</Text>
                <Text
                  selectable
                  style={s.address}
                  testID="native-send-recipient"
                >
                  {review.recipient}
                </Text>
                <View style={s.separator} />
                <Text style={s.label}>MAXIMUM NETWORK FEE</Text>
                <Text testID="native-send-fee">
                  {formatBaseUnits(review.maximumFeeUnits, 18)} ETH
                </Text>
                <Text style={s.hint}>
                  The final network fee may be lower. It cannot exceed this
                  limit.
                </Text>
                <View style={s.separator} />
                <Text style={s.label}>MAXIMUM TOTAL</Text>
                <Text>{formatBaseUnits(review.totalUnits, 18)} ETH</Text>
              </Card>
              {review.retry && (
                <Notice
                  title="Retry the same transaction"
                  body="The network may already have this transaction. Retrying sends the same signed bytes and hash, without creating another transfer."
                  tone="amber"
                />
              )}
              {input('Confirm your wallet password', password, setPassword, {
                secret: true,
              })}
              <Text style={s.hint}>
                Confirm the full address and network before sending. Completed
                transfers cannot be reversed.
              </Text>
              <Button
                title="Edit transfer"
                variant="quiet"
                disabled={busy}
                onPress={() => {
                  setPassword('');
                  controller.cancel();
                }}
              />
            </>
          ) : hasOutcome ? (
            <>
              <View style={s.hero}>
                <Coin id="ethereum" size={46} />
                <Text style={s.title}>
                  {snapshot.phase === 'confirmed'
                    ? 'Transfer confirmed'
                    : snapshot.phase === 'reverted'
                    ? 'Transfer reverted'
                    : snapshot.phase === 'nonce-consumed'
                    ? 'Check account history'
                    : snapshot.phase === 'unknown'
                    ? 'Checking submission'
                    : 'Transfer pending'}
                </Text>
              </View>
              <Notice
                title={
                  snapshot.phase === 'unknown'
                    ? 'Keep this transaction'
                    : 'Ethereum transaction'
                }
                body={
                  snapshot.message ??
                  'Check the transaction status before sending again.'
                }
                tone={
                  snapshot.phase === 'unknown' ||
                  snapshot.phase === 'reverted' ||
                  snapshot.phase === 'nonce-consumed'
                    ? 'amber'
                    : undefined
                }
              />
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
                onPress={() => void run(() => controller.recover())}
              />
              {snapshot.phase === 'unknown' && (
                <Button
                  title="Review retry"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void run(() => controller.recover(true))}
                />
              )}
              {['confirmed', 'reverted', 'nonce-consumed'].includes(
                snapshot.phase
              ) && (
                <Button
                  title="New transfer"
                  onPress={() => {
                    setRecipient('');
                    setAmount('');
                    setPassword('');
                    setError('');
                    controller.cancel();
                  }}
                />
              )}
              <Button title="Back to wallet" variant="quiet" onPress={close} />
            </>
          ) : (
            <>
              {input('Ethereum address', recipient, setRecipient, { max: 128 })}
              {input('Amount in ETH', amount, setAmount, {
                decimal: true,
                max: 100,
              })}
              <Notice
                title="Ethereum network"
                body="Use an Ethereum address. The amount and maximum network fee are shown before you confirm."
              />
              <Text style={s.hint}>
                Preparing a transfer shares its addresses and amount with the
                Ethereum RPC provider.
              </Text>
            </>
          )}
          {busy && (
            <View style={s.progress}>
              <ActivityIndicator color={colors.pink} />
              <Text style={styles.muted}>
                {snapshot.phase === 'signing'
                  ? 'Authenticating and signing…'
                  : snapshot.phase === 'submitting'
                  ? 'Submitting the transaction…'
                  : 'Checking the network…'}
              </Text>
            </View>
          )}
          {!!error && (
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
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
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
