import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { INetwork } from '@pollum-io/sysweb3-network';

import { PrimaryButton, SecondaryButton } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { ICustomRpcParams } from 'types/transactions';
import { dispatchBackgroundEvent } from 'utils/browser';

const CustomRPCExternal = () => {
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { alert } = useUtils();
  const { controllerEmitter } = useController();
  const [form] = useForm();

  // Extract chainConfig from the nested data structure
  const chainConfig = data.chainConfig || data;

  // Initial values for the form - memoize to prevent unnecessary re-renders
  const initialValues: ICustomRpcParams = React.useMemo(() => {
    if (!chainConfig || Object.keys(chainConfig).length === 0) {
      return {
        label: '',
        url: '',
        chainId: 0,
        symbol: '',
        explorer: '',
        apiUrl: '',
        isSyscoinRpc: false,
      };
    }

    return {
      label: chainConfig.chainName || '',
      url: chainConfig.rpcUrls?.[0] || chainConfig.url || '',
      chainId:
        typeof chainConfig.chainId === 'string'
          ? parseInt(chainConfig.chainId, 16)
          : chainConfig.chainId || 0,
      symbol:
        chainConfig.nativeCurrency?.symbol ||
        chainConfig.symbol ||
        chainConfig.currency ||
        '',
      explorer:
        chainConfig.blockExplorerUrls?.[0] || chainConfig.explorer || '',
      apiUrl: chainConfig.apiUrl || '',
      isSyscoinRpc: false, // External RPCs are always EVM
    };
  }, [chainConfig]);

  // Ensure form is populated when chainConfig is available
  React.useEffect(() => {
    if (
      chainConfig &&
      Object.keys(chainConfig).length > 0 &&
      initialValues.label
    ) {
      console.log('ExternalAddRPC - Setting form values:', initialValues);
      form.setFieldsValue(initialValues);
    }
  }, [chainConfig, initialValues, form]);

  const validateRpcUrlAndShowError = async (
    rpcUrl?: string,
    formData?: ICustomRpcParams
  ): Promise<INetwork | null> => {
    if (!rpcUrl || !rpcUrl.trim()) {
      // Clear any existing RPC URL field errors
      form.setFields([
        {
          name: 'url',
          errors: [],
          validating: false,
        },
      ]);
      return null;
    }

    // Set validating state
    form.setFields([
      {
        name: 'url',
        validating: true,
      },
    ]);

    try {
      const rpcParams = {
        url: rpcUrl.trim(),
        label: formData?.label || '',
        symbol: formData?.symbol || '',
        explorer: formData?.explorer || '',
        apiUrl: formData?.apiUrl || '',
        chainId: formData?.chainId || '',
        isSyscoinRpc: false,
      };

      const network = (await controllerEmitter(
        ['wallet', 'getRpc'],
        [rpcParams]
      )) as INetwork;

      if (!network) {
        throw new Error('Failed to get network configuration from RPC');
      }

      // Set success state
      form.setFields([
        {
          name: 'url',
          errors: [],
          validating: false,
        },
      ]);

      // Auto-fill chainId from RPC validation if not already set
      if (network.chainId && !formData?.chainId) {
        form.setFieldsValue({
          chainId: network.chainId.toString(),
        });
      }

      // Verify chainId matches what was requested
      if (formData?.chainId && network.chainId !== formData.chainId) {
        throw new Error(
          `Chain ID mismatch: RPC reports ${network.chainId}, but expected ${formData.chainId}`
        );
      }

      return network;
    } catch (error) {
      // Extract the actual error message from the thrown error
      let errorMessage = t('settings.failedValidateRpc');
      if (error && typeof error === 'object' && 'message' in error) {
        errorMessage = (error as Error).message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      // Set error state
      form.setFields([
        {
          name: 'url',
          errors: [errorMessage],
          validating: false,
        },
      ]);

      return null;
    }
  };

  const validateApiUrlAndShowError = async (apiUrl?: string) => {
    if (!apiUrl || !apiUrl.trim()) {
      // Clear any existing API URL field errors
      form.setFields([
        {
          name: 'apiUrl',
          errors: [],
          validating: false,
        },
      ]);
      return true; // Optional field
    }

    // Set validating state
    form.setFields([
      {
        name: 'apiUrl',
        validating: true,
      },
    ]);

    try {
      const apiResult = await controllerEmitter(
        ['wallet', 'testExplorerApi'],
        [apiUrl.trim()]
      );

      // Type guard for API result
      const typedApiResult = apiResult as { error?: string; success?: boolean };

      if (!typedApiResult?.success) {
        const apiError = typedApiResult?.error || 'Failed to validate API URL';

        // Set error state
        form.setFields([
          {
            name: 'apiUrl',
            errors: [apiError],
            validating: false,
          },
        ]);

        return false;
      }

      // Set success state
      form.setFields([
        {
          name: 'apiUrl',
          errors: [],
          validating: false,
        },
      ]);

      return true;
    } catch (error) {
      const errorMessage = error?.message || 'Failed to validate API URL';

      // Set error state
      form.setFields([
        {
          name: 'apiUrl',
          errors: [errorMessage],
          validating: false,
        },
      ]);

      return false;
    }
  };

  const onSubmit = async (values: ICustomRpcParams) => {
    setLoading(true);

    try {
      // Validate form fields before proceeding
      await form.validateFields();
      // For EVM networks, ensure chainId is a number
      if (typeof values.chainId === 'string') {
        values.chainId = parseInt(values.chainId, 10);
      }
      // Validate RPC URL and get network configuration
      const network = await validateRpcUrlAndShowError(values.url, values);
      if (!network) {
        setLoading(false);
        return;
      }

      // Validate API URL if provided (only for EVM networks)
      if (values.apiUrl && !(await validateApiUrlAndShowError(values.apiUrl))) {
        setLoading(false);
        return;
      }

      // Add the network
      await controllerEmitter(['wallet', 'addCustomRpc'], [network]);
      const type = data.eventName;

      // Signal success to the DApp
      dispatchBackgroundEvent(`${type}.${host}`, null);
      setConfirmed(true);
      setLoading(false);
      await controllerEmitter(['wallet', 'setActiveNetwork'], [network, true]);
      // Show success and close
      alert.success(t('settings.rpcSuccessfullyAdded'));

      setTimeout(() => {
        window.close();
      }, 1000);
    } catch (error: any) {
      setLoading(false);
      setConfirmed(false);

      const errorMessage = error.message || 'Failed to add network';

      // Show error alert prominently
      alert.error(errorMessage, {
        autoClose: 6000,
      });

      // Also log for debugging
      console.error('Network addition failed:', {
        error: errorMessage,
        values,
        chainId: values.chainId,
        host,
      });
    }
  };

  const validateUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:'].includes(urlObj.protocol) && !!urlObj.hostname;
    } catch {
      return false;
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-bkg-3">
      <div className="flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
        <h2 className="text-center text-lg text-white">
          {t('send.allow')} {host} {t('settings.toAddNetwork')}?
        </h2>
        <div className="flex flex-col mt-1 px-4 w-full text-center text-xs text-white">
          <span>{t('settings.thisWillAllow')}</span>
          <span>
            <b>{t('settings.paliDoesNotVerify')}</b>
          </span>
        </div>
      </div>

      <Form
        form={form}
        key={`external-rpc-${chainConfig?.chainId || 'new'}-${
          chainConfig?.chainName || 'network'
        }`}
        id="rpc"
        name="rpc"
        initialValues={initialValues}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center w-full px-4 py-4"
      >
        <Form.Item
          name="label"
          className="md:w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: t('settings.networkNameRequired'),
            },
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.networkName')}
            className="custom-input-normal relative"
          />
        </Form.Item>

        <Form.Item
          name="url"
          className="md:w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: t('settings.rpcUrlRequired'),
            },
            () => ({
              validator(_, value) {
                if (!value || value.trim() === '') {
                  return Promise.resolve();
                }
                // Basic URL format validation only
                if (validateUrl(value.trim())) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(t('settings.validUrlRequired'))
                );
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.rpcUrl')}
            className="custom-input-normal relative"
            onBlur={async (e) => {
              const url = e.target.value?.trim();
              if (url) {
                // Get current form values for validation
                const currentFormValues = form.getFieldsValue();
                // Validate RPC and auto-fill chainId
                await validateRpcUrlAndShowError(url, currentFormValues);
              }
            }}
          />
        </Form.Item>

        <Form.Item name="chainId" hasFeedback className="md:w-full">
          <Input
            type="text"
            readOnly
            placeholder={t('settings.chainId')}
            className="custom-input-normal relative"
            style={{
              cursor: 'not-allowed',
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          />
        </Form.Item>

        <Form.Item
          name="symbol"
          hasFeedback
          className="md:w-full"
          rules={[
            {
              required: true,
              message: t('settings.symbolRequired'),
            },
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.symbol')}
            className="custom-input-normal relative uppercase"
            onChange={(e) => {
              // Transform to uppercase and update the field
              const upperValue = e.target.value.toUpperCase();
              e.target.value = upperValue;
              form.setFieldsValue({ symbol: upperValue });
            }}
          />
        </Form.Item>

        <Form.Item
          hasFeedback
          className="md:w-full"
          name="explorer"
          rules={[
            {
              required: false,
              message: t('settings.explorerUrlRequired'),
            },
            () => ({
              validator(_, value) {
                if (!value || value.trim() === '') {
                  return Promise.resolve();
                }
                if (validateUrl(value.trim())) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(t('settings.validUrlRequired'))
                );
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.explorer')}
            className="custom-input-normal relative"
          />
        </Form.Item>

        {initialValues.apiUrl && (
          <Form.Item
            name="apiUrl"
            hasFeedback
            className="md:w-full"
            rules={[
              {
                required: false,
                message: '',
              },
              () => ({
                validator(_, value) {
                  if (!value || value.trim() === '') {
                    return Promise.resolve();
                  }
                  // Only validate URL format here, API validation happens on blur
                  if (validateUrl(value.trim())) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error(t('settings.validUrlRequired'))
                  );
                },
              }),
            ]}
          >
            <Input
              type="text"
              placeholder={t('settings.blockExplorerApiUrl')}
              className="custom-input-normal relative"
              onBlur={async (e) => {
                const apiUrl = e.target.value?.trim();
                if (apiUrl) {
                  // Validate API URL and show feedback
                  await validateApiUrlAndShowError(apiUrl);
                }
              }}
            />
          </Form.Item>
        )}

        {/* Add bottom padding to account for fixed buttons */}
        <div className="pb-20"></div>
      </Form>

      {/* Fixed button container at bottom of viewport */}
      <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50 min-h-[76px]">
        <div className="flex gap-3 justify-center">
          <SecondaryButton type="button" onClick={window.close}>
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton
            type="submit"
            disabled={confirmed}
            loading={loading}
            onClick={() => form.submit()}
          >
            {t('buttons.addNetwork')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};

export default CustomRPCExternal;
