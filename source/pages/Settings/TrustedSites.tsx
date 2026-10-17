import { Input } from 'antd';
import uniq from 'lodash/uniq';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { Icon } from 'components/index';
import trustedAppsArr from 'constants/trustedApps.json';
import { useUtils } from 'hooks/index';
import { isTrustedDappOrigin } from 'utils/dappOrigin';
import { truncate } from 'utils/index';

const trustedApps = uniq(trustedAppsArr);

const EMPTY_STATE = {
  label: '',
  icon: '',
  className: '',
};

const TRUSTED_STYLE = {
  label: 'settings.trustedSiteMatch',
  icon: 'check',
  className: 'bg-warning-success bg-opacity-20 text-warning-success',
};

const NOT_TRUSTED_WALLET_STYLE = {
  label: 'settings.unlistedSite',
  icon: 'close-circle',
  className: 'bg-warning-error bg-opacity-20 text-content-primary',
};

const TrustedSitesView = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { navigate } = useUtils();
  const [search, setSearch] = useState<string>(
    typeof location.state?.trustedSitesSearch === 'string'
      ? location.state.trustedSitesSearch.slice(0, 200)
      : ''
  );
  const normalizedSearch = search.trim();
  const candidateUrl = normalizedSearch.includes('://')
    ? normalizedSearch
    : `https://${normalizedSearch}`;
  const searchHost = useMemo(() => {
    try {
      return new URL(candidateUrl).hostname.toLowerCase();
    } catch {
      return normalizedSearch.toLowerCase();
    }
  }, [candidateUrl, normalizedSearch]);
  const filteredSearch = useMemo(
    () => trustedApps.filter((url) => url.toLowerCase().startsWith(searchHost)),
    [searchHost]
  );
  const status = !normalizedSearch
    ? EMPTY_STATE
    : isTrustedDappOrigin(candidateUrl, trustedApps)
    ? TRUSTED_STYLE
    : NOT_TRUSTED_WALLET_STYLE;

  const handleSearch = (typed: string) => {
    setSearch(typed);
    // Keep this public list filter in the current history entry for menu detours.
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: { ...location.state, trustedSitesSearch: typed },
    });
  };

  return (
    <>
      <p className="text-white text-sm font-normal pb-6">
        {t('settings.isConnected')}
      </p>
      <Input
        value={search}
        maxLength={200}
        onChange={(event) => handleSearch(event.target.value)}
        type="text"
        className="w-full"
        aria-label={t('settings.searchTrustedSites')}
        placeholder={t('settings.searchTrustedSites')}
        suffix={
          status.label ? (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-xs whitespace-nowrap ${status.className}`}
            >
              <Icon size={12} name={status.icon} />
              {t(status.label)}
            </span>
          ) : (
            <span />
          )
        }
      />
      <div className="flex flex-col items-center justify-center w-full">
        <ul
          data-navigation-scroll="trusted-sites"
          className="remove-scrollbar my-2 w-full h-[19.5rem] overflow-auto"
        >
          {filteredSearch &&
            filteredSearch.map((url: string, key: number) => (
              <li
                key={`${url}${key}`}
                className="my-2 py-2 w-full text-xs border-b border-dashed border-gray-500"
              >
                <p>{truncate(url, 40)}</p>
              </li>
            ))}
          {filteredSearch.length === 0 && (
            <li role="status" className="py-3 text-sm text-content-muted">
              {t('settings.noTrustedSitesFound')}
            </li>
          )}
        </ul>
      </div>
    </>
  );
};

export default TrustedSitesView;
