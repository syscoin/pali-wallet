import { Form, Input } from 'antd';
import { Button } from 'components/Button';
import { AuthViewLayout } from 'containers/common/Layout';
import React, { FC } from 'react';


interface ICustomRpc {}
const CustomRpc: FC<ICustomRpc> = ({}) => {
  return (
    <div>
      <AuthViewLayout title="CUSTOM RPC"> </AuthViewLayout>
      <Form
        className="flex justify-center items-center flex-col gap-4 text-center pt-4"
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{ remember: true }}
        autoComplete="off"
      >
        <Form.Item name="password">
          <Input placeholder="Network name" className="rounded-full w-full"/>
        </Form.Item>
        <Form.Item name="password">
          <Input placeholder="Blockbook URL" />
        </Form.Item>
        <Form.Item name="password">
          <Input placeholder="Chain ID" />
        </Form.Item>
      </Form>
      <div className="flex justify-center items-center pt-60">
        <Button type="submit">Save</Button>
      </div>
    </div>
  );
};
export default CustomRpc;
