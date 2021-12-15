import { Form, Input } from 'antd';
import { Button } from 'components/Button';
import { AuthViewLayout } from 'containers/common/Layout';
import React, { FC } from 'react';

interface IBlackList {}
const BlackList: FC<IBlackList> = ({}) => {
  return (
    <div>
      <AuthViewLayout title="BLACK LIST"> </AuthViewLayout>
      <div className="p-3 text-white">
        <p className="text-sm">Check all sites included on blacklist.</p>
        <Form
          name="basic"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          initialValues={{ remember: true }}
          autoComplete="off"
        >
          <Form.Item
            name="username"
          >
            <Input
              className="w-full rounded-full bg-brand-navydarker p-1 px-4 mt-2 border border-brand-navydark"
              placeholder="Search site"
            />
          </Form.Item>
        </Form>
        <div className='mt-4'>
          <div className="border-dashed border-b border-gray-200 border-opacity-10 py-2">
            <div className="flex text-xs">
              <div className="grid grid-cols-9 gap-1 w-full">
                <div className="col-span-3">
                  <p>app.uniswap.org</p>
                </div>
              </div>
            </div>
          </div>
          <div className="border-dashed border-b border-gray-200 border-opacity-10 py-2">
            <div className="flex text-xs">
              <div className="grid grid-cols-9 gap-1 w-full">
                <div className="col-span-3">
                  <p>pancakeswap.finance</p>
                </div>
              </div>
            </div>
          </div>
          <div className="border-dashed border-b border-gray-200 border-opacity-10 py-2">
            <div className="flex text-xs">
              <div className="grid grid-cols-9 gap-1 w-full">
                <div className="col-span-3">
                  <p>app.sushi.com/swap</p>
                </div>
              </div>
            </div>
          </div>
          <div className="border-dashed border-b border-gray-200 border-opacity-10 py-2">
            <div className="flex text-xs">
              <div className="grid grid-cols-9 gap-1 w-full">
                <div className="col-span-3">
                  <p>traderjoexyz.com</p>
                </div>
              </div>
            </div>
          </div>
          <div className="border-dashed border-b border-gray-200 border-opacity-10 py-2">
            <div className="flex text-xs">
              <div className="grid grid-cols-9 gap-1 w-full">
                <div className="col-span-3">
                  <p>app.uniswap.org</p>
                </div>
              </div>
            </div>
          </div>
          <div className="border-dashed border-b border-gray-200 border-opacity-10 py-2">
            <div className="flex text-xs">
              <div className="grid grid-cols-9 gap-1 w-full">
                <div className="col-span-3">
                  <p>pancakeswap.finance</p>
                </div>
              </div>
            </div>
          </div>
          <div className="border-dashed border-b border-gray-200 border-opacity-10 py-2">
            <div className="flex text-xs">
              <div className="grid grid-cols-9 gap-1 w-full">
                <div className="col-span-3">
                  <p>app.uniswap.org</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1 pt-4 p-4 text-white">
        <div className="pt-8 flex justify-center items-center">
          <Button type="submit">Close</Button>
        </div>
      </div>
    </div>
  );
};
export default BlackList;
