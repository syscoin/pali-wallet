import { Form, Input } from 'antd';
import { isBoolean, isNil } from 'lodash';
import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { DefaultModal, ErrorModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const SyscoinImportToken = () => {
  const controller = getController();
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [added, setAdded] = useState(false);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const nextStep = async ({ assetGuid }: { assetGuid: string }) => {
    setIsLoading(true);
    try {
      const addTokenMethodResponse =
        await controller.wallet.assets.sys.addSysDefaultToken(
          assetGuid,
          activeNetwork.url
        );

      if (isBoolean(addTokenMethodResponse) || isNil(addTokenMethodResponse)) {
        setError(true);
        setIsLoading(false);
        return;
      }

      await controller.wallet.account.sys.saveTokenInfo(addTokenMethodResponse);

      setAdded(true);
    } catch (submitError) {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Form
        validateMessages={{ default: '' }}
        form={form}
        id="token-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        onFinish={nextStep}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center mt-4 text-center md:w-full"
      >
        <Form.Item
          name="assetGuid"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              async validator(_, value) {
                const data = await getAsset(activeNetwork.url, value);

                if (!value || data) {
                  if (data && data.symbol) {
                    form.setFieldValue('symbol', atob(String(data.symbol)));
                  }

                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="text"
            className="input-small relative"
            placeholder="Token Guid"
          />
        </Form.Item>

        <Form.Item
          name="symbol"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            className="input-small relative"
            placeholder={t('tokens.tokenSymbol')}
          />
        </Form.Item>

        <div className="flex flex-col items-center justify-center w-full">
          <div className="absolute bottom-12 md:static">
            <NeutralButton loading={isLoading} type="submit">
              {t('tokens.next')}
            </NeutralButton>
          </div>
        </div>
      </Form>

      {added && (
        <DefaultModal
          show={added}
          title={t('tokens.tokenSuccessfullyAdded')}
          description={`${form.getFieldValue('symbol')} ${t(
            'tokens.wasSucessfullyAdded'
          )}`}
          onClose={() => navigate('/home')}
        />
      )}

      {error && (
        <ErrorModal
          show={Boolean(error)}
          title={t('tokens.tokenNotAdded')}
          description={t('tokens.couldNotAddTokenToYour')}
          log={t('tokens.tokenNotFoundIn')}
          onClose={() => setError(false)}
        />
      )}
    </>
  );
};
