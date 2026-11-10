import React, { useEffect, useState } from 'react';
import { BackHandler, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeDappControlReview as Review } from '../connections/controlRequests';
import type { NativeConnectionsView } from '../connections/types';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { DappSiteStatus } from './DappSiteStatus';

export function NativeDappControlReview({ review, controller }: { review: Review; controller: Pick<NativeConnectionsView, 'approveControl' | 'rejectControl'> }) {
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
  const title = asset ? 'Add asset' : network?.kind === 'network-add' ? 'Add network' : 'Switch network';
  const blocked = expired || !!review.error || !details || review.busy;
  const reject = () => { void controller.rejectControl(review.id).catch(() => undefined); };
  return <SafeAreaView edges={['top', 'bottom']} style={s.root}><Screen key={review.id} footer={<>
    <Button title={review.busy ? 'Applying…' : title} disabled={blocked} onPress={() => { if (!blocked && Date.now() < review.expiresAt) void controller.approveControl(review.id, review.revision).catch(() => undefined); }} />
    <Button title="Reject" variant="quiet" size="compact" onPress={reject} />
  </>}>
    <Header title={title} onBack={reject} />
    <Card style={s.card}>
      <Text style={s.title}>{review.appName}</Text>
      <Text style={s.muted}>Reported website</Text><Text selectable>{review.origin}</Text>
      <DappSiteStatus verification={review.verification} />
      <Text style={s.muted}>{review.accountLabel} · {review.networkLabel}</Text><Text selectable style={s.identifier}>{review.address}</Text>
    </Card>
    {network && <Card style={s.card}>
      <Text style={s.title}>{network.name}</Text>
      <Text>Chain ID {network.chainId} · {network.symbol}</Text>
      <Text style={s.muted}>RPC endpoint</Text><Text selectable style={s.identifier}>{network.rpcUrl}</Text>
    </Card>}
    {asset && <Card style={s.card}>
      <Text style={s.title}>{asset.name}</Text><Text>{asset.symbol} · {asset.type}</Text>
      <Text style={s.muted}>Contract</Text><Text selectable style={s.identifier}>{asset.address}</Text>
      {asset.tokenId !== undefined && <><Text style={s.muted}>Token ID</Text><Text selectable style={s.identifier}>{asset.tokenId}</Text></>}
      <Text style={s.muted}>Adding an asset saves it to your list.</Text>
    </Card>}
    {!details && !review.error && <Text accessibilityLiveRegion="polite" style={s.muted}>Checking request…</Text>}
    {review.error === 'CONTROL_UNAVAILABLE' && <Notice title="Request unavailable" body="Pali could not verify this request. Ask the app to try again." />}
    {review.error === 'BLOCKED_SITE' && !review.verification.isScam && <Notice title="Known security risk" body="Pali flagged this website. This request is blocked." />}
    {review.error === 'SITE_MISMATCH' && review.verification.validation !== 'INVALID' && <Notice title="Website mismatch" body="The requesting website does not match the app’s claimed address. This request is blocked." />}
    {expired && <Notice title="Request expired" body="Ask the app to send a new request." />}
  </Screen></SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, card: { padding: 16, gap: 12 }, title: { fontSize: 18, fontWeight: '700' }, muted: { color: colors.muted, lineHeight: 22 }, identifier: { fontSize: 13, lineHeight: 20 } });
