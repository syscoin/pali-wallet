import React, { useState } from 'react';
import { Layout, SecondaryButton, PrimaryButton, Card } from 'components/index';
import { Form, Input } from 'antd';
import { useUtils } from 'hooks/index';
import TextArea from 'antd/lib/input/TextArea';
import { getController } from 'utils/index';

const DeleteWalletView = () => {
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
      controller.wallet.deleteWallet(data.password);

      navigate('/');
    }
  };

  const [form] = Form.useForm();

  return (
    <Layout title="DELETE WALLET">
      <Card type="info" className="md:mt-8">
        <p>
          <b className="text-warning-info">WARNING:</b> This will delete the
          wallet created with your current seed phrase. If in the future you
          want to use Pali again, you will need to create a new wallet.
        </p>
      </Card>

      <div className="flex flex-col items-center justify-center px-5 w-full">
        <p className="my-5 w-full max-w-xs text-left text-white text-xs sm:max-w-xl">
          Please input your wallet password
        </p>

        <Form
          form={form}
          onFinish={onSubmit}
          className="password w-full max-w-xs text-center sm:max-w-xl"
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
              id="delete_password"
            />
          </Form.Item>

          {hasAccountFunds && (
            <>
              <p className="my-5 text-left text-xs leading-4">
                You still have funds in your wallet. Paste your seed phrase
                below to delete wallet.
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
                  id="delete_seed"
                />
              </Form.Item>
            </>
          )}

          <div className="flex gap-x-8 justify-between sm:absolute sm:bottom-48">
            <SecondaryButton type="button" onClick={() => navigate('/home')}>
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              disabled={!isPasswordValid || !isSeedValid}
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
