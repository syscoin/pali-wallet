import { SecondaryButton } from 'components/index';
import { AuthViewLayout } from 'containers/common/Layout';
import React, { useState } from 'react';
import { useUtils, useFormat, useStore } from 'hooks/index';
import { Form, Input } from 'antd';

const TrustedSitesView = () => {
  const { formatURL } = useFormat();
  const { history } = useUtils();
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
      <p className="text-white text-sm text-center mt-2 ml-2 mb-2">
        Check all sites included on our trusted list.
      </p>

      <Form
        id="trusted"
        name="trusted"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        autoComplete="off"
        className="flex justify-center items-center flex-col gap-4 text-center"
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
            className="rounded-full py-2 px-4 w-72 bg-fields-input-primary border border-fields-input-border text-sm focus:border-fields-input-borderfocus"
          />
        </Form.Item>
      </Form>

      <div className="flex flex-col justify-center items-center w-full">
        <ul className="scrollbar-styled h-72 my-4 overflow-auto w-full p-2">
          {filteredSearch &&
            filteredSearch.map((url: string) => (
              <li
                key={url}
                className="my-2 p-2 border-b border-dashed border-bkg-3 w-full text-xs"
              >
                <p>{formatURL(url, 40)}</p>
              </li>
            ))}
        </ul>

        <div className="absolute bottom-12">
          <SecondaryButton type="button" onClick={() => history.push('/home')}>
            Close
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};

export default TrustedSitesView;
