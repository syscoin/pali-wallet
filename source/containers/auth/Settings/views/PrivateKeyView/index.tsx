import React, { useState } from 'react';
import { useFormat, useAccount, useUtils, useController } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';
import { Icon, SecondaryButton, InfoCard, CopyCard } from 'components/index';
import { Disclosure } from '@headlessui/react';
import { Input, Form } from 'antd';

const PrivateKeyView = () => {
  const controller = useController();
  const { history, useCopyClipboard } = useUtils();
  const { activeAccount } = useAccount();
  const { ellipsis } = useFormat();

  const [copied, copyText] = useCopyClipboard();
  const [valid, setValid] = useState<boolean>(false);

  const sysExplorer = controller.wallet.account.getSysExplorerSearch();

  return (
    <AuthViewLayout title="YOUR KEYS" id="your-keys-title">
      <div className="h-96 px-2 py-5 scrollbar-styled overflow-auto">
        <InfoCard>
          <p>
            <b className="text-warning-info">WARNING: </b>
            This is your account root indexer to check your full balance for{' '}
            {activeAccount?.label}, it isn't a receiving address. DO NOT SEND
            FUNDS TO THESE ADDRESSES, YOU WILL LOOSE THEM!
          </p>
        </InfoCard>

        <Disclosure>
          {({ open }) => (
            <>
              <Disclosure.Button
                className={`${
                  open ? 'rounded-t-lg' : 'rounded-lg'
                } w-full max-w-xs px-4 mt-6 py-2 flex justify-between items-center border border-bkg-1 text-xs cursor-pointer transition-all duration-300 bg-bkg-1`}
              >
                XPUB
                <Icon
                  name="select-down"
                  className={`${
                    open ? 'transform rotate-180' : ''
                  } mb-1 text-brand-white`}
                />
              </Disclosure.Button>

              <Disclosure.Panel className="cursor-pointer py-4 px-4 flex flex-col justify-start items-start rounded-b-lg w-80 border border-bkg-3 transition-all duration-300 bg-bkg-3">
                <div
                  className="flex justify-between text-xs w-full items-center"
                  onClick={() => copyText(String(activeAccount?.xpub))}
                >
                  <p>{ellipsis(activeAccount?.xpub, 4, 16)}</p>

                  <Icon name="copy" className="text-brand-white mb-1" />
                </div>
              </Disclosure.Panel>
            </>
          )}
        </Disclosure>

        <p className="text-xs mt-4">
          To see your private key, input your password
        </p>

        <Form
          className="flex justify-center items-center flex-col gap-8 text-center my-3 w-full max-w-xs"
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
                  if (controller.wallet.getPhrase(value)) {
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
          className="flex mt-4 justify-center text-xs cursor-pointer hover:text-brand-royalblue items-center gap-2"
          onClick={() =>
            window.open(`${sysExplorer}/xpub/${activeAccount?.xpub}`)
          }
        >
          <p>View account on explorer</p>

          <Icon name="select" className="mb-1" />
        </div>
      </div>

      <div className="absolute bottom-8">
        <SecondaryButton type="button" onClick={() => history.push('/home')}>
          {copied ? 'Copied' : 'Close'}
        </SecondaryButton>
      </div>
    </AuthViewLayout>
  );
};

export default PrivateKeyView;
