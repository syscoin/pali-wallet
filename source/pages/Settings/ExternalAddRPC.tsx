import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import type { RootState } from 'state/store';
import { INetwork } from 'types/network';
import { ICustomRpcParams } from 'types/transactions';
import { dispatchBackgroundEvent } from 'utils/browser';
import { extractErrorMessage } from 'utils/index';
import { translateRpcValidationError } from 'utils/rpcValidationError';

const networkKey = (network?: INetwork) =>
  network &&
  JSON.stringify([
    network.kind,
    network.chainId,
    network.slip44,
    network.url,
    network.label,
    network.currency,
    network.explorer,
    network.apiUrl,
  ]);

const CustomRPCExternal = () => {
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const addedNetwork = useRef<string>();
  const submitting = useRef(false);
  const rpcValidation = useRef(0);
  const apiValidation = useRef(0);
  const { alert } = useUtils();
  const { controllerEmitter } = useController();
  const [form] = useForm();

  React.useEffect(
    () => () => {
      rpcValidation.current++;
      apiValidation.current++;
    },
    []
  );

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

  const setFieldErrors = (name: 'url' | 'apiUrl', errors: string[] = []) => {
    form.setFields([{ name, errors, validating: false }]);
  };

  const validateRpcUrlAndShowError = async (
    rpcUrl?: string,
    formData?: ICustomRpcParams
  ): Promise<INetwork | null> => {
    const validation = ++rpcValidation.current;
    const isCurrent = () =>
      validation === rpcValidation.current &&
      form.getFieldValue('url')?.trim() === rpcUrl?.trim();
    if (!rpcUrl || !rpcUrl.trim()) {
      // Clear any existing RPC URL field errors
      setFieldErrors('url');
      return null;
    }

    // Set validating state
    form.setFields([
      {
        name: 'url',
        validating: true,
      },
    ]);

    let ownValidationMessage: string | undefined;
    try {
      const rpcParams = {
        url: rpcUrl.trim(),
        label: formData?.label || '',
        symbol: formData?.symbol || '',
        explorer: (formData?.explorer || '').trim() || rpcUrl.trim(),
        apiUrl: formData?.apiUrl || '',
        chainId: formData?.chainId || '',
        isSyscoinRpc: false,
      };

      const network = (await controllerEmitter(
        ['wallet', 'getRpc'],
        [rpcParams]
      )) as INetwork;

      // A later edit or validation owns the field, even if this request was
      // started first and happens to complete last.
      if (!isCurrent()) return null;

      if (!network) {
        ownValidationMessage = t('settings.failedValidateRpc');
        throw new Error('Failed to get network configuration from RPC');
      }

      // Set success state
      setFieldErrors('url');

      // Auto-fill chainId from RPC validation if not already set
      if (network.chainId && !formData?.chainId) {
        form.setFieldsValue({
          chainId: network.chainId.toString(),
        });
      }

      // Verify chainId matches what was requested
      if (formData?.chainId && network.chainId !== formData.chainId) {
        ownValidationMessage = t('settings.chainIdMismatch', {
          actual: network.chainId,
          expected: formData.chainId,
        });
        throw new Error(
          `Chain ID mismatch: RPC reports ${network.chainId}, but expected ${formData.chainId}`
        );
      }

      return network;
    } catch (error) {
      if (!isCurrent()) return null;
      // Extract the actual error message from the thrown error
      const errorMessage =
        ownValidationMessage ||
        translateRpcValidationError(
          extractErrorMessage(error, t('settings.failedValidateRpc')),
          t
        );

      // Set error state
      setFieldErrors('url', [errorMessage]);

      return null;
    }
  };

  const validateApiUrlAndShowError = async (apiUrl?: string) => {
    const validation = ++apiValidation.current;
    const isCurrent = () =>
      validation === apiValidation.current &&
      form.getFieldValue('apiUrl')?.trim() === apiUrl?.trim();
    if (!apiUrl || !apiUrl.trim()) {
      // Clear any existing API URL field errors
      setFieldErrors('apiUrl');
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

      if (!isCurrent()) return false;

      // Type guard for API result
      const typedApiResult = apiResult as { error?: string; success?: boolean };

      if (!typedApiResult?.success) {
        const apiError = typedApiResult?.error || t('settings.apiFormatError');

        // Set error state
        setFieldErrors('apiUrl', [apiError]);

        return false;
      }

      // Set success state
      setFieldErrors('apiUrl');

      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const errorMessage = extractErrorMessage(
        error,
        t('settings.apiConnectionError')
      );

      // Set error state
      setFieldErrors('apiUrl', [errorMessage]);

      return false;
    }
  };

  const onSubmit = async (values: ICustomRpcParams) => {
    if (submitting.current || confirmed) return;
    submitting.current = true;
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
      const fingerprint = networkKey(network);
      const key = JSON.stringify([host, fingerprint]);
      let needsAdd = addedNetwork.current !== key;
      if (!needsAdd) {
        // Popup state broadcasts can lag the successful add response.
        const state = (await controllerEmitter(
          ['wallet', 'getState'],
          []
        )) as RootState;
        if (!state?.vaultGlobal?.networks?.ethereum)
          throw new Error(t('settings.failedValidateRpc'));
        needsAdd =
          networkKey(state.vaultGlobal.networks.ethereum[network.chainId]) !==
          fingerprint;
      }
      // A switch can fail after the add is already saved. Retry that switch,
      // but never reuse a successful add for a changed network proposal.
      if (needsAdd) {
        await controllerEmitter(['wallet', 'addCustomRpc'], [network]);
        addedNetwork.current = key;
      }

      // Switch to network switching state
      setLoading(false);
      setSwitchingNetwork(true);

      // Switch to the new network
      await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        // Do not hold the dapp approval open for post-switch balance loading.
        [network, false]
      );

      const type = data.eventName;

      setConfirmed(true);
      setSwitchingNetwork(false);

      // Show success and close
      alert.success(t('settings.rpcSuccessfullyAdded'));
      // Signal success to the DApp
      setTimeout(() => {
        dispatchBackgroundEvent(`${type}.${host}`, null);
        window.close();
      }, 2000);
    } catch (error: any) {
      setLoading(false);
      setSwitchingNetwork(false);
      setConfirmed(false);

      const errorMessage = extractErrorMessage(
        error,
        t('settings.networkAdditionFailed')
      );

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
    } finally {
      submitting.current = false;
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

  const urlFormatRule = () => ({
    validator(_, value) {
      if (!value || value.trim() === '' || validateUrl(value.trim())) {
        return Promise.resolve();
      }
      return Promise.reject(new Error(t('settings.validUrlRequired')));
    },
  });

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
        onValuesChange={(changed) => {
          if ('url' in changed) rpcValidation.current++;
          if ('apiUrl' in changed) apiValidation.current++;
        }}
        disabled={loading || switchingNetwork || confirmed}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center w-full px-4 py-4"
      >
        <Form.Item
          name="label"
          className="w-full"
          hasFeedback
          rules={[
            {
              required: true,
              whitespace: true,
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
          className="w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: t('settings.rpcUrlRequired'),
            },
            urlFormatRule,
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.rpcUrlPlaceholder')}
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

        <Form.Item name="chainId" hasFeedback className="w-full">
          <Input
            type="text"
            readOnly
            placeholder={t('settings.chainIdCannotBeEdited')}
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
          className="w-full"
          rules={[
            {
              required: true,
              whitespace: true,
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
          className="w-full"
          name="explorer"
          rules={[
            {
              required: false,
              message: t('settings.explorerUrlRequired'),
            },
            urlFormatRule,
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
            className="w-full"
            rules={[
              {
                required: false,
                message: '',
              },
              urlFormatRule,
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
      <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50 min-h-[76px]">
        <div className="flex gap-3 justify-center">
          <Button
            variant="secondary"
            type="button"
            onClick={window.close}
            disabled={loading || switchingNetwork}
          >
            {t('buttons.cancel')}
          </Button>

          <Button
            variant="primary"
            type="submit"
            disabled={confirmed || loading || switchingNetwork}
            loading={loading || switchingNetwork}
            onClick={() => form.submit()}
          >
            {switchingNetwork
              ? t('networkConnection.switchingNetwork')
              : t('buttons.addNetwork')}
          </Button>
        </div>
      </ToastActionFooter>
    </div>
  );
};

export default CustomRPCExternal;
