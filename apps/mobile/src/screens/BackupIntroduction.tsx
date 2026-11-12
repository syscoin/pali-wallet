import { useNativeTranslation } from '../platform/localization';
import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Header, Icon, Notice, Screen, Text } from '../ui';

export type BackupIntroductionProps = {
  onBack(): void;
  onStart(): void;
  onLater(): void;
  disabled?: boolean;
  error?: string;
};


/** Public introduction only; the parent owns authentication and phrase access. */
export function BackupIntroduction({ onBack, onStart, onLater, disabled = false, error }: BackupIntroductionProps) {
  const { t } = useNativeTranslation();
const steps = [
  { title: t('mobile.noteFlows.backupIntroduction.writeItDown'), body: t('mobile.noteFlows.backupIntroduction.usePenAndPaper') },
  { title: t('mobile.noteFlows.backupIntroduction.keepItOffline'), body: t('mobile.noteFlows.backupIntroduction.dontScreenshotOrSaveItDigitally') },
  { title: t('mobile.noteFlows.backupIntroduction.keepItPrivate'), body: t('mobile.noteFlows.backupIntroduction.anyoneWithItCanControlYourWallet') },
] as const;
  const compact = useWindowDimensions().height < 700;
  return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <Screen gap={16} footer={<>
      <Button title={t('mobile.noteFlows.backupIntroduction.backUpNow')} disabled={disabled} onPress={onStart} />
      <Button title={t('mobile.noteFlows.backupIntroduction.doItLater')} variant="secondary" disabled={disabled} onPress={onLater} style={s.later} />
    </>}>
      <Header title={t('mobile.noteFlows.backupIntroduction.walletBackup')} onBack={onBack} />
      <View style={[s.content, compact && s.compactContent]}>
        <View style={s.hero}>
          <View style={[s.heroIcon, compact && s.compactIcon]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name="shield" size={36} color={colors.blue} />
          </View>
          <Text accessibilityRole="header" style={s.title}>{t('mobile.portfolioCopy.backupTitle')}</Text>
          <Text style={s.body}>{t('mobile.noteFlows.backupIntroduction.yourRecoveryPhraseRestoresAccountsDerivedFromThis')}</Text>
        </View>
        <Card style={s.steps}>
          {steps.map((step, index) => <View key={step.title} style={[s.step, index < steps.length - 1 && s.divider]}>
            <View style={s.number} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={s.numberText}>{index + 1}</Text>
            </View>
            <View style={s.stepCopy}>
              <Text style={s.stepTitle}>{step.title}</Text>
              <Text style={s.stepBody}>{step.body}</Text>
            </View>
          </View>)}
        </Card>
      </View>
      {error && <Notice title={t('mobile.noteFlows.backupIntroduction.backupWasNotOpened')} body={error} tone="amber" />}
    </Screen>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: 'center', gap: 38, paddingTop: 24, paddingBottom: 8 },
  compactContent: { gap: 24, paddingTop: 8 },
  hero: { alignItems: 'center', gap: 18, paddingHorizontal: 8 },
  heroIcon: { width: 80, height: 80, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
  compactIcon: { width: 64, height: 64, borderRadius: 18, marginBottom: 0 },
  title: { color: colors.text, fontSize: 27, lineHeight: 35, fontWeight: '700', letterSpacing: -0.6, textAlign: 'center' },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  steps: { padding: 0, overflow: 'hidden' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  number: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue },
  numberText: { color: colors.bg, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  stepCopy: { flex: 1, minWidth: 0, gap: 4 },
  stepTitle: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  stepBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  later: { backgroundColor: colors.bg, borderColor: colors.muted },
});
