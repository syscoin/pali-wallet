import { Form, Input } from 'antd';
import { isBoolean, isNil } from 'lodash';
import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { useSelector } from 'react-redux';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { ErrorModal, NeutralButton } from 'components/index';
import { TokenSuccessfullyAdded } from 'components/Modal/WarningBaseModal';
import { useUtils } from 'hooks/index';
import { getController } from 'scripts/Background';
import { RootState } from 'state/store';

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
        className="flex w-full flex-col gap-3 items-center justify-center mt-4 text-center"
      >
        <Form.Item
          name="assetGuid"
          className="w-full md:max-w-md"
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
            placeholder="Token GUID"
          />
        </Form.Item>

        <Form.Item
          name="assetSymbol"
          className="w-full md:max-w-md"
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
        <div className="w-full flex items-center justify-center mt-4 text-brand-white hover:text-brand-deepPink100">
          <a
            href="https://docs.paliwallet.com/guide/v2/"
            target="_blank"
            className="flex items-center justify-center gap-x-2"
            rel="noreferrer"
          >
            <ExternalLinkIcon size={16} />
            <span className="font-normal font-poppins underline text-sm">
              Learn more on docs!
            </span>
          </a>
        </div>

        <div className="flex flex-col items-center justify-center w-full">
          <div className="w-full px-4 absolute bottom-12 md:static">
            <NeutralButton loading={isLoading} type="submit" fullWidth={true}>
              {t('buttons.next')}
            </NeutralButton>
          </div>
        </div>
      </Form>

      {added && (
        <TokenSuccessfullyAdded
          title={t('tokens.tokenSuccessfullyAdded')}
          phraseOne={`${form.getFieldValue('symbol')} ${t(
            'tokens.wasSuccessfullyAdded'
          )}`}
          onClose={() => navigate('/home')}
          show={added}
          buttonText={t('settings.gotIt')}
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
