import React, { useState, FC, useEffect } from 'react';
import { AuthViewLayout } from 'containers/common/Layout';
import { PrimaryButton, SecondaryButton, Tooltip, Icon, IconButton } from 'components/index';
import { useTransaction, useController, useUtils, useStore } from 'hooks/index';
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
  const { currentSenderURL } = useStore();
  const { handleRejectTransaction } = useTransaction();

  const [loading, setLoading] = useState<boolean>(false);
  const [recommend, setRecommend] = useState(0.00001);
  const [form] = Form.useForm();

  const temporaryTransaction = controller.wallet.account.getTransactionItem()[temporaryTransactionAsString];

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

  return (
    <AuthViewLayout canGoBack={false} title={layoutTitle.toUpperCase()}>
      <div className="flex flex-col justify-center items-center">
        <h1 className="text-sm mt-4">FEE</h1>

        <p className="text-brand-royalBlue text-sm">
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
              className="w-12 py-1.5 bg-brand-navyborder border border-brand-royalBlue rounded-l-full text-center"
              rules={[
                {
                  required: false,
                  message: ''
                },
              ]}
            >
              <Tooltip content="Click to use the recommended fee">
                <IconButton
                  onClick={handleGetFee}
                >
                  <Icon
                    wrapperClassname="w-6 mb-1"
                    name="verified"
                    className="text-brand-green"
                  />
                </IconButton>
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
              <Input
                className="outline-none rounded-r-full py-3 pr-8 w-60 pl-4 bg-brand-navyborder border border-brand-royalBlue text-sm"
                type="number"
                placeholder="Fee"
              />
            </Form.Item>
          </div>

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
