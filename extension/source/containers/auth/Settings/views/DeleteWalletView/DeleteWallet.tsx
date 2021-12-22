import React from 'react';
import { SecondaryButton, PrimaryButton } from 'components/index';
import { AuthViewLayout } from 'containers/common/Layout';
import { Form, Input } from 'antd';
import { useController, useAccount, useUtils } from 'hooks/index';

const DeleteWalletView = () => {
  const { history } = useUtils();
  const { activeAccount } = useAccount();

  const controller = useController();

  const onSubmit = (data: any) => {
    if (controller.wallet.checkPassword(data.password)) {
      controller.wallet.deleteWallet(data.password);

      history.push('/app.html');

      return;
    }
  };

  const [form] = Form.useForm();

  const password = form.getFieldValue('password');
  const seed = form.getFieldValue('seed');
  const walletSeedPhrase = controller.wallet.getPhrase(password);

  const canDeleteWallet = !password ||
    !seed ||
    !walletSeedPhrase ||
    walletSeedPhrase !== seed;

  return (
    <AuthViewLayout title="DELETE WALLET">
      <p className="text-white text-sm py-3 px-10 mt-8">
        Please input your wallet password
      </p>

      <div className="flex justify-center items-center flex-col">
        <Form
          form={form}
          onFinish={onSubmit}
          className="flex justify-center items-center flex-col gap-8 text-center pt-4 mb-12"
          name="delete"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
        >
          <Form.Item
            name="password"
            hasFeedback
            rules={[
              {
                required: true,
                message: '',
              },
              ({ }) => ({
                validator(_, value) {
                  const seed = controller.wallet.getPhrase(value);

                  if (seed) {
                    return Promise.resolve();
                  }

                  return Promise.reject('');
                },
              }),
            ]}
          >
            <Input.Password
              className="phrase-input rounded-full py-2 px-4 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none"
              placeholder="Enter your password"
            />
          </Form.Item>

          {activeAccount && activeAccount.balance > 0 && (
            <>
              <p className="bg-brand-navydark border border-dashed border-brand-deepPink100 mx-6 p-4 text-xs rounded-lg">
                <b>WARNING:</b> You still have funds in your wallet. Paste your seed phrase below to delete wallet.
              </p>

              <div
                className="flex flex-col justify-center items-center gap-3 bg-brand-navydarker border border-dashed border-brand-royalBlue mx-6 my-8 p-2 text-xs w-72 rounded-lg"
              >
                <Form.Item
                  name="seed"
                  dependencies={['password']}
                  rules={[
                    {
                      required: true,
                      message: '',
                    },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        const seed = controller.wallet.getPhrase(getFieldValue('password'));

                        if (seed === value) {
                          return Promise.resolve();
                        }

                        return Promise.reject('');
                      },
                    }),
                  ]}
                >
                  <Input
                    className="bg-brand-navydarker border border-brand-navydarker text-sm w-60 outline-none py-2"
                    placeholder="Your seed phrase"
                  />
                </Form.Item>
              </div>
            </>
          )}

          <div className="absolute bottom-12 flex justify-between gap-x-4">
            <SecondaryButton
              type="button"
              onClick={() => history.push('/home')}
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              disabled={canDeleteWallet}
            >
              Delete
            </PrimaryButton>
          </div>
        </Form>
      </div>
    </AuthViewLayout>
  );
};

export default DeleteWalletView;
