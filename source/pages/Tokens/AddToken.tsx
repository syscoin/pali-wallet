import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React from 'react';
import { useState, FC } from 'react';

import { Layout } from 'components/index';

import { CustomToken } from './CustomToken';
import { ImportToken } from './ImportToken';

export const AddToken: FC = () => {
  const [form] = Form.useForm();

  const [importCustom, setImportCustom] = useState(false);

  return (
    <Layout title="IMPORT TOKEN">
      <Form
        form={form}
        validateMessages={{ default: '' }}
        id="token"
        name="token"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        autoComplete="off"
        className="standard flex flex-col gap-2 items-center justify-center text-center"
      >
        <Form.Item
          id="network-switch"
          name="network-switch"
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          <div className="flex gap-x-2 my-4 text-xs">
            <p>Search</p>

            <Switch
              checked={importCustom}
              onChange={() => setImportCustom(!importCustom)}
              className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
            >
              <span className="sr-only">Search or custom token</span>
              <span
                className={`${
                  importCustom
                    ? 'translate-x-6 bg-brand-royalblue'
                    : 'translate-x-1 bg-brand-deepPink100'
                } inline-block w-2 h-2 transform rounded-full`}
              />
            </Switch>

            <p>Custom token</p>
          </div>
        </Form.Item>
      </Form>

      {importCustom ? <CustomToken /> : <ImportToken />}
    </Layout>
  );
};
