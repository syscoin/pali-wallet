import { nativeI18n, useNativeTranslation } from '../platform/localization';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
import { NativeSentrySettings } from './NativeSentrySettings';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import {
  isAllowedSentryKeyRoleScheme,
  type SentryAuthorityScheme,
  type SentryKeySummary,
} from '../../../../source/wallet/sentryKeyVault';
import { containsSentryPrivateKey } from '../../../../source/utils/sentry/importBatch';
import type {
  NativeSentryKeyManagement,
  SentryKeyImportReview,
  SentryKeyRemovalReview,
} from '../custody/sentryKeyManagement';
import { Button, Card, colors, Header, Row, Screen, styles, Text } from '../ui';
import { IdlePressable, IdleTextInput } from './IdleActivityBoundary';
import { NoteBackupPasswordField } from './NoteBackupPasswordField';
const t = nativeI18n.t.bind(nativeI18n);

type Role = SentryKeySummary['role'];
type Key = Readonly<SentryKeySummary>;
type Step =
  | { kind: 'list' }
  | {
      kind: 'settings';
      manager: Pick<NativeSentryKeyManagement, 'getSettings' | 'saveSettings' | 'cancel' | 'isAuthenticating'>;
      assertCurrent(): void;
    }
  | { kind: 'draft'; multiple: boolean }
  | { kind: 'detail'; key: Key }
  | { kind: 'import'; review: SentryKeyImportReview }
  | { kind: 'remove'; review: SentryKeyRemovalReview };
type Owner = {
  lifetime: AbortController;
  step: Step;
  busy: boolean;
  manager?: NativeSentryKeyManagement;
};
type Props = {
  networkLabel: string;
  open(
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<NativeSentryKeyManagement>;
  onBack(): void;
};

const roleLabel = (): Record<Role, string> => ({
  owner: t('sentry.roles.owner'),
  operator: t('sentry.roles.operator'),
  voting: t('sentry.roles.voting'),
  collateral: t('sentry.roles.collateral'),
});
const schemeLabel = {
  'bls-basic': 'BLS Basic',
  'slh-dsa-shake-128s': 'SLH-DSA (SHAKE-128s)',
  secp256k1: 'secp256k1',
} satisfies Record<SentryAuthorityScheme, string>;
const roles: Role[] = ['owner', 'operator', 'voting', 'collateral'];
const schemes = Object.keys(schemeLabel) as SentryAuthorityScheme[];
const describe = ({ role, scheme }: Pick<Key, 'role' | 'scheme'>) =>
  `${roleLabel()[role]} · ${schemeLabel[scheme]}`;
const singleEntry = /^[^|\u0000-\u001f\u007f-\u009f]+$/u;

const errorCode = (cause: unknown) =>
  cause && typeof cause === 'object' && 'code' in cause
    ? cause.code
    : undefined;
function errorText(cause: unknown) {
  switch (errorCode(cause)) {
    case 'INVALID_INPUT':
      return t("mobile.sentryViews.checkThePrivateKeyAndSelectedKeyType");
    case 'DUPLICATE':
      return t("mobile.sentryViews.thisKeyIsAlreadySavedForThisRole");
    case 'INVALID_CREDENTIAL':
      return t("mobile.sentryViews.deviceAuthenticationWasNotCompletedStartANewReviewToTryAgain");
    case 'AUTH_THROTTLED':
      return t("mobile.sentryViews.tooManyAttemptsWaitBeforeTryingAgain");
    case 'CANCELLED':
      return t("mobile.sentryViews.reviewEndedStartANewReviewToContinue");
    case 'BUSY':
      return t("mobile.sentryViews.anotherWalletOperationIsFinishingTryAgainShortly");
    default:
      return t("mobile.sentryViews.couldNotCompleteTheActionCheckYourSavedKeysBeforeTryingAgain");
  }
}

function Choices<T extends string>({
  label,
  choices,
  selected,
  labels,
  disabled,
  onSelect,
}: {
  label: string;
  choices: readonly T[];
  selected: T;
  labels: Record<T, string>;
  disabled: boolean;
  onSelect(value: T): void;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.choices}>
        {choices.map((value) => (
          <IdlePressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === selected, disabled }}
            aria-checked={value === selected}
            disabled={disabled}
            onPress={() => onSelect(value)}
            style={[s.choice, value === selected && s.selected]}
          >
            <Text>{labels[value]}</Text>
          </IdlePressable>
        ))}
      </View>
    </View>
  );
}

