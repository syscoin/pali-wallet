import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import { Form, Input } from 'antd';

import Layout from '../../common/Layout';

import * as consts from './consts';

const CreatePass = () => {
  const history = useHistory();
  const controller = useController();
  const [passed, setPassed] = useState<boolean>(false);
  const title = passed ? consts.CREATE_PASS_TITLE2 : consts.CREATE_PASS_TITLE1;

  const nextHandler = () => {
    if (passed) {
      history.push('/create/phrase/generated');
    }
  };

  const onSubmit = (data: any) => {
    console.log('data password', data.password)
    controller.wallet.setWalletPassword(data.password);
    setPassed(true);
  };

  const onFinishFailed = (errorInfo: any) => {
    console.log('Failed:', errorInfo);
  };

  return (
    <Layout title={title} linkTo="/app.html">
      <Form
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        onFinishFailed={onFinishFailed}
        autoComplete="off"
      >
        <Form.Item
          label="Password"
          name="password"
          hasFeedback
          tooltip="You will need this password to create your wallet."
          rules={[
            {
              required: true,
              message: 'Password is a required field.'
            },
            {
              pattern: /^(?=.*[a-z])(?=.*[0-9])(?=.{8,})/,
              message: 'Please, check the requirements below.'
            }
          ]}
        >
          <Input.Password className="bg-brand-graymedium" />
        </Form.Item>

        <Form.Item
          name="repassword"
          dependencies={['password']}
          hasFeedback
          rules={[
            {
              required: true,
              message: 'Please, confirm your password.'
            },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }

                return Promise.reject(new Error('The two passwords that you entered do not match.'));
              },
            }),
          ]}
        >
          <Input.Password />
        </Form.Item>

        <span>
          At least 8 characters, 1 lower-case, 1 numeral.
        </span>

        <Button
          type={passed ? 'button' : 'submit'}
          onClick={nextHandler}
        >
          Next
        </Button>
      </Form>
    </Layout>
  );
};

export default CreatePass;
