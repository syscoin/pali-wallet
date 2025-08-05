import { Form } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { EditFeeModalBase } from 'components/Modal/EditFeeModalBase';
import { ICustomFeeParams, IFeeState } from 'types/transactions';
import removeScientificNotation from 'utils/removeScientificNotation';

import { PriorityBar } from './components';

interface IEditPriorityModalProps {
  customFee: ICustomFeeParams;
  defaultGasLimit?: number;
  fee: IFeeState;
  isSendLegacyTransaction?: boolean;
  setCustomFee: React.Dispatch<React.SetStateAction<ICustomFeeParams>>;
  setHaveError: React.Dispatch<React.SetStateAction<boolean>>;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showModal: boolean; // Add this prop to pass the default gas limit
}

export const EditPriorityModal = (props: IEditPriorityModalProps) => {
  const {
    showModal,
    setIsOpen,
    setCustomFee,
    customFee,
    fee,
    setHaveError,
    isSendLegacyTransaction,
    defaultGasLimit = 42000, // Default fallback
  } = props;
  // Initialize priority based on whether we have custom fees
  const [priority, setPriority] = useState<number>(() => {
    if (customFee.isCustom) {
      // Try to determine which preset matches current custom values
      const currentMaxFee = customFee.maxFeePerGas ?? customFee.gasPrice ?? 0;
      const baseMaxFee = fee?.maxFeePerGas ?? fee?.gasPrice ?? 0;

      if (baseMaxFee > 0) {
        const ratio = currentMaxFee / baseMaxFee;
        if (Math.abs(ratio - 0.8) < 0.01) return 0; // Low
        if (Math.abs(ratio - 1.2) < 0.01) return 2; // High
      }
    }
    return 1; // Default to medium
  });
  const { t } = useTranslation();
  const [form] = Form.useForm();

  // Validation states for visual feedback
  // Start with null to avoid showing validation errors before user interaction
  const [gasLimitValid, setGasLimitValid] = useState<boolean | null>(null);
  const [priorityFeeValid, setPriorityFeeValid] = useState<boolean | null>(
    null
  );
  const [maxFeeValid, setMaxFeeValid] = useState<boolean | null>(null);
  const [gasPriceValid, setGasPriceValid] = useState<boolean | null>(null);

  // Track specific validation errors
  const [priorityFeeError, setPriorityFeeError] = useState<string | null>(null);
  const [maxFeeError, setMaxFeeError] = useState<string | null>(null);

  // Use actual gas prices, even if 0 (cancellation now handles this properly)
  const maxFeePerGas = fee?.maxFeePerGas ?? 0;
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas ?? 0;
  const gasPrice = fee?.gasPrice ?? 0;
  // ALWAYS have a gas limit - use custom, then fee, then default
  const gasLimit = customFee.gasLimit || fee?.gasLimit || defaultGasLimit;

  // Validation functions
  const validateGasLimit = (value: number) => {
    const isValid = value >= 42000;
    setGasLimitValid(isValid);
    return isValid;
  };

  const validatePriorityFee = (value: number) => {
    const maxFee = form.getFieldValue('maxFeePerGas');
    // Allow 0 priority fee for networks like Arbitrum

    if (value < 0) {
      setPriorityFeeValid(false);
      setPriorityFeeError('priorityFeeMustBePositive');
      return false;
    }

    if (maxFee && value > maxFee) {
      setPriorityFeeValid(false);
      setPriorityFeeError('priorityFeeTooHigh');
      return false;
    }

    setPriorityFeeValid(true);
    setPriorityFeeError(null);
    return true;
  };

  const validateMaxFee = (value: number) => {
    const priorityFee = form.getFieldValue('maxPriorityFeePerGas');
    // Max fee must be greater than or equal to priority fee

    if (value <= 0) {
      setMaxFeeValid(false);
      setMaxFeeError('maxFeeMustBePositive');
      return false;
    }

    if (priorityFee > 0 && value < priorityFee) {
      setMaxFeeValid(false);
      setMaxFeeError('maxFeeTooLow');
      return false;
    }

    setMaxFeeValid(true);
    setMaxFeeError(null);
    return true;
  };

  const validateGasPrice = (value: number) => {
    const isValid = value > 0;
    setGasPriceValid(isValid);
    return isValid;
  };

  // Initialize form when modal opens
  React.useEffect(() => {
    if (!showModal) return;

    // Always ensure we have valid gas limit (minimum 42000)
    const feeGasLimit = fee?.gasLimit || defaultGasLimit;
    const validGasLimit = Math.max(customFee.gasLimit || feeGasLimit, 42000);

    // If we have custom values, use them
    if (customFee.isCustom) {
      if (isSendLegacyTransaction) {
        const validGasPrice = Number(
          removeScientificNotation(customFee.gasPrice ?? gasPrice ?? 0)
        );
        form.setFieldsValue({
          gasLimit: validGasLimit,
          gasPrice: validGasPrice,
        });
        // Validate after setting values with a small delay to ensure form is updated
        setTimeout(() => {
          validateGasLimit(validGasLimit);
          validateGasPrice(validGasPrice);
        }, 0);
      } else {
        const validMaxPriorityFeePerGas = Number(
          removeScientificNotation(
            customFee.maxPriorityFeePerGas ?? maxPriorityFeePerGas ?? 0
          )
        );
        const validMaxFeePerGas = Number(
          removeScientificNotation(customFee.maxFeePerGas ?? maxFeePerGas ?? 0)
        );
        form.setFieldsValue({
          gasLimit: validGasLimit,
          maxPriorityFeePerGas: validMaxPriorityFeePerGas,
          maxFeePerGas: validMaxFeePerGas,
        });
        // Validate after setting values with a small delay to ensure form is updated
        setTimeout(() => {
          validateGasLimit(validGasLimit);
          validatePriorityFee(validMaxPriorityFeePerGas);
          validateMaxFee(validMaxFeePerGas);
        }, 0);
      }
    } else {
      // Use default values with current priority multiplier
      const multiplier = priority === 0 ? 0.8 : priority === 2 ? 1.2 : 1;

      if (isSendLegacyTransaction) {
        const validGasPrice = gasPrice ?? 0;
        const calculatedGasPrice = Number(
          removeScientificNotation(multiplier * validGasPrice)
        );
        const finalGasPrice = isNaN(calculatedGasPrice)
          ? 0
          : calculatedGasPrice;

        form.setFieldsValue({
          gasLimit: validGasLimit, // Always set gas limit
          gasPrice: finalGasPrice,
        });
        // Validate after setting values with a small delay to ensure form is updated
        setTimeout(() => {
          validateGasLimit(validGasLimit);
          validateGasPrice(finalGasPrice);
        }, 0);
      } else {
        const validMaxPriorityFeePerGas = maxPriorityFeePerGas ?? 0;
        const validMaxFeePerGas = maxFeePerGas ?? 0;

        const calculatedPriorityFee = Number(
          removeScientificNotation(multiplier * validMaxPriorityFeePerGas)
        );
        const calculatedMaxFee = Number(
          removeScientificNotation(multiplier * validMaxFeePerGas)
        );

        const finalPriorityFee = isNaN(calculatedPriorityFee)
          ? 0
          : calculatedPriorityFee;
        const finalMaxFee = isNaN(calculatedMaxFee) ? 0 : calculatedMaxFee;

        form.setFieldsValue({
          gasLimit: validGasLimit, // Always set gas limit
          maxPriorityFeePerGas: finalPriorityFee,
          maxFeePerGas: finalMaxFee,
        });
        // Validate after setting values with a small delay to ensure form is updated
        setTimeout(() => {
          validateGasLimit(validGasLimit);
          validatePriorityFee(finalPriorityFee);
          validateMaxFee(finalMaxFee);
        }, 0);
      }
    }
  }, [showModal, customFee.isCustom, defaultGasLimit]); // Only run when modal visibility changes

  // Update form values when priority changes
  React.useEffect(() => {
    if (!showModal || customFee.isCustom) return;

    const multiplier = priority === 0 ? 0.8 : priority === 2 ? 1.2 : 1;
    const feeGasLimit = fee?.gasLimit || defaultGasLimit;
    const validGasLimit = Math.max(customFee.gasLimit || feeGasLimit, 42000);

    if (isSendLegacyTransaction) {
      const validGasPrice = gasPrice ?? 0;
      const calculatedGasPrice = Number(
        removeScientificNotation(multiplier * validGasPrice)
      );
      const finalGasPrice = isNaN(calculatedGasPrice) ? 0 : calculatedGasPrice;

      form.setFieldsValue({
        gasLimit: validGasLimit, // Always ensure gas limit is set
        gasPrice: finalGasPrice,
      });
      // Validate after setting values with a small delay to ensure form is updated
      setTimeout(() => {
        validateGasLimit(validGasLimit);
        validateGasPrice(finalGasPrice);
      }, 0);
    } else {
      const validMaxPriorityFeePerGas = maxPriorityFeePerGas ?? 0;
      const validMaxFeePerGas = maxFeePerGas ?? 0;

      const calculatedPriorityFee = Number(
        removeScientificNotation(multiplier * validMaxPriorityFeePerGas)
      );
      const calculatedMaxFee = Number(
        removeScientificNotation(multiplier * validMaxFeePerGas)
      );

      const finalPriorityFee = isNaN(calculatedPriorityFee)
        ? 0
        : calculatedPriorityFee;
      const finalMaxFee = isNaN(calculatedMaxFee) ? 0 : calculatedMaxFee;

      form.setFieldsValue({
        gasLimit: validGasLimit, // Always ensure gas limit is set
        maxPriorityFeePerGas: finalPriorityFee,
        maxFeePerGas: finalMaxFee,
      });
      // Validate after setting values with a small delay to ensure form is updated
      setTimeout(() => {
        validateGasLimit(validGasLimit);
        validatePriorityFee(finalPriorityFee);
        validateMaxFee(finalMaxFee);
      }, 0);
    }
  }, [priority]);

  // Check if all fields are valid
  // Allow form submission if no field is explicitly invalid (false)
  const isFormValid = () => {
    if (isSendLegacyTransaction) {
      return gasLimitValid !== false && gasPriceValid !== false;
    }
    return (
      gasLimitValid !== false &&
      priorityFeeValid !== false &&
      maxFeeValid !== false
    );
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // Ensure gas limit is always set with a valid value
      const finalGasLimit = values.gasLimit || gasLimit || defaultGasLimit;

      // Update custom fee with final values based on transaction type
      if (isSendLegacyTransaction) {
        setCustomFee({
          isCustom: true,
          gasLimit: finalGasLimit,
          gasPrice: values.gasPrice ?? 0,
          // Clear EIP-1559 fields for legacy transactions
          maxFeePerGas: 0,
          maxPriorityFeePerGas: 0,
        });
      } else {
        setCustomFee({
          isCustom: true,
          gasLimit: finalGasLimit,
          maxFeePerGas: values.maxFeePerGas ?? 0,
          maxPriorityFeePerGas: values.maxPriorityFeePerGas ?? 0,
          // Clear gasPrice for EIP-1559 transactions
          gasPrice: 0,
        });
      }
      setHaveError(false);
      setIsOpen(false);
    } catch (error) {
      // Validation errors are shown inline
      setHaveError(true);
    }
  };

  const handlePriorityChange = (value: number) => {
    setPriority(value);
    const multiplier = value === 0 ? 0.8 : value === 2 ? 1.2 : 1;

    // Don't reset validation states - we'll update them after setting new values

    // Always ensure gas limit is set (minimum 42000)
    const currentGasLimit =
      form.getFieldValue('gasLimit') || gasLimit || defaultGasLimit;
    const validGasLimit = Math.max(currentGasLimit, 42000);

    if (isSendLegacyTransaction) {
      const newGasPrice = Number(
        removeScientificNotation(multiplier * (gasPrice ?? 0))
      );
      // Ensure the value is a valid number
      const validGasPrice = isNaN(newGasPrice) ? 0 : newGasPrice;
      form.setFieldValue('gasLimit', validGasLimit); // Always set gas limit
      form.setFieldValue('gasPrice', validGasPrice);
      // Validate after setting values with a small delay to ensure form is updated
      setTimeout(() => {
        validateGasLimit(validGasLimit);
        validateGasPrice(validGasPrice);
      }, 0);
      setCustomFee({
        isCustom: value !== 1,
        gasLimit: validGasLimit,
        gasPrice: validGasPrice,
        // Clear EIP-1559 fields for legacy transactions
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
      });
    } else {
      const newPriorityFee = Number(
        removeScientificNotation(multiplier * (maxPriorityFeePerGas ?? 0))
      );
      const newMaxFee = Number(
        removeScientificNotation(multiplier * (maxFeePerGas ?? 0))
      );

      // Ensure the values are valid numbers
      const validPriorityFee = isNaN(newPriorityFee) ? 0 : newPriorityFee;
      const validMaxFee = isNaN(newMaxFee) ? 0 : newMaxFee;

      form.setFieldValue('gasLimit', validGasLimit); // Always set gas limit
      form.setFieldValue('maxPriorityFeePerGas', validPriorityFee);
      form.setFieldValue('maxFeePerGas', validMaxFee);

      // Validate after setting values with a small delay to ensure form is updated
      setTimeout(() => {
        validateGasLimit(validGasLimit);
        validatePriorityFee(validPriorityFee);
        validateMaxFee(validMaxFee);
      }, 0);

      setCustomFee({
        isCustom: value !== 1,
        gasLimit: validGasLimit,
        maxPriorityFeePerGas: validPriorityFee,
        maxFeePerGas: validMaxFee,
        // Clear gasPrice for EIP-1559 transactions
        gasPrice: 0,
      });
    }
  };

  const handleFieldChange = (field: string, value: string) => {
    let validNumValue: number | undefined;

    const numValue = value === '' ? 0 : Number(value);
    validNumValue = isNaN(numValue) ? 0 : numValue;

    // Special handling for gas limit to ensure it's never below minimum
    if (field === 'gasLimit') {
      if (validNumValue === 0) {
        validNumValue = defaultGasLimit;
      }
      // Don't enforce minimum while typing, but validate it
      // This allows users to type values like "4" before typing "42000"
    }

    form.setFieldValue(field, validNumValue);

    // Validate the field
    switch (field) {
      case 'gasLimit':
        validateGasLimit(validNumValue);
        break;
      case 'maxPriorityFeePerGas':
        validatePriorityFee(validNumValue);
        // Re-validate max fee when priority changes
        const maxFee = form.getFieldValue('maxFeePerGas');
        if (maxFee !== undefined) {
          validateMaxFee(maxFee);
        }
        break;
      case 'maxFeePerGas':
        validateMaxFee(validNumValue);
        // Re-validate priority fee when max changes
        const priorityFee = form.getFieldValue('maxPriorityFeePerGas');
        if (priorityFee !== undefined) {
          validatePriorityFee(priorityFee);
        }
        break;
      case 'gasPrice':
        validateGasPrice(validNumValue);
        break;
    }

    setCustomFee((prev) => ({
      ...prev,
      isCustom: true,
      [field]: validNumValue,
    }));
  };

  const handleClose = () => {
    // Reset to default values, ensuring all are valid numbers and gas limit is set
    setCustomFee((prev) => ({
      ...prev,
      isCustom: false,
      maxPriorityFeePerGas: maxPriorityFeePerGas ?? 0,
      maxFeePerGas: maxFeePerGas ?? 0,
      gasPrice: gasPrice ?? 0,
      gasLimit: gasLimit || defaultGasLimit, // Always ensure gas limit is set
    }));
    setPriority(1);
    form.resetFields();
    // Reset validation states
    setGasLimitValid(null);
    setPriorityFeeValid(null);
    setMaxFeeValid(null);
    setGasPriceValid(null);
    setPriorityFeeError(null);
    setMaxFeeError(null);
    setIsOpen(false);
  };

  return (
    <EditFeeModalBase show={showModal} onClose={handleClose}>
      <div className="inline-block align-middle w-screen max-w-md mx-auto text-brand-white font-poppins bg-brand-blue500 rounded-t-[50px] shadow-xl transform transition-all">
        <div className="flex flex-col items-center justify-center w-full h-full">
          <div className="flex py-4 justify-center w-full rounded-t-[50px] bg-[#1c3255]">
            <p className="text-center font-poppins text-base font-medium uppercase">
              {t('send.editFee')}
            </p>
          </div>
          <div className="flex flex-col items-center px-6">
            <div className="flex justify-center w-full my-4">
              <PriorityBar priority={priority} onClick={handlePriorityChange} />
            </div>
            <Form
              form={form}
              validateMessages={{ default: '' }}
              className="flex flex-col gap-3 items-center justify-center my-3 py-2 w-full"
              name="priority-form"
              id="priority-form"
              autoComplete="off"
            >
              <div className="flex flex-col items-start justify-center w-full">
                <p className="mb-1 text-sm">{t('send.gasLimit')}</p>
                <Form.Item
                  name="gasLimit"
                  className="w-full mb-0"
                  rules={[
                    {
                      validator: (_, value) => {
                        if (value < 42000) {
                          return Promise.reject(
                            new Error(t('send.gasLimitTooLow'))
                          );
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <div className="relative">
                    <input
                      type="number"
                      placeholder={t('send.gasLimit')}
                      className={`custom-gas-input w-full ${
                        gasLimitValid === false ? 'border-red-500' : ''
                      }`}
                      style={{ paddingRight: '3.5rem' }}
                      value={form.getFieldValue('gasLimit') || ''}
                      onChange={(e) =>
                        handleFieldChange('gasLimit', e.target.value)
                      }
                    />
                    {gasLimitValid !== null && (
                      <img
                        src={
                          gasLimitValid
                            ? '/assets/all_assets/successIcon.svg'
                            : '/assets/all_assets/errorIcon.svg'
                        }
                        alt={gasLimitValid ? 'Valid' : 'Invalid'}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none"
                      />
                    )}
                  </div>
                </Form.Item>
                {gasLimitValid === false && (
                  <p className="text-red-400 text-xs mt-1">
                    {t('send.gasLimitTooLow')}
                  </p>
                )}
              </div>

              {!isSendLegacyTransaction ? (
                <>
                  <div className="flex flex-col items-start justify-center w-full">
                    <p className="text-sm text-white mb-1 font-normal">
                      {t('send.maxPriority')} (GWEI)
                    </p>
                    <Form.Item
                      name="maxPriorityFeePerGas"
                      className="w-full mb-0"
                      rules={[
                        {
                          validator: (_, value) => {
                            const maxFee = form.getFieldValue('maxFeePerGas');
                            if (value < 0) {
                              return Promise.reject(
                                new Error(t('send.priorityFeeMustBePositive'))
                              );
                            }
                            if (value > 0 && maxFee > 0 && value > maxFee) {
                              return Promise.reject(
                                new Error(t('send.priorityFeeTooHigh'))
                              );
                            }
                            return Promise.resolve();
                          },
                        },
                      ]}
                    >
                      <div className="relative">
                        <input
                          type="number"
                          placeholder={`${t('send.maxPriorityFee')} (GWEI)`}
                          className={`custom-gas-input w-full ${
                            priorityFeeValid === false ? 'border-red-500' : ''
                          }`}
                          style={{ paddingRight: '3.5rem' }}
                          value={
                            form.getFieldValue('maxPriorityFeePerGas')
                              ? removeScientificNotation(
                                  form.getFieldValue('maxPriorityFeePerGas')
                                )
                              : ''
                          }
                          onChange={(e) =>
                            handleFieldChange(
                              'maxPriorityFeePerGas',
                              e.target.value
                            )
                          }
                        />
                        {priorityFeeValid !== null && (
                          <img
                            src={
                              priorityFeeValid
                                ? '/assets/all_assets/successIcon.svg'
                                : '/assets/all_assets/errorIcon.svg'
                            }
                            alt={priorityFeeValid ? 'Valid' : 'Invalid'}
                            className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none"
                          />
                        )}
                      </div>
                    </Form.Item>
                    {priorityFeeValid === false && priorityFeeError && (
                      <p className="text-red-400 text-xs mt-1">
                        {t(`send.${priorityFeeError}`)}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-start justify-center w-full">
                    <p className="text-sm text-white mb-1 font-normal">
                      {t('send.maxFee')} (GWEI)
                    </p>
                    <Form.Item
                      name="maxFeePerGas"
                      className="w-full mb-0"
                      dependencies={['maxPriorityFeePerGas']}
                      rules={[
                        {
                          validator: (_, value) => {
                            const priorityFee = form.getFieldValue(
                              'maxPriorityFeePerGas'
                            );
                            if (!value || value <= 0) {
                              return Promise.reject(
                                new Error(t('send.maxFeeMustBePositive'))
                              );
                            }
                            if (priorityFee > 0 && value < priorityFee) {
                              return Promise.reject(
                                new Error(t('send.maxFeeTooLow'))
                              );
                            }
                            return Promise.resolve();
                          },
                        },
                      ]}
                    >
                      <div className="relative">
                        <input
                          type="number"
                          placeholder={`${t('send.maxFee')} (GWEI)`}
                          className={`custom-gas-input w-full ${
                            maxFeeValid === false ? 'border-red-500' : ''
                          }`}
                          style={{ paddingRight: '3.5rem' }}
                          value={
                            form.getFieldValue('maxFeePerGas')
                              ? removeScientificNotation(
                                  form.getFieldValue('maxFeePerGas')
                                )
                              : ''
                          }
                          onChange={(e) =>
                            handleFieldChange('maxFeePerGas', e.target.value)
                          }
                        />
                        {maxFeeValid !== null && (
                          <img
                            src={
                              maxFeeValid
                                ? '/assets/all_assets/successIcon.svg'
                                : '/assets/all_assets/errorIcon.svg'
                            }
                            alt={maxFeeValid ? 'Valid' : 'Invalid'}
                            className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none"
                          />
                        )}
                      </div>
                    </Form.Item>
                    {maxFeeValid === false && maxFeeError && (
                      <p className="text-red-400 text-xs mt-1">
                        {t(`send.${maxFeeError}`)}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-start justify-center w-full">
                  <p className="text-sm text-white mb-1 font-normal">
                    {t('send.gasPrice')} (GWEI)
                  </p>
                  <Form.Item
                    name="gasPrice"
                    className="w-full mb-0"
                    rules={[
                      {
                        validator: (_, value) => {
                          if (!value || value <= 0) {
                            return Promise.reject(
                              new Error(t('send.gasPriceTooLow'))
                            );
                          }
                          return Promise.resolve();
                        },
                      },
                    ]}
                  >
                    <div className="relative">
                      <input
                        type="number"
                        placeholder={`${t('send.gasPrice')} (GWEI)`}
                        className={`custom-gas-input w-full ${
                          gasPriceValid === false ? 'border-red-500' : ''
                        }`}
                        style={{ paddingRight: '3.5rem' }}
                        value={
                          form.getFieldValue('gasPrice')
                            ? removeScientificNotation(
                                form.getFieldValue('gasPrice')
                              )
                            : ''
                        }
                        onChange={(e) =>
                          handleFieldChange('gasPrice', e.target.value)
                        }
                      />
                      {gasPriceValid !== null && (
                        <img
                          src={
                            gasPriceValid
                              ? '/assets/all_assets/successIcon.svg'
                              : '/assets/all_assets/errorIcon.svg'
                          }
                          alt={gasPriceValid ? 'Valid' : 'Invalid'}
                          className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none"
                        />
                      )}
                    </div>
                  </Form.Item>
                  {gasPriceValid === false && (
                    <p className="text-red-400 text-xs mt-1">
                      {t('send.gasPriceTooLow')}
                    </p>
                  )}
                </div>
              )}
            </Form>
          </div>

          <div className="flex items-center justify-center mt-4 mb-4 gap-6">
            <Button
              className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-white text-base bg-transparent hover:opacity-60 border border-white rounded-[100px] transition-all duration-300 xl:flex-none"
              type="button"
              onClick={handleClose}
            >
              {t('buttons.cancel')}
            </Button>
            <Button
              className={`xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-base rounded-[100px] transition-all duration-300 xl:flex-none ${
                isFormValid()
                  ? 'text-brand-blue400 bg-white hover:opacity-60'
                  : 'text-gray-400 bg-gray-300 cursor-not-allowed opacity-50'
              }`}
              type="submit"
              onClick={handleSubmit}
              disabled={!isFormValid()}
            >
              {t('buttons.save')}
            </Button>
          </div>
        </div>
      </div>
    </EditFeeModalBase>
  );
};
