import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useNativeTranslation } from '../platform/localization';
import { Button, Card, styles, Text } from '../ui';
import { WalletModal } from '../ui/WalletModal';

export function SubmissionLeavePrompt({ visible, onStay, onLeave }: {
  visible: boolean;
  onStay(): void;
  onLeave(): void;
}) {
  const { t } = useNativeTranslation();
  return (
    <WalletModal visible={visible} transparent animationType="fade" onRequestClose={onStay}>
      <SafeAreaView style={s.overlay} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={s.content}>
          <Card style={s.card}>
            <Text accessibilityRole="header" style={s.title}>{t('mobile.sendAssetViews.evm.submissionInProgress')}</Text>
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              {t('mobile.sendAssetViews.evm.thisTransactionMayAlreadyHaveBeenSentCheckActivityBefore')}
            </Text>
            <Button title={t('mobile.sendAssetViews.evm.stay')} onPress={onStay} />
            <Button title={t('mobile.sendAssetViews.evm.leave')} variant="secondary" onPress={onLeave} />
          </Card>
        </ScrollView>
      </SafeAreaView>
    </WalletModal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: { padding: 24, gap: 20 },
  title: { fontSize: 24, fontWeight: '600' },
});
