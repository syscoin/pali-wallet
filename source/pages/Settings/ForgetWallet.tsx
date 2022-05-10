import React, { useState } from 'react';
import { Layout, SecondaryButton, PrimaryButton, Card } from 'components/index';
import { Form, Input } from 'antd';
import { useUtils, useStore } from 'hooks/index';
import TextArea from 'antd/lib/input/TextArea';
import { getController } from 'utils/browser';

const ForgetWalletView = () => {
  const { navigate } = useUtils();

  const controller = getController();
  const { activeAccount } = useStore();

  if (!activeAccount) throw new Error('No active account');
  const hasAccountFunds = activeAccount.balances.syscoin > 0;

  // if account has no funds, no need to input the seed
  const [isSeedValid, setIsSeedValid] = useState<boolean>(!hasAccountFunds);
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  const onSubmit = ({ password }: { password: string }) => {
    controller.wallet.forgetWallet(password);

    navigate('/');
  };

  const [form] = Form.useForm();

  return (
    <Layout title="FORGET WALLET">
      <Card type="info" className="md:mt-8">
        <p>
          <b className="text-warning-info">WARNING:</b> This will forget the
          wallet created with your current seed phrase. If in the future you
          want to use Pali again, you will need to create a new wallet using
          your seed or creating a new one.
        </p>
      </Card>

      <div className="flex flex-col items-center justify-center px-5 w-full">
        <p className="my-3 w-full max-w-xs text-left text-white text-xs md:max-w-md">
          Please input your wallet password
        </p>
        <Form
          form={form}
          onFinish={onSubmit}
          className="password flex flex-col gap-6 items-center justify-center w-full max-w-xs text-center md:max-w-md"
          name="forget"
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
                  const seed = controller.wallet.getSeed(value);

                  if (seed) {
                    setIsPasswordValid(true);
                    return Promise.resolve();
                  }

                  setIsPasswordValid(false);
                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input.Password
              className="password"
              placeholder="Enter your password"
              id="forget_password"
            />
          </Form.Item>

          {hasAccountFunds && (
            <>
              <p className="max-w-xs text-left text-xs leading-4 md:max-w-md">
                You still have funds in your wallet. Paste your seed phrase
                below to forget wallet.
              </p>

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
                      const seed = controller.wallet.getSeed(
                        getFieldValue('password')
                      );

                      if (seed === value) {
                        setIsSeedValid(true);
                        return Promise.resolve();
                      }

                      setIsSeedValid(false);
                      return Promise.reject();
                    },
                  }),
                ]}
              >
                <TextArea
                  className={`${
                    !isSeedValid && form.getFieldValue('seed')
                      ? 'border-warning-error'
                      : 'border-fields-input-border'
                  } bg-fields-input-primary p-2 pl-4 w-full h-20 text-brand-graylight text-sm border focus:border-fields-input-borderfocus rounded-lg outline-none resize-none`}
                  placeholder="Paste your wallet seed phrase"
                  id="forget_seed"
                />
              </Form.Item>
            </>
          )}

          <div className="absolute bottom-12 flex gap-x-8 justify-between md:static md:gap-x-40">
            <PrimaryButton type="button" onClick={() => navigate('/home')}>
              Cancel
            </PrimaryButton>

            <SecondaryButton
              type="submit"
              disabled={!isPasswordValid || !isSeedValid}
              id="forget-btn"
            >
              Forget
            </SecondaryButton>
          </div>
        </Form>
      </div>
    </Layout>
  );
};

export default ForgetWalletView;
