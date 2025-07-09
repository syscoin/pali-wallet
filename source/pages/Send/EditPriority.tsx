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
      const currentMaxFee = customFee.maxFeePerGas || customFee.gasPrice || 0;
      const baseMaxFee = fee?.maxFeePerGas || fee?.gasPrice || 0;

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
  const [gasLimitValid, setGasLimitValid] = useState<boolean | null>(null);
  const [priorityFeeValid, setPriorityFeeValid] = useState<boolean | null>(
    null
  );
  const [maxFeeValid, setMaxFeeValid] = useState<boolean | null>(null);
  const [gasPriceValid, setGasPriceValid] = useState<boolean | null>(null);

  const maxFeePerGas = fee?.maxFeePerGas || 0;
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas || 0;
  const gasPrice = fee?.gasPrice || 0;
  // ALWAYS have a gas limit - use custom, then fee, then default
  const gasLimit = customFee.gasLimit || fee?.gasLimit || defaultGasLimit;

  // Initialize form when modal opens
  React.useEffect(() => {
    if (!showModal) return;

    // Always ensure we have valid gas limit
    const validGasLimit =
      customFee.gasLimit || fee?.gasLimit || defaultGasLimit;

    // If we have custom values, use them
    if (customFee.isCustom) {
      if (isSendLegacyTransaction) {
        const validGasPrice = customFee.gasPrice || gasPrice || 0;
        form.setFieldsValue({
          gasLimit: validGasLimit,
          gasPrice: validGasPrice,
        });
      } else {
        const validMaxPriorityFeePerGas =
          customFee.maxPriorityFeePerGas || maxPriorityFeePerGas || 0;
        const validMaxFeePerGas = customFee.maxFeePerGas || maxFeePerGas || 0;
        form.setFieldsValue({
          gasLimit: validGasLimit,
          maxPriorityFeePerGas: validMaxPriorityFeePerGas,
          maxFeePerGas: validMaxFeePerGas,
        });
      }
    } else {
      // Use default values with current priority multiplier
      const multiplier = priority === 0 ? 0.8 : priority === 2 ? 1.2 : 1;

      if (isSendLegacyTransaction) {
        const validGasPrice = gasPrice || 0;
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
      } else {
        const validMaxPriorityFeePerGas = maxPriorityFeePerGas || 0;
        const validMaxFeePerGas = maxFeePerGas || 0;

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
      }
    }
  }, [showModal, customFee.isCustom, defaultGasLimit]); // Only run when modal visibility changes

  // Update form values when priority changes
  React.useEffect(() => {
    if (!showModal || customFee.isCustom) return;

    const multiplier = priority === 0 ? 0.8 : priority === 2 ? 1.2 : 1;
    const validGasLimit =
      customFee.gasLimit || fee?.gasLimit || defaultGasLimit;

    if (isSendLegacyTransaction) {
      const validGasPrice = gasPrice || 0;
      const calculatedGasPrice = Number(
        removeScientificNotation(multiplier * validGasPrice)
      );
      const finalGasPrice = isNaN(calculatedGasPrice) ? 0 : calculatedGasPrice;

      form.setFieldsValue({
        gasLimit: validGasLimit, // Always ensure gas limit is set
        gasPrice: finalGasPrice,
      });
    } else {
      const validMaxPriorityFeePerGas = maxPriorityFeePerGas || 0;
      const validMaxFeePerGas = maxFeePerGas || 0;

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
    }
  }, [priority]);

  // Check if all fields are valid
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

      // Update custom fee with final values
      setCustomFee((prev) => ({
        ...prev,
        isCustom: true,
        gasLimit: finalGasLimit, // Always set a valid gas limit
        gasPrice: values.gasPrice || 0,
        maxFeePerGas: values.maxFeePerGas || 0,
        maxPriorityFeePerGas: values.maxPriorityFeePerGas || 0,
      }));
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

    // Reset validation states when changing priority
    setGasLimitValid(null);
    setPriorityFeeValid(null);
    setMaxFeeValid(null);
    setGasPriceValid(null);

    // Always ensure gas limit is set
    const validGasLimit =
      form.getFieldValue('gasLimit') || gasLimit || defaultGasLimit;

    if (isSendLegacyTransaction) {
      const newGasPrice = Number(
        removeScientificNotation(multiplier * (gasPrice || 0))
      );
      // Ensure the value is a valid number
      const validGasPrice = isNaN(newGasPrice) ? 0 : newGasPrice;
      form.setFieldValue('gasLimit', validGasLimit); // Always set gas limit
      form.setFieldValue('gasPrice', validGasPrice);
      setCustomFee((prev) => ({
        ...prev,
        isCustom: value !== 1,
        gasLimit: validGasLimit, // Always set gas limit
        gasPrice: validGasPrice,
      }));
    } else {
      const newPriorityFee = Number(
        removeScientificNotation(multiplier * (maxPriorityFeePerGas || 0))
      );
      const newMaxFee = Number(
        removeScientificNotation(multiplier * (maxFeePerGas || 0))
      );

      // Ensure the values are valid numbers
      const validPriorityFee = isNaN(newPriorityFee) ? 0 : newPriorityFee;
      const validMaxFee = isNaN(newMaxFee) ? 0 : newMaxFee;

      form.setFieldValue('gasLimit', validGasLimit); // Always set gas limit
      form.setFieldValue('maxPriorityFeePerGas', validPriorityFee);
      form.setFieldValue('maxFeePerGas', validMaxFee);

      setCustomFee((prev) => ({
        ...prev,
        isCustom: value !== 1,
        gasLimit: validGasLimit, // Always set gas limit
        maxPriorityFeePerGas: validPriorityFee,
        maxFeePerGas: validMaxFee,
      }));
    }
  };

  const handleFieldChange = (field: string, value: string) => {
    let validNumValue: number | undefined;

    const numValue = value === '' ? 0 : Number(value);
    validNumValue = isNaN(numValue) ? 0 : numValue;

    // Special handling for gas limit to ensure it's never 0 or undefined
    if (field === 'gasLimit' && validNumValue === 0) {
      validNumValue = defaultGasLimit;
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
      maxPriorityFeePerGas: maxPriorityFeePerGas || 0,
      maxFeePerGas: maxFeePerGas || 0,
      gasPrice: gasPrice || 0,
      gasLimit: gasLimit || defaultGasLimit, // Always ensure gas limit is set
    }));
    setPriority(1);
    form.resetFields();
    // Reset validation states
    setGasLimitValid(null);
    setPriorityFeeValid(null);
    setMaxFeeValid(null);
    setGasPriceValid(null);
    setIsOpen(false);
  };

  // Validation functions
  const validateGasLimit = (value: number) => {
    const isValid = value >= 42000;
    setGasLimitValid(isValid);
    return isValid;
  };

  const validatePriorityFee = (value: number) => {
    const maxFee = form.getFieldValue('maxFeePerGas');
    // Allow 0 priority fee for networks like Arbitrum
    const isValid = value >= 0 && (!maxFee || value < maxFee);
    setPriorityFeeValid(isValid);
    return isValid;
  };

  const validateMaxFee = (value: number) => {
    const priorityFee = form.getFieldValue('maxPriorityFeePerGas');
    // Max fee must be greater than priority fee (unless priority is 0)
    const isValid = value > 0 && (priorityFee === 0 || value > priorityFee);
    setMaxFeeValid(isValid);
    return isValid;
  };

  const validateGasPrice = (value: number) => {
    const isValid = value > 0;
    setGasPriceValid(isValid);
    return isValid;
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
                            if (value > 0 && maxFee > 0 && value >= maxFee) {
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
                            form.getFieldValue('maxPriorityFeePerGas') || ''
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
                    {priorityFeeValid === false && (
                      <p className="text-red-400 text-xs mt-1">
                        {t('send.priorityFeeTooHigh')}
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
                            if (priorityFee > 0 && value <= priorityFee) {
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
                          value={form.getFieldValue('maxFeePerGas') || ''}
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
                    {maxFeeValid === false && (
                      <p className="text-red-400 text-xs mt-1">
                        {t('send.maxFeeTooLow')}
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
                        value={form.getFieldValue('gasPrice') || ''}
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
