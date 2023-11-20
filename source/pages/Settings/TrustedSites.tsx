import { Form, Input } from 'antd';
import uniq from 'lodash/uniq';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Layout } from 'components/index';
import trustedAppsArr from 'constants/trustedApps.json';
import { RootState } from 'state/store';
import { truncate } from 'utils/index';

const trustedApps = uniq(trustedAppsArr);

const TrustedSitesView = () => {
  const { t } = useTranslation();
  const [filteredSearch, setFilteredSearch] = useState<string[]>(trustedApps);

  const { accounts, activeAccount } = useSelector(
    (state: RootState) => state.vault
  );

  const handleSearch = (typed) => {
    if (typed) {
      const newList = trustedApps.filter((item: string) => {
        const url = item.toLowerCase();
        const typedValue = typed.toLowerCase();

        return url.startsWith(typedValue);
      });

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
      <Form
        validateMessages={{ default: '' }}
        id="trusted"
        name="trusted"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        autoComplete="off"
      >
        <Form.Item
          name="search"
          className="md:w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              validator(_, value) {
                const isValueValid = validateSearch(value, trustedApps);
                if (isValueValid) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            onChange={(event) => handleSearch(event.target.value)}
            type="text"
            className="custom-input-search relative"
            placeholder="Search"
          />
        </Form.Item>
      </Form>

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
