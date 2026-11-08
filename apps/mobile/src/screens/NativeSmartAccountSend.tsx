import {
  NativePortfolioController,
  type PublicCustodySource,
} from '../portfolio/nativePortfolio';
import type { BalanceReader } from '../core/watchOnlyAuthority';
import { formatBaseUnits } from '../core/amounts';
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeSmartAccountOperation } from '../smartAccount/operation';
import type { NativeSendContext } from '../custody/networkContext';
import { NativeSendInput, nativeTransferFailure } from './NativeSend';
import { NativeSmartAccountOperationScreen } from './NativeSmartAccountOperation';
import { Button, colors, Header, Notice, Screen, styles, Text } from '../ui';

export function NativeSmartAccountSend({
  open,
  context,
  accountLabel,
  source,
  reader,
  onBack,
}: {
  open(
    recipient: string,
    amount: string,
    assertCurrent: () => void
  ): Promise<NativeSmartAccountOperation>;
  context: NativeSendContext;
  accountLabel: string;
  source: PublicCustodySource;
  reader: BalanceReader;
  onBack(): void;
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
  useLayoutEffect(() => portfolio.connect(), [portfolio]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [controller, setController] =
    useState<NativeSmartAccountOperation | null>(null);
  const owner = useRef({
    active: true,
    operation: null as NativeSmartAccountOperation | null,
    busy: false,
  });
  useEffect(() => {
    const current = owner.current;
    current.active = true;
    return () => {
      current.active = false;
      current.operation?.dispose();
    };
  }, []);
  const review = async () => {
    const current = owner.current;
    if (!current.active || current.busy) return;
    current.busy = true;
    setBusy(true);
    setError('');
    const check = () => {
      if (!current.active) throw new Error('SMART_OPERATION_EXPIRED');
    };
    try {
      const operation = await open(recipient, amount, check);
      if (!current.active) {
        operation.dispose();
        return;
      }
      current.operation = operation;
      setController(operation);
    } catch (error) {
      if (current.active)
        setError(nativeTransferFailure(error, context, 'coin', false, false));
    } finally {
      current.busy = false;
      if (current.active) setBusy(false);
    }
  };
  if (controller)
    return (
      <NativeSmartAccountOperationScreen
        controller={controller}
        onBack={onBack}
      />
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen>
          <Header title="Send" onBack={onBack} />
          <Text style={styles.muted}>
            {accountLabel} · {context.name}
          </Text>
          <Text style={styles.muted}>
            {balance.status === 'available' && balance.units !== null
              ? `Balance ${formatBaseUnits(balance.units, context.decimals)} ${
                  context.symbol
                }`
              : balance.status === 'loading'
              ? 'Loading balance…'
              : 'Balance unavailable'}
          </Text>
          <NativeSendInput
            label="Recipient address"
            value={recipient}
            onChange={setRecipient}
            busy={busy}
            placeholder="0x…"
          />
          <NativeSendInput
            label={`Amount (${context.symbol})`}
            value={amount}
            onChange={setAmount}
            busy={busy}
            keyboardType="decimal-pad"
          />
          {error ? (
            <Notice title="Check transfer" body={error} tone="amber" />
          ) : null}
          {busy ? <ActivityIndicator color={colors.pink} /> : null}
          <Button
            title="Review transfer"
            disabled={busy || !recipient || !amount}
            onPress={() => void review()}
          />
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
