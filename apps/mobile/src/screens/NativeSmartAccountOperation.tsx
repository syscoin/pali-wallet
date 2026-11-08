import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatBaseUnits } from '../core/amounts';
import { getNativeSendContext } from '../custody/networkContext';
import type { NativeSmartAccountOperation } from '../smartAccount/operation';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';

export function NativeSmartAccountOperationRoute({
  open,
  onBack,
}: {
  open(assertCurrent: () => void): Promise<NativeSmartAccountOperation>;
  onBack(): void;
}) {
  const [controller, setController] =
    useState<NativeSmartAccountOperation | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let current: NativeSmartAccountOperation | undefined;
    const check = () => {
      if (!alive) throw new Error('DEPLOYMENT_EXPIRED');
    };
    void open(check).then(
      (value) => {
        current = value;
        if (alive) setController(value);
        else value.dispose();
      },
      () => {
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
      current?.dispose();
    };
  }, [open]);
  if (controller)
    return (
      <NativeSmartAccountOperationScreen
        controller={controller}
        onBack={onBack}
      />
    );
  return (
    <SafeAreaView style={s.safe}>
      <Screen>
        <Header title="Deploy smart account" onBack={onBack} />
        {failed ? (
          <Notice
            title="Deployment unavailable"
            body="Return to your account and try again."
          />
        ) : (
          <ActivityIndicator color={colors.pink} />
        )}
        <Button title="Close" variant="quiet" onPress={onBack} />
      </Screen>
    </SafeAreaView>
  );
}

export function NativeSmartAccountOperationScreen({
  controller,
  onBack,
}: {
  controller: NativeSmartAccountOperation;
  onBack(): void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [details, setDetails] = useState(false);
  const network = getNativeSendContext(state.network);
  const amount = (units: string) => {
    const value = formatBaseUnits(units, network.decimals);
    return (
      <View
        style={s.amount}
        accessible
        accessibilityLabel={`${value} ${network.symbol}`}
      >
        <Text selectable style={[s.value, value.length > 18 && s.preciseValue]}>
          {value}
        </Text>
        <Text style={s.unit}>{network.symbol}</Text>
      </View>
    );
  };
  useEffect(() => {
    void controller.prepare();
    return () => controller.dispose();
  }, [controller]);
  const payer = state.payerReview;
  const transfer =
    state.intent.kind === 'native-transfer' ? state.intent : null;
  const waiting = ['preparing', 'preparing-fee', 'waiting'].includes(
    state.phase
  );
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <Screen>
        <Header
          title={
            state.phase === 'authorize'
              ? transfer
                ? 'Review transfer'
                : 'Authorize deployment'
              : payer?.purpose === 'fund-account'
              ? 'Fund smart account'
              : transfer
              ? 'Send'
              : 'Deploy smart account'
          }
          onBack={onBack}
        />
        <Card style={s.card}>
          <Text style={s.label}>{network.name}</Text>
          <Text selectable style={s.address}>
            {state.account}
          </Text>
          <Text style={s.label}>Chain ID {state.network.chainId}</Text>
        </Card>
        {transfer && (
          <Card style={s.card}>
            <Text style={s.label}>To</Text>
            <Text selectable style={s.address}>
              {transfer.recipient}
            </Text>
            <Text style={s.label}>Amount</Text>
            {amount(transfer.amountUnits)}
          </Card>
        )}
        {state.phase === 'authorize' && (
          <>
            <Notice
              title={
                transfer
                  ? 'Authorize this transfer'
                  : 'Create this account on the network'
              }
              body={
                transfer
                  ? 'Authorize this smart account transfer. The following review confirms the paying account and submission fee.'
                  : 'Authorize the account’s deployment. This operation sends no assets. The following review confirms the wallet account and network fee used to submit it.'
              }
            />
            <Card style={s.card}>
              <Text style={s.label}>Maximum account charge</Text>
              {amount(state.maximumPrefundUnits!)}
              <Text style={s.label}>
                Unused prefund stays with your account.
              </Text>
              <Button
                title={
                  details
                    ? 'Hide authorization details'
                    : 'View authorization details'
                }
                variant="quiet"
                expanded={details}
                onPress={() => setDetails(!details)}
              />
              {details && (
                <>
                  <Text style={s.label}>User operation nonce</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.nonce}
                  </Text>
                  <Text style={s.label}>EntryPoint</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.entryPoint}
                  </Text>
                  <Text style={s.label}>Account creation data</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.initCode}
                  </Text>
                  <Text style={s.label}>Account call data</Text>
                  <Text selectable style={s.address}>
                    {state.authorization?.callData}
                  </Text>
                  <Text style={s.label}>Authorization hash</Text>
                  <Text selectable style={s.address}>
                    {state.userOperationHash}
                  </Text>
                </>
              )}
            </Card>
            <Button
              title={transfer ? 'Authorize transfer' : 'Authorize deployment'}
              onPress={() => void controller.authorize(state.revision)}
            />
          </>
        )}
        {payer && (
          <>
            <Notice
              title={
                payer.purpose === 'fund-account'
                  ? 'Fund the account charge'
                  : transfer
                  ? 'Submit the authorized transfer'
                  : 'Submit the authorized deployment'
              }
              body={
                payer.purpose === 'fund-account'
                  ? 'Move this amount to your smart account so it can cover its network charge.'
                  : transfer
                  ? 'This transaction submits the transfer you authorized.'
                  : 'This transaction submits your existing deployment authorization.'
              }
            />
            <Card style={s.card}>
              <Text style={s.label}>Paying account</Text>
              <Text selectable style={s.address}>
                {payer.transaction.from}
              </Text>
              <Text style={s.label}>Amount</Text>
              {amount(payer.transaction.value)}
              <Text style={s.label}>Maximum network fee</Text>
              {amount(payer.maximumFeeUnits)}
              <Text style={s.label}>Maximum total</Text>
              {amount(payer.maximumTotalUnits)}
            </Card>
            <Button
              title={
                payer.purpose === 'fund-account'
                  ? 'Confirm funding'
                  : transfer
                  ? 'Confirm transfer'
                  : 'Confirm deployment'
              }
              onPress={() => controller.confirmPayer(payer.id)}
            />
          </>
        )}
        {waiting && (
          <View style={s.progress}>
            <ActivityIndicator color={colors.pink} />
            <Text>
              {state.phase === 'waiting'
                ? 'Waiting for the network…'
                : transfer
                ? 'Preparing transfer…'
                : 'Preparing deployment…'}
            </Text>
          </View>
        )}
        {state.phase === 'complete' && (
          <Notice
            title={transfer ? 'Transfer submitted' : 'Smart account deployed'}
            body={
              transfer
                ? 'Follow this transaction in Activity.'
                : 'Your account is available on this network.'
            }
          />
        )}
        {state.error && (
          <Notice
            title={
              transfer ? 'Check transfer status' : 'Check deployment status'
            }
            body={state.error}
            tone="amber"
          />
        )}
        {state.transactionHash && (
          <Card style={s.card}>
            <Text style={s.label}>Latest transaction</Text>
            <Text selectable style={s.address}>
              {state.transactionHash}
            </Text>
          </Card>
        )}
        <Button title="Close" variant="quiet" onPress={onBack} />
      </Screen>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 20, gap: 10 },
  label: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  address: { color: colors.text, fontSize: 13, lineHeight: 20 },
  amount: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 6,
  },
  value: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '600',
    maxWidth: '100%',
  },
  preciseValue: { fontSize: 16, lineHeight: 24 },
  unit: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  progress: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 20,
  },
});
