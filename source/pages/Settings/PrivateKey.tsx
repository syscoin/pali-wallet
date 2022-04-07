import React, { useState, useEffect } from 'react';
import { useUtils, useStore } from 'hooks/index';
import { ellipsis } from 'utils/index';
import { getController } from 'utils/browser';
import {
  Layout,
  Icon,
  SecondaryButton,
  Card,
  CopyCard,
} from 'components/index';
import { Input, Form } from 'antd';

const PrivateKeyView = () => {
  const controller = getController();
  const { activeAccount, activeNetwork } = useStore();

  const { navigate, useCopyClipboard, alert } = useUtils();

  const [copied, copyText] = useCopyClipboard();
  const [valid, setValid] = useState<boolean>(false);

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Successfully copied');
  }, [copied]);

  return (
    <Layout title="YOUR KEYS">
      <div className="scrollbar-styled px-2 py-5 h-96 overflow-auto md:h-full">
        <Card type="info">
          <p>
            <b className="text-warning-info">WARNING: </b>
            This is your account root indexer to check your full balance for{' '}
            {activeAccount?.label}, it isn't a receiving address. DO NOT SEND
            FUNDS TO THESE ADDRESSES, YOU WILL LOOSE THEM!
          </p>
        </Card>

        <CopyCard
          className="my-4"
          onClick={() => copyText(String(activeAccount?.xpub))}
          label="Your XPUB"
        >
          <p>{ellipsis(activeAccount?.xpub, 4, 16)}</p>
        </CopyCard>

        <p className="my-5 max-w-xs text-xs sm:text-center md:text-left">
          To see your private key, input your password
        </p>

        <Form
          className="password mx-auto my-3 w-full max-w-xs text-center md:max-w-xl"
          name="phraseview"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
        >
          <Form.Item
            name="password"
            hasFeedback
            className="w-full"
            rules={[
              {
                required: true,
                message: '',
              },
              () => ({
                validator(_, value) {
                  if (controller.wallet.getSeed(value)) {
                    setValid(true);

                    return Promise.resolve();
                  }

                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input.Password placeholder="Enter your password" />
          </Form.Item>
        </Form>

        <CopyCard
          className="my-3"
          onClick={
            valid ? () => copyText(String(activeAccount?.xprv)) : undefined
          }
          label="Your private key"
        >
          <p>
            {valid
              ? ellipsis(activeAccount?.xprv, 4, 16)
              : '********...************'}
          </p>
        </CopyCard>

        <div
          className="flex gap-2 items-center justify-center mt-4 hover:text-brand-royalblue text-xs cursor-pointer"
          onClick={() =>
            window.open(`${activeNetwork.url}/xpub/${activeAccount?.xpub}`)
          }
        >
          <p>View account on explorer</p>
          <Icon name="select" className="mb-1" />
        </div>
      </div>

      <div className="absolute bottom-8 md:static">
        <SecondaryButton type="button" onClick={() => navigate('/home')}>
          Close
        </SecondaryButton>
      </div>
    </Layout>
  );
};

export default PrivateKeyView;
