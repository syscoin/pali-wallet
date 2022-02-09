import { SecondaryButton } from 'components/index';
import { AuthViewLayout } from 'pages/Layout';
import React, { useState } from 'react';
import { useUtils, useFormat, useStore } from 'hooks/index';
import { Form, Input } from 'antd';

const TrustedSitesView = () => {
  const { formatURL } = useFormat();
  const { navigate } = useUtils();
  const { trustedApps } = useStore();

  const [filteredSearch, setFilteredSearch] = useState<any>(
    Object.values(trustedApps)
  );

  const handleSearch = (event) => {
    let newList: string[] = [];

    if (event.target.value) {
      newList = Object.values(trustedApps).filter((item: string) => {
        const url = item.toLowerCase();
        const typedValue = event.target.value.toLowerCase();

        return url.includes(typedValue);
      });

      setFilteredSearch(newList);

      return;
    }

    setFilteredSearch(Object.values(trustedApps));
  };

  return (
    <AuthViewLayout title="TRUSTED WEBSITES">
      <p className="ml-2 mt-2 text-center text-white text-sm">
        Check all sites included on our trusted list.
      </p>

      <Form
        id="trusted"
        name="trusted"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        autoComplete="off"
        className="flex flex-col gap-4 items-center justify-center text-center"
      >
        <Form.Item
          name="search"
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
            className="px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full"
          />
        </Form.Item>
      </Form>

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled my-4 p-2 w-full h-72 overflow-auto">
          {filteredSearch &&
            filteredSearch.map((url: string) => (
              <li
                key={url}
                className="my-2 p-2 w-full text-xs border-b border-dashed border-bkg-3"
              >
                <p>{formatURL(url, 40)}</p>
              </li>
            ))}
        </ul>

        <div className="absolute bottom-12">
          <SecondaryButton type="button" onClick={() => navigate('/home')}>
            Close
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};

export default TrustedSitesView;
