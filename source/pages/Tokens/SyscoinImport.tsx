import { Form, Input, Button, message } from 'antd';
import { debounce } from 'lodash';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { Icon, LoadingComponent } from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

export const SyscoinImport = () => {
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const [form] = Form.useForm();

  const { activeNetwork, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);

  // Debounced asset lookup function
  const debouncedLookup = useCallback(
    debounce(async (assetGuid: string) => {
      if (!assetGuid || !/^\\d+$/.test(assetGuid)) return;

      setIsLookingUp(true);

      try {
        const assetData = await getAsset(activeNetwork.url, assetGuid);

        if (assetData) {
          // Auto-fill the form with the found asset data
          form.setFieldsValue({
            assetSym: assetData.symbol,
            assetDecimals: assetData.decimals,
            assetContract: assetData.contract || '',
          });

          message.success(t('tokens.assetFoundAutoFilled'));
        } else {
          message.error(t('tokens.assetNotFound'));
        }
      } catch (error) {
        console.error('Asset lookup error:', error);
        message.error(t('tokens.assetNotFound'));
      } finally {
        setIsLookingUp(false);
      }
    }, 500), // 500ms debounce
    [activeNetwork.url, form, t]
  );

  // Handle asset GUID input change
  const handleAssetGuidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    if (value) {
      debouncedLookup(value);
    }
  };

  const onFinish = async (values: any) => {
    if (!isBitcoinBased) {
      message.error('SPT tokens can only be imported on UTXO networks');
      return;
    }

    setIsLoading(true);

    try {
      const { assetGuid } = values;

      const addTokenMethodResponse = await controllerEmitter(
        ['wallet', 'assets', 'sys', 'addSysDefaultToken'],
        [assetGuid, activeNetwork.url]
      );

      if (
        !addTokenMethodResponse ||
        !(addTokenMethodResponse as any).assetGuid
      ) {
        message.error(t('tokens.tokenNotAdded'));
        return;
      }

      await controllerEmitter(
        ['wallet', 'account', 'sys', 'saveTokenInfo'],
        [addTokenMethodResponse]
      );

      message.success(t('tokens.tokenSuccessfullyAdded'));
      form.resetFields();
    } catch (error) {
      console.error('Failed to import token:', error);
      message.error(t('tokens.tokenNotAdded'));
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <LoadingComponent />;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        className="space-y-4"
      >
        <Form.Item
          name="assetGuid"
          label={t('tokens.tokenGuid')}
          className="w-full md:max-w-md"
          hasFeedback
          validateStatus={isLookingUp ? 'validating' : ''}
          help={isLookingUp ? t('tokens.lookingUpAsset') : ''}
          rules={[
            {
              required: true,
              message: t('tokens.assetGuidRequired'),
            },
            {
              pattern: /^\\d+$/,
              message: t('tokens.invalidAssetGuidFormat'),
            },
          ]}
        >
          <Input
            placeholder={`${t('tokens.tokenGuid')} (e.g., 123456789)`}
            onChange={handleAssetGuidChange}
            suffix={
              isLookingUp ? (
                <Icon name="loading" className="animate-spin" />
              ) : null
            }
          />
        </Form.Item>

        <Form.Item
          name="assetSym"
          label={t('tokens.tokenSymbol')}
          className="w-full md:max-w-md"
        >
          <Input placeholder={t('tokens.tokenSymbol')} disabled />
        </Form.Item>

        <Form.Item
          name="assetDecimals"
          label={t('tokens.tokenDecimals')}
          className="w-full md:max-w-md"
        >
          <Input
            placeholder={t('tokens.tokenDecimals')}
            type="number"
            disabled
          />
        </Form.Item>

        <Form.Item
          name="assetContract"
          label={t('tokens.contractAddress')}
          className="w-full md:max-w-md"
          help={t('tokens.contractAddressHelp')}
        >
          <Input placeholder={t('tokens.contractAddress')} disabled />
        </Form.Item>

        <Form.Item className="pt-4">
          <Button
            type="primary"
            htmlType="submit"
            loading={isLoading}
            className="w-full md:w-auto"
            disabled={!form.getFieldValue('assetGuid')}
          >
            {t('buttons.import')}
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};
