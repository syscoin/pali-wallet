import { Input } from 'antd';
import uniq from 'lodash/uniq';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { Icon } from 'components/index';
import trustedAppsArr from 'constants/trustedApps.json';
import { useUtils } from 'hooks/index';
import { truncate } from 'utils/index';

const trustedApps = uniq(trustedAppsArr);

const EMPTY_STATE = {
  name: '',
  icon: '',
  className: '',
};

const ATTENTION_STYLE = {
  name: 'Undefined',
  icon: 'warning',
  className: 'bg-warning-info bg-opacity-20 text-warning-info',
};

const TRUSTED_STYLE = {
  name: 'Trusted',
  icon: 'check',
  className: 'bg-warning-success bg-opacity-20 text-warning-success',
};

const NOT_TRUSTED_WALLET_STYLE = {
  name: 'Not trusted',
  icon: 'close-circle',
  className: 'bg-warning-error bg-opacity-20 text-brand-red',
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
  const filteredSearch = useMemo(
    () =>
      trustedApps.filter((url) =>
        url.toLowerCase().startsWith(search.toLowerCase())
      ),
    [search]
  );
  const status = !search
    ? EMPTY_STATE
    : trustedApps.some((url) => url.startsWith(search))
    ? TRUSTED_STYLE
    : filteredSearch.length === 0
    ? ATTENTION_STYLE
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
        placeholder="Search"
        suffix={
          status.name ? (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-xs whitespace-nowrap ${status.className}`}
            >
              <Icon size={12} name={status.icon} />
              {status.name}
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
        </ul>
      </div>
    </>
  );
};

export default TrustedSitesView;
