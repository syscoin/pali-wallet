import React from 'react';
import { PrimaryButton, Link } from 'components/index';
import { useController } from 'hooks/index';
import LogoImage from 'assets/images/logo-s.svg';
import { Form, Input } from 'antd';

export const Start = () => {
  const controller = useController();

  const onSubmit = async (data: any) => {
    await controller.wallet.unLock(data.password);
  };

  return (
    <div className="flex flex-col items-center justify-center mt-12 p-2 min-w-full">
      <p className="mb-2 text-center text-brand-deepPink100 text-lg font-normal tracking-wider">
        WELCOME TO
      </p>

      <h1 className="m-0 text-center text-brand-royalblue font-poppins text-4xl font-bold tracking-wide leading-4">
        Pali Wallet
      </h1>

      <img src={LogoImage} className="my-8 w-52" alt="syscoin" />

      <Form
        className="flex flex-col gap-8 items-center justify-center w-full max-w-xs text-center"
        name="basic"
        onFinish={onSubmit}
        autoComplete="off"
        id="login"
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
              async validator(_, value) {
                if (await controller.wallet.unLock(value)) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input.Password placeholder="Enter your password" />
        </Form.Item>

        <PrimaryButton type="submit">Unlock</PrimaryButton>
      </Form>

      <Link
        className="mt-12 hover:text-brand-graylight text-brand-royalblue text-base font-light transition-all duration-300"
        to="/import"
      >
        Import using wallet seed phrase
      </Link>
    </div>
  );
};
