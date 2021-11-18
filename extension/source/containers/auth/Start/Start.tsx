import React from 'react';
import { Link } from 'components/index';
import { useController } from 'hooks/index';
import LogoImage from 'assets/images/logo-s.svg';
import { Button, Form, Input } from 'antd';
import { changeBackgroundLinear, changeBackground } from '../../../constants'

export const Start = () => {
  const controller = useController();

  const onSubmit = (data: any) => {
    controller.wallet.unLock(data.password);
  };
  
  return (
    <div className="mt-16 flex justify-center items-center flex-col min-w-full p-2">
      <p className=" text-brand-deepPink100 text-center text-lg  font-normal mb-2 tracking-wider">WELCOME TO</p>

      <h1 className=" text-brand-royalBlue font-bold text-center text-4xl m-0 font-sans leading-4 tracking-wide"
      >Pali Wallet</h1>

      <img src={LogoImage} className="w-52 my-8" alt="syscoin" />

      <Form
        className="flex justify-center items-center flex-col gap-8 text-center"
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
      >
        <Form.Item
          name="password"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
            ({}) => ({
              validator(_, value) {
                console.log('value pass',controller.wallet.unLock(value))
                if (controller.wallet.unLock(value)) {
                  return Promise.resolve();
                }

                return Promise.reject('');
              },
            }),
          ]}
        >
          <Input.Password placeholder="Enter your password" />
        </Form.Item>
        <div className="p-0.5 bg-primary rounded-full">
          <Button
            onMouseEnter={changeBackgroundLinear}
            onMouseLeave={changeBackground}
            className="bg-brand-navy tracking-normal text-base py-2.5 px-12 cursor-pointer rounded-full text-brand-white"
          >
            Unlock
          </Button>
        </div>
      </Form>
      
      <Link className="font-light mt-12 text-base text-brand-graylight hover:text-brand-royalBlue transition-all duration-300" to="/import">
        Import using wallet seed phrase
      </Link>
    </div>
  );
};

export default Start;
