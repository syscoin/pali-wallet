import React, { useState } from 'react';
import { Button } from 'components/index';;
// import { useController, useUtils, useStore } from 'hooks/index';
// import IWalletState from 'state/wallet/types';
// import { useSelector } from 'react-redux';
// import { RootState } from 'state/store';

import { Form, Input } from 'antd';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
const AutolockView = () => {
    const [autolock, setAutolock] = useState<boolean>(false);
  // const [confirmed, setConfirmed] = useState<boolean>(false);
  // const controller = useController();
  // const { timer } = useStore();
  // const { alert, history } = useUtils();

  // const [loading, setLoading] = useState<boolean>(false);
  // const [minutes, setMinutes] = useState<string>(String(timer));

  // const onSubmit = async (data: any) => {
  //   setLoading(true);
  //   controller.wallet.account.setAutolockTimer(data.minutes);
  //   setConfirmed(true);
  // };

  // const handleMinutesChange = useCallback(
  //   (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  //     setMinutes(event.target.value.replace(/[^0-9]/g, '').replace(/(\..*?)\*/g, '$1'));

  //     if (Number(event.target.value) > 30 ) {
  //       alert.removeAll();
  //       alert.error('Maximum 30 minutes of no activity.', { timeout: 2000 })
  //     }
  //   },
  //   []
  // );
  const handleConfirm = () => {
    if (!autolock) {
        setAutolock(true);
      return;
    }
  };
  return (
    <div >
        <AuthViewLayout title="AUTO LOCK TIMER">You can set auto lock timer. Default is 5 minutes after no activity</AuthViewLayout>
        <Form
          className="flex justify-center items-center flex-col gap-8 text-center pt-4"
          name="basic"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          initialValues={{ remember: true }}
          autoComplete="off"
        >
            <Form.Item
                name="password"
            >
                <Input />
            </Form.Item>
        </Form>
        <div className="flex justify-center items-center pt-60">
          <Button
            type="submit"
            onClick={handleConfirm}
          >
              Save
          </Button>
        </div>
        {autolock && (
          <div className="transition-all duration-300 ease-in-out">
            <div className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent" />

            <div className="transition-all duration-300 ease-in-out fixed z-10 flex flex-col bg-brand-royalBlue top-1/3 left-8 right-8 p-6 rounded-3xl">
              <h2 className="pb-4 text-brand-white border-b border-dashed border-brand-graylight w-full text-center mb-4">
                AUTO LOCK TIMER
              </h2>

              <span className="font-light text-brand-graylight text-base">
                After 20 minutes of no activity, your wallet will be locked
              </span>

              <Button
                type="submit"
                onClick={handleConfirm}
              >
                Ok!
              </Button>
            </div>
          </div>
        )}
  </div>
  );
};

export default AutolockView;