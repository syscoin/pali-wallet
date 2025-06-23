import { Form, Input } from 'antd';
import TextArea from 'antd/lib/input/TextArea';
import { debounce } from 'lodash';
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BiCopy } from 'react-icons/bi';
import { useSelector } from 'react-redux';

import { INetworkType } from '@pollum-io/sysweb3-network';

import { Button, Card } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

const ForgetWalletView = () => {
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  if (!activeAccount) throw new Error('No active account');

  const hasAccountFunds =
    (isBitcoinBased
      ? activeAccount.balances[INetworkType.Syscoin]
      : activeAccount.balances[INetworkType.Ethereum]) > 0;

  // Separate loading states for better UX
  const [isValidatingPassword, setIsValidatingPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Validation status states
  const [passwordStatus, setPasswordStatus] = useState<
    'success' | 'error' | ''
  >('');

  // Cached seed for copying
  const [cachedSeed, setCachedSeed] = useState<string>('');

  // if account has no funds, no need to input the seed
  const [isSeedValid, setIsSeedValid] = useState<boolean>(!hasAccountFunds);
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  const [form] = Form.useForm();

  // Debounced password validation - faster response like SyscoinImport
  const debouncedPasswordValidation = useCallback(
    debounce(async (password: string) => {
      if (!password) {
        setPasswordStatus('');
        setIsPasswordValid(false);
        setCachedSeed('');
        return;
      }

      setIsValidatingPassword(true);
      setPasswordStatus('');

      try {
        const seed = await controllerEmitter(['wallet', 'getSeed'], [password]);

        if (seed) {
          setPasswordStatus('success');
          setIsPasswordValid(true);
          setCachedSeed(String(seed)); // Cache seed for seed validation

          // Auto-fill seed field so user can copy it when they have funds
          if (hasAccountFunds) {
            form.setFieldsValue({ seed: String(seed) });
            setIsSeedValid(true); // Mark as valid since it's the correct seed
          }

          // Clear password field errors
          form.setFields([
            {
              name: 'password',
              errors: [],
            },
          ]);
        } else {
          setPasswordStatus('error');
          setIsPasswordValid(false);
          setCachedSeed('');

          // Set password field error
          form.setFields([
            {
              name: 'password',
              errors: [t('start.wrongPassword')],
            },
          ]);
        }
      } catch (error) {
        console.error('Password validation error:', error);
        setPasswordStatus('error');
        setIsPasswordValid(false);
        setCachedSeed('');

        form.setFields([
          {
            name: 'password',
            errors: [t('start.wrongPassword')],
          },
        ]);
      } finally {
        setIsValidatingPassword(false);
      }
    }, 300), // Reduced to 300ms for faster response
    [controllerEmitter, form, t]
  );

  // Handle password input change
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Clear previous validation state when user starts typing
    if (passwordStatus) {
      setPasswordStatus('');
      form.setFields([
        {
          name: 'password',
          errors: [],
        },
      ]);
    }

    // Reset seed state when password changes
    setIsSeedValid(!hasAccountFunds); // Reset to default state
    setCachedSeed('');

    if (hasAccountFunds) {
      form.setFieldsValue({ seed: '' }); // Clear seed field
    }

    if (value.trim()) {
      setIsValidatingPassword(true); // Show spinner immediately
      debouncedPasswordValidation(value);
    } else {
      setIsPasswordValid(false);
      setCachedSeed('');
      setIsValidatingPassword(false);
      setPasswordStatus('');
    }
  };

  // Copy seed phrase to clipboard
  const handleCopySeed = async () => {
    try {
      await navigator.clipboard.writeText(cachedSeed);
      alert.success(t('settings.seedPhraseCopied'));
    } catch (error) {
      console.error('Failed to copy seed:', error);
      alert.error(t('buttons.error'));
    }
  };

  const onSubmit = async ({ password }: { password: string }) => {
    setIsSubmitting(true);

    try {
      await controllerEmitter(['wallet', 'forgetWallet'], [password]);
      navigate('/');
    } catch (error) {
      console.error('Failed to forget wallet:', error);
      // Handle error if needed
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Loading overlay for submit action */}
      {isSubmitting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
        </div>
      )}

      <div>
        <p className="text-sm mb-6">
          {t('forgetWalletPage.importedAccountsWont')}
        </p>
        <Form
          validateMessages={{ default: '' }}
          form={form}
          onFinish={onSubmit}
          className="password flex flex-col gap-4 items-center justify-center text-center"
          name="forget"
          autoComplete="off"
        >
          <Form.Item
            name="password"
            className="w-full md:max-w-md"
            hasFeedback
            validateStatus={
              isValidatingPassword ? 'validating' : passwordStatus || ''
            }
            rules={[
              {
                required: true,
                message: t('settings.enterYourPassword'),
              },
            ]}
          >
            <Input
              type="password"
              className="custom-import-input relative"
              placeholder={t('settings.enterYourPassword')}
              id="forget_password"
              onChange={handlePasswordChange}
            />
          </Form.Item>

          {hasAccountFunds && (
            <>
              <Form.Item
                name="seed"
                className="w-full md:max-w-md"
                rules={[
                  {
                    required: hasAccountFunds,
                    message: t('import.pasteYourWalletSeed'),
                  },
                ]}
              >
                <div className="relative">
                  <TextArea
                    className={`${
                      !isPasswordValid
                        ? 'opacity-50 cursor-not-allowed bg-gray-800'
                        : 'opacity-100 bg-fields-input-primary'
                    } p-2 pl-4 pr-12 w-full h-[90px] text-brand-graylight text-sm border border-border-default focus:border-fields-input-borderfocus rounded-[10px] outline-none resize-none`}
                    placeholder={
                      !isPasswordValid ? t('settings.enterYourPassword') : ''
                    }
                    id="forget_seed"
                    value={cachedSeed} // Display the cached seed directly
                    readOnly={true} // Always read-only since it's auto-filled
                  />

                  {/* Copy icon - only show when password is valid and seed is available */}
                  {isPasswordValid && cachedSeed && (
                    <button
                      type="button"
                      onClick={handleCopySeed}
                      className="absolute top-2 right-2 p-1 rounded hover:bg-gray-700 transition-colors duration-200"
                      title={t('buttons.copy')}
                    >
                      <BiCopy className="w-4 h-4 text-brand-graylight hover:text-white" />
                    </button>
                  )}
                </div>
              </Form.Item>

              <Card type="info">
                <div className="flex flex-col justify-start items-start">
                  <p className="text-brand-yellowInfo text-sm font-normal text-left">
                    {t('forgetWalletPage.stillHaveFunds')}
                  </p>
                  <p className="text-white text-sm font-normal text-left">
                    {t('forgetWalletPage.saveProperly')}
                  </p>
                </div>
              </Card>
            </>
          )}
        </Form>
      </div>

      {/* Buttons container - pushed to bottom */}
      <div className="w-full px-4 absolute bottom-12 md:static">
        <div className="flex gap-x-8 justify-between md:gap-x-40">
          <Button
            type="button"
            onClick={() => navigate('/home')}
            className="w-[164px] h-10 flex items-center justify-center rounded-[100px] border-2 border-white text-base font-medium text-white"
            disabled={isSubmitting}
          >
            {t('buttons.cancel')}
          </Button>

          <Button
            type="button"
            onClick={() => form.submit()}
            className={`${
              !isPasswordValid || isSubmitting ? 'opacity-60' : 'opacity-100'
            } w-[164px] h-10 flex items-center justify-center rounded-[100px] bg-white border-white text-base font-medium text-brand-blue400`}
            disabled={!isPasswordValid || isSubmitting}
            id="forget-btn"
          >
            {isSubmitting ? (
              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-brand-blue400"></div>
            ) : (
              t('buttons.forget')
            )}
          </Button>
        </div>
      </div>
    </>
  );
};

export default ForgetWalletView;
