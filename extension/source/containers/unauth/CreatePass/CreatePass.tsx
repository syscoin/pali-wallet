import React from 'react';
import { useController, useUtils } from 'hooks/index';
import { Button, Form, Input } from 'antd';
import { changeBackgroundLinear, changeBackground } from '../../../constants'
import { Layout } from '../../common/Layout';

const CreatePass = () => {
  const { history } = useUtils();
  const controller = useController();

  const onSubmit = (data: any) => {
    try {
      controller.wallet.setWalletPassword(data.password);

      history.push('/create/phrase/generated');
    } catch (error) {
      console.log('error', error);
    }
  };

  return (
    <Layout
      title="Password"
      onlySection
    >
      <Form
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex justify-center text-justify items-center flex-col gap-4 mt-8 text-center"
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

        <span className="font-light text-brand-graylight text-sm">
          At least 8 characters, 1 lower-case and 1 numeral.
        </span>

        <span className="font-light text-brand-royalBlue text-sm mx-4 p-7">
          Do not forget to save your password. You will need this password to unlock your wallet.
        </span>
        <div className="p-0.5 bg-primary rounded-full">
          <Button
            htmlType="submit"
            onMouseEnter={changeBackgroundLinear}
            onMouseLeave={changeBackground}
            className="bottom-12 tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-navy text-brand-white font-light"
          >
            Next
          </Button>
        </div>
      </Form>
    </Layout>
  );
};

export default CreatePass;
