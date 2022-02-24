import React, { useState } from 'react';
import {
  Layout,
  SecondaryButton,
  PrimaryButton,
  InfoCard,
} from 'components/index';
import { Form, Input } from 'antd';
import { useController, useAccount, useUtils } from 'hooks/index';
import TextArea from 'antd/lib/input/TextArea';

const DeleteWalletView = () => {
  const { navigate } = useUtils();
  const { activeAccount } = useAccount();

  const controller = useController();

  const [seedIsValid, setSeedIsValid] = useState<boolean>();

  const onSubmit = (data: any) => {
    if (controller.wallet.checkPassword(data.password)) {
      controller.wallet.deleteWallet(data.password);

      navigate('/');
    }
  };

  const [form] = Form.useForm();

  return (
    <Layout title="DELETE WALLET">
      <InfoCard>
        <p>
          <b className="text-warning-info">WARNING:</b> This will delete the
          wallet created with your current seed phrase. If in the future you
          want to use Pali again, you will need to create a new wallet.
        </p>
      </InfoCard>

      <p className="mr-28 my-3 text-left text-white text-xs">
        Please input your wallet password
      </p>

      <div className="flex flex-col items-center justify-center px-5 w-full">
        <Form
          form={form}
          onFinish={onSubmit}
          className="password flex flex-col gap-6 items-center justify-center w-full max-w-xs text-center"
          name="delete"
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
                  const seed = controller.wallet.getPhrase(value);

                  if (seed) {
                    return Promise.resolve();
                  }

                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input.Password
              placeholder="Enter your password"
              id="delete_password"
            />
          </Form.Item>

          {activeAccount && activeAccount.balance > 0 && (
            <p className="max-w-xs text-left text-xs leading-4">
              You still have funds in your wallet. Paste your seed phrase below
              to delete wallet.
            </p>
          )}

          {activeAccount && activeAccount.balance > 0 && (
            <Form.Item
              name="seed"
              className="w-full"
              dependencies={['password']}
              rules={[
                {
                  required: true,
                  message: '',
                },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    const seed = controller.wallet.getPhrase(
                      getFieldValue('password')
                    );

                    setSeedIsValid(seed === value);

                    if (seed === value) {
                      return Promise.resolve();
                    }

                    return Promise.reject();
                  },
                }),
              ]}
            >
              <TextArea
                className={`${
                  !seedIsValid && form.getFieldValue('seed')
                    ? 'border-warning-error'
                    : 'border-fields-input-border'
                } bg-bkg-4 border border-bkg-4 text-sm outline-none rounded-lg p-5`}
                placeholder="Paste your wallet seed phrase"
                id="delete_seed"
              />
            </Form.Item>
          )}

          <div className="absolute bottom-12 flex gap-x-4 justify-between">
            <SecondaryButton
              type="button"
              onClick={() => navigate('/home')}
              action
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton
              action
              type="submit"
              disabled={!form.getFieldValue('password') || !seedIsValid}
              id="delete-btn"
            >
              Delete
            </PrimaryButton>
          </div>
        </Form>
      </div>
    </Layout>
  );
};

export default DeleteWalletView;
