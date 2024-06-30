import { Form } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  Layout,
  PrimaryButton,
  SecondaryButton,
  Fee as FeeFC,
} from 'components/index';
import { getController } from 'scripts/Background';
import { RootState } from 'state/store';

interface IFee {
  onFinish: (fee: number) => any;
  title: string;
}

const Fee: React.FC<IFee> = ({ title, onFinish }) => {
  const { getRecommendedFee } = getController().wallet.syscoinTransaction;
  const { t } = useTranslation();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const [form] = Form.useForm();

  const [fee, setFee] = useState(0.00001);

  const updateFee = async () => {
    const _fee = await getRecommendedFee(activeNetwork.url);
    form.setFieldsValue({ fee: _fee });
    setFee(_fee);
  };

  useEffect(() => {
    updateFee();
  }, []);

  const disabledFee =
    activeNetwork.chainId === 57 || activeNetwork.chainId === 5700;

  return (
    <Layout canGoBack={false} title={title.toUpperCase()}>
      <div className="flex flex-col items-center justify-center">
        <h1 className="mt-4 text-sm">{t('transactions.fee')}</h1>

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
          <FeeFC recommend={fee} disabled={disabledFee} form={form} />

          <p className="mt-4 mx-6 p-4 max-w-xs text-left text-xs bg-transparent border border-dashed border-gray-600 rounded-lg md:max-w-2xl">
            {t('transactions.withCurrentNetwork')} {fee} SYS.
          </p>

          <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
            <SecondaryButton type="button" onClick={window.close}>
              {t('buttons.cancel')}
            </SecondaryButton>

            <PrimaryButton type="submit">{t('buttons.next')}</PrimaryButton>
          </div>
        </Form>
      </div>
    </Layout>
  );
};

export default Fee;
