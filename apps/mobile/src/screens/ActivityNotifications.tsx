import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NotificationChoice } from '../notifications/choices';
import { notificationCapabilities } from '../notifications/capabilities';
import { nativeActivityNotifications } from '../notifications/service';
import { useNativeTranslation } from '../platform/localization';
import { Button, Card, Coin, colors, Header, Icon, Screen, Text } from '../ui';
import { IdlePressable, IdleTextInput } from './IdleActivityBoundary';

export type NotificationSettingsTarget = Readonly<{
  scope: string;
  readChoices(): readonly NotificationChoice[];
  assertCurrent(): void;
}>;

export function ActivityNotifications({ target, onBack }: { target: NotificationSettingsTarget; onBack(): void }) {
  const { t } = useNativeTranslation();
  const snapshot = useSyncExternalStore(nativeActivityNotifications.subscribe, nativeActivityNotifications.getSnapshot, nativeActivityNotifications.getSnapshot);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lifetime = useRef({ alive: true, token: 0, busy: false });
  const latest = useRef(target);
  useLayoutEffect(() => { latest.current = target; }, [target]);
  useLayoutEffect(() => {
    const owner = lifetime.current;
    owner.alive = true;
    return () => { owner.alive = false; owner.token++; };
  }, []);
  useEffect(() => { void nativeActivityNotifications.load().catch(() => undefined); }, []);
  let choices: readonly NotificationChoice[] = [];
  let available = true;
  try { target.assertCurrent(); choices = target.readChoices(); } catch { available = false; }
  const fullCatalogue = JSON.stringify(choices);
  const search = query.trim().toLocaleLowerCase();
  const matches = choices.filter(choice => !search || `${choice.label} ${choice.networkName} ${choice.symbol}`.toLocaleLowerCase().includes(search));
  const enabled = new Set(snapshot.enabledScopeIds);
  const run = async (operation: (check: () => void) => Promise<void>) => {
    const owner = lifetime.current;
    if (owner.busy || !owner.alive) return;
    const token = ++owner.token;
    const check = () => {
      if (!owner.alive || owner.token !== token || latest.current.scope !== target.scope || AppState.currentState !== 'active') throw Error('CANCELLED');
      latest.current.assertCurrent();
      if (JSON.stringify(latest.current.readChoices()) !== fullCatalogue) throw Error('CANCELLED');
    };
    owner.busy = true; setBusy(true); setError(false);
    try { check(); await operation(check); check(); }
    catch { if (owner.alive && owner.token === token) setError(true); }
    finally { if (owner.alive && owner.token === token) { owner.busy = false; setBusy(false); } }
  };
  const close = () => { lifetime.current.token++; onBack(); };
  const ready = available && snapshot.status === 'ready';
  return <SafeAreaView edges={['top']} style={s.safe}><Screen gap={16} footer={<>
    <Button title={t('mobile.notifications.checkNow')} icon="refresh" variant="secondary" disabled={busy || !available || enabled.size === 0}
      onPress={() => void run(async check => { await nativeActivityNotifications.load(); check(); await nativeActivityNotifications.runForeground(); })} />
    <Button title={t('mobile.notifications.disableAll')} variant="secondary" disabled={busy || enabled.size === 0}
      onPress={() => void run(() => nativeActivityNotifications.disableAll())} />
  </>}>
    <Header title={t('mobile.notifications.title')} onBack={close} />
    <Text style={s.description}>{t('mobile.notifications.description')}</Text>
    <IdleTextInput accessibilityLabel={t('mobile.notifications.search')} placeholder={t('mobile.notifications.search')}
      placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} editable={!busy}
      autoCapitalize="none" autoCorrect={false} maxLength={80} style={s.search} />
    {matches.length > 0 && <Card style={s.card}>{matches.map((choice, index) => {
      const checked = enabled.has(choice.scope.id);
      const coverage = notificationCapabilities(choice.scope);
      const supported = coverage.transactions || coverage.guardian;
      const limitation = coverage.transactions ? '' : t(coverage.guardian ? 'mobile.notifications.guardianOnly' : 'mobile.notifications.noTransactionProvider');
      return <IdlePressable key={choice.scope.id} accessibilityRole="checkbox"
        accessibilityLabel={`${choice.label}, ${choice.networkName}, ${choice.scope.accountAddress}${limitation ? `, ${limitation}` : ''}`}
        accessibilityState={{ checked, disabled: busy || !ready || !checked && !supported }} aria-checked={checked} disabled={busy || !ready || !checked && !supported}
        onPress={() => { if (checked || supported) void run(check => checked ? nativeActivityNotifications.disableScope(choice.scope.id) : nativeActivityNotifications.enable([choice.scope], check)); }}
        style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && s.pressed]}>
        <Coin id={choice.scope.network.id} fallbackSymbol={choice.symbol} size={36} />
        <View style={s.details}><Text numberOfLines={2} style={s.name}>{choice.label}</Text>
          <Text numberOfLines={2} style={s.network}>{choice.networkName} · {choice.symbol}</Text>
          {!!limitation && <Text style={s.network}>{limitation}</Text>}</View>
        <View style={[s.checkbox, checked && s.checked]}>{checked && <Icon name="check" size={17} color={colors.bg} />}</View>
      </IdlePressable>;
    })}</Card>}
    {!matches.length && ready && <Text style={s.description}>{t('mobile.notifications.empty')}</Text>}
    {(!available || snapshot.status === 'unavailable') && <Text style={s.description}>{t('mobile.notifications.unavailable')}</Text>}
    {snapshot.status === 'loading' && <Text style={s.description}>{t('buttons.loading')}</Text>}
    {error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{t('mobile.notifications.error')}</Text>}
    <Text style={s.help}>{t('mobile.notifications.privacy')}</Text>
    <Text style={s.help}>{t('mobile.notifications.background')}</Text>
  </Screen></SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  description: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  search: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, color: colors.text, fontSize: 15 },
  card: { padding: 0 }, row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  details: { flex: 1, minWidth: 0, gap: 5 }, name: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  network: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: colors.controlBorder, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.blue, borderColor: colors.blue },
  pressed: { opacity: 0.7 }, help: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
