import React, { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeAccountChangeReview as Review } from '../connections/accountChangeRequests';
import type { NativeConnectionsView } from '../connections/types';
import { useNativeTranslation } from '../platform/localization';
import { Button, Card, colors, Header, Icon, Notice, Row, Screen, Text } from '../ui';
import { DappSiteStatus } from './DappSiteStatus';

export function NativeAccountChangeReview({ review, controller, onUnavailable }: { review: Review; controller: Pick<NativeConnectionsView, 'selectConnectionAccount' | 'approveAccountChange' | 'rejectAccountChange' | 'getSnapshot'>; onUnavailable(): void }) {
  const { t } = useNativeTranslation();
  const identity = `${review.id}:${review.expiresAt}`;
  const [expiredReview, setExpiredReview] = useState<string | null>(null);
  const expired = expiredReview === identity;
  const reject = () => { void controller.rejectAccountChange(review.id).catch(() => undefined); };
  useEffect(() => {
    const timer = setTimeout(() => setExpiredReview(identity), Math.max(0, review.expiresAt - Date.now()));
    const back = BackHandler.addEventListener('hardwareBackPress', () => { void controller.rejectAccountChange(review.id).catch(() => undefined); return true; });
    return () => { clearTimeout(timer); back.remove(); };
  }, [controller, review.id, review.expiresAt, identity]);
  const disabled = expired || review.busy || !!review.error;
  return <SafeAreaView style={s.root} edges={['top', 'bottom']}><Screen footer={<>
    <Button title={t('connections.switchAccount')} icon="wallet" disabled={disabled} onPress={() => { if (!disabled) void controller.approveAccountChange(review.id, review.revision).catch(() => { if (controller.getSnapshot().error === 'CONNECTION_UNAVAILABLE') onUnavailable(); }); }} />
    <Button title={t('buttons.reject')} icon="close" variant="secondary" onPress={reject} />
  </>}>
    <Header title={t('connections.changeAccount')} onBack={reject} />
    <Card style={s.identity}><View style={s.title}><Icon name="link" size={24} color={colors.blue} /><Text style={s.name}>{review.appName}</Text></View>
      <Text>{review.origin}</Text><DappSiteStatus verification={review.verification} /><Text style={s.muted}>{review.networkLabel}</Text></Card>
    <Text style={s.muted}>{t('connections.selectAccountToConnect')}</Text>
    <Card>{review.accounts.map(account => <Row key={account.id} icon="wallet" title={account.label}
      subtitle={`${account.address}${account.id === review.currentAccountId ? ` · ${t('connections.currentlyConnected')}` : ''}${account.id === review.selectedAccountId ? ` · ${t('mobile.language.selected')}` : ''}`}
      right={account.id === review.selectedAccountId ? <Icon name="check" size={22} color={colors.blue} /> : <View style={{ width: 22 }} />}
      onPress={disabled ? undefined : () => controller.selectConnectionAccount(review.id, account.id, review.revision)} />)}</Card>
    {(expired || review.error) && <Notice title={t('mobile.dappConsent.dappControlReview.requestUnavailable')} body={t(expired ? 'mobile.dappConsent.dappControlReview.askTheAppToSendANew' : 'connections.onlyConnect')} />}
  </Screen></SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, identity: { padding: 16, gap: 12 }, title: { flexDirection: 'row', alignItems: 'center', gap: 12 }, name: { fontSize: 18, fontWeight: '700', flex: 1 }, muted: { color: colors.muted, lineHeight: 22 } });