function PublicKeyCard({
  value,
}: {
  value: Pick<Key, 'label' | 'role' | 'scheme' | 'publicKey'>;
}) {
  return (
    <Card style={s.keyCard}>
      <Text style={s.heading}>{value.label}</Text>
      <Text style={styles.muted}>{describe(value)}</Text>
      <Text selectable accessibilityLabel={t('mobile.sentryViews.publicKeyValue', { key: value.publicKey })}>
        {value.publicKey}
      </Text>
    </Card>
  );
}

/** This leaf never receives wallet seed, stored private keys or signing authority. */
export function NativeSentryKeys({ networkLabel, open, onBack }: Props) {
  useNativeTranslation();
  const ownerRef = useRef<Owner | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [keys, setKeys] = useState<readonly Key[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [active, setActive] = useState(false);
  const [role, setRole] = useState<Role>('operator');
  const [scheme, setScheme] = useState<SentryAuthorityScheme>('bls-basic');
  const [label, setLabel] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();

  const current = useCallback(
    (owner: Owner) =>
      ownerRef.current === owner &&
      !owner.lifetime.signal.aborted &&
      (AppState.currentState === 'active' ||
        (!!owner.manager && allowsPrivateAuthenticationInterruption(owner.manager, AppState.currentState))),
    []
  );
  const navigate = useCallback((owner: Owner, next: Step) => {
    owner.step = next;
    setStep(next);
  }, []);
  const clearFields = useCallback(() => {
    setLabel('');
    setPrivateKey('');
    setBackedUp(false);
    Keyboard.dismiss();
  }, []);
  const retire = useCallback((owner: Owner) => {
    if (ownerRef.current !== owner) return;
    ownerRef.current = null;
    owner.lifetime.abort();
    owner.manager?.dispose();
  }, []);
  const run = useCallback(
    async (
      action: (owner: Owner, check: () => void) => Promise<void>,
      onError?: (owner: Owner, cause: unknown) => string | void
    ) => {
      const owner = ownerRef.current;
      if (!owner || owner.busy || !current(owner)) return;
      owner.busy = true;
      setBusy(true);
      setNotice(undefined);
      const check = () => {
        if (!current(owner)) throw new Error('CANCELLED');
      };
      try {
        // Call the guarded action before yielding so its caller can drop form text.
        await action(owner, check);
      } catch (cause) {
        if (current(owner)) {
          const detail = onError?.(owner, cause);
          setNotice({ text: detail ?? errorText(cause), error: true });
        }
      } finally {
        owner.busy = false;
        if (current(owner)) setBusy(false);
      }
    },
    [current]
  );

  const load = useCallback(
    () =>
      run(async (owner, check) => {
        if (!owner.manager) {
          const manager = await open(owner.lifetime.signal, check);
          if (!current(owner)) manager.dispose();
          check();
          owner.manager = manager;
        }
        const result = await owner.manager.list();
        check();
        setKeys(result);
      }),
    [open, current, run]
  );

  useLayoutEffect(() => {
    const owner: Owner = {
      lifetime: new AbortController(),
      step: { kind: 'list' },
      busy: false,
    };
    ownerRef.current = owner;
    queueMicrotask(() => {
      if (!current(owner)) return;
      setActive(true);
      navigate(owner, owner.step);
      void load();
    });
    const hide = () => {
      retire(owner);
      setActive(false);
      clearFields();
      setKeys(null);
      setNotice(undefined);
      setBusy(false);
      setStep({ kind: 'list' });
    };
    const change = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && !(!!owner.manager && allowsPrivateAuthenticationInterruption(owner.manager, state))) hide();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => {
            if (owner.manager?.isAuthenticating() !== true) hide();
          })
        : null;
    return () => {
      retire(owner);
      change.remove();
      blur?.remove();
    };
  }, [load, navigate, retire, clearFields, current]);

  const editable = useCallback(() => {
    const owner = ownerRef.current;
    return owner && !owner.busy && owner.step === step && current(owner)
      ? owner
      : undefined;
  }, [current, step]);
  const back = useCallback(() => {
    const owner = ownerRef.current;
    clearFields();
    setNotice(undefined);
    if (owner && current(owner) && owner.step.kind !== 'list' && !owner.busy) {
      owner.manager?.cancel();
      navigate(owner, { kind: 'list' });
    } else {
      if (owner) retire(owner);
      onBack();
    }
  }, [clearFields, current, navigate, onBack, retire]);
  useLayoutEffect(() => {
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      if (ownerRef.current?.step.kind === 'settings') return false;
      back();
      return true;
    });
    return () => hardware.remove();
  }, [back]);

  const expiresAt =
    step.kind === 'import' || step.kind === 'remove'
      ? step.review.expiresAt
      : null;
  const expireReview = useCallback(
    (owner: Owner) => {
      owner.manager?.cancel();
      setBackedUp(false);
      Keyboard.dismiss();
      if (!owner.busy) {
        navigate(owner, { kind: 'list' });
        setNotice({ text: t("mobile.sentryViews.reviewExpiredStartAgainToContinue") });
      }
    },
    [navigate]
  );
  useLayoutEffect(() => {
    const owner = ownerRef.current;
    if (!owner || expiresAt === null) return;
    const timeout = setTimeout(() => {
      if (current(owner) && owner.step === step) expireReview(owner);
    }, Math.max(0, Math.ceil(expiresAt - performance.now())));
    return () => clearTimeout(timeout);
  }, [current, expireReview, expiresAt, step]);

  const startDraft = (multiple: boolean) => {
    const owner = editable();
    if (!owner) return;
    clearFields();
    setNotice(undefined);
    setRole('operator');
    setScheme('bls-basic');
    navigate(owner, { kind: 'draft', multiple });
  };
  const preview = () => {
    if (
      !editable() ||
      step.kind !== 'draft' ||
      step.multiple ||
      !label.trim() ||
      !privateKey
    )
      return;
    if (
      !singleEntry.test(label) ||
      !singleEntry.test(privateKey) ||
      !label.isWellFormed() ||
      containsSentryPrivateKey(label)
    ) {
      setNotice({
        text: t("mobile.sentryViews.enterOnePrivateKeyAndALabelWithoutAVerticalBar"),
        error: true,
      });
      return;
    }
    let draft = `${label.trim()} | ${privateKey}`;
    setPrivateKey('');
    Keyboard.dismiss();
    const work = run(async (owner, check) => {
      const review = await owner.manager!.prepareImport(draft, role, scheme);
      check();
      if (review.keys.length !== 1) {
        owner.manager!.cancel();
        throw new Error('INVALID_REVIEW');
      }
      setLabel('');
      navigate(owner, { kind: 'import', review });
    });
    draft = '';
    return work;
  };
  const pasteBatch = () => {
    if (!editable() || step.kind !== 'draft' || !step.multiple) return;
    return run(async (owner, check) => {
      let input = await Clipboard.getStringAsync();
      try {
        check();
        const preparing = owner.manager!.prepareImport(input, role, scheme);
        input = '';
        const review = await preparing;
        check();
        navigate(owner, { kind: 'import', review });
      } finally {
        input = '';
      }
    });
  };
  const startRemoval = () => {
    if (!editable() || step.kind !== 'detail') return;
    const { key } = step;
    return run(async (owner, check) => {
      const review = await owner.manager!.prepareRemoval(key.id);
      check();
      navigate(owner, { kind: 'remove', review });
    });
  };
  const confirm = useCallback(() => {
    const owner = editable();
    if (
      !owner ||
      (step.kind !== 'import' && step.kind !== 'remove')
    )
      return;
    if (step.kind === 'remove' && !backedUp) return;
    if (performance.now() >= step.review.expiresAt) {
      expireReview(owner);
      return;
    }
    clearFields();
    const work = run(
      async (owner, check) => {
        if (step.kind === 'import') {
          const saved = await owner.manager!.confirmImport(
            step.review
          );
          check();
          setKeys((before) => [...(before ?? []), ...saved]);
        } else {
          const removed = await owner.manager!.confirmRemoval(
            step.review,
            backedUp
          );
          check();
          setKeys(
            (before) =>
              before?.filter((key) => key.id !== removed.removedKeyId) ?? null
          );
        }
        navigate(owner, { kind: 'list' });
        setNotice({
          text:
            step.kind === 'import'
              ? t("mobile.sentryViews.sentryKeySaved")
              : t("mobile.sentryViews.sentryKeyRemoved"),
        });
      },
      (owner, cause) => {
        owner.manager?.cancel();
        navigate(owner, { kind: 'list' });
        const code = errorCode(cause);
        if (code !== 'INVALID_CREDENTIAL' && code !== 'AUTH_THROTTLED')
          setKeys(null);
      }
    );
    return work;
  }, [
    backedUp,
    clearFields,
    editable,
    expireReview,
    navigate,
    run,
    step,
  ]);
  const copy = () => {
    if (!editable() || step.kind !== 'detail') return;
    return run(async (_owner, check) => {
      check();
      if (!(await Clipboard.setStringAsync(step.key.publicKey)))
        throw new Error('COPY_FAILED');
      check();
      setNotice({ text: t("sentry.publicKeyCopied") });
    });
  };

  const previewKeys =
    step.kind === 'import'
      ? step.review.keys
      : step.kind === 'remove'
      ? [step.review.key]
      : [];
  const title =
    step.kind === 'draft'
      ? step.multiple
        ? t("mobile.sentryViews.importMultipleSentryKeys")
        : t("mobile.sentryViews.importASentryKey")
      : step.kind === 'import'
      ? step.review.keys.length > 1
        ? t("mobile.sentryViews.reviewSentryKeys")
        : t("mobile.sentryViews.reviewSentryKey")
      : step.kind === 'remove'
      ? t("mobile.sentryViews.removeSentryKey")
      : t("mobile.sentryViews.sentryKeys");
  const canRetry = keys === null && active;
  if (step.kind === 'settings' && active) {
    return (
      <NativeSentrySettings
        manager={step.manager}
        assertCurrent={step.assertCurrent}
        networkLabel={networkLabel}
        onBack={back}
      />
    );
  }
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <KeyboardAvoidingView
        style={s.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen gap={16} scrollResetKey={step.kind} footer={previewKeys.length > 0 ? (<Button
                title={
                  busy
                    ? t("mobile.sentryViews.confirming")
                    : step.kind === 'remove'
                    ? t("mobile.sentryViews.removeKey")
                    : previewKeys.length > 1
                    ? t("mobile.sentryViews.saveKeys")
                    : t("mobile.sentryViews.saveKey")
                }
                variant={step.kind === 'remove' ? 'danger' : 'primary'}
                disabled={
                  busy || (step.kind === 'remove' && !backedUp)
                }
                onPress={confirm}
              />) : undefined}>
          <Header title={title} subtitle={networkLabel} onBack={back} />
          {step.kind === 'list' && (
            <>
              {keys === null ? (
                <Text style={styles.muted}>
                  {busy ? t("mobile.sentryViews.loadingSentryKeys") : t("mobile.sentryViews.sentryKeysUnavailable")}
                </Text>
              ) : keys.length ? (
                <Card>
                  {keys.map((key, index) => (
                    <Row
                      key={key.id}
                      title={key.label}
                      subtitle={describe(key)}
                      icon="shield"
                      last={index === keys.length - 1}
                      onPress={() => {
                        const owner = editable();
                        if (owner) navigate(owner, { kind: 'detail', key });
                      }}
                    />
                  ))}
                </Card>
              ) : (
                <Text style={styles.muted}>
                  {t("mobile.sentryViews.noSentryKeysSavedOnThisNetwork")}</Text>
              )}
              {keys !== null && (
                <>
                  <Button icon="settings"
                    title={t("mobile.sentryViews.serviceSettings")}
                    variant="secondary" size="compact"
                    disabled={busy}
                    onPress={() => {
                      const owner = editable();
                      if (owner?.manager) {
                        const next: Step = {
                          kind: 'settings',
                          manager: {
                            getSettings: owner.manager.getSettings,
                            saveSettings: owner.manager.saveSettings,
                            cancel: owner.manager.cancel,
                            isAuthenticating: owner.manager.isAuthenticating,
                          },
                          assertCurrent() {
                            if (!current(owner) || owner.step !== next)
                              throw new Error('CANCELLED');
                          },
                        };
                        clearFields();
                        navigate(owner, next);
                      }
                    }}
                  />
                  <Button icon="plus"
                    title={t("mobile.sentryViews.importKey")}
                    disabled={busy}
                    onPress={() => startDraft(false)}
                  />
                  <Button icon="plus"
                    title={t("mobile.sentryViews.importMultipleKeys")}
                    variant="secondary" size="compact"
                    disabled={busy}
                    onPress={() => startDraft(true)}
                  />
                </>
              )}
              {canRetry && !busy && (
                <Button icon="refresh" title={t("mobile.connections.tryAgain")} variant="secondary" size="compact" onPress={load} />
              )}
            </>
          )}
          {step.kind === 'detail' && (
            <>
              <PublicKeyCard value={step.key} />
              <Button
                title={t("sentry.copyPublicKey")}
                icon="copy"
                variant="secondary" size="compact"
                disabled={busy}
                onPress={copy}
              />
              <Button icon="trash"
                title={t("mobile.sentryViews.removeKey")}
                variant="secondary" size="compact"
                disabled={busy}
                onPress={startRemoval}
              />
            </>
          )}
          {step.kind === 'draft' && (
            <>
              <Choices
                label={t("mobile.sentryViews.role")}
                choices={roles}
                selected={role}
                labels={roleLabel()}
                disabled={busy}
                onSelect={(value) => {
                  if (!editable() || role === value) return;
                  setRole(value);
                  setPrivateKey('');
                  if (!isAllowedSentryKeyRoleScheme(value, scheme))
                    setScheme(
                      schemes.find((item) =>
                        isAllowedSentryKeyRoleScheme(value, item)
                      )!
                    );
                }}
              />
              <Choices
                label={t("sentry.keyType")}
                choices={schemes.filter((item) =>
                  isAllowedSentryKeyRoleScheme(role, item)
                )}
                selected={scheme}
                labels={schemeLabel}
                disabled={busy}
                onSelect={(value) => {
                  if (editable() && value !== scheme) {
                    setScheme(value);
                    setPrivateKey('');
                  }
                }}
              />
              {step.multiple ? (
                <View style={s.field}>
                  <Text style={s.label}>
                    {t("mobile.sentryViews.copyUpTo20LinesUsingLabelPrivateKey")}</Text>
                  <Button icon="copy"
                    title={t("mobile.sentryViews.pasteAndReviewKeys")}
                    disabled={busy}
                    onPress={pasteBatch}
                  />
                </View>
              ) : (
                <>
                  <View style={s.field}>
                    <Text style={s.label}>{t("sentry.keyLabel")}</Text>
                    <IdleTextInput
                      accessibilityLabel={t("sentry.keyLabel")}
                      value={label}
                      editable={!busy}
                      autoCorrect={false}
                      autoComplete="off"
                      style={s.input}
                      onChangeText={(value) => {
                        if (!editable()) return;
                        // Let JS reject the full edit. Native truncation could
                        // turn a pasted private key into an accepted label.
                        if (
                          value.length > 80 ||
                          containsSentryPrivateKey(value)
                        ) {
                          setNotice({
                            text:
                              value.length > 80
                                ? t("mobile.sentryViews.useUpTo80CharactersForTheKeyLabel")
                                : t("mobile.sentryViews.enterPrivateKeysOnlyInThePrivateKeyField"),
                            error: true,
                          });
                        } else setLabel(value);
                      }}
                    />
                  </View>
                  <NoteBackupPasswordField
                    label={t("mobile.sentryViews.privateKey")}
                    value={privateKey}
                    onChange={(value) => {
                      if (!editable()) return;
                      if (value.length > 130) {
                        setPrivateKey('');
                        setNotice({
                          text: t("mobile.sentryViews.enterOneCompletePrivateKey"),
                          error: true,
                        });
                      } else setPrivateKey(value);
                    }}
                    busy={busy}
                  />
                </>
              )}
              {!step.multiple && (
                <Button
                  title={busy ? t("mobile.sentryViews.checkingKey") : t("mobile.sentryViews.reviewKey")}
                  disabled={busy || !label.trim() || !privateKey}
                  onPress={preview}
                />
              )}
            </>
          )}
          {previewKeys.length > 0 && (
            <>
              {previewKeys.map((key, index) => (
                <PublicKeyCard key={`${index}:${key.publicKey}`} value={key} />
              ))}
              {step.kind === 'remove' && (
                <IdlePressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: backedUp, disabled: busy }}
                  aria-checked={backedUp}
                  disabled={busy}
                  onPress={() => {
                    if (editable()) setBackedUp(!backedUp);
                  }}
                  style={s.check}
                >
                  <Text aria-hidden>{backedUp ? '✓' : '○'}</Text>
                  <Text style={s.fill}>
                    {t("mobile.sentryViews.iHaveASeparateBackupOfThisKey")}</Text>
                </IdlePressable>
              )}

            </>
          )}
          {notice && (
            <Text
              accessibilityRole={notice.error ? 'alert' : undefined}
              accessibilityLiveRegion="polite"
              style={notice.error ? s.error : styles.muted}
            >
              {notice.text}
            </Text>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  field: { gap: 8 },
  label: { color: colors.muted, fontWeight: '600' },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    minHeight: 56,
    fontSize: 16,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  selected: { borderColor: colors.pink, backgroundColor: colors.raised },
  keyCard: { padding: 16, gap: 8 },
  heading: { fontWeight: '600', fontSize: 17, lineHeight: 24 },
  check: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { color: colors.red },
});
