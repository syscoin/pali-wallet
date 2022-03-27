import React, { useState } from 'react';
import { Layout, SecondaryButton, PrimaryButton, Card } from 'components/index';
import { Form, Input } from 'antd';
import { useUtils } from 'hooks/index';
import TextArea from 'antd/lib/input/TextArea';
import { getController } from 'utils/browser';

const ForgetWalletView = () => {
  const { navigate } = useUtils();

  const controller = getController();
  const activeAccount = controller.wallet.account.getActiveAccount();

  if (!activeAccount) throw new Error('No active account');
  const hasAccountFunds = activeAccount.balance > 0;

  // if account has no funds, no need to input the seed
  const [isSeedValid, setIsSeedValid] = useState<boolean>(!hasAccountFunds);
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  const onSubmit = (data: any) => {
    if (controller.wallet.checkPassword(data.password)) {
      controller.wallet.forgetWallet(data.password);

      navigate('/');
    }
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
                  const seed = controller.wallet.getPhrase(value);

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
                      const seed = controller.wallet.getPhrase(
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
                  } bg-bkg-4 border border-bkg-4 text-sm outline-none rounded-lg p-5`}
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
