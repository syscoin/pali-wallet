import { Input } from 'antd';
import uniq from 'lodash/uniq';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from 'components/index';
import trustedAppsArr from 'constants/trustedApps.json';
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
  const [filteredSearch, setFilteredSearch] = useState<string[]>(trustedApps);

  const [status, setStatus] = useState(EMPTY_STATE);

  const handleSearch = (typed) => {
    if (!typed) setStatus(EMPTY_STATE);

    if (typed) {
      const newList = trustedApps.filter((item: string) => {
        const url = item.toLowerCase();
        const typedValue = typed.toLowerCase();

        return url.startsWith(typedValue);
      });

      const isValueValid = validateSearch(typed, trustedApps);

      if (isValueValid) {
        setStatus(TRUSTED_STYLE);
      } else if (!isValueValid && newList.length === 0) {
        setStatus(ATTENTION_STYLE);
      } else {
        setStatus(NOT_TRUSTED_WALLET_STYLE);
      }

      setFilteredSearch(newList);

      return;
    }

    setFilteredSearch(trustedApps);
  };

  const validateSearch = (str: string, array: string[]) => {
    const searchString = array.some((s) => s.startsWith(str));
    return searchString;
  };

  return (
    <>
      <p className="text-white text-sm font-normal pb-6">
        {t('settings.isConnected')}
      </p>
      <Input
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
        <ul className="remove-scrollbar my-2 w-full h-[19.5rem] overflow-auto">
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
