import { IdlePressable } from './IdleActivityBoundary';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, Header, Icon, Notice, Screen, Text } from '../ui';
import { useNativeTranslation } from '../platform/localization';

export type RealTab = 'wallet' | 'activity' | 'tools' | 'settings';
export type ShellLeafNavigation = Readonly<{
  registerBack(handler: () => boolean): () => void;
  registerLeave(handler: (navigate: () => void) => void): () => void;
  setImmersive(value: boolean): void;
}>;
const TABS = [
  { id: 'wallet', icon: 'wallet' },
  { id: 'activity', icon: 'activity' },
  { id: 'tools', icon: 'grid' },
  { id: 'settings', icon: 'settings' },
] as const;

export function UnavailableActivity({ accountLabel, watchOnly, onBack }: { accountLabel: string; watchOnly: boolean; onBack(): void }) {
  const { t } = useNativeTranslation();
  return <SafeAreaView edges={['top']} style={s.shell}><Screen><Header title={t('mobile.navigation.activity')} subtitle={accountLabel} onBack={onBack} />
    <Notice title={t('mobile.activity.unavailableTitle')}
      body={watchOnly ? t('mobile.activity.watchUnavailable') : t('mobile.activity.unavailable')} />
  </Screen></SafeAreaView>;
}

/** Layout only. Session owners supply public content and all navigation actions. */
export function RealAppShell({ tab, onTab, immersive = false, children }: {
  tab: RealTab; onTab(tab: RealTab): void; immersive?: boolean; children: React.ReactNode;
}) {
  const { t } = useNativeTranslation();
  return <View style={s.shell}>
    <View style={s.content}>{children}</View>
    {!immersive && <SafeAreaView edges={['bottom']} style={s.safe}>
      <View accessibilityRole="tablist" accessibilityLabel={t('mobile.navigation.label')} style={s.tabs}>
        {TABS.map((item) => <IdlePressable key={item.id} accessibilityRole="tab" accessibilityLabel={t(`mobile.navigation.${item.id}`)}
          accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={t(`mobile.navigation.${item.id}`)}
          accessibilityState={{ selected: tab === item.id }} aria-selected={tab === item.id} onPress={() => onTab(item.id)}
          style={({ pressed }) => [s.tab, pressed && s.pressed]}>
          <View style={[s.icon, tab === item.id && s.selected]}><Icon name={item.icon} color={tab === item.id ? colors.blue : colors.muted} /></View>
          <Text testID={`main-tab-caption-${item.id}`} numberOfLines={1} maxFontSizeMultiplier={1.25}
            adjustsFontSizeToFit minimumFontScale={1} style={[s.label, tab === item.id && s.selectedLabel]}>{t(`mobile.navigation.${item.id}`)}</Text>
        </IdlePressable>)}
      </View>
    </SafeAreaView>}
  </View>;
}
const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg }, content: { flex: 1, minHeight: 0 },
  safe: { backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  tabs: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 4, paddingVertical: 6 },
  tab: { flex: 1, minWidth: 0, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 2 },
  icon: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 }, selected: { backgroundColor: colors.raised },
  label: { fontSize: 12, lineHeight: 17, color: colors.muted, textAlign: 'center', alignSelf: 'stretch', flexShrink: 1 },
  selectedLabel: { color: colors.blue, fontWeight: '600' }, pressed: { opacity: 0.7 },
});
