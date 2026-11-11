import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeSentryAssent, NativeSentryReview as Review } from '../connections/sentryRequests';
import type { NativeConnectionsView } from '../connections/types';
import { Button, Card, colors, Header, Notice, Row, Screen, Text } from '../ui';
import { DappSiteStatus } from './DappSiteStatus';
import { decodeSentryPayoutAddress } from './sentryPayoutAddress';

function Field({ name, value }: { name: string; value: string }) {
  return <><Text style={s.muted}>{name}</Text><Text selectable style={s.value}>{value || 'Not set'}</Text></>;
}

/** Render only the independently checked, public shared approval; no UI-authored signing payload. */
export function NativeSentryReview({ review, controller }: { review: Review; controller: Pick<NativeConnectionsView, 'approveSentry' | 'rejectSentry'> }) {
  const identity = `${review.id}:${review.expiresAt}`;
  const currentReview = useRef(review);
  useLayoutEffect(() => { currentReview.current = review; }, [review]);
  const [selection, setSelection] = useState({ id: identity, index: 0 });
  const [expiredReview, setExpiredReview] = useState<string | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<string | null>(null);
  const expired = expiredReview === identity, submitting = pendingIdentity === identity;
  const [error, setError] = useState('');
  const busy = useRef(false), alive = useRef(true), attempt = useRef<object | null>(null);
  const details = review.details;
  const [expandedReview, setExpandedReview] = useState<string | null>(null);
  const showDetails = expandedReview === identity;
  const operation = details?.kind === 'operation' ? details.approval : null;
  const vote = details?.kind === 'vote' ? details.approval : null;
  const link = details?.kind === 'link' ? details.approval : null;
  const key = operation?.keys[selection.id === identity ? selection.index : 0];
  const title = link ? 'Link Sentry node' : vote ? 'Approve governance vote' : operation?.review.operation === 'updateService' ? 'Update node service' : operation?.review.operation === 'updateRegistrar' ? 'Update node registration' : 'Authorize Sentry update';
  const fieldNames: Record<string, string> = { service: 'Service address', nevmAddress: 'NEVM address', operatorPayoutScript: 'Operator payout address',
    payoutAddress: 'Proposed payout address', previousPayoutAddress: 'Current payout address',
    ownerKeyId: 'Owner key ID', votingKeyId: 'Proposed voting key ID', previousVotingKeyId: 'Current voting key ID',
    operatorPublicKey: 'Proposed operator public key', previousOperatorPublicKey: 'Current operator public key',
    pqVotingPublicKey: 'Proposed post-quantum voting key', previousPQVotingPublicKey: 'Current post-quantum voting key',
    pqOwnerPublicKey: 'Proposed post-quantum owner key', previousPQOwnerPublicKey: 'Current post-quantum owner key' };
  const technicalField = (name: string) => ['globalKeyVersion', 'childKeyCommitment', 'collateralSigningMessage'].includes(name);
  const fieldName = (name: string) => fieldNames[name] ?? name.replace(/([A-Z])/g, ' $1');
  const fieldValue = (name: string, value: string) => name === 'operatorPayoutScript' && value
    ? decodeSentryPayoutAddress(value, operation!.network) ?? 'Address unavailable · See script in Details'
    : value;
  const unavailable = !details || !!review.error || expired;
  const blocked = unavailable || review.busy || submitting ||
    !!operation && !key || !!vote && (!vote.nodes.length || !!vote.missingVotingKeys.length);
  const reject = useCallback(() => { if (currentReview.current === review) void controller.rejectSentry(review.id).catch(() => undefined); }, [controller, review]);
  useEffect(() => {
    alive.current = true; busy.current = false; attempt.current = null;
    const timer = setTimeout(() => { setExpiredReview(identity); }, Math.max(0, review.expiresAt - Date.now()));
    const back = BackHandler.addEventListener('hardwareBackPress', () => { reject(); return true; });
    return () => { alive.current = false; attempt.current = null; clearTimeout(timer); back.remove(); };
  }, [controller, review.id, review.expiresAt, details, identity, reject]);
  const approve = async () => {
    if (currentReview.current !== review || blocked || busy.current || Date.now() >= review.expiresAt || AppState.currentState !== 'active' || !details) return;
    const ticket = {}; attempt.current = ticket;
    busy.current = true; setPendingIdentity(identity); setError(''); Keyboard.dismiss();
    const assent: NativeSentryAssent = details.kind === 'link' ? { kind: 'link' } : details.kind === 'vote'
      ? { kind: 'vote' } : { kind: 'operation', keyId: key!.id,
        ...(key!.authorizationId ? { authorizationId: key!.authorizationId } : {}) };
    try { await controller.approveSentry(review.id, review.revision, assent); }
    catch { if (alive.current && currentReview.current === review && attempt.current === ticket) setError('Could not authorize this request. Try again.'); }
    finally { if (attempt.current === ticket) { attempt.current = null; busy.current = false; if (alive.current && currentReview.current === review) setPendingIdentity(null); } }
  };
  return <SafeAreaView edges={['top', 'bottom']} style={s.root}>
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen key={review.id} gap={14} footer={<>
      <Button title={review.busy || submitting ? 'Authorizing…' : title} disabled={blocked} onPress={() => void approve()} />
      <Button title="Reject" variant="secondary" onPress={reject} />
    </>}>
    <Header title={title} onBack={reject} />
    <Card style={s.originCard}>
      <Text style={s.originTitle}>{review.appName} · {review.networkLabel}</Text>
      <Text selectable style={s.origin}>{review.origin}</Text>
      <DappSiteStatus verification={review.verification} />
      {!operation && <><Text style={s.muted}>{review.accountLabel}</Text><Text selectable style={s.value}>{review.address}</Text></>}
    </Card>
    {link && <Card style={s.card}>
      <Field name="Registered node" value={link.node.proTxHash} />
      <Field name="Collateral" value={`${link.node.collateralOutpoint.txid}:${link.node.collateralOutpoint.vout}`} />
      <Field name="State source" value={link.serviceUrl} />
      <Text style={s.muted}>The collateral remains protected from ordinary wallet sends until you release it.</Text>
    </Card>}
    {operation && <>
      {'changes' in operation.review ? <View style={s.changes} testID="sentry-proposed-changes">
        {Object.entries(operation.review.changes).map(([name, change]) =>
          <Card key={name} style={s.change}><Text style={s.changeTitle}>{fieldName(name)}</Text><Field name="Proposed" value={fieldValue(name, change.next)} /><Field name="Current" value={fieldValue(name, change.previous)} /></Card>)}
      </View> : <Card style={s.card}>
        <Text style={s.title}>Proposed changes</Text>
        {Object.entries(operation.review.fields).filter(([name]) => !technicalField(name)).map(([name, value]) =>
            <Field key={name} name={fieldName(name)} value={fieldValue(name, value)} />)}
      </Card>}
      <Card style={s.card}>
        <Field name="Request account" value={`${review.accountLabel} · ${review.address}`} />
        <Field name="Registered node" value={operation.review.proTxHash ?? 'New registration'} />
        {key && <><Field name="Authority" value={key.label} /><Text style={s.muted}>{key.role} · {key.scheme}</Text></>}
        <Field name="Transaction fee" value={`${operation.review.feeSatoshis} satoshis`} />
      </Card>
      {!!operation.keys.length && <Card><Text style={s.keyHeading}>Choose authority key</Text>{operation.keys.map((item, index) => <Row
        key={`${item.id}:${item.authorizationId ?? ''}`} title={`${item.label} · ${item.authorizationId ?? item.role}`}
        subtitle={`${item.scheme}${key === item ? ' · Selected' : ''}`} onPress={review.busy ? undefined : () => {
          setSelection({ id: identity, index });
        }} last={index === operation.keys.length - 1} />)}</Card>}
      {!operation.keys.length && <Notice title="Authority key unavailable" body="Import the matching node authority key in Sentry settings before approving this request." />}
      <Button title={showDetails ? 'Hide request details' : 'View request details'} variant="quiet" size="compact" expanded={showDetails} onPress={() => setExpandedReview(showDetails ? null : identity)} />
      {showDetails && <>
        <Card style={s.card}>
          <Field name="Operation" value={operation.review.operation} /><Field name="State source" value={operation.serviceUrl} />
          {'changes' in operation.review && <>
            <Field name="Current operator payout script" value={operation.review.changes.operatorPayoutScript.previous} />
            <Field name="Proposed operator payout script" value={operation.review.changes.operatorPayoutScript.next} />
          </>}
          {'fields' in operation.review && operation.review.fields.operatorPayoutScript !== undefined &&
            <Field name="Operator payout script" value={operation.review.fields.operatorPayoutScript} />}
          {'fields' in operation.review && Object.entries(operation.review.fields).filter(([name]) => technicalField(name)).map(([name, value]) =>
            <Field key={name} name={fieldName(name)} value={value} />)}
          {'authorizations' in operation.review && operation.review.authorizations.map(auth => <Text key={auth.id}>{auth.id} · {auth.scheme} · {auth.signed ? 'Already signed' : 'Signature required'}</Text>)}
        </Card>
        <Card style={s.card}><Text style={s.title}>Fee transaction outputs</Text>
          {operation.review.outputs.filter(output => !output.isPayload).map((output, i) => <Field key={i} name={`${output.valueSatoshis} satoshis`} value={output.scriptHex} />)}
        </Card>
      </>}
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
    {!details && !review.error && <Text accessibilityLiveRegion="polite">Checking node state…</Text>}
    {review.error === 'BLOCKED_SITE' && !review.verification.isScam && <Notice title="Known security risk" body="Pali flagged this website. This request is blocked." />}
    {review.error === 'SENTRY_UNAVAILABLE' && <Notice title="Request unavailable" body="Pali could not verify this node request. Ask the app to try again." />}
    {review.error === 'DELIVERY_UNCERTAIN' && <Notice title="Authorization delivery uncertain" body="Pali authorized this request, but could not confirm the app received it. Check the app before requesting another signature." />}
    {expired && <Notice title="Request expired" body="Ask the app to send a new request." />}
    {!!error && review.error !== 'DELIVERY_UNCERTAIN' && <Notice title="Authorization unsuccessful" body={error} />}
  </Screen></KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, card: { padding: 16, gap: 10 },
  originCard: { padding: 12, gap: 6 }, originTitle: { fontSize: 14, fontWeight: '600' }, origin: { fontSize: 12, lineHeight: 18, color: colors.muted },
  title: { fontSize: 17, fontWeight: '700' }, muted: { color: colors.muted, lineHeight: 22 }, value: { fontSize: 13, lineHeight: 20 },
  change: { padding: 12, gap: 6 }, changeTitle: { fontSize: 15, fontWeight: '600' }, keyHeading: { padding: 16, fontWeight: '700' },
  changes: { gap: 12 },
  input: { minHeight: 52, borderRadius: 14, paddingHorizontal: 16, backgroundColor: colors.surface, color: colors.text } });
