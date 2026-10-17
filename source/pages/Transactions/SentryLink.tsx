import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Icon, PageActionFooter } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { dispatchBackgroundEvent } from 'utils/browser';
import type { SentryLinkApproval } from 'utils/sentry/types';

export default function SentryLink() {
  const { t } = useTranslation();
  const { controllerEmitter, connectionUnavailable, isUnlocked } =
    useController();
  const { sentryApprovalId, eventName, host } = useQueryData();
  const [approval, setApproval] = useState<SentryLinkApproval>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setApproval(undefined);
    setError('');
    setBusy(false);
    pending.current = false;
    void controllerEmitter(
      ['wallet', 'getSentryLinkApproval'],
      [sentryApprovalId]
    )
      .then((result: SentryLinkApproval) => {
        if (current === generation.current) setApproval(result);
      })
      .catch((reason) => {
        if (current === generation.current)
          setError(reason.message || t('sentry.unableToVerifyNode'));
      });
    return () => {
      generation.current += 1;
    };
  }, [controllerEmitter, sentryApprovalId]);
  const link = async () => {
    if (pending.current || !approval || connectionUnavailable || !isUnlocked)
      return;
    const current = generation.current;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await controllerEmitter(
        ['wallet', 'approveSentryLink'],
        [sentryApprovalId],
        45000,
        false
      );
      if (current !== generation.current) return;
      if (
        !result ||
        typeof result !== 'object' ||
        !('linked' in result) ||
        result.linked !== true ||
        !('proTxHash' in result) ||
        result.proTxHash !== approval.node.proTxHash
      )
        throw new Error(t('sentry.unableToLinkNode'));
      dispatchBackgroundEvent(`${eventName}.${host}`, result);
      window.close();
    } catch (reason: any) {
      if (current === generation.current)
        setError(reason.message || t('sentry.unableToLinkNode'));
    } finally {
      if (current === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-4 text-white">
      <section className="rounded-xl border border-brand-blue600 bg-bkg-2 p-4">
        <div className="flex items-center gap-3">
          <Icon name="Key" isSvg />
          <h2 className="font-medium">{t('sentry.linkThisSentryNode')}</h2>
        </div>
        <p className="mt-2 break-all text-sm">{approval?.origin || host}</p>
        <p className="mt-3 text-sm text-brand-gray200">
          {t('sentry.linkingSavesThisNodesPublicIdentityAndProtects')}
        </p>
      </section>
      {approval && (
        <dl className="space-y-4 rounded-xl border border-brand-blue600 p-4 text-sm">
          <div>
            <dt className="text-brand-gray200">
              {t('sentry.networkAndTrustedSource')}
            </dt>
            <dd className="mt-1 break-all">
              {approval.network} · {approval.serviceUrl}
            </dd>
          </div>
          <div>
            <dt className="text-brand-gray200">{t('sentry.registeredNode')}</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {approval.node.proTxHash}
            </dd>
          </div>
          <div>
            <dt className="text-brand-gray200">{t('sentry.service')}</dt>
            <dd className="mt-1 break-all">{approval.node.service}</dd>
          </div>
          <div>
            <dt className="text-brand-gray200">{t('sentry.nEVMAddress')}</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {approval.node.nevmAddress || t('sentry.notRegistered')}
            </dd>
          </div>
          <div>
            <dt className="text-brand-gray200">
              {t('sentry.collateralOutpoint')}
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {approval.node.collateralOutpoint.txid}:
              {approval.node.collateralOutpoint.vout}
            </dd>
          </div>
        </dl>
      )}
      <PageActionFooter error={error || undefined}>
        <div className="flex flex-wrap gap-3">
          <Button
            className="flex-1"
            type="button"
            disabled={busy}
            onClick={() => window.close()}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            className="flex-1"
            type="button"
            disabled={busy || !approval || connectionUnavailable || !isUnlocked}
            loading={busy}
            onClick={() => void link()}
          >
            {t('sentry.linkNode')}
          </Button>
        </div>
      </PageActionFooter>
    </div>
  );
}
