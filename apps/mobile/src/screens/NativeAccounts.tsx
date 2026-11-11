import type { TFunction } from 'i18next';
import { useNativeTranslation } from '../platform/localization';
import { IdleTextInput, IdlePressable } from './IdleActivityBoundary';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  NativeAccountRequest,
  NativeAccountView,
} from '../custody/accounts';
import {
  Button,
  Card,
  colors,
  Header,
  IconButton,
  Notice,
  Row,
  Screen,
  styles,
  Text,
} from '../ui';

type Form = {
  accountType?: 'HDAccount' | 'Imported' | 'SmartAccount' | 'Ledger' | 'Trezor';
  kind: 'create' | 'create-smart' | 'rename' | 'remove';
  id?: string;
  index?: number;
  label: string;
  address?: string;
  catalogueRevision: number;
  contextRevision: number;
};
type FormScope = {
  catalogue: NonNullable<ReturnType<NativeAccountView['getSnapshot']>>;
  contextRevision: number;
};
function failure(error: unknown, t: TFunction): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'BUSY')
    return t('mobile.accounts.busy');
  if (code === 'INVALID_CREDENTIAL')
    return t('mobile.accounts.invalidCredential');
  if (code === 'AUTH_THROTTLED')
    return t('mobile.accounts.throttled');
  if (code === 'INVALID_INPUT')
    return t('mobile.accounts.invalidInput');
  if (code === 'ACCOUNT_LIMIT')
    return t('mobile.accounts.limit');
  if (code === 'ACCOUNT_NOT_REMOVABLE')
    return t('mobile.accounts.notRemovable');
  if (code === 'PENDING_TRANSFER')
    return t('mobile.accounts.pendingTransfer');
  if (code === 'CANCELLED' || code === 'NOT_READY')
    return t('mobile.accounts.contextChanged');
  return t('mobile.accounts.failed');
}

