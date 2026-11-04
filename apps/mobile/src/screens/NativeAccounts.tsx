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
  Notice,
  Screen,
  styles,
  Text,
} from '../ui';

type Form = {
  accountType?: 'HDAccount' | 'Imported';
  kind: 'create' | 'rename' | 'remove';
  id?: string;
  index?: number;
  label: string;
  address?: string;
  catalogueRevision: number;
  contextRevision: number;
};
function failure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'BUSY')
    return 'Wait for the current wallet operation to finish.';
  if (code === 'INVALID_CREDENTIAL')
    return 'That password is incorrect. Unlock your wallet to try again.';
  if (code === 'AUTH_THROTTLED')
    return 'Too many incorrect passwords. Wait a few minutes before trying again.';
  if (code === 'INVALID_INPUT')
    return 'Enter a name of up to 64 characters and your wallet password.';
  if (code === 'ACCOUNT_LIMIT')
    return 'There is not enough protected storage for this account.';
  if (code === 'ACCOUNT_NOT_REMOVABLE')
    return 'Select another account before removing this one. Account 1 must remain on this device.';
  if (code === 'PENDING_TRANSFER')
    return 'This account has an unresolved transfer. Check its transaction status before removing it.';
  if (code === 'CANCELLED' || code === 'NOT_READY')
    return 'Your wallet context changed. Unlock it and try again.';
  return 'The account change could not be completed. Your saved wallet has been preserved.';
}

/** Real native account UI; the controller alone owns derivation and persistence. */
export function NativeAccounts({
  controller,
  onBack,
  onImport,
}: {
  controller: NativeAccountView;
  onBack(): void;
  onImport?(): void;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removeAcknowledged, setRemoveAcknowledged] = useState(false);
  const working = useRef(false);
  const lifetime = useRef({ alive: true, epoch: 0 });
  const latestBack = useRef(onBack);
  useLayoutEffect(() => {
    latestBack.current = onBack;
  }, [onBack]);
  const subscribe = useCallback(
    (listener: () => void) =>
      controller.subscribe(() => {
        setPassword('');
        setForm(null);
        setName('');
        setRemoveAcknowledged(false);
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
    setPassword('');
    latestBack.current();
  }, [controller]);
  useEffect(() => {
    const localLifetime = lifetime.current;
    localLifetime.alive = true;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
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
    setPassword('');
    setName(value.label);
    setRemoveAcknowledged(false);
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
    setPassword('');
    Keyboard.dismiss();
    const epoch = lifetime.current.epoch;
    try {
      await controller.execute(request, contextRevision, catalogueRevision);
      if (lifetime.current.alive && epoch === lifetime.current.epoch) {
        setForm(null);
        setName('');
      }
    } catch (cause) {
      if (lifetime.current.alive && epoch === lifetime.current.epoch)
        setError(failure(cause));
    } finally {
      working.current = false;
      if (lifetime.current.alive && epoch === lifetime.current.epoch) {
        setBusy(false);
        setPassword('');
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
    let entered = password;
    const request: NativeAccountRequest =
      form.kind === 'create'
        ? { kind: 'create', label: name.trim(), password: entered }
        : form.kind === 'remove'
        ? { kind: 'remove', id: form.id!, password: entered }
        : { kind: 'rename', id: form.id!, label: name.trim() };
    void run(request, form.contextRevision, form.catalogueRevision).finally(
      () => {
        entered = '';
      }
    );
  };
  const field = (
    title: string,
    value: string,
    change: (text: string) => void,
    secret = false
  ) => (
    <View style={s.field}>
      <Text style={s.label}>{title}</Text>
      <IdleTextInput
        accessibilityLabel={title}
        value={value}
        onChangeText={change}
        editable={!busy}
        maxLength={secret ? 1024 : 64}
        secureTextEntry={secret}
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
  const needsPassword = form && form.kind !== 'rename';
  const title = !form
    ? 'Accounts'
    : form.kind === 'create'
    ? 'Add an account'
    : form.kind === 'remove'
    ? 'Remove account'
    : 'Rename account';
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
                subtitle="EVM · Wallet accounts"
                onBack={close}
              />
              <Text style={styles.muted}>
                Choose the account you want to use. Recovery phrase accounts and
                imported-key accounts have separate backups.
              </Text>
              <Button
                title="Add account"
                onPress={() => open({ kind: 'create', label: '' })}
              />
              {onImport && (
                <Button
                  title="Import private key"
                  variant="secondary"
                  onPress={onImport}
                />
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
            </View>
          }
          renderItem={({ item: account }) => (
            <Card style={s.account}>
              <IdlePressable
                accessibilityRole="button"
                accessibilityLabel={`Select ${account.label}`}
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
                    <Text style={s.selected}>Selected</Text>
                  )}
                </View>
                <Text style={s.kind}>
                  {account.type === 'Imported'
                    ? 'Imported key · Separate backup'
                    : 'Recovery phrase account'}
                </Text>
                <Text selectable style={s.address}>
                  {account.address}
                </Text>
              </IdlePressable>
              <View style={s.actions}>
                <Button
                  title="Rename"
                  variant="quiet"
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
                    <Button
                      title="Remove"
                      variant="quiet"
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
            <Text style={s.buildLabel}>
              Development build · Use a test wallet
            </Text>
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
                  form.kind === 'create'
                    ? 'Create account'
                    : form.kind === 'remove'
                    ? 'Remove from this device'
                    : 'Save name'
                }
                disabled={
                  busy ||
                  (form.kind !== 'remove' && !name.trim()) ||
                  (!!needsPassword && !password) ||
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
            subtitle="EVM · Wallet accounts"
            onBack={() => {
              if (form && !busy) {
                setForm(null);
                setPassword('');
                setError('');
              } else close();
            }}
          />
          {busy ? (
            <Notice
              title="Saving account change…"
              body="Keep Pali open while your wallet completes this request."
            />
          ) : !snapshot ? (
            <Notice
              title="Wallet locked"
              body="Unlock your wallet to manage its accounts."
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
                    title="Your funds stay at this address"
                    body={
                      form.accountType === 'Imported'
                        ? 'Removing this account removes its saved key from this wallet. Your recovery phrase cannot restore it. Keep the original key backed up separately. This does not move funds or cancel transactions.'
                        : 'Removing this account removes its local record. Add account reuses the next available recovery-phrase account. This does not move funds or cancel transactions.'
                    }
                    tone="amber"
                  />
                  {form.accountType === 'Imported' && (
                    <IdlePressable
                      accessibilityRole="checkbox"
                      accessibilityLabel="I have the original private key backed up"
                      accessibilityState={{ checked: removeAcknowledged }}
                      aria-checked={removeAcknowledged}
                      onPress={() => setRemoveAcknowledged((value) => !value)}
                      style={s.acknowledgement}
                    >
                      <Text>
                        {removeAcknowledged ? '✓' : '□'} I have the original
                        private key backed up.
                      </Text>
                    </IdlePressable>
                  )}
                </>
              ) : (
                <>
                  {field('Account name', name, setName)}
                  {form.kind !== 'rename' && (
                    <Notice
                      title="One recovery phrase, another address"
                      body="This account is derived from your existing recovery phrase. Keep that phrase backed up offline."
                    />
                  )}
                </>
              )}
              {needsPassword &&
                field('Confirm wallet password', password, setPassword, true)}
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
  list: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 26 },
  listHeader: { gap: 22, paddingBottom: 22 },
  separator: { height: 16 },
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
  account: { padding: 18, gap: 8 },
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
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  section: { fontSize: 20, fontWeight: '600' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
  buildLabel: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
