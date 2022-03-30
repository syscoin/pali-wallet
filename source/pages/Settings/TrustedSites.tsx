import { Layout, SecondaryButton } from 'components/index';
import React, { useState } from 'react';
import { useUtils, useStore } from 'hooks/index';
import { formatUrl } from 'utils/index';
import { Form, Input } from 'antd';

const TrustedSitesView = () => {
  const { navigate } = useUtils();
  const { trustedApps } = useStore();

  const [filteredSearch, setFilteredSearch] = useState<string[]>(trustedApps);

  const handleSearch = (event) => {
    let newList: string[] = [];

    if (event.target.value) {
      newList = trustedApps.filter((item: string) => {
        const url = item.toLowerCase();
        const typedValue = event.target.value.toLowerCase();

        return url.includes(typedValue);
      });

      setFilteredSearch(newList);

      return;
    }

    setFilteredSearch(trustedApps);
  };

  return (
    <Layout title="TRUSTED WEBSITES">
      <p className="m-4 max-w-xs text-center text-white text-xs">
        Check all sites included on our trusted list.
      </p>

      <Form
        id="trusted"
        name="trusted"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        autoComplete="off"
        className="flex flex-col gap-4 items-center justify-center mx-auto text-center md:w-full"
      >
        <Form.Item
          name="search"
          className="md:w-full"
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          <Input
            onChange={(event) => handleSearch(event)}
            type="text"
            placeholder="Search"
            className="px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
          />
        </Form.Item>
      </Form>

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled my-1 p-4 w-full h-72 overflow-auto">
          {filteredSearch &&
            filteredSearch.map((url: string) => (
              <li
                key={url}
                className="my-2 py-2 w-full text-xs border-b border-dashed border-gray-500"
              >
                <p>{formatUrl(url, 40)}</p>
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
