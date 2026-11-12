import { nativeI18n, useNativeTranslation } from '../platform/localization';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeSentryAssent, NativeSentryReview as Review } from '../connections/sentryRequests';
import type { NativeConnectionsView } from '../connections/types';
import { Button, Card, colors, Header, Notice, Row, Screen, Text } from '../ui';
import { DappSiteStatus } from './DappSiteStatus';
import { decodeSentryPayoutAddress } from './sentryPayoutAddress';
const t = nativeI18n.t.bind(nativeI18n);

function Field({ name, value }: { name: string; value: string }) {
  return <><Text style={s.muted}>{name}</Text><Text selectable style={s.value}>{value || t("sentry.notSet")}</Text></>;
}

/** Render only the independently checked, public shared approval; no UI-authored signing payload. */
export function NativeSentryReview({ review, controller }: { review: Review; controller: Pick<NativeConnectionsView, 'approveSentry' | 'rejectSentry'> }) {
  useNativeTranslation();
  const identity = `${review.id}:${review.expiresAt}`;
  const details = review.details;
  const requestScope = useMemo(() => ({ controller, identity, details }), [controller, identity, details]);
  const currentReview = useRef(review);
  useLayoutEffect(() => { currentReview.current = review; }, [review]);
  const [selection, setSelection] = useState({ id: identity, index: 0 });
  const [expiredReview, setExpiredReview] = useState<string | null>(null);
  const [pendingScope, setPendingScope] = useState<object | null>(null);
  const expired = expiredReview === identity, submitting = pendingScope === requestScope;
  const [failure, setFailure] = useState<{ scope: object; message: string } | null>(null);
  const error = failure?.scope === requestScope ? failure.message : '';
  const busy = useRef(false), alive = useRef(true), attempt = useRef<object | null>(null);
  const [expandedReview, setExpandedReview] = useState<string | null>(null);
  const showDetails = expandedReview === identity;
  const operation = details?.kind === 'operation' ? details.approval : null;
  const vote = details?.kind === 'vote' ? details.approval : null;
  const link = details?.kind === 'link' ? details.approval : null;
  const key = operation?.keys[selection.id === identity ? selection.index : 0];
  const title = link ? t("sentry.linkSentryNode") : vote ? t("mobile.sentryViews.approveGovernanceVote") : operation?.review.operation === 'updateService' ? t("mobile.sentryViews.updateNodeService") : operation?.review.operation === 'updateRegistrar' ? t("mobile.sentryViews.updateNodeRegistration") : t("sentry.authorizeTitle");
  const fieldNames: Record<string, string> = { service: t("sentry.serviceAddress"), nevmAddress: t("sentry.nEVMAddress"), operatorPayoutScript: t("mobile.sentryViews.operatorPayoutAddress"),
    payoutAddress: t("mobile.sentryViews.proposedPayoutAddress"), previousPayoutAddress: t("mobile.sentryViews.currentPayoutAddress"),
    ownerKeyId: t("sentry.managementFields.ownerKeyId"), votingKeyId: t("mobile.sentryViews.proposedVotingKeyId"), previousVotingKeyId: t("mobile.sentryViews.currentVotingKeyId"),
    operatorPublicKey: t("mobile.sentryViews.proposedOperatorPublicKey"), previousOperatorPublicKey: t("mobile.sentryViews.currentOperatorPublicKey"),
    pqVotingPublicKey: t("mobile.sentryViews.proposedPostQuantumVotingKey"), previousPQVotingPublicKey: t("mobile.sentryViews.currentPostQuantumVotingKey"),
    pqOwnerPublicKey: t("mobile.sentryViews.proposedPostQuantumOwnerKey"), previousPQOwnerPublicKey: t("mobile.sentryViews.currentPostQuantumOwnerKey") };
  const technicalField = (name: string) => ['globalKeyVersion', 'childKeyCommitment', 'collateralSigningMessage'].includes(name);
  const fieldName = (name: string) => fieldNames[name] ?? t(`sentry.managementFields.${name}`, { defaultValue: name.replace(/([A-Z])/g, ' $1') });
  const fieldValue = (name: string, value: string) => name === 'operatorPayoutScript' && value
    ? decodeSentryPayoutAddress(value, operation!.network) ?? t("mobile.sentryViews.addressUnavailableSeeScriptInDetails")
    : value;
  const unavailable = !details || !!review.error || expired;
  const blocked = unavailable || review.busy || submitting ||
    !!operation && !key || !!vote && (!vote.nodes.length || !!vote.missingVotingKeys.length);
  const reject = useCallback(() => { if (currentReview.current === review) void controller.rejectSentry(review.id).catch(() => undefined); }, [controller, review]);
  // Busy/error snapshots replace the review object without replacing its request.
  useLayoutEffect(() => {
    alive.current = true; busy.current = false; attempt.current = null;
    const timer = setTimeout(() => { setExpiredReview(identity); }, Math.max(0, review.expiresAt - Date.now()));
    return () => { alive.current = false; attempt.current = null; clearTimeout(timer); };
  }, [requestScope, review.expiresAt, identity]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { reject(); return true; });
    return () => back.remove();
  }, [reject]);
  const approve = async () => {
    if (!alive.current || currentReview.current !== review || blocked || busy.current || Date.now() >= review.expiresAt || AppState.currentState !== 'active' || !details) return;
    const ticket = {}; attempt.current = ticket;
    busy.current = true; setPendingScope(requestScope); setFailure(null); Keyboard.dismiss();
    const assent: NativeSentryAssent = details.kind === 'link' ? { kind: 'link' } : details.kind === 'vote'
      ? { kind: 'vote' } : { kind: 'operation', keyId: key!.id,
        ...(key!.authorizationId ? { authorizationId: key!.authorizationId } : {}) };
    try { await controller.approveSentry(review.id, review.revision, assent); }
    catch { if (alive.current && attempt.current === ticket && !currentReview.current.error) setFailure({ scope: requestScope, message: t("mobile.sentryViews.couldNotAuthorizeThisRequestTryAgain") }); }
    finally { if (attempt.current === ticket) { attempt.current = null; busy.current = false; if (alive.current) setPendingScope(null); } }
  };
  return <SafeAreaView edges={['top', 'bottom']} style={s.root}>
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen key={review.id} gap={14} footer={<>
      <Button title={review.busy || submitting ? t("mobile.noteFlows.reveal.authorizing") : title} disabled={blocked} onPress={() => void approve()} />
      <Button title={t("buttons.reject")} variant="secondary" onPress={reject} />
    </>}>
    <Header title={title} onBack={reject} />
    <Card style={s.originCard}>
      <Text style={s.originTitle}>{review.appName} · {review.networkLabel}</Text>
      <Text selectable style={s.origin}>{review.origin}</Text>
      <DappSiteStatus verification={review.verification} compact />
      {!operation && <><Text style={s.muted}>{review.accountLabel}</Text><Text selectable style={s.value}>{review.address}</Text></>}
    </Card>
    {link && <Card style={s.card}>
      <Field name={t("sentry.registeredNode")} value={link.node.proTxHash} />
      <Field name={t("sentry.collateral")} value={`${link.node.collateralOutpoint.txid}:${link.node.collateralOutpoint.vout}`} />
      <Field name={t("mobile.sentryViews.stateSource")} value={link.serviceUrl} />
      <Text style={s.muted}>{t("mobile.sentryViews.theCollateralRemainsProtectedFromOrdinaryWalletSendsUntilYouReleaseIt")}</Text>
    </Card>}
    {operation && <>
      {'changes' in operation.review ? <View style={s.changes} testID="sentry-proposed-changes">
        {Object.entries(operation.review.changes).map(([name, change]) =>
          <Card key={name} style={s.change}><Text style={s.changeTitle}>{fieldName(name)}</Text><Field name={t("sentry.proposed")} value={fieldValue(name, change.next)} /><Field name={t("components.current")} value={fieldValue(name, change.previous)} /></Card>)}
      </View> : <Card style={s.card}>
        <Text style={s.title}>{t("mobile.sentryViews.proposedChanges")}</Text>
        {Object.entries(operation.review.fields).filter(([name]) => !technicalField(name)).map(([name, value]) =>
            <Field key={name} name={fieldName(name)} value={fieldValue(name, value)} />)}
      </Card>}
      <Card style={s.card}>
        <Field name={t("mobile.sentryViews.requestAccount")} value={`${review.accountLabel} · ${review.address}`} />
        <Field name={t("sentry.registeredNode")} value={operation.review.proTxHash ?? t("sentry.newRegistration")} />
        {key && <><Field name={t("send.approvalAuthority")} value={key.label} /><Text style={s.muted}>{t(`sentry.roles.${key.role}`)} · {key.scheme}</Text></>}
        <Field name={t("sentry.transactionFee")} value={`${operation.review.feeSatoshis} satoshis`} />
      </Card>
      {!!operation.keys.length && <Card><Text style={s.keyHeading}>{t("mobile.sentryViews.chooseAuthorityKey")}</Text>{operation.keys.map((item, index) => <Row
        key={`${item.id}:${item.authorizationId ?? ''}`} title={`${item.label} · ${item.authorizationId ?? t(`sentry.roles.${item.role}`)}`}
        subtitle={`${item.scheme}${key === item ? " " + t("mobile.sentryViews.selected") : ''}`} onPress={review.busy ? undefined : () => {
          setSelection({ id: identity, index });
        }} last={index === operation.keys.length - 1} />)}</Card>}
      {!operation.keys.length && <Notice title={t("mobile.sentryViews.authorityKeyUnavailable")} body={t("mobile.sentryViews.importTheMatchingNodeAuthorityKeyInSentrySettingsBeforeApprovingThisRequest")} />}
      <Button title={showDetails ? t("mobile.sentryViews.hideRequestDetails") : t("mobile.sentryViews.viewRequestDetails")} variant="quiet" size="compact" expanded={showDetails} onPress={() => setExpandedReview(showDetails ? null : identity)} />
      {showDetails && <>
        <Card style={s.card}>
          <Field name={t("mobile.sentryViews.operation")} value={operation.review.operation} /><Field name={t("mobile.sentryViews.stateSource")} value={operation.serviceUrl} />
          {'changes' in operation.review && <>
            <Field name={t("mobile.sentryViews.currentOperatorPayoutScript")} value={operation.review.changes.operatorPayoutScript.previous} />
            <Field name={t("mobile.sentryViews.proposedOperatorPayoutScript")} value={operation.review.changes.operatorPayoutScript.next} />
          </>}
          {'fields' in operation.review && operation.review.fields.operatorPayoutScript !== undefined &&
            <Field name={t("sentry.operatorPayoutScript")} value={operation.review.fields.operatorPayoutScript} />}
          {'fields' in operation.review && Object.entries(operation.review.fields).filter(([name]) => technicalField(name)).map(([name, value]) =>
            <Field key={name} name={fieldName(name)} value={value} />)}
          {'authorizations' in operation.review && operation.review.authorizations.map(auth => <Text key={auth.id}>{auth.id} · {auth.scheme} · {auth.signed ? t("sentry.alreadySigned") : t("sentry.signatureRequired")}</Text>)}
        </Card>
        <Card style={s.card}><Text style={s.title}>{t("sentry.feeTransactionOutputs")}</Text>
          {operation.review.outputs.filter(output => !output.isPayload).map((output, i) => <Field key={i} name={`${output.valueSatoshis} satoshis`} value={output.scriptHex} />)}
        </Card>
      </>}
    </>}
    {vote && <Card style={s.card}>
      <Text style={s.title}>{vote.proposal?.name ?? t("mobile.sentryViews.governanceProposal")}</Text>
      <Field name={t("mobile.sentryViews.proposal")} value={vote.request.proposalHash} /><Field name={t("transactions.methodNames.vote")} value={`${t(`sentry.voteOutcomes.${vote.request.outcome}`)} · ${vote.request.signal}`} />
      <Field name={t("transactionDisplay.timestamp")} value={new Date(vote.request.timestamp * 1000).toISOString()} />
      <Field name={t("mobile.sentryViews.stateSource")} value={vote.serviceUrl} />
      <Text style={s.title}>{t('mobile.sentryViews.votingNodesCount', { count: vote.nodes.length })}</Text>
      {vote.nodes.map(node => <Field key={node.proTxHash} name={node.keyLabel} value={node.proTxHash} />)}
      {!!vote.missingVotingKeys.length && <Notice title={t("mobile.sentryViews.votingKeysUnavailable")} body={t("mobile.sentryViews.importTheMatchingVotingKeysInSentrySettingsBeforeApprovingThisRequest")} />}
    </Card>}
    {!details && !review.error && <Text accessibilityLiveRegion="polite">{t("mobile.sentryViews.checkingNodeState")}</Text>}
    {review.error === 'BLOCKED_SITE' && !review.verification.isScam && <Notice title={t("mobile.generalViews.knownRisk")} body={t("mobile.sentryViews.paliFlaggedThisWebsiteThisRequestIsBlocked")} />}
    {review.error === 'SENTRY_UNAVAILABLE' && <Notice title={t("mobile.sentryViews.requestUnavailable")} body={t("mobile.sentryViews.paliCouldNotVerifyThisNodeRequestAskTheAppToTryAgain")} />}
    {review.error === 'DELIVERY_UNCERTAIN' && <Notice title={t("mobile.sentryViews.authorizationDeliveryUncertain")} body={t("mobile.sentryViews.paliAuthorizedThisRequestButCouldNotConfirmTheAppReceivedItCheckTheAppBeforeRequestingAnotherSignature")} />}
    {expired && <Notice title={t("mobile.sentryViews.requestExpired")} body={t("mobile.sentryViews.askTheAppToSendANewRequest")} />}
    {!!error && review.error !== 'DELIVERY_UNCERTAIN' && <Notice title={t("mobile.sentryViews.authorizationUnsuccessful")} body={error} />}
  </Screen></KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, card: { padding: 16, gap: 10 },
  originCard: { padding: 12, gap: 6 }, originTitle: { fontSize: 14, fontWeight: '600' }, origin: { fontSize: 12, lineHeight: 18, color: colors.muted },
  title: { fontSize: 17, fontWeight: '700' }, muted: { color: colors.muted, lineHeight: 22 }, value: { fontSize: 13, lineHeight: 20 },
  change: { padding: 12, gap: 6 }, changeTitle: { fontSize: 15, fontWeight: '600' }, keyHeading: { padding: 16, fontWeight: '700' },
  changes: { gap: 12 },
  input: { minHeight: 52, borderRadius: 14, paddingHorizontal: 16, backgroundColor: colors.surface, color: colors.text } });
