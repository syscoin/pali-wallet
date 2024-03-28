import uniq from 'lodash/uniq';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon, Layout } from 'components/index';
import trustedAppsArr from 'constants/trustedApps.json';
import { RootState } from 'state/store';
import { truncate } from 'utils/index';

const trustedApps = uniq(trustedAppsArr);

const TrustedSitesView = () => {
  const { t } = useTranslation();
  const [filteredSearch, setFilteredSearch] = useState<string[]>(trustedApps);

  const [status, setStatus] = useState({
    name: '',
    icon: '',
    color: '',
    size: '',
  });

  const { accounts, activeAccount } = useSelector(
    (state: RootState) => state.vault
  );

  const handleSearch = (typed) => {
    if (!typed) setStatus({ name: '', icon: '', color: '', size: '' });

    if (typed) {
      const newList = trustedApps.filter((item: string) => {
        const url = item.toLowerCase();
        const typedValue = typed.toLowerCase();

        return url.startsWith(typedValue);
      });

      const isValueValid = validateSearch(typed, trustedApps);

      if (isValueValid) {
        setStatus({
          name: 'Trusted',
          icon: 'WhiteSuccess',
          color: '#8EC100',
          size: '14px',
        });
      } else if (!isValueValid && newList.length === 0) {
        setStatus({
          name: 'Undefined',
          icon: 'AttentionIcon',
          color: '#FE9B07',
          size: '16px',
        });
      } else {
        setStatus({
          name: 'Not trusted',
          icon: 'WhiteErrorIcon',
          color: '#C60000 ',
          size: '16px',
        });
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
    <Layout title={t('settings.trustedWebsites')}>
      <p className="text-white text-sm font-normal pb-6">
        {accounts[activeAccount.type][activeAccount.id].label} is connected to
        these site. They can view your account address.
      </p>
      <div className="relative">
        <input
          onChange={(event) => handleSearch(event.target.value)}
          type="text"
          className="w-[352px] text-xs h-10 p-3 bg-brand-blue800 rounded-[100px] border border-alpha-whiteAlpha300 ]"
          placeholder="Search"
        />
        <div
          style={{ backgroundColor: status.color }}
          className={`absolute flex gap-2 px-[7px] py-[4px] items-center rounded-[100px] right-5 top-[8px]`}
        >
          <Icon size={status.size} isSvg name={status.icon} />
          <p className="text-xs text-white">{status.name}</p>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled my-2 w-full h-[19.5rem] overflow-auto">
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
    </Layout>
  );
};

export default TrustedSitesView;
