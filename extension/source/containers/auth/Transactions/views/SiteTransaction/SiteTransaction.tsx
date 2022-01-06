import React, { useState, FC, useEffect } from 'react';
import { AuthViewLayout } from 'containers/common/Layout';
import { PrimaryButton, SecondaryButton, Tooltip, Icon } from 'components/index';
import { useTransaction, useController, useUtils, useStore, useBrowser } from 'hooks/index';
import { Form, Input } from 'antd';

interface ISiteTransaction {
  confirmRoute: string;
  temporaryTransactionAsString: string;
  layoutTitle: string;
}

export const SiteTransaction: FC<ISiteTransaction> = ({
  confirmRoute,
  temporaryTransactionAsString,
  layoutTitle,
}) => {
  const controller = useController();

  const { history, getHost } = useUtils();
  const { currentSenderURL, activeNetwork } = useStore();
  const { handleRejectTransaction } = useTransaction();
  const { browser } = useBrowser();

  const [loading, setLoading] = useState<boolean>(false);
  const [recommend, setRecommend] = useState(0.00001);
  const [form] = Form.useForm();

  const temporaryTransaction = controller.wallet.account.getTemporaryTransaction(temporaryTransactionAsString);

  const handleGetFee = async () => {
    const recommendFee = await controller.wallet.account.getRecommendFee();

    setRecommend(recommendFee);

    form.setFieldsValue({
      fee: recommendFee,
    });
  };

  useEffect(() => {
    handleGetFee();
  }, []);

  const handleCreateTemporaryTransaction = ({ fee }) => {
    controller.wallet.account.updateTemporaryTransaction({
      tx: {
        ...temporaryTransaction,
        fee
      },
      type: temporaryTransactionAsString
    });

    setLoading(true);

    history.push(confirmRoute);
  };

  const disabledFee = activeNetwork === 'main' || activeNetwork === 'testnet';

  return (
    <AuthViewLayout canGoBack={false} title={layoutTitle.toUpperCase()}>
      <div className="flex flex-col justify-center items-center">
        <h1 className="text-sm mt-4">FEE</h1>

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
          className="flex justify-center items-center flex-col gap-3 mt-4 text-center"
        >
          <div className="mx-2 flex gap-x-0.5 justify-center items-center">
            <Form.Item
              name="recommend"
              className={`${disabledFee && 'opacity-50 cursor-not-allowed'} bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus w-16 py-1.5 rounded-l-full text-center`}
              rules={[
                {
                  required: false,
                  message: ''
                },
              ]}
            >
              <Tooltip content={`${disabledFee ? 'Use recommended fee. Disabled for SYS networks because the fee used in transactions is always the recommended for current SYS network conditions.' : 'Click to use the recommended fee'}`}>
                <div onClick={handleGetFee}>
                  <Icon
                    wrapperClassname="w-6 mb-1"
                    name="verified"
                    className={`${disabledFee ? 'cursor-not-allowed text-button-disabled' : 'text-warning-success'}`}
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
                  className={`${disabledFee && 'opacity-50 cursor-not-allowed text-button-disabled'} border border-fields-input-border bg-fields-input-primary rounded-r-full w-full md:max-w-md outline-none py-3 pr-24 pl-4 text-sm`}
                  type="number"
                  placeholder="Fee network"
                  value={recommend}
                />
              </Tooltip>
            </Form.Item>
          </div>

          <p className="bg-transparent border text-left border-dashed border-gray-600 max-w-xs md:max-w-md mx-6 p-4 mt-4 text-xs rounded-lg">
            With current network conditions, we recommend a fee of {recommend} SYS.
          </p>

          <div className="flex justify-between w-full max-w-xs md:max-w-md items-center absolute bottom-10 gap-3">
            <SecondaryButton
              type="button"
              action
              onClick={() => handleRejectTransaction(browser, temporaryTransaction, history)}
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton
              action
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
