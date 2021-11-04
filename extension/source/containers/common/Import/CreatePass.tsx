import React, { useState } from 'react';  
import { useController } from 'hooks/index';
import { Form, Input } from 'antd';
import Button from 'components/Button';
import Layout from '../../common/Layout';
import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import { useHistory } from 'react-router-dom';

const CreatePass = () => {
  const controller = useController();
  const history = useHistory();

  const { tabs }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const [passed, setPassed] = useState<boolean>(false);

  const nextHandler = () => {
    if (passed) {
      controller.wallet.createWallet(true);

      if (tabs.canConnect) {
        history.push('/connect-wallet');
      } else {
        history.push('/home');
      }
    }
  };

  const onSubmit = (data: any) => {
    controller.wallet.setWalletPassword(data.password);
    setPassed(true);
  };

  return (
    <Layout
      title="Password"
      onlySection
      linkTo="/app.html"
    >
      <Form
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex justify-center items-center flex-col gap-4 mt-8 text-center"
      >
        <Form.Item
          name="password"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
            {
              pattern: /^(?=.*[a-z])(?=.*[0-9])(?=.{8,})/,
              message: ''
            }
          ]}
        >
          <Input.Password placeholder="New password (min 8 chars)" />
        </Form.Item>

        <Form.Item
          name="repassword"
          dependencies={['password']}
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }

                return Promise.reject('');
              },
            }),
          ]}
        >
          <Input.Password placeholder="Confirm password" />
        </Form.Item>

        <span className="font-light text-brand-graylight text-xs">
          At least 8 characters, 1 lower-case and 1 numeral.
        </span>

        <span className="font-light text-brand-royalBlue text-xs mx-4">
          Do not forget to save your password. You will need this password to unlock your wallet.
        </span>

        <Button
          type={passed ? 'button' : 'submit'}
          onClick={nextHandler}
          className="absolute bottom-12 tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-navy text-brand-white font-light border border-brand-royalBlue hover:bg-brand-royalBlue hover:text-brand-navy transition-all duration-300"
        >
          Next
        </Button>
      </Form>
    </Layout>
  );
};

export default CreatePass;
