import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Icon, PageActionFooter } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { dispatchBackgroundEvent } from 'utils/browser';
import type { SentryApproval } from 'utils/sentry/types';

const Change = ({
  label,
  previous,
  next,
}: {
  label: string;
  next: string;
  previous: string;
}) => {
  const { t } = useTranslation();
  return (
    <div className="border-b border-brand-blue600 py-4 last:border-b-0">
      <h3 className="text-sm font-medium">
        {label}
        {previous === next ? ` · ${t('sentry.unchanged')}` : ''}
      </h3>
      <dl className="mt-2 space-y-2 text-xs">
        <div>
          <dt className="text-brand-gray200">{t('sentry.current')}</dt>
          <dd className="mt-1 break-all font-mono">
            {previous || t('sentry.notSet')}
          </dd>
        </div>
        <div>
          <dt className="text-brand-gray200">{t('sentry.proposed')}</dt>
          <dd className="mt-1 break-all font-mono">
            {next || t('sentry.removeRegistration')}
          </dd>
        </div>
      </dl>
    </div>
  );
};

const SentryOperation = () => {
  const { t } = useTranslation();
  const { controllerEmitter, connectionUnavailable, isUnlocked } =
    useController();
  const { sentryApprovalId, host, eventName } = useQueryData();
  const [approval, setApproval] = useState<SentryApproval>();
  const [keyId, setKeyId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef<symbol | null>(null);

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    inFlight.current = null;
    setBusy(false);
    setApproval(undefined);
    setPassword('');
    setError('');
    if (typeof sentryApprovalId !== 'string') {
      setError(t('sentry.invalidSentryApproval'));
      return;
    }
    void controllerEmitter(['wallet', 'getSentryApproval'], [sentryApprovalId])
      .then((result: SentryApproval) => {
        if (cancelled) return;
        setApproval(result);
        const key = result.keys[0];
        setKeyId(key ? `${key.id}:${key.authorizationId || ''}` : '');
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason.message || t('sentry.sentryApprovalIsUnavailable'));
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [controllerEmitter, sentryApprovalId]);

  const cancel = async () => {
    if (busy) return;
    await controllerEmitter(
      ['wallet', 'cancelSentryApproval'],
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
      !keyId ||
      connectionUnavailable ||
      !isUnlocked
    )
      return;
    const selectedKey = approval.keys.find(
      (key) => `${key.id}:${key.authorizationId || ''}` === keyId
    );
    if (!selectedKey) return;
    const job = Symbol('sentry-authorization');
    inFlight.current = job;
    setBusy(true);
    setError('');
    try {
      const response = await controllerEmitter(
        ['wallet', 'signSentryApproval'],
        [
          {
            id: sentryApprovalId,
            keyId: selectedKey.id,
            password,
            ...(selectedKey.authorizationId
              ? { authorizationId: selectedKey.authorizationId }
              : {}),
          },
        ],
        180000,
        false
      );
      if (!alive.current || inFlight.current !== job) return;
      if (
        !response ||
        typeof response !== 'object' ||
        !('transactionHex' in response) ||
        typeof response.transactionHex !== 'string' ||
        !/^(?:[0-9a-fA-F]{2})+$/.test(response.transactionHex)
      )
        throw new Error(t('sentry.unableToAuthorizeSentryUpdate'));
      dispatchBackgroundEvent(`${eventName}.${host}`, response);
      window.close();
    } catch (reason: any) {
      if (alive.current && inFlight.current === job)
        setError(reason?.message || t('sentry.unableToAuthorizeSentryUpdate'));
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
  const serviceReview =
    approval?.review.operation === 'updateService'
      ? approval.review
      : undefined;
  const managementReview =
    approval?.review && 'authorizations' in approval.review
      ? approval.review
      : undefined;

  return (
    <form
      onSubmit={sign}
      autoComplete="off"
      className="flex min-w-0 w-full flex-col gap-4 text-white"
    >
      <section className="rounded-xl border border-brand-blue600 bg-bkg-2 p-4">
        <div className="flex items-start gap-3">
          <Icon name="Key" isSvg />
          <div className="min-w-0">
            <h2 className="font-medium">
              {t(
                approval?.request.operation === 'register'
                  ? 'sentry.authorizeRegistration'
                  : approval?.request.operation === 'revoke'
                  ? 'sentry.authorizeRevocation'
                  : 'sentry.authorizeTitle'
              )}
            </h2>
            <p className="mt-2 break-all text-sm text-brand-gray200">
              {approval?.origin || host}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm">
          {t('sentry.thisAuthorizesTheSelectedNodekeyRoleOnlyAdditional')}
        </p>
      </section>
      {!approval && !error && (
        <p role="status">{t('sentry.loadingIndependentlyCheckedNodeState')}</p>
      )}
      {approval && (
        <>
          <dl className="space-y-3 rounded-xl bg-bkg-2 p-4 text-sm">
            <div>
              <dt className="text-brand-gray200">{t('sentry.network')}</dt>
              <dd>
                {approval.network} ·{' '}
                {approval.request.chain.era === 'legacy-v3'
                  ? t('sentry.legacy')
                  : t('sentry.postquantum')}
              </dd>
            </div>
            <div>
              <dt className="text-brand-gray200">
                {t('sentry.registeredNode')}
              </dt>
              <dd className="break-all font-mono text-xs">
                {approval.review.proTxHash || t('sentry.newRegistration')}
              </dd>
            </div>
            <div>
              <dt className="text-brand-gray200">
                {t('sentry.trustedStateSource')}
              </dt>
              <dd className="break-all text-xs">{approval.serviceUrl}</dd>
            </div>
            <div>
              <dt className="text-brand-gray200">
                {t('sentry.transactionFee')}
              </dt>
              <dd>
                {approval.review.feeSatoshis} {t('sentry.satoshis')}
              </dd>
            </div>
          </dl>
          {serviceReview && (
            <section className="min-w-0 rounded-xl border border-brand-blue600 px-4">
              <Change
                label={t('sentry.nEVMAddress')}
                {...serviceReview.changes.nevmAddress}
              />
              <Change
                label={t('sentry.serviceAddress')}
                {...serviceReview.changes.service}
              />
              <Change
                label={t('sentry.operatorPayoutScript')}
                {...serviceReview.changes.operatorPayoutScript}
              />
            </section>
          )}
          {managementReview && (
            <section className="min-w-0 rounded-xl border border-brand-blue600 p-4">
              <dl className="space-y-3">
                {Object.entries(managementReview.fields)
                  .filter(([, value]) => value !== '')
                  .map(([field, value]) => (
                    <div key={field}>
                      <dt className="text-sm text-brand-gray200">
                        {field.replace(/([A-Z])/g, ' $1')}
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {value}
                      </dd>
                    </div>
                  ))}
              </dl>
              <h3 className="mt-4 text-sm font-medium">
                {t('sentry.requiredNodeAuthorizations')}
              </h3>
              <ul className="mt-2 space-y-2 text-xs">
                {managementReview.authorizations.map((auth) => (
                  <li key={auth.id}>
                    {auth.id}: {auth.scheme} ·{' '}
                    {auth.signed
                      ? t('sentry.alreadySigned')
                      : t('sentry.signatureRequired')}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="rounded-xl border border-brand-blue600 p-4">
            <h3 className="text-sm font-medium">
              {t('sentry.feeTransactionOutputs')}
            </h3>
            {approval.review.outputs
              .filter((output) => !output.isPayload)
              .map((output, index) => (
                <div key={index} className="mt-3 text-xs">
                  <p>
                    {output.valueSatoshis} {t('sentry.satoshis')}
                  </p>
                  <p className="mt-1 break-all font-mono text-brand-gray200">
                    {output.scriptHex}
                  </p>
                </div>
              ))}
          </section>
          {!approval.keys.length ? (
            <p role="alert" className="text-sm text-warning-error">
              {serviceReview
                ? t('sentry.theRegisteredOperatorKeyIsNotInThis')
                : t('sentry.noRemainingAuthorityKeyForThisRequestIs')}{' '}
              {t('sentry.importTheMatchingRoleAndKeyInWallet')}
            </p>
          ) : (
            <>
              <label className="text-sm">
                {t('sentry.nodeAuthorityKey')}
                <select
                  className="mt-2 min-h-11 w-full rounded-xl border border-fields-input-border bg-bkg-1 p-3"
                  value={keyId}
                  disabled={busy}
                  onChange={(e) => setKeyId(e.target.value)}
                >
                  {approval.keys.map((key) => (
                    <option
                      key={`${key.id}:${key.authorizationId || ''}`}
                      value={`${key.id}:${key.authorizationId || ''}`}
                    >
                      {key.label} · {key.authorizationId || key.role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                {t('sentry.walletPassword')}
                <input
                  type="password"
                  autoComplete="current-password"
                  className="mt-2 min-h-11 w-full rounded-xl border border-fields-input-border bg-bkg-1 p-3"
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </>
          )}
        </>
      )}
      <PageActionFooter error={error || undefined}>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            className="flex-1"
            onClick={() => void cancel()}
            disabled={busy}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            type="submit"
            className="flex-1"
            disabled={
              busy ||
              !password ||
              !keyId ||
              !approval ||
              connectionUnavailable ||
              !isUnlocked
            }
            loading={busy}
          >
            {t('sentry.authorizeUpdate')}
          </Button>
        </div>
      </PageActionFooter>
    </form>
  );
};

export default SentryOperation;
