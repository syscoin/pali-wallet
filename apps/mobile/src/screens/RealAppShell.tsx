import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, Header, Icon, Notice, Screen, Text } from '../ui';

export type RealTab = 'wallet' | 'activity' | 'tools' | 'settings';
export type ShellLeafNavigation = Readonly<{
  registerBack(handler: () => boolean): () => void;
  registerLeave(handler: (navigate: () => void) => void): () => void;
  setImmersive(value: boolean): void;
}>;
const TABS = [
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'tools', label: 'Tools', icon: 'grid' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const;

export function UnavailableActivity({ accountLabel, watchOnly, onBack }: { accountLabel: string; watchOnly: boolean; onBack(): void }) {
  return <SafeAreaView edges={['top']} style={s.shell}><Screen><Header title="Activity" subtitle={accountLabel} onBack={onBack} />
    <Notice title={watchOnly ? 'Activity unavailable for watch accounts' : 'Activity unavailable on this network'}
      body={watchOnly ? 'This public account can show balances and receive addresses. Its transaction history is not available in Pali yet.' : 'Wallet transaction history is currently available on Ethereum. Balance and receive remain available on this network.'} />
  </Screen></SafeAreaView>;
}

/** Layout only. Session owners supply public content and all navigation actions. */
export function RealAppShell({ tab, onTab, immersive = false, children }: {
  tab: RealTab; onTab(tab: RealTab): void; immersive?: boolean; children: React.ReactNode;
}) {
  return <View style={s.shell}>
    <View style={s.content}>{children}</View>
    {!immersive && <SafeAreaView edges={['bottom']} style={s.safe}>
      <View accessibilityRole="tablist" accessibilityLabel="Main navigation" style={s.tabs}>
        {TABS.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label}
          accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={item.label}
          accessibilityState={{ selected: tab === item.id }} aria-selected={tab === item.id} onPress={() => onTab(item.id)}
          style={({ pressed }) => [s.tab, pressed && s.pressed]}>
          <View style={[s.icon, tab === item.id && s.selected]}><Icon name={item.icon} color={tab === item.id ? colors.blue : colors.muted} /></View>
          <Text testID={`main-tab-caption-${item.id}`} numberOfLines={1} maxFontSizeMultiplier={1.25}
            adjustsFontSizeToFit minimumFontScale={1} style={[s.label, tab === item.id && s.selectedLabel]}>{item.label}</Text>
        </Pressable>)}
      </View>
    </SafeAreaView>}
  </View>;
}
const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg }, content: { flex: 1, minHeight: 0 },
  safe: { backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  tabs: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 4, paddingVertical: 7 },
  tab: { flex: 1, minWidth: 0, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 2 },
  icon: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 }, selected: { backgroundColor: colors.raised },
  label: { fontSize: 12, lineHeight: 17, color: colors.muted, textAlign: 'center', alignSelf: 'stretch', flexShrink: 1 },
  selectedLabel: { color: colors.blue, fontWeight: '600' }, pressed: { opacity: 0.7 },
});
