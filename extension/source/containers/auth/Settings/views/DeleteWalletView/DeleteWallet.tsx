import React, { useState } from 'react';
import { SecondaryButton, PrimaryButton, InfoCard } from 'components/index';
import { AuthViewLayout } from 'containers/common/Layout';
import { Form, Input } from 'antd';
import { useController, useAccount, useUtils } from 'hooks/index';
import TextArea from 'antd/lib/input/TextArea';

const DeleteWalletView = () => {
  const { history } = useUtils();
  const { activeAccount } = useAccount();

  const controller = useController();

  const [seedIsValid, setSeedIsValid] = useState<boolean>();

  const onSubmit = (data: any) => {
    if (controller.wallet.checkPassword(data.password)) {
      controller.wallet.deleteWallet(data.password);

      history.push('/app.html');

      return;
    }
  };

  const [form] = Form.useForm();

  return (
    <AuthViewLayout title="DELETE WALLET">
      <InfoCard>
        <p>
          <b className="text-warning-info">WARNING:</b> This will delete the wallet created with your current seed phrase. If in the future you want to use Pali again, you will need to create a new wallet.
        </p>
      </InfoCard>

      <p className="text-white text-xs text-left my-3 mr-28">
        Please input your wallet password
      </p>

      <div className="flex justify-center items-center flex-col">
        <Form
          form={form}
          onFinish={onSubmit}
          className="flex justify-center items-center flex-col text-center w-full max-w-xs gap-6"
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
              placeholder="Enter your password"
            />
          </Form.Item>

          {activeAccount && activeAccount.balance > 0 && (
            <p className="leading-4 text-left max-w-xs text-xs">
              You still have funds in your wallet. Paste your seed phrase below to delete wallet.
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
                    const seed = controller.wallet.getPhrase(getFieldValue('password'));

                    setSeedIsValid(seed === value)

                    if (seed === value) {
                      return Promise.resolve();
                    }

                    return Promise.reject('');
                  },
                }),
              ]}
            >
              <TextArea
                className={`${!seedIsValid && form.getFieldValue('seed') ? 'border-warning-error' : 'border-fields-input-border'} bg-bkg-4 border border-bkg-4 text-sm outline-none rounded-lg p-5`}
                placeholder="Paste your wallet seed phrase"
              />
            </Form.Item>
          )}

          <div className="absolute bottom-12 flex justify-between gap-x-4">
            <SecondaryButton
              type="button"
              onClick={() => history.push('/home')}
              action
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton
              action
              type="submit"
              disabled={!form.getFieldValue('password') || !seedIsValid}
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
