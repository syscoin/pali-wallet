import { Form } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { PrimaryButton, SecondaryButton, Fee as FeeFC } from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

interface IFee {
  onFinish: (fee: number) => any;
}

const Fee: React.FC<IFee> = ({ onFinish }) => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );

  const [form] = Form.useForm();

  const [fee, setFee] = useState(0.0000001);

  const updateFee = async () => {
    const _fee = (await controllerEmitter(
      ['wallet', 'getRecommendedFee'],
      []
    )) as number;

    form.setFieldsValue({ fee: _fee });

    setFee(_fee);
  };

  useEffect(() => {
    updateFee();
  }, []);

  const getFeeLabel = () => {
    if (isBitcoinBased) {
      return t('components.feeRateLabel', {
        currency: activeNetwork.currency.toUpperCase(),
      });
    }
    return t('components.gasPriceLabel');
  };

  const getFeeDescription = () => {
    if (isBitcoinBased) {
      return t('transactions.withCurrentNetworkFeeRate', {
        fee,
        currency: activeNetwork.currency.toUpperCase(),
      });
    }
    return t('transactions.withCurrentNetworkGasPrice', { fee });
  };

  return (
    <div className="flex flex-col items-center justify-center">
      <h1 className="mt-4 text-sm">{getFeeLabel()}</h1>

      <Form
        validateMessages={{ default: '' }}
        form={form}
        id="site"
        labelCol={{ span: 8 }}
        initialValues={{ fee: fee }}
        wrapperCol={{ span: 8 }}
        onFinish={(data) => onFinish(data.fee)}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center mt-4 text-center"
      >
        <FeeFC recommend={fee} disabled={false} form={form} />

        <p className="mt-4 mx-6 p-4 max-w-xs text-left text-xs bg-transparent border border-dashed border-gray-600 rounded-lg md:max-w-2xl">
          {getFeeDescription()}
        </p>

        <div className="w-full px-4 absolute bottom-12 md:static flex items-center justify-between">
          <SecondaryButton type="button" onClick={window.close}>
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton type="submit">{t('buttons.next')}</PrimaryButton>
        </div>
      </Form>
    </div>
  );
};

export default Fee;
