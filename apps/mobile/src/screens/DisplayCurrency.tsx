import React, { useMemo, useRef, useState } from 'react';
import { AppState, FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FIAT_QUOTE_CURRENCIES } from '../../../../source/shared/nativeCoinQuotes.ts';
import { DEFAULT_FIAT_CURRENCY, type FiatCurrency } from '../core/fiatPreference.ts';
import { reloadFiatCurrency, saveFiatCurrency, useFiatCurrency } from '../platform/fiatPreferences';
import { useNativeTranslation } from '../platform/localization';
import { IdleTextInput } from './IdleActivityBoundary';
import { Button, Card, colors, Header, Notice, Row, styles, Text } from '../ui';

export function DisplayCurrency({ onBack }: { onBack(): void }) {
  const { t, i18n } = useNativeTranslation();
  const preference = useFiatCurrency();
  const saved = preference.status === 'ready' ? preference.currency : null;
  const [search, setSearch] = useState('');
  const [choice, setChoice] = useState<FiatCurrency | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const selected = choice ?? saved;
  const query = search.trim().toLowerCase();
  const currencies = useMemo(() => {
    const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([i18n.resolvedLanguage ?? 'en'], { type: 'currency', fallback: 'none' }) : null;
    return FIAT_QUOTE_CURRENCIES.map((code) => ({ code, label: code.length === 3 ? names?.of(code.toUpperCase()) : undefined }));
  }, [i18n.resolvedLanguage]);
  const items = useMemo(() => currencies.filter(({ code, label }) => code.includes(query) || label?.toLocaleLowerCase().includes(query)), [currencies, query]);
  const save = async (target: FiatCurrency) => {
    if (pending.current || target === saved || AppState.currentState !== 'active') return;
    pending.current = true;
    setSaving(true);
    try { if (await saveFiatCurrency(target)) setChoice(null); }
    finally { pending.current = false; setSaving(false); }
  };
  return <SafeAreaView edges={['top', 'bottom']} style={s.screen}>
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.top}>
        <Header title={t('mobile.currency.title')} onBack={onBack} />
        <Text style={styles.muted}>{t('mobile.currency.description')}</Text>
        {saved && <IdleTextInput accessibilityLabel={t('mobile.currency.search')} placeholder={t('mobile.currency.search')} placeholderTextColor={colors.muted}
          autoCapitalize="characters" autoCorrect={false} maxLength={12} value={search} onChangeText={setSearch} style={s.search} />}
      </View>
      {saved ? <FlatList data={items} keyExtractor={({ code }) => code} keyboardShouldPersistTaps="handled" contentContainerStyle={s.list}
        initialNumToRender={10} windowSize={5} ListEmptyComponent={<Text style={styles.muted}>{t('mobile.currency.empty')}</Text>}
        renderItem={({ item }) => <Card><Row title={item.label || item.code.toUpperCase()}
          subtitle={`${item.code.toUpperCase()}${item.code === selected ? ` · ${t('mobile.currency.selected')}` : ''}`}
          onPress={saving ? undefined : () => setChoice(item.code)} last /></Card>} /> :
        <View style={s.top}>{preference.status === 'loading' ? <Text style={styles.muted} accessibilityLiveRegion="polite">{t('mobile.currency.loading')}</Text> : <>
          {preference.status === 'unsupported' ? <>
            <Notice title={t('mobile.currency.unsupportedTitle')} body={t('mobile.currency.unsupportedBody')} tone="amber" />
            <Button title={saving ? t('mobile.currency.resetting') : t('mobile.currency.reset')} disabled={saving} onPress={() => void save(DEFAULT_FIAT_CURRENCY)} />
          </> : <>
            <Notice title={t('mobile.currency.unavailableTitle')} body={t('mobile.currency.unavailableBody')} tone="amber" />
            <Button title={t('mobile.currency.reload')} variant="secondary" onPress={() => { setChoice(null); void reloadFiatCurrency(); }} />
          </>}
        </>}</View>}
      {saved && <View style={s.footer}><Button title={saving ? t('mobile.currency.saving') : t('mobile.currency.save')} disabled={saving || !choice || choice === saved} onPress={() => { if (choice) void save(choice); }} /></View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { gap: 14, paddingHorizontal: 22, paddingVertical: 12 },
  list: { gap: 8, paddingHorizontal: 22, paddingBottom: 16 },
  search: { minHeight: 48, color: colors.text, backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 14 },
  footer: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 12 },
});