/** Real native account UI; the controller alone owns derivation and persistence. */
export function NativeAccounts({
  controller,
  onBack,
  onImport,
  onLedger,
  onTrezor,
  networkLabel = 'EVM',
}: {
  controller: NativeAccountView;
  networkLabel?: string;
  onBack(): void;
  onImport?(): void;
  onLedger?(): void;
  onTrezor?(): void;
}) {
  const { t } = useNativeTranslation();
  const [form, setForm] = useState<Form | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removeAcknowledged, setRemoveAcknowledged] = useState(false);
  const working = useRef(false);
  const formScope = useRef<FormScope | null>(null);
  const operationScope = useRef<FormScope | null>(null);
  const lifetime = useRef({ alive: true, epoch: 0 });
  const latestBack = useRef(onBack);
  useLayoutEffect(() => {
    latestBack.current = onBack;
  }, [onBack]);
  const subscribe = useCallback(
    (listener: () => void) =>
      controller.subscribe(() => {
        const scope = operationScope.current ?? formScope.current;
        const current = controller.getSnapshot();
        const revision = controller.getContextRevision();
        const unchanged = scope && current === scope.catalogue && revision === scope.contextRevision;
        // The authority hides its catalogue while authenticating our request.
        // A refused credential then restores that exact, unmodified catalogue.
        const authenticating = scope && scope === operationScope.current &&
          revision === scope.contextRevision + 1 && (!current || current === scope.catalogue);
        if (!unchanged && !authenticating) {
          formScope.current = null;
          setForm(null);
          setAdding(false);
          setName('');
          setRemoveAcknowledged(false);
        }
        listener();
      }),
    [controller]
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const close = useCallback(() => {
    lifetime.current.epoch++;
    controller.cancel();
    Keyboard.dismiss();
    latestBack.current();
  }, [controller]);
  const back = useCallback(() => {
    if (form && !busy && !working.current) {
      formScope.current = null;
      setForm(null);
      setError('');
    } else close();
  }, [form, busy, close]);
  const navigationBack = useRef(back);
  useLayoutEffect(() => { navigationBack.current = back; }, [back]);
  useEffect(() => {
    const localLifetime = lifetime.current;
    localLifetime.alive = true;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      navigationBack.current();
      return true;
    });
    return () => {
      localLifetime.alive = false;
      localLifetime.epoch++;
      controller.cancel();
      listener.remove();
    };
  }, [controller, close]);
  const open = (value: Omit<Form, 'catalogueRevision' | 'contextRevision'>) => {
    if (!snapshot || working.current) return;
    setError('');
    setAdding(false);
    setName(value.label);
    setRemoveAcknowledged(false);
    formScope.current = { catalogue: snapshot, contextRevision: controller.getContextRevision() };
    setForm({
      ...value,
      catalogueRevision: snapshot.revision,
      contextRevision: controller.getContextRevision(),
    });
  };
  const run = async (
    request: NativeAccountRequest,
    contextRevision: number,
    catalogueRevision: number
  ) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    Keyboard.dismiss();
    const epoch = lifetime.current.epoch;
    const catalogue = controller.getSnapshot();
    const scope = catalogue && catalogue.revision === catalogueRevision && controller.getContextRevision() === contextRevision
      ? formScope.current ?? { catalogue, contextRevision } : null;
    operationScope.current = scope;
    try {
      await controller.execute(request, contextRevision, catalogueRevision);
      if (lifetime.current.alive && epoch === lifetime.current.epoch) {
        formScope.current = null;
        setForm(null);
        setName('');
      }
    } catch (cause) {
      if (lifetime.current.alive && epoch === lifetime.current.epoch) {
        // Renew only this unchanged draft after the authority has returned from
        // authentication. Never carry approval across a changed saved catalogue.
        if (scope && formScope.current === scope && controller.getSnapshot() === scope.catalogue &&
            controller.getContextRevision() === scope.contextRevision + 1) {
          const contextRevision = controller.getContextRevision();
          formScope.current = { ...scope, contextRevision };
          setForm(current => current && { ...current, contextRevision });
        }
        setError(failure(cause, t));
      }
    } finally {
      if (operationScope.current === scope) operationScope.current = null;
      working.current = false;
      if (lifetime.current.alive && epoch === lifetime.current.epoch) {
        setBusy(false);
      }
    }
  };
  const submit = () => {
    if (
      !form ||
      busy ||
      (form.kind === 'remove' &&
        form.accountType === 'Imported' &&
        !removeAcknowledged)
    )
      return;
    const request: NativeAccountRequest =
      form.kind === 'create' || form.kind === 'create-smart'
        ? { kind: form.kind, label: name.trim() }
        : form.kind === 'remove'
        ? { kind: 'remove', id: form.id! }
        : { kind: 'rename', id: form.id!, label: name.trim() };
    void run(request, form.contextRevision, form.catalogueRevision);
  };
  const field = (
    title: string,
    value: string,
    change: (text: string) => void
  ) => (
    <View style={s.field}>
      <Text style={s.label}>{title}</Text>
      <IdleTextInput
        accessibilityLabel={title}
        value={value}
        onChangeText={change}
        editable={!busy}
        maxLength={64}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        textContentType="none"
        importantForAutofill="noExcludeDescendants"
        style={s.input}
      />
    </View>
  );
  const title = !form
    ? t('mobile.accounts.title')
    : form.kind === 'create-smart'
    ? t('mobile.accounts.createSmartTitle')
    : form.kind === 'create'
    ? t('mobile.accounts.addTitle')
    : form.kind === 'remove'
    ? t('mobile.accounts.removeTitle')
    : t('mobile.accounts.renameTitle');
  if (!form && !busy && snapshot)
    return (
      <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
        <FlatList
          testID="native-accounts-list"
          data={snapshot.accounts}
          keyExtractor={(account) => account.id}
          extraData={snapshot.active.accountId}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.list}
          ListHeaderComponent={
            <View style={s.listHeader}>
              <Header
                title={title}
                subtitle={t('mobile.accounts.subtitle', { network: networkLabel })}
                onBack={close}
                right={<IconButton label={t('buttons.addAccount')} icon="plus" onPress={() => setAdding(value => !value)} selected={adding} />}
              />
              <Text style={styles.muted}>
                {t('mobile.accounts.choose')}</Text>
              {adding && <Card>
                <Row title={t('mobile.accounts.create')} icon="plus" onPress={() => open({ kind: 'create', label: '' })} dense />
                {controller.supportsSmartAccounts?.() && <Row title={t('mobile.accounts.createSmart')} icon="wallet" onPress={() => open({ kind: 'create-smart', label: '' })} dense />}
                {onLedger && <Row title={t('mobile.accounts.connectLedger')} icon="shield" onPress={onLedger} dense />}
                {onTrezor && <Row title={t('mobile.accounts.connectTrezor')} icon="shield" onPress={onTrezor} dense />}
                {onImport && <Row title={t('mobile.accounts.importKey')} icon="wallet" onPress={onImport} dense last />}
              </Card>}
              {!!error && (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={s.error}
                >
                  {error}
                </Text>
              )}
            </View>
          }
          renderItem={({ item: account }) => (
            <Card style={s.account}>
              <IdlePressable
                style={s.accountContent}
                accessibilityRole="button"
                accessibilityLabel={t('mobile.accounts.select', { name: account.label })}
                onPress={() => {
                  if (account.id !== snapshot.active.accountId)
                    void run(
                      { kind: 'select', id: account.id },
                      controller.getContextRevision(),
                      snapshot.revision
                    );
                }}
              >
                <View style={s.row}>
                  <Text style={s.name}>{account.label}</Text>
                  {account.id === snapshot.active.accountId && (
                    <Text style={s.selected}>{t('mobile.accounts.selected')}</Text>
                  )}
                </View>
                <Text style={s.kind}>
                  {account.type === 'Imported' ? t('mobile.accounts.imported')
                    : account.type === 'SmartAccount' ? t('mobile.accounts.smart')
                    : account.type === 'Ledger' ? t('mobile.accounts.ledger') : account.type === 'Trezor' ? 'Trezor' : t('mobile.accounts.phrase')}
                </Text>
                <Text accessibilityLabel={account.address} style={[s.address, s.listAddress]}>
                  {account.address.length > 20 ? `${account.address.slice(0, 10)}…${account.address.slice(-6)}` : account.address}
                </Text>
              </IdlePressable>
              <View style={s.actions}>
                <IconButton
                  label={`${t('mobile.accounts.rename')} ${account.label}`}
                  icon="edit"
                  onPress={() =>
                    open({
                      kind: 'rename',
                      id: account.id,
                      label: account.label,
                      address: account.address,
                    })
                  }
                />
                {(account.type !== 'HDAccount' || account.index !== 0) &&
                  account.id !== snapshot.active.accountId && (
                    <IconButton
                      label={`${t('buttons.remove')} ${account.label}`}
                      icon="trash"
                      onPress={() =>
                        open({
                          kind: 'remove',
                          id: account.id,
                          label: account.label,
                          address: account.address,
                          accountType: account.type,
                        })
                      }
                    />
                  )}
              </View>
            </Card>
          )}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          ListFooterComponent={
            typeof __DEV__ !== 'undefined' && __DEV__ ? <Text style={s.buildLabel}>
              {t('mobile.common.development')}</Text> : undefined
          }
        />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.safeArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen
          footer={
            form ? (
              <Button
                title={
                  form.kind === 'create-smart' ? t('mobile.accounts.createSmart')
                    : form.kind === 'create' ? t('mobile.accounts.create')
                    : form.kind === 'remove'
                    ? t('mobile.accounts.removeDevice')
                    : t('mobile.accounts.saveName')
                }
                disabled={
                  busy ||
                  (form.kind !== 'remove' && !name.trim()) ||
                  (form.kind === 'remove' &&
                    form.accountType === 'Imported' &&
                    !removeAcknowledged)
                }
                onPress={submit}
              />
            ) : undefined
          }
        >
          <Header
            title={title}
            subtitle={t('mobile.accounts.subtitle', { network: networkLabel })}
            onBack={back}
          />
          {busy ? (
            <Notice
              title={t('mobile.accounts.saving')}
              body={t('mobile.accounts.savingBody')}
            />
          ) : !snapshot ? (
            <Notice
              title={t('mobile.accounts.locked')}
              body={t('mobile.accounts.unlock')}
            />
          ) : form ? (
            <>
              {!!form.address && (
                <Card style={s.identity}>
                  <Text style={s.name}>{form.label}</Text>
                  <Text selectable style={s.address}>
                    {form.address}
                  </Text>
                </Card>
              )}
              {form.kind === 'remove' ? (
                <>
                  <Notice
                    title={t('mobile.accounts.fundsRemain')}
                    body={
                      form.accountType === 'Ledger' || form.accountType === 'Trezor' ? t('mobile.accounts.removeHardware', { device: form.accountType })
                        : form.accountType === 'SmartAccount' ? t('mobile.accounts.removeSmart')
                        : form.accountType === 'Imported'
                        ? t('mobile.accounts.removeImported')
                        : t('mobile.accounts.removeDerived')
                    }
                    tone="amber"
                  />
                  {form.accountType === 'Imported' && (
                    <IdlePressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={t('mobile.accounts.backupAcknowledgement')}
                      accessibilityState={{ checked: removeAcknowledged }}
                      aria-checked={removeAcknowledged}
                      onPress={() => setRemoveAcknowledged((value) => !value)}
                      style={s.acknowledgement}
                    >
                      <Text>
                        {removeAcknowledged ? '✓' : '□'} {t('mobile.accounts.backupAcknowledgementBody')}
                      </Text>
                    </IdlePressable>
                  )}
                </>
              ) : (
                <>
                  {field(t('mobile.accounts.accountName'), name, setName)}
                  {form.kind !== 'rename' && (
                    <Notice
                      title={form.kind === 'create-smart' ? t('mobile.accounts.managed') : t('mobile.accounts.derived')}
                      body={form.kind === 'create-smart' ? t('mobile.accounts.smartBody') : t('mobile.accounts.derivedBody')}
                    />
                  )}
                </>
              )}
            </>
          ) : null}
          {!!error && (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={s.error}
            >
              {error}
            </Text>
          )}
          {typeof __DEV__ !== 'undefined' && __DEV__ && <Text style={s.buildLabel}>
            {t('mobile.common.development')}</Text>}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 26 },
  listHeader: { gap: 14, paddingBottom: 16 },
  separator: { height: 10 },
  field: { gap: 10 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
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
  account: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  accountContent: { flex: 1, minWidth: 0, minHeight: 64, justifyContent: 'center' },
  identity: { padding: 18, gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  name: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  selected: { color: colors.green, fontSize: 12 },
  kind: { color: colors.muted, fontSize: 12, lineHeight: 20, marginTop: 6 },
  acknowledgement: { paddingVertical: 12 },
  address: { fontSize: 13, lineHeight: 22, color: colors.muted, marginTop: 10 },
  listAddress: { marginTop: 4 },
  actions: { flexDirection: 'column', alignItems: 'center' },
  section: { fontSize: 20, fontWeight: '600' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
  buildLabel: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
