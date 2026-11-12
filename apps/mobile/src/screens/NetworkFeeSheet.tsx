import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeDecimalInput } from '../../../../source/shared/decimalInput';
import {
  AUTOMATIC_FEE,
  chooseEvmFees,
  chooseUtxoFeeRate,
  feeGweiUnits,
  snapshotEvmFeeChoice,
  snapshotUtxoFeeChoice,
  utxoFeeRateUnits,
  type EvmFeeChoice,
  type EvmFeeRates,
  type FeePriority,
  type UtxoFeeChoice,
} from '../../../../source/shared/transactionFeeChoice';
import { formatBaseUnits } from '../core/amounts';
import { useNativeTranslation } from '../platform/localization';
import { Button, Card, colors, Icon, IconButton, styles, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

type Props = Readonly<{ onClose(): void; allowGasLimit?: boolean }> &
  (
    | Readonly<{
        mode: 'evm';
        choice: EvmFeeChoice;
        load(signal: AbortSignal): Promise<EvmFeeRates>;
        onApply(choice: EvmFeeChoice): void;
      }>
    | Readonly<{
        mode: 'utxo';
        choice: UtxoFeeChoice;
        load(signal: AbortSignal): Promise<string>;
        onApply(choice: UtxoFeeChoice): void;
      }>
  );
export function NetworkFeeSheet(props: Props) {
  const { t, i18n } = useNativeTranslation();
  const active = useRef(true);
  const close = () => {
    if (!active.current) return;
    active.current = false;
    props.onClose();
  };
  const [kind, setKind] = useState<FeePriority | 'custom'>(props.choice.kind);
  const initial =
    props.mode === 'evm' && props.choice.kind === 'custom'
      ? props.choice
      : null;
  const [price, setPrice] = useState(
    initial
      ? formatBaseUnits(
          initial.type === 0 ? initial.gasPrice : initial.maxFeePerGas,
          9
        )
      : props.mode === 'utxo' && props.choice.kind === 'custom'
      ? props.choice.satPerVbyte
      : ''
  );
  const [tip, setTip] = useState(
    initial?.type === 2 ? formatBaseUnits(initial.maxPriorityFeePerGas, 9) : ''
  );
  const [gas, setGas] = useState(initial?.gasLimit ?? '');
  const [rates, setRates] = useState<EvmFeeRates | string | null>(null);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState<'load' | 'input' | null>(null);
  useEffect(() => {
    active.current = true;
    let current = true;
    const request = new AbortController();
    const load = async (): Promise<EvmFeeRates | string> =>
      props.load(request.signal);
    void load()
      .then((value) => {
        if (!current) return;
        setRates(value);
        if (props.choice.kind !== 'custom') {
          setPrice(
            typeof value === 'string'
              ? value
              : formatBaseUnits(
                  value.type === 0 ? value.gasPrice : value.maxFeePerGas,
                  9
                )
          );
          if (typeof value !== 'string' && value.type === 2)
            setTip(formatBaseUnits(value.maxPriorityFeePerGas, 9));
        }
      })
      .catch(() => {
        if (current) setError('load');
      })
      .finally(() => {
        if (current) setLoaded(true);
      });
    return () => {
      current = false;
      active.current = false;
      request.abort();
    };
    // One request belongs to this mounted sheet; the parent keys it by account/network.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const custom = kind === 'custom';
  const evm = typeof rates === 'object' ? rates : null;
  const priceLabel = (priority: FeePriority) => {
    if (!rates) return '—';
    try {
      if (typeof rates === 'string') {
        const selected = chooseUtxoFeeRate(Number(rates) / 1e8, {
          kind: priority,
        });
        return `${
          selected === undefined ? rates : utxoFeeRateUnits(selected)
        } sat/vB`;
      }
      const selected = chooseEvmFees(rates, { kind: priority });
      return `${formatBaseUnits(
        selected.type === 0 ? selected.gasPrice : selected.maxFeePerGas,
        9
      )} Gwei`;
    } catch {
      return '—';
    }
  };
  const field = (
    label: string,
    value: string,
    update: (value: string) => void,
    integer = false
  ) => (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <IdleTextInput
        accessibilityLabel={label}
        value={value}
        keyboardType={integer ? 'number-pad' : 'decimal-pad'}
        onChangeText={(value) => {
          setError(null);
          update(
            integer
              ? value
              : normalizeDecimalInput(value, i18n.resolvedLanguage ?? 'en')
          );
        }}
        autoComplete="off"
        maxLength={80}
        style={s.input}
      />
    </View>
  );
  const apply = () => {
    if (!active.current) return;
    try {
      if (kind !== 'custom') {
        const choice =
          kind === 'automatic' ? AUTOMATIC_FEE : Object.freeze({ kind });
        active.current = false;
        if (props.mode === 'evm') props.onApply(choice);
        else props.onApply(choice);
      } else if (props.mode === 'utxo') {
        const choice = snapshotUtxoFeeChoice({ kind, satPerVbyte: price });
        active.current = false;
        props.onApply(choice);
      } else {
        if (!evm) throw new Error('Unavailable');
        const selected =
          evm.type === 0
            ? { kind, type: 0 as const, gasPrice: feeGweiUnits(price) }
            : {
                kind,
                type: 2 as const,
                maxFeePerGas: feeGweiUnits(price),
                maxPriorityFeePerGas: feeGweiUnits(tip, true),
              };
        const choice = snapshotEvmFeeChoice({
          ...selected,
          ...(gas === '' || props.allowGasLimit === false
            ? {}
            : { gasLimit: gas }),
        });
        active.current = false;
        props.onApply(choice);
      }
    } catch {
      setError('input');
    }
  };
  return (
    <Modal transparent animationType="slide" visible onRequestClose={close}>
      <SafeAreaView style={s.overlay} accessibilityViewIsModal>
        <KeyboardAvoidingView
          style={s.keyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Card style={s.sheet}>
            <View style={s.heading}>
              <Icon name="settings" color={colors.blue} />
              <Text accessibilityRole="header" style={s.title}>
                {t('send.networkFee')}
              </Text>
              <IconButton
                icon="close"
                label={t('buttons.close')}
                onPress={close}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.content}
            >
              <Text style={styles.muted}>
                {t('mobile.feeChoice.automaticHint')}
              </Text>
              <Button
                title={t('mobile.sendAssetViews.evm.automatic')}
                variant={kind === 'automatic' ? 'primary' : 'secondary'}
                onPress={() => {
                  setKind('automatic');
                  setError(null);
                }}
              />
              <Text style={s.rate}>{priceLabel('automatic')}</Text>
              <View style={s.priorities}>
                {(['low', 'medium', 'high'] as const).map((value) => (
                  <View key={value} style={s.priority}>
                    <Button
                      title={t(`send.${value}`)}
                      size="compact"
                      style={{ paddingHorizontal: 4 }}
                      variant={kind === value ? 'primary' : 'secondary'}
                      disabled={!loaded || !rates}
                      onPress={() => {
                        setKind(value);
                        setError(null);
                      }}
                    />
                    <Text style={s.rate}>{priceLabel(value)}</Text>
                  </View>
                ))}
              </View>
              <Button
                title={t('mobile.feeChoice.custom')}
                variant={custom ? 'primary' : 'secondary'}
                disabled={props.mode === 'evm' && !evm}
                onPress={() => {
                  setKind('custom');
                  setError(null);
                }}
              />
              {custom && (
                <>
                  {field(
                    props.mode === 'utxo'
                      ? t('mobile.feeChoice.satPerVbyte')
                      : evm?.type === 0
                      ? t('mobile.feeChoice.gasPrice')
                      : t('mobile.feeChoice.maximumPrice'),
                    price,
                    setPrice,
                    props.mode === 'utxo'
                  )}
                  {props.mode === 'evm' &&
                    evm?.type === 2 &&
                    field(t('mobile.feeChoice.priorityPrice'), tip, setTip)}
                  {props.mode === 'evm' &&
                    props.allowGasLimit !== false &&
                    field(t('send.gasLimit'), gas, setGas, true)}
                  {(props.mode === 'utxo' || props.allowGasLimit !== false) && (
                    <Text style={styles.muted}>
                      {t(
                        props.mode === 'evm'
                          ? 'mobile.feeChoice.gasHint'
                          : 'mobile.feeChoice.rateHint'
                      )}
                    </Text>
                  )}
                </>
              )}
              {!loaded && (
                <Text accessibilityLiveRegion="polite" style={styles.muted}>
                  {t('mobile.feeChoice.loading')}
                </Text>
              )}
              {error && (
                <Text accessibilityRole="alert" style={s.error}>
                  {t(
                    error === 'input'
                      ? 'mobile.feeChoice.invalid'
                      : 'mobile.feeChoice.unavailable'
                  )}
                </Text>
              )}
              <Button
                title={t('mobile.feeChoice.apply')}
                onPress={apply}
                disabled={
                  kind === 'custom'
                    ? props.mode === 'evm' && !evm
                    : kind !== 'automatic' && !rates
                }
              />
            </ScrollView>
          </Card>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    margin: 12,
    padding: 20,
    borderRadius: 24,
    gap: 16,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 21, fontWeight: '700' },
  content: { gap: 14, paddingBottom: 4 },
  priorities: { flexDirection: 'row', gap: 8 },
  priority: { flex: 1, gap: 5 },
  rate: { textAlign: 'center', color: colors.muted, fontSize: 11 },
  field: { gap: 8 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  input: {
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    padding: 14,
    borderRadius: 14,
    fontSize: 16,
  },
  error: { color: colors.red },
});
