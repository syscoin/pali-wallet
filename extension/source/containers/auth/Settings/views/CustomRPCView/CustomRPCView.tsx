import React from 'react';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { Form, Input } from 'antd';
import { Button } from 'components/Button';

const CustomRPCView = () => {
  const onSubmit = (data: any) => {
    console.log('data', data)
  }

  return (
    <AuthViewLayout title="CUSTOM RPC">
      <Form
        id="send"
        name="send"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex justify-center items-center flex-col gap-4 mt-8 text-center"
      >
        <Form.Item
          name="custom-name"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
          ]}
        >
          <Input
            type="text"
            placeholder="Network name"
            className="ant-input rounded-full py-3 pl-4 pr-24 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none"
          />
        </Form.Item>

        <Form.Item
          name="custom-url"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
          ]}
        >
          <Input
            type="text"
            placeholder="Blockbook URL"
            className="ant-input rounded-full py-3 pl-4 pr-24 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none"
          />
        </Form.Item>

        <Form.Item
          name="custom-chainid"
          hasFeedback
          rules={[
            {
              required: false,
              message: ''
            },
          ]}
        >
          <Input
            disabled={true}
            type="text"
            placeholder="Chain ID"
            className={`${true ? 'ant-input rounded-full py-3 pl-4 pr-24 bg-brand-navydarker bg-opacity-60 border border-brand-gray100 cursor-not-allowed text-sm' : 'ant-input rounded-full py-3 pl-4 pr-24 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none'}`}
          />
        </Form.Item>
       
        <Button
          type="submit"
          className="bg-brand-navydarker"
          classNameBorder="absolute bottom-12"
        >
          Next
        </Button>
      </Form>
    </AuthViewLayout>
  );
};

export default CustomRPCView;