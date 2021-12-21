import React, { useState, FC } from 'react';
import { AuthViewLayout } from 'containers/common/Layout';
import { PrimaryButton, SecondaryButton } from 'components/index';
import { useController, useUtils, useBrowser, useStore } from 'hooks/index';
import { Form, Input } from 'antd';

interface ISiteTransaction {
  callbackToSetDataFromWallet: any;
  confirmRoute: string;
  itemStringToClearData: string;
  layoutTitle: string;
  messageToSetDataFromWallet: string;
}

export const SiteTransaction: FC<ISiteTransaction> = ({
  callbackToSetDataFromWallet,
  messageToSetDataFromWallet,
  confirmRoute,
  itemStringToClearData,
  layoutTitle,
}) => {
  const controller = useController();
  const { history, getHost } = useUtils();
  const { browser } = useBrowser();
  const { currentSenderURL } = useStore();

  const [loading, setLoading] = useState<boolean>(false);
  const [fee, setFee] = useState('0');
  const [recommend, setRecommend] = useState(0.00001);
  const [transacting, setTransacting] = useState(false);

  const handleGetFee = async () => {
    const recommendFee = await controller.wallet.account.getRecommendFee();

    setRecommend(recommendFee);
    setFee(String(recommendFee));
  };

  const handleMessageToSetDataFromWallet = ({ fee }) => {
    callbackToSetDataFromWallet({
      fee,
    });

    browser.runtime.sendMessage({
      type: messageToSetDataFromWallet,
      target: 'background',
    });

    setTransacting(true);
    setLoading(true);

    history.push(confirmRoute);
  };

  const handleRejectTransaction = () => {
    history.push('/home');

    browser.runtime.sendMessage({
      type: 'WALLET_ERROR',
      target: 'background',
      transactionError: true,
      invalidParams: false,
      message: 'Transaction rejected.',
    });

    browser.runtime.sendMessage({
      type: 'CANCEL_TRANSACTION',
      target: 'background',
      item: itemStringToClearData || null,
    });

    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });
  };

  return (
    <AuthViewLayout canGoBack={false} title={layoutTitle.toUpperCase()}>
      <div className="flex flex-col justify-center items-center">
        <h1 className="text-sm mt-4">FEE</h1>

        <p className="text-brand-royalBlue text-sm">{getHost(`${currentSenderURL}`)}</p>

        <Form
          id="site"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 8 }}
          onFinish={handleMessageToSetDataFromWallet}
          autoComplete="off"
          className="flex justify-center items-center flex-col gap-3 mt-4 text-center"
        >
          <Form.Item
            name="fee"
            hasFeedback
            rules={[
              {
                required: true,
                message: '',
                min: 0.00001
              },
            ]}
          >
            <Input
              className="rounded-full my-8 p-2 w-72 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none"
              type="number"
              placeholder="Fee"
            />
          </Form.Item>

          <p className="bg-brand-navydarker border text-left border-dashed border-brand-royalBlue mx-12 p-4 mt-4 text-xs rounded-lg">
            With current network conditions, we recommend a fee of {recommend} SYS.
          </p>

          <div className="flex justify-between items-center absolute bottom-10 gap-3">
            <SecondaryButton
              type="button"
              onClick={handleRejectTransaction}
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              loading={loading}
            >
              Next
            </PrimaryButton>
          </div>
        </Form>
      </div>
    </AuthViewLayout>
  );
};
