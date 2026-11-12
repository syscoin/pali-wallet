import { useNativeTranslation } from '../platform/localization';
import React, { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeDappControlReview as Review } from '../connections/controlRequests';
import type { NativeConnectionsView } from '../connections/types';
import { Button, Card, colors, Header, Icon, Notice, Screen, Text } from '../ui';
import { DappSiteStatus } from './DappSiteStatus';

export function NativeDappControlReview({ review, controller }: { review: Review; controller: Pick<NativeConnectionsView, 'approveControl' | 'rejectControl'> }) {
  const { t } = useNativeTranslation();
  const identity = `${review.id}:${review.expiresAt}`;
  const [expiredReview, setExpiredReview] = useState<string | null>(null);
  const expired = expiredReview === identity;
  useEffect(() => {
    const timer = setTimeout(() => setExpiredReview(identity), Math.max(0, review.expiresAt - Date.now()));
    const back = BackHandler.addEventListener('hardwareBackPress', () => { void controller.rejectControl(review.id).catch(() => undefined); return true; });
    return () => { clearTimeout(timer); back.remove(); };
  }, [controller, review.id, review.expiresAt, identity]);
  const details = review.details;
  const asset = details?.kind === 'watch-asset' ? details : null;
  const network = details?.kind === 'network-add' || details?.kind === 'network-switch' ? details : null;
  const title = asset ? t('mobile.dappConsent.dappControlReview.addAsset') : network?.kind === 'network-add' ? t('mobile.networks.add') : t('mobile.dappConsent.dappControlReview.switchNetwork');
  const blocked = expired || !!review.error || !details || review.busy;
  const reject = () => { void controller.rejectControl(review.id).catch(() => undefined); };
  return <SafeAreaView edges={['top', 'bottom']} style={s.root}><Screen key={review.id} footer={<>
    <Button title={review.busy ? t('mobile.dappConsent.dappControlReview.applying') : title} icon={network?.kind === 'network-switch' ? 'globe' : 'plus'} disabled={blocked} onPress={() => { if (!blocked && Date.now() < review.expiresAt) void controller.approveControl(review.id, review.revision).catch(() => undefined); }} />
    <Button title={t('buttons.reject')} icon="close" variant="secondary" onPress={reject} />
  </>}>
    <Header title={title} onBack={reject} />
    <Card style={s.card}>
      <View style={s.identity}><View style={s.appIcon}><Icon name="link" size={23} color={colors.blue} /></View>
        <Text style={[s.title, s.identityLabel]}>{review.appName}</Text></View>
      <Text style={s.muted}>{t('mobile.connections.reportedWebsite')}</Text><Text selectable>{review.origin}</Text>
      <DappSiteStatus verification={review.verification} />
      <Text style={s.muted}>{review.accountLabel} · {review.networkLabel}</Text><Text selectable style={s.identifier}>{review.address}</Text>
    </Card>
    {network && <Card style={s.card}>
      <View style={s.identity}><View style={s.appIcon}><Icon name="globe" size={23} color={colors.blue} /></View>
        <Text style={[s.title, s.identityLabel]}>{network.name}</Text></View>
      <Text>{t('mobile.dappConsent.dappControlReview.chainIdentity', { chainId: network.chainId, symbol: network.symbol })}</Text>
      <Text style={s.muted}>{t('mobile.dappConsent.dappControlReview.rpcEndpoint')}</Text><Text selectable style={s.identifier}>{network.rpcUrl}</Text>
    </Card>}
    {asset && <Card style={s.card}>
      <View style={s.identity}><View style={s.appIcon}><Icon name="wallet" size={23} color={colors.blue} /></View>
        <Text style={[s.title, s.identityLabel]}>{asset.name}</Text></View><Text>{asset.symbol} · {asset.type}</Text>
      <Text style={s.muted}>{t('transactionDisplay.contract')}</Text><Text selectable style={s.identifier}>{asset.address}</Text>
      {asset.tokenId !== undefined && <><Text style={s.muted}>{t('send.tokenId')}</Text><Text selectable style={s.identifier}>{asset.tokenId}</Text></>}
      <Text style={s.muted}>{t('mobile.dappConsent.dappControlReview.addingAnAssetSavesItToYour')}</Text>
    </Card>}
    {!details && !review.error && <Text accessibilityLiveRegion="polite" style={s.muted}>{t('mobile.dappConsent.dappControlReview.checkingRequest')}</Text>}
    {review.error === 'CONTROL_UNAVAILABLE' && <Notice title={t('mobile.dappConsent.dappControlReview.requestUnavailable')} body={t('mobile.dappConsent.dappControlReview.paliCouldNotVerifyThisRequestAsk')} />}
    {review.error === 'BLOCKED_SITE' && !review.verification.isScam && <Notice title={t('mobile.generalViews.knownRisk')} body={t('mobile.dappConsent.dappControlReview.paliFlaggedThisWebsiteThisRequestIs')} />}
    {review.error === 'SITE_MISMATCH' && review.verification.validation !== 'INVALID' && <Notice title={t('mobile.generalViews.siteMismatch')} body={t('mobile.generalViews.mismatchBody')} />}
    {expired && <Notice title={t('mobile.dappConsent.dappControlReview.requestExpired')} body={t('mobile.dappConsent.dappControlReview.askTheAppToSendANew')} />}
  </Screen></SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, card: { padding: 16, gap: 12 }, title: { fontSize: 18, fontWeight: '700' }, muted: { color: colors.muted, lineHeight: 22 }, identifier: { fontSize: 13, lineHeight: 20 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 }, identityLabel: { flex: 1 },
  appIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
});
