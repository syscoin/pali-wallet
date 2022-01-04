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
    }
  };

  const [form] = Form.useForm();

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
              ({}) => ({
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
              className="phrase-input rounded-full py-2 px-4 w-72 bg-fields-input-primary border border-fields-input-border text-sm focus:border-fields-input-borderfocus"
              placeholder="Enter your password"
            />
          </Form.Item>

          {activeAccount && activeAccount.balance > 0 ? (
            <p className="leading-4 bg-bkg-2 border border-dashed border-brand-deepPink100 mx-6 p-4 text-xs rounded-lg">
              <b>WARNING:</b> You still have funds in your wallet. Paste your
              seed phrase below to delete wallet.
            </p>
          ) : (
            <p className="leading-4 bg-bkg-2 border border-dashed border-brand-deepPink100 mx-6 p-4 text-xs rounded-lg">
              <b>WARNING:</b> This will delete the wallet created with your
              current seed phrase. If in the future you want to use Pali again,
              you will need to create a new wallet.
            </p>
          )}

          {activeAccount && activeAccount.balance > 0 && (
            <>
              <div className="flex flex-col justify-center items-center gap-3 bg-bkg-1 border border-dashed border-brand-royalblue mx-6 my-8 p-2 text-xs w-72 rounded-lg">
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
                        const seed = controller.wallet.getPhrase(
                          getFieldValue('password')
                        );

                        if (seed === value) {
                          return Promise.resolve();
                        }

                        return Promise.reject('');
                      },
                    }),
                  ]}
                >
                  <Input
                    className="bg-bkg-1 border border-bkg-1 text-sm w-60 outline-none py-2"
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

            <PrimaryButton type="submit">Delete</PrimaryButton>
          </div>
        </Form>
      </div>
    </AuthViewLayout>
  );
};

export default DeleteWalletView;
