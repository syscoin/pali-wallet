import React, { useState, FC, useEffect } from 'react';
import {
  Layout,
  PrimaryButton,
  SecondaryButton,
  Tooltip,
  Icon,
} from 'components/index';
import {
  useTransaction,
  useController,
  useUtils,
  useStore,
  useBrowser,
} from 'hooks/index';
import { Form, Input } from 'antd';

interface ITxLayout {
  confirmRoute: string;
  title: string;
  txType: string;
}

export const TxLayout: FC<ITxLayout> = ({ confirmRoute, txType, title }) => {
  const controller = useController();

  const { navigate, getHost } = useUtils();
  const { currentSenderURL, activeNetwork } = useStore();
  const { handleRejectTransaction } = useTransaction();
  const { browser } = useBrowser();

  const [loading, setLoading] = useState<boolean>(false);
  const [recommend, setRecommend] = useState(0.00001);
  const [form] = Form.useForm();

  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction(txType);

  const handleGetFee = async () => {
    const recommendFee = await controller.wallet.account.getRecommendFee();

    setRecommend(recommendFee);

    form.setFieldsValue({ fee: recommendFee });
  };

  useEffect(() => {
    handleGetFee();
  }, []);

  const handleCreateTemporaryTransaction = ({ fee }) => {
    controller.wallet.account.updateTemporaryTransaction({
      tx: {
        ...temporaryTransaction,
        fee,
      },
      type: txType,
    });

    setLoading(true);

    navigate(confirmRoute);
  };

  const disabledFee = activeNetwork === 'main' || activeNetwork === 'testnet';

  return (
    <Layout canGoBack={false} title={title.toUpperCase()}>
      <div className="flex flex-col items-center justify-center">
        <h1 className="mt-4 text-sm">FEE</h1>

        <p className="text-brand-royalblue text-sm">
          {getHost(`${currentSenderURL}`)}
        </p>

        <Form
          form={form}
          id="site"
          labelCol={{ span: 8 }}
          initialValues={{ fee: recommend }}
          wrapperCol={{ span: 8 }}
          onFinish={handleCreateTemporaryTransaction}
          autoComplete="off"
          className="flex flex-col gap-3 items-center justify-center mt-4 text-center"
        >
          <div className="flex gap-x-0.5 items-center justify-center mx-2">
            <Form.Item
              name="recommend"
              className={`${
                disabledFee && 'opacity-50 cursor-not-allowed'
              } bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus w-16 py-1.5 rounded-l-full text-center`}
              rules={[
                {
                  required: false,
                  message: '',
                },
              ]}
            >
              <Tooltip
                content={`${
                  disabledFee
                    ? 'Use recommended fee. Disabled for SYS networks because the fee used in transactions is always the recommended for current SYS network conditions.'
                    : 'Click to use the recommended fee'
                }`}
              >
                <div onClick={handleGetFee}>
                  <Icon
                    wrapperClassname="w-6 ml-5 mb-1"
                    name="verified"
                    className={`${
                      disabledFee
                        ? 'cursor-not-allowed text-button-disabled'
                        : 'text-warning-success'
                    }`}
                  />
                </div>
              </Tooltip>
            </Form.Item>

            <Form.Item
              name="fee"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: '',
                },
              ]}
            >
              <Tooltip content={disabledFee ? 'Fee network' : ''}>
                <Input
                  disabled={disabledFee}
                  className={`${
                    disabledFee &&
                    'opacity-50 cursor-not-allowed text-button-disabled'
                  } border border-fields-input-border bg-fields-input-primary rounded-r-full w-full md:max-w-2xl outline-none py-3 pr-24 pl-4 text-sm`}
                  type="number"
                  placeholder="Fee network"
                  value={recommend}
                />
              </Tooltip>
            </Form.Item>
          </div>

          <p className="mt-4 mx-6 p-4 max-w-xs text-left text-xs bg-transparent border border-dashed border-gray-600 rounded-lg md:max-w-2xl">
            With current network conditions, we recommend a fee of
            {recommend} SYS.
          </p>

          <div className="absolute bottom-10 flex gap-3 items-center justify-between w-full max-w-xs md:max-w-2xl">
            <SecondaryButton
              type="button"
              action
              onClick={() =>
                handleRejectTransaction(browser, temporaryTransaction, navigate)
              }
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton action type="submit" loading={loading}>
              Next
            </PrimaryButton>
          </div>
        </Form>
      </div>
    </Layout>
  );
};
