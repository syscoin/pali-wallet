import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatBaseUnits } from '../core/amounts';
import { getNativeSendContext } from '../custody/networkContext';
import type { NativeSmartAccountDeployment } from '../smartAccount/deployment';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';

export function NativeSmartAccountDeploymentRoute({
  open,
  onBack,
}: {
  open(assertCurrent: () => void): Promise<NativeSmartAccountDeployment>;
  onBack(): void;
}) {
  const [controller, setController] =
    useState<NativeSmartAccountDeployment | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let current: NativeSmartAccountDeployment | undefined;
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
      <NativeSmartAccountDeploymentScreen
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

export function NativeSmartAccountDeploymentScreen({
  controller,
  onBack,
}: {
  controller: NativeSmartAccountDeployment;
  onBack(): void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [details, setDetails] = useState(false);
  const network = getNativeSendContext(state.network);
  const amount = (value: string) =>
    `${formatBaseUnits(value, network.decimals)} ${network.symbol}`;
  useEffect(() => {
    void controller.prepare();
    return () => controller.dispose();
  }, [controller]);
  const payer = state.payerReview;
  const waiting = ['preparing', 'preparing-fee', 'waiting'].includes(
    state.phase
  );
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <Screen>
        <Header
          title={
            state.phase === 'authorize'
              ? 'Authorize deployment'
              : payer?.purpose === 'fund-account'
              ? 'Fund smart account'
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
        {state.phase === 'authorize' && (
          <>
            <Notice
              title="Create this account on the network"
              body="Authorize the account’s deployment. This operation sends no assets. The following review confirms the wallet account and network fee used to submit it."
            />
            <Card style={s.card}>
              <Text style={s.label}>Maximum account charge</Text>
              <Text style={s.value}>{amount(state.maximumPrefundUnits!)}</Text>
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
              title="Authorize deployment"
              onPress={() => void controller.authorize(state.revision)}
            />
          </>
        )}
        {payer && (
          <>
            <Notice
              title={
                payer.purpose === 'fund-account'
                  ? 'Fund the deployment charge'
                  : 'Submit the authorized deployment'
              }
              body={
                payer.purpose === 'fund-account'
                  ? 'Move this amount to your smart account so it can cover its network charge.'
                  : 'This transaction submits your existing deployment authorization.'
              }
            />
            <Card style={s.card}>
              <Text style={s.label}>Paying account</Text>
              <Text selectable style={s.address}>
                {payer.transaction.from}
              </Text>
              <Text style={s.label}>Amount</Text>
              <Text style={s.value}>{amount(payer.transaction.value)}</Text>
              <Text style={s.label}>{payer.coveredFeeUnits !== '0' ? 'Maximum network fee · gas tank' : 'Maximum network fee'}</Text>
              <Text style={s.value}>{amount(payer.maximumFeeUnits)}</Text>
              <Text style={s.label}>{payer.coveredFeeUnits !== '0' ? 'Maximum from paying account' : 'Maximum total'}</Text>
              <Text style={s.value}>{amount(payer.maximumTotalUnits)}</Text>
            </Card>
            <Button
              title={
                payer.purpose === 'fund-account'
                  ? 'Confirm funding'
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
                : 'Preparing deployment…'}
            </Text>
          </View>
        )}
        {state.phase === 'complete' && (
          <Notice
            title="Smart account deployed"
            body="Your account is available on this network."
          />
        )}
        {state.error && (
          <Notice
            title="Check deployment status"
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
  value: { color: colors.text, fontSize: 19, fontWeight: '600' },
  progress: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 20,
  },
});
