import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PALI_LANGUAGE_OPTIONS, type PaliLanguage } from '../../../../source/shared/languagePolicy';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard';
import { initializeNativeLanguage, nativeLanguagePreferences, useNativeTranslation } from '../platform/localization';
import { Button, Card, colors, Header, Row, Screen, styles, Text } from '../ui';

/** Draft language is local; only a guarded, confirmed protected write changes i18next. */
export function NativePreferences({ onBack, assertCurrent }: { onBack(): void; assertCurrent(): void }) {
  const { t } = useNativeTranslation();
  const preference = useSyncExternalStore(nativeLanguagePreferences.subscribe, nativeLanguagePreferences.getSnapshot, nativeLanguagePreferences.getSnapshot);
  const [choice, setChoice] = useState<PaliLanguage | null>(null);
  const [saving, setSaving] = useState(false), [failed, setFailed] = useState(false);
  const life = useRef({ active: true, generation: 0, pending: false });
  useEffect(() => {
    void initializeNativeLanguage();
    const current = life.current; current.active = true;
    const retire = () => { current.generation++; setSaving(false); };
    const change = AppState.addEventListener('change', (state) => { if (state !== 'active') retire(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', retire) : undefined;
    return () => { current.active = false; retire(); change.remove(); blur?.remove(); };
  }, []);
  const saved = preference.status === 'ready' ? preference.value : null;
  const selected = choice ?? saved?.language;
  const back = () => { life.current.generation++; onBack(); };
  const save = async () => {
    const current = life.current;
    if (!saved || !choice || choice === saved.language || current.pending) return;
    const generation = current.generation, target = choice;
    const check = () => { assertSynchronousEvmFeeGuard(assertCurrent); if (!current.active || generation !== current.generation || AppState.currentState !== 'active') throw new Error('CANCELLED'); };
    current.pending = true; setSaving(true); setFailed(false);
    try { check(); await nativeLanguagePreferences.save(saved, target, check); check(); onBack(); }
    catch { if (current.active && generation === current.generation) setFailed(true); }
    finally { current.pending = false; if (current.active && generation === current.generation) setSaving(false); }
  };
  return <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
    <Screen footer={<Button title={saving ? t('mobile.language.saving') : t('buttons.save')}
      disabled={saving || !saved || !choice || choice === saved.language} onPress={() => void save()} />}>
      <Header title={t('generalMenu.languages')} onBack={back} />
      <Text style={styles.muted}>{t('settings.setYourPreferredLanguage')}</Text>
      <Card>{PALI_LANGUAGE_OPTIONS.map((language, index) => <Row key={language.value}
        title={language.nativeName} subtitle={`${language.name}${selected === language.value ? ` · ${t('mobile.language.selected')}` : ''}`}
        onPress={saving || !saved ? undefined : () => { setChoice(language.value); setFailed(false); }} last={index === PALI_LANGUAGE_OPTIONS.length - 1} />)}</Card>
      <Text style={styles.muted}>{t('mobile.language.fallback')}</Text>
      {preference.status === 'opening' && <Text accessibilityLiveRegion="polite">{t('mobile.language.loading')}</Text>}
      {(preference.status === 'unavailable' || failed) && <>
        <Text accessibilityRole="alert">{t('settings.preferencesSaveFailed')}</Text>
        <Button title={t('mobile.language.reload')} variant="quiet" disabled={saving}
          onPress={() => { setChoice(null); setFailed(false); void nativeLanguagePreferences.load().catch(() => undefined); }} />
      </>}
    </Screen>
  </SafeAreaView>;
}
