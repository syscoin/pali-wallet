import { Form, Input } from 'antd';
import { Button } from 'components/Button';
import { WarningCard } from 'components/Cards';
import { AuthViewLayout } from 'containers/common/Layout';
import React, { FC } from 'react';
import ConfirmTokenCreate from './ConfirmTokenCreate';
interface ICreateTokenView {}
const CreateTokenView: FC<ICreateTokenView> = ({}) => {
  const confirmTokenCreate = false;
  return (
    <div>
      {confirmTokenCreate ? (
        <>
          <AuthViewLayout title="CREATE TOKEN"> </AuthViewLayout>
          <Form
            className="flex justify-center items-center flex-col gap-4 text-center pt-4"
            name="basic"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 16 }}
            initialValues={{ remember: true }}
            autoComplete="off"
          >
            <div>
              <p className="text-center text-white">FEE</p>
            </div>
            <Form.Item name="password">
              <Input className="rounded-full w-full" />
            </Form.Item>
          </Form>
          <div>
            <WarningCard
              className="w-full rounded text-brand-white border-dashed border border-light-blue-500 text-justify mt-4"
              children="With the current network conditions, we recommend a fee of 0.00001 SYS"
            />
          </div>
          <div className="flex justify-center items-center flex-col gap-1 text-center pt-4 ">
            <Button className="inline-flex" type="submit">
              Reject
            </Button>
            <Button className="inline-flex" type="submit">
              Next
            </Button>
          </div>
        </>
      ) : (
        <>
          <ConfirmTokenCreate />
        </>
      )}
    </div>
  );
};
export default CreateTokenView;
