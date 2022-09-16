import { Form, Input } from 'antd';
import React, { useState } from 'react';

import { Layout, SecondaryButton } from 'components/index';
import trustedApps from 'constants/trustedApps.json';
import { useUtils } from 'hooks/index';
import { truncate } from 'utils/index';

const TrustedSitesView = () => {
  const { navigate } = useUtils();

  const [filteredSearch, setFilteredSearch] = useState<string[]>(trustedApps);

  const handleSearch = (typed) => {
    let newList: string[] = [];

    if (typed && typed.length >= 2) {
      newList = trustedApps.filter((item: string) => {
        const url = item.toLowerCase();
        const typedValue = typed.toLowerCase();

        return url.includes(typedValue);
      });

      setFilteredSearch(newList);

      return;
    }

    setFilteredSearch(trustedApps);
  };

  return (
    <Layout title="TRUSTED WEBSITES">
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
                if (!value || value.length <= 2) {
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
            className="input-small relative"
            placeholder="Search"
          />
        </Form.Item>
      </Form>

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
          <SecondaryButton type="button" onClick={() => navigate('/home')}>
            Close
          </SecondaryButton>
        </div>
      </div>
    </Layout>
  );
};

export default TrustedSitesView;
