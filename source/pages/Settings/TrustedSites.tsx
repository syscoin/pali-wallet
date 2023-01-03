import React, { useState } from 'react';

import { Layout, NeutralButton } from 'components/index';
import trustedApps from 'constants/trustedApps.json';
import { useUtils } from 'hooks/index';
import { truncate } from 'utils/index';

const TrustedSitesView = () => {
  const { navigate } = useUtils();

  const [filteredSearch, setFilteredSearch] = useState<string[]>(trustedApps);

  const onSearch = (search: string) => {
    if (search && search.length >= 2) {
      const newList = trustedApps.filter((item: string) => {
        const url = item.toLowerCase();
        const typedValue = search.toLowerCase();

        return url.includes(typedValue);
      });

      setFilteredSearch(newList);

      return;
    }

    setFilteredSearch(trustedApps);
  };

  return (
    <Layout title="TRUSTED WEBSITES">
      <input
        onChange={(event) => onSearch(event.target.value)}
        type="text"
        placeholder="Enter your search and press Enter"
        className="input-small relative md:w-full"
      />

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled mb-2 mt-6 w-full h-60 overflow-auto">
          {filteredSearch &&
            filteredSearch.map((url: string) => (
              <li
                key={url}
                className="my-2 py-2 w-full text-xs border-b border-dashed border-gray-500"
              >
                <p>{truncate(url, 40)}</p>
              </li>
            ))}
        </ul>

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="button" onClick={() => navigate('/home')}>
            Close
          </NeutralButton>
        </div>
      </div>
    </Layout>
  );
};

export default TrustedSitesView;
