import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Icon, PageActionFooter } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { dispatchBackgroundEvent } from 'utils/browser';
import type { SentryVoteApproval } from 'utils/sentry/types';

const SentryVote = () => {
  const { t } = useTranslation();
  const { controllerEmitter, isUnlocked, connectionUnavailable } =
    useController();
  const { sentryApprovalId, host, eventName } = useQueryData();
  const [approval, setApproval] = useState<SentryVoteApproval>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef<symbol | null>(null);

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    inFlight.current = null;
    setApproval(undefined);
    setPassword('');
    setBusy(false);
    setError('');
    if (typeof sentryApprovalId !== 'string') {
      setError(t('sentry.invalidSentryApproval'));
      return;
    }
    void controllerEmitter(
      ['wallet', 'getSentryVoteApproval'],
      [sentryApprovalId]
    )
      .then((result: SentryVoteApproval) => {
        if (!cancelled) setApproval(result);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason?.message || t('sentry.sentryApprovalIsUnavailable'));
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [controllerEmitter, sentryApprovalId]);

  const cancel = async () => {
    if (busy) return;
    await controllerEmitter(
      ['wallet', 'cancelSentryVoteApproval'],
      [sentryApprovalId]
    ).catch(() => undefined);
    window.close();
  };
  const sign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      inFlight.current ||
      !approval ||
      !password ||
      connectionUnavailable ||
      !isUnlocked
    )
      return;
    const job = Symbol('governance-vote');
    inFlight.current = job;
    setBusy(true);
    setError('');
    try {
      const result = (await controllerEmitter(
        ['wallet', 'signSentryVoteApproval'],
        [{ id: sentryApprovalId, password }],
        180000,
        false
      )) as Record<string, any> | null;
      if (!alive.current || inFlight.current !== job) return;
      if (
        !result ||
        result.version !== 1 ||
        !Array.isArray(result.votes) ||
        result.chain?.genesisHash !== approval.request.chain.genesisHash ||
        result.chain?.era !== approval.request.chain.era ||
        result.votes.length !== approval.nodes.length ||
        result.proposalHash !== approval.request.proposalHash ||
        result.signal !== approval.request.signal ||
        result.outcome !== approval.request.outcome ||
        result.timestamp !== approval.request.timestamp ||
        result.votes.some(
          (vote: any, index: number) =>
            vote?.proTxHash !== approval.nodes[index].proTxHash ||
            typeof vote?.voteSig !== 'string'
        )
      )
        throw new Error(t('sentry.unableToAuthorizeVote'));
      dispatchBackgroundEvent(`${eventName}.${host}`, result);
      window.close();
    } catch (reason: any) {
      if (alive.current && inFlight.current === job)
        setError(reason?.message || t('sentry.unableToAuthorizeVote'));
    } finally {
      if (inFlight.current === job) {
        inFlight.current = null;
        if (alive.current) {
          setBusy(false);
          setPassword('');
        }
      }
    }
  };

  return (
    <form
      onSubmit={sign}
      autoComplete="off"
      className="flex min-w-0 w-full flex-col gap-4 text-white"
    >
      <section className="min-w-0 rounded-xl border border-brand-blue600 bg-bkg-2 p-4">
        <div className="flex items-start gap-3">
          <Icon name="Key" isSvg className="shrink-0" />
          <div className="min-w-0">
            <h2 className="font-medium">
              {t('sentry.authorizeGovernanceVote')}
            </h2>
            <p className="mt-2 break-all text-sm text-brand-gray200">
              {approval?.origin || host}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm">{t('sentry.voteSignatureOnly')}</p>
      </section>
      {!approval && !error && (
        <p role="status">{t('sentry.loadingIndependentlyCheckedNodeState')}</p>
      )}
      {approval && (
        <>
          <section className="min-w-0 rounded-xl bg-bkg-2 p-4">
            <h3 className="break-words text-lg font-medium">
              {approval.proposal?.name || approval.request.proposalHash}
            </h3>
            <p className="mt-3 text-lg font-semibold">
              {t(`sentry.voteOutcomes.${approval.request.outcome}`)} ·{' '}
              {t('sentry.fundingVote')}
            </p>
            <p className="mt-3 text-sm">
              {approval.network} ·{' '}
              {t('sentry.votingNodes', { count: approval.nodes.length })}
            </p>
          </section>
          <details className="min-w-0 rounded-xl border border-brand-blue600 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t('sentry.voteDetails')}
            </summary>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-brand-gray200">{t('sentry.network')}</dt>
                <dd>
                  {approval.network} · {t('sentry.legacy')}
                </dd>
              </div>
              <div>
                <dt className="text-brand-gray200">
                  {t('sentry.proposalHash')}
                </dt>
                <dd className="break-all font-mono text-xs">
                  {approval.request.proposalHash}
                </dd>
              </div>
              {approval.proposal?.url && (
                <div>
                  <dt className="text-brand-gray200">
                    {t('sentry.proposalUrl')}
                  </dt>
                  <dd className="break-all text-xs">{approval.proposal.url}</dd>
                </div>
              )}
              <div>
                <dt className="text-brand-gray200">{t('sentry.voteTime')}</dt>
                <dd>
                  {new Date(approval.request.timestamp * 1000).toISOString()}
                </dd>
              </div>
              <div>
                <dt className="text-brand-gray200">
                  {t('sentry.trustedStateSource')}
                </dt>
                <dd className="break-all text-xs">{approval.serviceUrl}</dd>
              </div>
            </dl>
            <h3 className="mt-4 font-medium">
              {t('sentry.votingNodes', { count: approval.nodes.length })}
            </h3>
            <ul className="mt-3 space-y-4">
              {approval.nodes.map((node) => (
                <li
                  key={node.proTxHash}
                  className="min-w-0 border-b border-brand-blue600 pb-3 last:border-b-0 last:pb-0"
                >
                  <p className="break-words text-sm">{node.keyLabel}</p>
                  <p className="mt-1 break-all font-mono text-xs">
                    {node.proTxHash}
                  </p>
                  <p className="mt-2 text-xs text-brand-gray200">
                    {t('sentry.collateralOutpoint')}
                  </p>
                  <p className="break-all font-mono text-xs">
                    {node.collateralOutpoint.txid}:
                    {node.collateralOutpoint.vout}
                  </p>
                </li>
              ))}
            </ul>
          </details>
          <label className="text-sm">
            {t('sentry.walletPassword')}
            <input
              type="password"
              autoComplete="current-password"
              className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-fields-input-border bg-bkg-1 p-3"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        </>
      )}
      <PageActionFooter error={error || undefined}>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            className="flex-1"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            type="submit"
            className="flex-1"
            disabled={
              busy ||
              !approval ||
              !password ||
              connectionUnavailable ||
              !isUnlocked
            }
            loading={busy}
          >
            {t('sentry.signVotes')}
          </Button>
        </div>
      </PageActionFooter>
    </form>
  );
};

export default SentryVote;
