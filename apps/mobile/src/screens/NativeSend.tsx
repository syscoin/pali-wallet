import { IdleTextInput } from './IdleActivityBoundary';
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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatBaseUnits } from '../core/amounts';
import {
  formatTokenUnits,
  type Erc20Metadata,
} from '../../../../source/shared/erc20';
import type { NativeTransferView } from '../custody/transfers';
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

const failure = (error: unknown, context: NativeSendContext, token = false, hasSavedTransaction = false, cancellation = false) => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_INPUT')
    return `Enter ${context.networkId === 'ethereum' ? 'an' : 'a'} ${
      context.name
    } address and an amount greater than zero.`;
  if (code === 'EXPIRED')
    return hasSavedTransaction
      ? 'A signed transaction was saved before the review expired. Check it before sending again.'
      : cancellation ? 'This cancellation is unavailable. Check the original transaction or try again.'
      : 'Network conditions changed or this review expired. Review the transfer again.';
  if (code === 'INSUFFICIENT_BALANCE')
    return token || cancellation
      ? `Not enough ${context.symbol} for the maximum network fee.`
      : `Not enough ${context.symbol} for the amount and maximum network fee.`;
  if (code === 'INSUFFICIENT_TOKEN_BALANCE')
    return 'Not enough tokens for this transfer.';
  if (code === 'TOKEN_CHANGED')
    return 'Token precision changed. Review the token before sending again.';
  if (code === 'TOKEN_TRANSFER_REJECTED')
    return 'The token contract rejected this transfer.';
  if (code === 'BUSY') return 'Wait for the current request to finish.';
  if (code === 'CANCELLED' || code === 'NOT_READY')
    return 'Your wallet was locked. Unlock to continue.';
  if (code === 'PENDING_TRANSFER') return '';
  return hasSavedTransaction
    ? 'This request could not be completed. Check your pending transaction before sending again.'
    : 'This request could not be completed. Try again or check Activity for an existing transaction.';
};

