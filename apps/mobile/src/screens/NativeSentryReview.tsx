import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeSentryAssent, NativeSentryReview as Review } from '../connections/sentryRequests';
import type { NativeConnectionsView } from '../connections/types';
import { Button, Card, colors, Header, Notice, Row, Screen, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';
import { DappSiteStatus } from './DappSiteStatus';

function Field({ name, value }: { name: string; value: string }) {
  return <><Text style={s.muted}>{name}</Text><Text selectable style={s.value}>{value || 'Not set'}</Text></>;
}

/** Render only the independently checked, public shared approval; no UI-authored signing payload. */
export function NativeSentryReview({ review, controller }: { review: Review; controller: Pick<NativeConnectionsView, 'approveSentry' | 'rejectSentry'> }) {
  const identity = `${review.id}:${review.expiresAt}`;
  const [credential, setCredential] = useState({ id: identity, approval: review.details, value: '' });
  const [selection, setSelection] = useState({ id: identity, index: 0 });
  const [expiredReview, setExpiredReview] = useState<string | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<string | null>(null);
  const expired = expiredReview === identity, submitting = pendingIdentity === identity;
  const [error, setError] = useState('');
  const busy = useRef(false), alive = useRef(true), attempt = useRef<object | null>(null);
  const password = credential.id === identity && credential.approval === review.details ? credential.value : '';
  const details = review.details;
  const operation = details?.kind === 'operation' ? details.approval : null;
  const vote = details?.kind === 'vote' ? details.approval : null;
  const link = details?.kind === 'link' ? details.approval : null;
  const key = operation?.keys[selection.id === identity ? selection.index : 0];
  const title = link ? 'Link Sentry Node' : vote ? 'Approve governance vote' : 'Authorize Sentry update';
  const unavailable = !details || !!review.error || expired;
  const blocked = unavailable || review.busy || submitting || (details?.kind !== 'link' && !password) ||
    !!operation && !key || !!vote && (!vote.nodes.length || !!vote.missingVotingKeys.length);
  const reject = useCallback(() => { setCredential({ id: identity, approval: details, value: '' }); void controller.rejectSentry(review.id).catch(() => undefined); }, [controller, review.id, identity, details]);
  useEffect(() => {
    alive.current = true; busy.current = false; attempt.current = null;
    const clear = () => setCredential({ id: identity, approval: details, value: '' });
    const timer = setTimeout(() => { clear(); setExpiredReview(identity); }, Math.max(0, review.expiresAt - Date.now()));
    const app = AppState.addEventListener('change', state => { if (state !== 'active') clear(); });
    const back = BackHandler.addEventListener('hardwareBackPress', () => { reject(); return true; });
    return () => { alive.current = false; attempt.current = null; clearTimeout(timer); app.remove(); back.remove(); };
  }, [controller, review.id, review.expiresAt, details, identity, reject]);
  const approve = async () => {
    if (blocked || busy.current || Date.now() >= review.expiresAt || AppState.currentState !== 'active' || !details) return;
    const ticket = {}; attempt.current = ticket;
    busy.current = true; setPendingIdentity(identity); setError(''); Keyboard.dismiss();
    const assent: NativeSentryAssent = details.kind === 'link' ? { kind: 'link' } : details.kind === 'vote'
      ? { kind: 'vote', password } : { kind: 'operation', password, keyId: key!.id,
        ...(key!.authorizationId ? { authorizationId: key!.authorizationId } : {}) };
    setCredential({ id: identity, approval: details, value: '' });
    try { await controller.approveSentry(review.id, review.revision, assent); }
    catch { if (alive.current && attempt.current === ticket) setError('Could not authorize this request. Check your password and try again.'); }
    finally { if (attempt.current === ticket) { attempt.current = null; busy.current = false; if (alive.current) setPendingIdentity(null); } }
  };
  return <SafeAreaView edges={['top', 'bottom']} style={s.root}>
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen key={review.id} footer={<>
      <Button title={review.busy || submitting ? 'Authorizing…' : title} disabled={blocked} onPress={() => void approve()} />
      <Button title="Reject" variant="quiet" size="compact" onPress={reject} />
    </>}>
    <Header title={title} onBack={reject} />
    <Card style={s.card}>
      <Text style={s.title}>{review.appName}</Text><Field name="Reported website" value={review.origin} />
      <DappSiteStatus verification={review.verification} />
      <Text style={s.muted}>{review.accountLabel} · {review.networkLabel}</Text><Text selectable style={s.value}>{review.address}</Text>
    </Card>
    {link && <Card style={s.card}>
      <Field name="Registered node" value={link.node.proTxHash} />
      <Field name="Collateral" value={`${link.node.collateralOutpoint.txid}:${link.node.collateralOutpoint.vout}`} />
      <Field name="State source" value={link.serviceUrl} />
      <Text style={s.muted}>The collateral remains protected from ordinary wallet sends until you release it.</Text>
    </Card>}
    {operation && <>
      <Card style={s.card}>
        <Field name="Operation" value={operation.review.operation} /><Field name="Registered node" value={operation.review.proTxHash ?? 'New registration'} />
        <Field name="State source" value={operation.serviceUrl} /><Field name="Transaction fee" value={`${operation.review.feeSatoshis} satoshis`} />
        {'changes' in operation.review ? Object.entries(operation.review.changes).map(([name, change]) =>
          <Card key={name} style={s.change}><Text style={s.title}>{name.replace(/([A-Z])/g, ' $1')}</Text>
            <Field name="Current" value={change.previous} /><Field name="Proposed" value={change.next || (change.previous ? 'Remove registration' : '')} /></Card>) :
          Object.entries(operation.review.fields).map(([name, value]) => <Field key={name} name={name.replace(/([A-Z])/g, ' $1')} value={value} />)}
        {'authorizations' in operation.review && operation.review.authorizations.map(auth => <Text key={auth.id}>
          {auth.id} · {auth.scheme} · {auth.signed ? 'Already signed' : 'Signature required'}
        </Text>)}
      </Card>
      <Card style={s.card}><Text style={s.title}>Fee transaction outputs</Text>
        {operation.review.outputs.filter(output => !output.isPayload).map((output, i) => <Field key={i}
          name={`${output.valueSatoshis} satoshis`} value={output.scriptHex} />)}
      </Card>
      {!!operation.keys.length && <Card><Text style={s.keyHeading}>Authority key</Text>{operation.keys.map((item, index) => <Row
        key={`${item.id}:${item.authorizationId ?? ''}`} title={`${item.label} · ${item.authorizationId ?? item.role}`}
        subtitle={`${item.scheme}${key === item ? ' · Selected' : ''}`} onPress={review.busy ? undefined : () => {
          setCredential({ id: identity, approval: details, value: '' }); setSelection({ id: identity, index });
        }} last={index === operation.keys.length - 1} />)}</Card>}
      {!operation.keys.length && <Notice title="Authority key unavailable" body="Import the matching node authority key in Sentry settings before approving this request." />}
    </>}
    {vote && <Card style={s.card}>
      <Text style={s.title}>{vote.proposal?.name ?? 'Governance proposal'}</Text>
      <Field name="Proposal" value={vote.request.proposalHash} /><Field name="Vote" value={`${vote.request.outcome} · ${vote.request.signal}`} />
      <Field name="Timestamp" value={new Date(vote.request.timestamp * 1000).toISOString()} />
      <Field name="State source" value={vote.serviceUrl} />
      <Text style={s.title}>Voting nodes ({vote.nodes.length})</Text>
      {vote.nodes.map(node => <Field key={node.proTxHash} name={node.keyLabel} value={node.proTxHash} />)}
      {!!vote.missingVotingKeys.length && <Notice title="Voting keys unavailable" body="Import the matching voting keys in Sentry settings before approving this request." />}
    </Card>}
    {details && details.kind !== 'link' && <IdleTextInput accessibilityLabel="Wallet password" placeholder="Wallet password"
      placeholderTextColor={colors.muted} value={password} onChangeText={value => setCredential({ id: identity, approval: details, value })}
      secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={1024}
      editable={!unavailable && !review.busy && !submitting} style={s.input} />}
    {!details && !review.error && <Text accessibilityLiveRegion="polite">Checking node state…</Text>}
    {review.error === 'BLOCKED_SITE' && !review.verification.isScam && <Notice title="Known security risk" body="Pali flagged this website. This request is blocked." />}
    {review.error === 'SENTRY_UNAVAILABLE' && <Notice title="Request unavailable" body="Pali could not verify this node request. Ask the app to try again." />}
    {review.error === 'DELIVERY_UNCERTAIN' && <Notice title="Authorization delivery uncertain" body="Pali authorized this request, but could not confirm the app received it. Check the app before requesting another signature." />}
    {expired && <Notice title="Request expired" body="Ask the app to send a new request." />}
    {!!error && review.error !== 'DELIVERY_UNCERTAIN' && <Notice title="Authorization unsuccessful" body={error} />}
  </Screen></KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, card: { padding: 16, gap: 10 },
  title: { fontSize: 17, fontWeight: '700' }, muted: { color: colors.muted, lineHeight: 22 }, value: { fontSize: 13, lineHeight: 20 },
  change: { padding: 12, gap: 8 }, keyHeading: { padding: 16, fontWeight: '700' },
  input: { minHeight: 52, borderRadius: 14, paddingHorizontal: 16, backgroundColor: colors.surface, color: colors.text } });
