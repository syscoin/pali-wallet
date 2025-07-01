import { Form, Input, message } from 'antd';
import { debounce } from 'lodash';
import React, { useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { useSelector } from 'react-redux';
import * as syscoinjs from 'syscoinjs-lib';

import { DefaultModal, ErrorModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ISysAssetMetadata } from 'types/tokens';

export const SyscoinImport = () => {
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const { navigate } = useUtils();
  const [form] = Form.useForm();

  const { activeNetwork, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupStatus, setLookupStatus] = useState<'success' | 'error' | ''>(
    ''
  );
  const [added, setAdded] = useState<boolean>(false);
  const [addedTokenSymbol, setAddedTokenSymbol] = useState<string>('');
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Cleanup messages on component mount and unmount
  useEffect(() => {
    // Clear any existing messages when component mounts
    message.destroy();

    return () => {
      // Clear messages when component unmounts
      message.destroy();
    };
  }, []);

  // Enhanced navigate function that clears messages
  const navigateWithCleanup = (path: string) => {
    message.destroy(); // Clear any lingering messages
    navigate(path);
  };

  // Function to show specific error
  const showError = (errorMsg: string) => {
    setErrorMessage(errorMsg);
    setError(true);
  };

  // Debounced asset lookup function
  const debouncedLookup = useCallback(
    debounce(async (assetGuid: string) => {
      if (!assetGuid || !/^\d+$/.test(assetGuid)) {
        // Clear validation state for invalid input
        setLookupStatus('');
        form.setFields([
          {
            name: 'assetGuid',
            errors: [],
          },
        ]);
        return;
      }

      setIsLookingUp(true);
      setLookupStatus('');

      try {
        const assetData = (await controllerEmitter(
          ['wallet', 'getSysAssetMetadata'],
          [assetGuid, activeNetwork.url]
        )) as ISysAssetMetadata | null;

        // getSysAssetMetadata returns undefined for invalid/unknown assets (doesn't throw)
        if (assetData && assetData.symbol) {
          // Auto-fill the form with the found asset data
          form.setFieldsValue({
            assetSym: assetData.symbol,
            assetDecimals: assetData.decimals,
            assetContract: assetData.contract || '',
          });

          // Set success state with visual checkmark
          form.setFields([
            {
              name: 'assetGuid',
              errors: [],
            },
          ]);
          setLookupStatus('success');

          // Visual feedback is provided by the form validation checkmark
          // No need for persistent message that shows on other pages
        } else {
          // Asset not found or invalid (getSysAssetMetadata returned undefined)

          // Set error state with visual X
          form.setFields([
            {
              name: 'assetGuid',
              errors: [t('tokens.assetNotFound')],
            },
          ]);
          setLookupStatus('error');

          // Clear the auto-filled fields
          form.setFieldsValue({
            assetSym: '',
            assetDecimals: '',
            assetContract: '',
          });
        }
      } catch (lookupError) {
        console.error('Asset lookup error:', lookupError);

        // This should rarely happen since getSysAssetMetadata catches errors internally
        const lookupErrorMessage = t('tokens.assetNotFound');

        // Set error state with visual X
        form.setFields([
          {
            name: 'assetGuid',
            errors: [lookupErrorMessage],
          },
        ]);
        setLookupStatus('error');

        // Clear the auto-filled fields on error
        form.setFieldsValue({
          assetSym: '',
          assetDecimals: '',
          assetContract: '',
        });
      } finally {
        setIsLookingUp(false);
      }
    }, 500), // 500ms debounce
    [activeNetwork.url, t] // Removed 'form' to fix circular reference warning
  );

  // Handle asset GUID input change
  const handleAssetGuidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();

    // Clear previous validation state when user starts typing
    if (lookupStatus) {
      setLookupStatus('');
      form.setFields([
        {
          name: 'assetGuid',
          errors: [],
        },
      ]);
    }

    if (value) {
      // Check if value contains invalid characters immediately
      if (!/^\d+$/.test(value)) {
        form.setFields([
          {
            name: 'assetGuid',
            errors: [t('tokens.invalidAssetGuidFormat')],
          },
        ]);
        setLookupStatus('error');

        // Clear the auto-filled fields for invalid input
        form.setFieldsValue({
          assetSym: '',
          assetDecimals: '',
          assetContract: '',
        });
        return; // Don't proceed with lookup for invalid characters
      }

      // Only proceed with lookup for valid numeric input
      debouncedLookup(value);
    } else {
      // Clear fields when input is empty
      form.setFieldsValue({
        assetSym: '',
        assetDecimals: '',
        assetContract: '',
      });
    }
  };

  const onFinish = async (values: any) => {
    if (!isBitcoinBased) {
      showError('SPT tokens can only be imported on UTXO networks');
      return;
    }

    // Prevent import if asset validation failed
    if (lookupStatus === 'error') {
      showError(t('tokens.assetInvalidOrUnknown'));
      return;
    }

    // Ensure asset was successfully validated
    if (lookupStatus !== 'success') {
      showError(t('tokens.assetNotFound'));
      return;
    }

    setIsLoading(true);

    try {
      const { assetGuid } = values;

      const addTokenMethodResponse = await controllerEmitter(
        ['wallet', 'addSysDefaultToken'],
        [assetGuid, activeNetwork.url]
      );

      if (
        !addTokenMethodResponse ||
        !(addTokenMethodResponse as any).assetGuid
      ) {
        showError(t('tokens.tokenNotAdded'));
        return;
      }

      await controllerEmitter(
        ['wallet', 'saveTokenInfo'],
        [addTokenMethodResponse]
      );

      const tokenSymbol = (addTokenMethodResponse as any).symbol || 'Token';
      // Store the token symbol for the success modal
      setAddedTokenSymbol(tokenSymbol);
      setAdded(true);

      // Don't clear the form - let users see what was imported
      // form.resetFields();
    } catch (importError) {
      console.error('Failed to import token:', importError);

      // Handle specific error messages
      let specificErrorMessage = t('tokens.tokenNotAdded');

      if (importError instanceof Error) {
        const errorMsg = importError.message.toLowerCase();

        if (
          errorMsg.includes('token already exists') ||
          errorMsg.includes('already imported')
        ) {
          specificErrorMessage = t('tokens.tokenAlreadyImported');
        } else if (
          errorMsg.includes('asset not found') ||
          errorMsg.includes('invalid') ||
          errorMsg.includes('unknown')
        ) {
          specificErrorMessage = t('tokens.assetInvalidOrUnknown');
        } else if (errorMsg.includes('network')) {
          specificErrorMessage = t('tokens.notAvailableInCurrentNetwork');
        } else if (importError.message && importError.message.length > 0) {
          // Use the actual error message if it's meaningful
          specificErrorMessage = importError.message;
        }
      }

      showError(specificErrorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Loading overlay - covers entire screen */}
      {isLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
        </div>
      )}

      <Form
        validateMessages={{ default: '' }}
        form={form}
        id="spt-import-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        onFinish={onFinish}
        autoComplete="off"
        className="flex w-full flex-col gap-3 items-center justify-center mt-4 text-center"
      >
        <Form.Item
          name="assetGuid"
          className="w-full md:max-w-md"
          hasFeedback
          validateStatus={isLookingUp ? 'validating' : lookupStatus || ''}
          rules={[
            {
              required: true,
              message: t('tokens.assetGuidRequired'),
            },
            {
              pattern: /^\d+$/,
              message: t('tokens.invalidAssetGuidFormat'),
            },
            {
              validator: (_, value) => {
                if (!value) return Promise.resolve();

                try {
                  // Check if it's a valid 64-bit unsigned integer using bn.js
                  const num = new syscoinjs.utils.BN(value);
                  const maxUint64 = new syscoinjs.utils.BN(
                    '18446744073709551615'
                  );

                  if (num.isNeg() || num.gt(maxUint64)) {
                    return Promise.reject(
                      new Error(
                        'Asset GUID must be a valid 64-bit number (0 to 18,446,744,073,709,551,615)'
                      )
                    );
                  }
                } catch (validationError) {
                  return Promise.reject(
                    new Error(t('tokens.invalidAssetGuidFormat'))
                  );
                }

                return Promise.resolve();
              },
            },
          ]}
        >
          <Input
            type="text"
            className="custom-import-input relative"
            placeholder={`${t('tokens.tokenGuid')} (e.g., 123456)`}
            onChange={handleAssetGuidChange}
          />
        </Form.Item>

        <Form.Item
          name="assetSym"
          className="w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            className="custom-import-input relative"
            placeholder={t('tokens.tokenSymbol')}
            disabled
          />
        </Form.Item>

        <Form.Item
          name="assetDecimals"
          className="w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            className="custom-import-input relative"
            placeholder={t('tokens.tokenDecimals')}
            disabled
          />
        </Form.Item>

        <Form.Item
          name="assetContract"
          className="w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            className="custom-import-input relative"
            placeholder={t('tokens.contractAddress')}
            disabled
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
          <div className="w-full px-4 absolute bottom-12 md:static md:mt-6">
            <NeutralButton
              type="submit"
              disabled={
                !form.getFieldValue('assetGuid') ||
                isLoading ||
                lookupStatus !== 'success'
              }
              loading={isLoading}
              fullWidth={true}
            >
              {t('buttons.import')}
            </NeutralButton>
          </div>
        </div>
      </Form>

      {added && (
        <DefaultModal
          show={added}
          title={t('tokens.tokenSuccessfullyAdded')}
          description={`${addedTokenSymbol} ${t(
            'tokens.wasSuccessfullyAdded'
          )}`}
          onClose={() => navigateWithCleanup('/home?tab=assets')}
        />
      )}

      {error && (
        <ErrorModal
          show={error}
          title={t('tokens.tokenNotAdded')}
          description={errorMessage}
          log={errorMessage}
          onClose={() => {
            setError(false);
            setErrorMessage('');
          }}
        />
      )}
    </>
  );
};
