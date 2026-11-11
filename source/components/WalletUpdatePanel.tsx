import React from 'react';
import { useTranslation } from 'react-i18next';

import {
  CHROME_WALLET_STORE_URL,
  useWalletUpdate,
} from 'hooks/useWalletUpdate';

const linkClass =
  'inline-flex min-h-[44px] items-center rounded px-2 text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue200';

export function WalletUpdatePanel() {
  const { t } = useTranslation();
  const update = useWalletUpdate();
  const available = !!update.release || !!update.pendingVersion;
  const checking =
    update.status === 'checking' || update.browserStatus === 'checking';
  const status = available
    ? 'available'
    : checking
    ? 'checking'
    : update.status === 'error' ||
      update.browserStatus === 'unavailable' ||
      update.browserStatus === 'throttled'
    ? 'unavailable'
    : update.status === 'ready'
    ? 'current'
    : 'notChecked';
  return (
    <section
      aria-label={t('updates.title')}
      className="my-4 w-full rounded-xl bg-brand-blue500 p-4 text-left text-white"
    >
      <h2 className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
        {t('updates.title')}
        {available && (
          <span
            aria-hidden="true"
            className="rounded-full bg-brand-pink px-2 py-0.5 text-[10px] text-white"
          >
            {t('updates.available')}
          </span>
        )}
      </h2>
      <p role="status" aria-live="polite" className="mt-2 text-xs">
        {t(`updates.${status}`)}
      </p>
      <dl className="mt-2 text-xs text-brand-gray200">
        <div className="flex flex-wrap gap-1">
          <dt>{t('updates.installed')}</dt>
          <dd>{update.installedVersion}</dd>
        </div>
        {update.release && (
          <div className="flex flex-wrap gap-1">
            <dt>{t('updates.latest')}</dt>
            <dd>{update.release.version}</dd>
          </div>
        )}
        {update.pendingVersion && (
          <div className="flex flex-wrap gap-1">
            <dt>{t('updates.readyToInstall')}</dt>
            <dd>{update.pendingVersion}</dd>
          </div>
        )}
      </dl>
      {update.release && (
        <div className="mt-3 text-xs">
          <p className="font-medium">
            {t(`updates.severity.${update.release.severity}`)}
          </p>
          <p className="mt-1 font-medium break-words">{update.release.title}</p>
          <p className="mt-1 break-words">{update.release.summary}</p>
          <a
            href={update.release.releaseNotesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {t('updates.releaseNotes')}
          </a>
        </div>
      )}
      {update.status === 'error' && available && (
        <p className="mt-2 text-xs">{t('updates.unavailable')}</p>
      )}
      {update.browserStatus === 'throttled' && (
        <p className="mt-2 text-xs">{t('updates.throttled')}</p>
      )}
      {update.browserStatus === 'unavailable' && (
        <p className="mt-2 text-xs">{t('updates.browserUnavailable')}</p>
      )}
      {available && (
        <p className="mt-3 text-xs text-brand-gray200">
          {t('updates.automaticInstall')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={checking}
          onClick={() => void update.check()}
          className="min-h-[44px] rounded-full border border-white px-4 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue200 disabled:opacity-50"
        >
          {t(checking ? 'updates.checking' : 'updates.check')}
        </button>
        <a
          href={CHROME_WALLET_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          {t('updates.openStore')}
        </a>
      </div>
    </section>
  );
}