export function NativeSend({
  controller,
  onBack,
  accountLabel = 'Account 1',
  token,
  context,
  savedHash,
  cancellationHash,
}: {
  controller: NativeTransferView;
  onBack(): void;
  accountLabel?: string;
  token?: Erc20Metadata;
  context: NativeSendContext;
  savedHash?: string;
  cancellationHash?: string;
}) {
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot()
  );
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const lifetime = useRef({ alive: true, epoch: 0 });
  const latestBack = useRef(onBack);
  useLayoutEffect(() => {
    latestBack.current = onBack;
  }, [onBack]);
  const busy = ['preparing', 'signing', 'submitting'].includes(snapshot.phase);
  const review = snapshot.review;
  const capturedContext = review?.context ?? snapshot.context ?? context;
  const networkLabel = `${capturedContext.name}${
    capturedContext.testnet ? ' · Test network' : ''
  }`;
  const reviewedToken = review?.intent?.token;
  const outcomeToken = snapshot.intent?.token;
  const amountText = review
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
  const close = () => {
    lifetime.current.epoch++;
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
        setError(failure(cause, capturedContext, !!token || !!snapshot.intent, !!controller.getSnapshot().hash, !!cancellationHash));
    }
  };
  useEffect(() => {
    if (cancellationHash) {
      const captured = lifetime.current.epoch;
      void controller.prepareCancellation(cancellationHash).catch((cause) => {
        if (lifetime.current.alive && captured === lifetime.current.epoch)
          setError(cause instanceof Error && cause.message === 'INSUFFICIENT_BALANCE'
            ? 'The account cannot cover the maximum network fee.'
            : 'Pali could not verify that this transaction is still pending.');
      });
      return;
    }
    void controller.recover(!!savedHash, savedHash).catch(() => undefined);
  }, [controller, savedHash, cancellationHash]);
  const submit = () => {
    if (!review || busy) return;
    Keyboard.dismiss();
    void run(() => controller.confirm(review.id));
  };
  const input = (
    label: string,
    value: string,
    change: (value: string) => void,
    options: { decimal?: boolean; max?: number } = {}
  ) => (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <IdleTextInput
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
        keyboardType={options.decimal ? 'decimal-pad' : 'default'}
        maxLength={options.max ?? 1024}
        placeholderTextColor={colors.muted}
        selectionColor={colors.pink}
        style={s.input}
      />
    </View>
  );
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
  const footer = !review && !hasOutcome && !cancellationHash ? (
    <Button
      title="Review transfer"
      disabled={busy || !recipient.trim() || !amount}
      onPress={() =>
        void run(() =>
          token
            ? controller.prepareToken(
                token.contractAddress,
                recipient.trim(),
                amount
              )
            : controller.prepare(recipient.trim(), amount)
        )
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
              cancellationHash
                ? hasOutcome ? 'Cancellation status' : 'Review cancellation'
                : review
                ? (review.retry ? 'Review resend' : 'Review transfer')
                : hasOutcome
                ? 'Transfer status'
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
              <View style={s.hero}>
                <Coin
                  id={
                    reviewedToken ? 'custom-token' : capturedContext.networkId
                  }
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
              {!!review.replay?.predecessorCount && <Card style={s.summary}>
                <Text style={s.label}>PREVIOUS TRANSACTION · NONCE {review.replay.missingNonce}</Text>
                <Text style={s.hint}>This transaction is waiting for an earlier nonce.</Text>
                {review.replay.predecessors.map(candidate => <Button key={candidate.hash} variant="secondary"
                  title={`${candidate.operation === 'cancel' ? 'Cancellation' : candidate.operation === 'speed-up' ? 'Replacement' : 'Transaction'} ${candidate.hash.slice(0, 10)}…`}
                  onPress={() => void run(() => controller.recover(true, candidate.hash))} />)}
                {review.replay.predecessors.length < review.replay.predecessorCount && <Button title="Load more saved transactions" variant="quiet" disabled={busy}
                  onPress={() => void run(() => controller.loadMorePredecessors())} />}
              </Card>}
              <Card style={s.summary}>
                <Text style={s.label}>{review.cancellation ? 'TO · YOUR ADDRESS' : 'TO'}</Text>
                <Text
                  selectable
                  style={s.address}
                  testID="native-send-recipient"
                >
                  {review.recipient}
                </Text>
                <View style={s.separator} />
                <Text style={s.label}>EXECUTION FEE LIMIT</Text>
                <Text testID="native-send-fee">
                  {formatBaseUnits(review.maximumFeeUnits, 18)}{' '}
                  {capturedContext.symbol}
                </Text>
                <Text style={s.hint}>
                  The final fee depends on network execution. This review limits the gas price and gas used by this transaction.
                </Text>
                {!reviewedToken && !review.cancellation && (
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
              {review.cancellation && <Card style={s.summary}>
                <Text style={s.label}>ORIGINAL TRANSACTION · NONCE {review.nonce}</Text>
                <Text selectable style={s.address}>{review.cancellation.originalHash}</Text>
                <Text style={s.hint}>This sends zero to your own address with a higher fee. The original can still confirm first.</Text>
              </Card>}
              {review.replay && <Card style={s.summary}>
                <Text style={s.label}>SAVED TRANSACTION · NONCE {review.nonce}</Text>
                <Text selectable style={s.address}>{review.replay.hash}</Text>
                <Text style={s.hint}>Connection: {new URL(capturedContext.rpcUrl).host}</Text>
                <Text>{review.replay.operation === 'cancel' ? 'Cancellation' : review.replay.operation === 'speed-up' ? 'Fee replacement' : review.replay.to === null ? 'Contract creation' : review.replay.dataBytes ? 'Contract interaction' : 'Transfer'}</Text>
                {review.replay.dataBytes > 0 && <Text style={s.hint}>{review.replay.selector ?? 'Contract data'} · {review.replay.dataBytes} bytes</Text>}
                {!!review.replay.accessListEntries && <Text style={s.hint}>{review.replay.accessListEntries} access-list entries</Text>}
                {review.replay.tokenTransfer && !reviewedToken && <Text>Token base units: {review.replay.tokenTransfer.amountUnits}</Text>}
              </Card>}
              {!review.cancellation && <Text style={s.hint}>
                Confirm the full address and network before sending. Completed
                transfers cannot be reversed.
              </Text>}
              <Button
                title={review.cancellation ? 'Submit cancellation' : review.retry ? 'Resend signed transaction' : 'Confirm and send'}
                disabled={busy}
                onPress={submit}
                testID="native-send-confirm"
              />
              <Button
                title={review.retry || review.cancellation ? 'Close review' : 'Edit transfer'}
                variant="quiet"
                disabled={busy}
                onPress={() => {
                  if (cancellationHash) close();
                  else controller.cancel();
                }}
              />
            </>
          ) : hasOutcome ? (
            <>
              <View style={s.hero}>
                <Coin
                  id={outcomeToken ? 'custom-token' : capturedContext.networkId}
                  size={46}
                />
                <Text style={s.title}>
                  {snapshot.phase === 'confirmed'
                    ? cancellationHash
                      ? 'Cancellation confirmed'
                      : outcomeToken
                      ? 'Transaction confirmed'
                      : 'Transfer confirmed'
                    : snapshot.phase === 'reverted'
                    ? cancellationHash ? 'Cancellation reverted' : 'Transfer reverted'
                    : snapshot.phase === 'nonce-consumed'
                    ? 'Check account history'
                    : snapshot.phase === 'unknown'
                    ? 'Checking submission'
                    : cancellationHash ? 'Cancellation submitted' : 'Transfer pending'}
                </Text>
              </View>
              {outcomeToken && tokenIdentity(outcomeToken)}
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
                onPress={() => void run(() => controller.recover(false, cancellationHash ? snapshot.hash! : undefined))}
              />
              {snapshot.phase === 'unknown' && (
                <Button
                  title="Review retry"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void run(() => controller.recover(true, cancellationHash ? snapshot.hash! : undefined))}
                />
              )}
              {!cancellationHash && ['confirmed', 'reverted', 'nonce-consumed'].includes(
                snapshot.phase
              ) && (
                <Button
                  title="New transfer"
                  onPress={() => {
                    setRecipient('');
                    setAmount('');
                    setError('');
                    controller.cancel();
                  }}
                />
              )}
              <Button title={cancellationHash ? 'Back to Activity' : 'Back to wallet'} variant="quiet" onPress={close} />
            </>
          ) : cancellationHash ? (
            !busy && <Button title="Check again" variant="secondary" onPress={() => void run(() => controller.prepareCancellation(cancellationHash))} />
          ) : (
            <>
              {input(
                `${capturedContext.name} address`,
                recipient,
                setRecipient,
                { max: 128 }
              )}
              {token && tokenIdentity(token)}
              {input(
                `Amount in ${token?.symbol ?? capturedContext.symbol}`,
                amount,
                setAmount,
                {
                  decimal: true,
                  max: token ? 334 : 100,
                }
              )}

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
