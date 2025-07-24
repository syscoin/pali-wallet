import uniq from 'lodash/uniq';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/index';
import trustedAppsArr from 'constants/trustedApps.json';
import { selectActiveAccount } from 'state/vault/selectors';
import { truncate } from 'utils/index';

const trustedApps = uniq(trustedAppsArr);

const EMPTY_STATE = {
  name: '',
  icon: '',
  color: '',
  size: '',
};

const ATTENTION_STYLE = {
  name: 'Undefined',
  icon: 'AttentionIcon',
  color: '#FE9B07',
  size: '16px',
};

const TRUSTED_STYLE = {
  name: 'Trusted',
  icon: 'WhiteSuccess',
  color: '#8EC100',
  size: '14px',
};

const NOT_TRUSTED_WALLET_STYLE = {
  name: 'Not trusted',
  icon: 'WhiteErrorIcon',
  color: '#C60000 ',
  size: '16px',
};

const TrustedSitesView = () => {
  const [filteredSearch, setFilteredSearch] = useState<string[]>(trustedApps);

  const [status, setStatus] = useState(EMPTY_STATE);

  const activeAccount = useSelector(selectActiveAccount);

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
        {activeAccount?.label} is connected to these site. They can view your
        account address.
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
