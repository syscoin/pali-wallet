import { Form } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { EditFeeModalBase } from 'components/Modal/EditFeeModalBase';
import { ICustomFeeParams, IFeeState } from 'types/transactions';
import removeScientificNotation from 'utils/removeScientificNotation';

import { PriorityBar } from './components';

interface IEditPriorityModalProps {
  customFee: ICustomFeeParams;
  fee: IFeeState;
  isSendLegacyTransaction?: boolean;
  setCustomFee: React.Dispatch<React.SetStateAction<ICustomFeeParams>>;
  setHaveError: React.Dispatch<React.SetStateAction<boolean>>;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showModal: boolean;
}

export const EditPriorityModal = (props: IEditPriorityModalProps) => {
  const {
    showModal,
    setIsOpen,
    customFee,
    setCustomFee,
    fee,
    setHaveError,
    isSendLegacyTransaction,
  } = props;
  const [priority, setPriority] = useState<number>(1);
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [hasCustomValues, setHasCustomValues] = useState(false);

  // Validation states for each field
  const [gasLimitValid, setGasLimitValid] = useState<boolean | null>(null);
  const [priorityFeeValid, setPriorityFeeValid] = useState<boolean | null>(
    null
  );
  const [maxFeeValid, setMaxFeeValid] = useState<boolean | null>(null);
  const [gasPriceValid, setGasPriceValid] = useState<boolean | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  const maxFeePerGas = fee?.maxFeePerGas || 0;
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas || 0;
  const gasPrice = fee?.gasPrice || 0;

  // Check if all fields are valid
  const isFormValid = () => {
    if (isSendLegacyTransaction) {
      return gasLimitValid === true && gasPriceValid === true;
    }
    return (
      gasLimitValid === true &&
      priorityFeeValid === true &&
      maxFeeValid === true
    );
  };

  const handleSubmit = async () => {
    try {
      // Validate form using Ant Design's validation
      await form.validateFields();

      // If validation passes, close the modal
      setIsOpen(false);
      setHaveError(false);
    } catch (error: any) {
      // Form has validation errors, but they're already shown inline
      // Just prevent closing the modal
    }
  };

  // Validation functions
  const validateGasLimit = (value: number) => {
    const isValid = value > 1000;
    setGasLimitValid(isValid);
    return isValid;
  };

  const validatePriorityFee = (value: number) => {
    const maxFee = form.getFieldValue('maxFeePerGas');
    const isValid = value > 0 && (!maxFee || value < maxFee);
    setPriorityFeeValid(isValid);
    return isValid;
  };

  const validateMaxFee = (value: number) => {
    const priorityFee = form.getFieldValue('maxPriorityFeePerGas');
    const isValid = value > priorityFee && value > 0;
    setMaxFeeValid(isValid);
    // Also revalidate priority fee when max fee changes
    if (priorityFee !== undefined) {
      validatePriorityFee(priorityFee);
    }
    return isValid;
  };

  const validateGasPrice = (value: number) => {
    const isValid = value > 0;
    setGasPriceValid(isValid);
    return isValid;
  };

  useEffect(() => {
    if (!showModal) return;

    // Initialize form values when modal opens for the first time
    if (!hasCustomValues) {
      if (fee?.gasLimit && !form.getFieldValue('gasLimit')) {
        form.setFieldValue('gasLimit', fee.gasLimit);
        // Clear validation state for initial value
        setGasLimitValid(null);
      }
      if (
        fee?.maxPriorityFeePerGas &&
        !form.getFieldValue('maxPriorityFeePerGas')
      ) {
        form.setFieldValue('maxPriorityFeePerGas', fee.maxPriorityFeePerGas);
        setPriorityFeeValid(null);
      }
      if (fee?.maxFeePerGas && !form.getFieldValue('maxFeePerGas')) {
        form.setFieldValue('maxFeePerGas', fee.maxFeePerGas);
        setMaxFeeValid(null);
      }
      if (fee?.gasPrice && !form.getFieldValue('gasPrice')) {
        form.setFieldValue('gasPrice', fee.gasPrice);
        setGasPriceValid(null);
      }
      // Mark as initialized after setting values
      setTimeout(() => setHasInitialized(true), 200);
    }
  }, [showModal, fee, form, hasCustomValues]);

  // Validate initial values when modal opens or priority changes
  useEffect(() => {
    if (!showModal || !hasInitialized) return;

    // Add a small delay to ensure form values are properly set
    const timer = setTimeout(() => {
      // Validate current form values
      const gasLimit = form.getFieldValue('gasLimit');
      const maxPriorityFeePerGas = form.getFieldValue('maxPriorityFeePerGas');
      const maxFeePerGas = form.getFieldValue('maxFeePerGas');
      const gasPrice = form.getFieldValue('gasPrice');

      if (gasLimit !== undefined && gasLimit !== null)
        validateGasLimit(gasLimit);
      if (
        maxPriorityFeePerGas !== undefined &&
        maxPriorityFeePerGas !== null &&
        !isSendLegacyTransaction
      )
        validatePriorityFee(maxPriorityFeePerGas);
      if (
        maxFeePerGas !== undefined &&
        maxFeePerGas !== null &&
        !isSendLegacyTransaction
      )
        validateMaxFee(maxFeePerGas);
      if (
        gasPrice !== undefined &&
        gasPrice !== null &&
        isSendLegacyTransaction
      )
        validateGasPrice(gasPrice);
    }, 100);

    return () => clearTimeout(timer);
  }, [showModal, form, priority, isSendLegacyTransaction, hasInitialized]);

  // Separate useEffect for priority changes only
  useEffect(() => {
    if (!showModal || hasCustomValues) return;

    switch (priority) {
      case 0:
        if (!isSendLegacyTransaction) {
          form.setFieldValue(
            'maxPriorityFeePerGas',
            removeScientificNotation(0.8 * maxPriorityFeePerGas)
          );
          form.setFieldValue(
            'maxFeePerGas',
            removeScientificNotation(0.8 * maxFeePerGas)
          );
          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: true,
            maxPriorityFeePerGas: 0.8 * maxPriorityFeePerGas,
            maxFeePerGas: 0.8 * maxFeePerGas,
          }));
        } else {
          form.setFieldValue(
            'gasPrice',
            removeScientificNotation(0.8 * gasPrice)
          );

          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: true,
            gasPrice: 0.8 * gasPrice,
          }));
        }
        break;

      case 1:
        if (!isSendLegacyTransaction) {
          form.setFieldValue(
            'maxPriorityFeePerGas',
            removeScientificNotation(1 * maxPriorityFeePerGas)
          );
          form.setFieldValue(
            'maxFeePerGas',
            removeScientificNotation(1 * maxFeePerGas)
          );
          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: false,
            maxPriorityFeePerGas: 1 * maxPriorityFeePerGas,
            maxFeePerGas: 1 * maxFeePerGas,
          }));
        } else {
          form.setFieldValue(
            'gasPrice',
            removeScientificNotation(1 * gasPrice)
          );

          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: false,
            gasPrice: 1 * gasPrice,
          }));
        }
        break;

      case 2:
        if (!isSendLegacyTransaction) {
          form.setFieldValue(
            'maxPriorityFeePerGas',
            removeScientificNotation(1.2 * maxPriorityFeePerGas)
          );
          form.setFieldValue(
            'maxFeePerGas',
            removeScientificNotation(1.2 * maxFeePerGas)
          );
          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: true,
            maxPriorityFeePerGas: 1.2 * maxPriorityFeePerGas,
            maxFeePerGas: 1.2 * maxFeePerGas,
          }));
        } else {
          form.setFieldValue(
            'gasPrice',
            removeScientificNotation(1.2 * gasPrice)
          );

          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: true,
            gasPrice: 1.2 * gasPrice,
          }));
        }
        break;

      default:
        if (!isSendLegacyTransaction) {
          form.setFieldValue(
            'maxPriorityFeePerGas',
            removeScientificNotation(1 * maxPriorityFeePerGas)
          );
          form.setFieldValue(
            'maxFeePerGas',
            removeScientificNotation(1 * maxFeePerGas)
          );
          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: false,
            maxPriorityFeePerGas: 1 * maxPriorityFeePerGas,
            maxFeePerGas: 1 * maxFeePerGas,
          }));
        } else {
          form.setFieldValue(
            'gasPrice',
            removeScientificNotation(1 * gasPrice)
          );

          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: false,
            gasPrice: 1 * gasPrice,
          }));
        }
    }
  }, [
    priority,
    showModal,
    gasPrice,
    maxPriorityFeePerGas,
    maxFeePerGas,
    isSendLegacyTransaction,
    hasCustomValues,
  ]);

  return (
    <EditFeeModalBase
      show={showModal}
      onClose={() => {
        setCustomFee((prevState) => ({
          ...prevState,
          isCustom: false,
          maxPriorityFeePerGas: 1 * maxPriorityFeePerGas,
          maxFeePerGas: 1 * maxFeePerGas,
          gasPrice: 1 * gasPrice,
        }));
        setHasCustomValues(false);
        form.resetFields();
        // Reset validation states
        setGasLimitValid(null);
        setPriorityFeeValid(null);
        setMaxFeeValid(null);
        setGasPriceValid(null);
        setHasInitialized(false);
        setIsOpen(false);
      }}
    >
      <div className="inline-block align-middle w-screen max-w-md mx-auto text-brand-white font-poppins bg-brand-blue500 rounded-t-[50px] shadow-xl transform transition-all">
        <div className="flex flex-col items-center justify-center w-full h-full">
          <div className="flex py-4 justify-center w-full rounded-t-[50px] bg-[#1c3255]">
            <p className="text-center font-poppins text-base font-medium uppercase">
              {t('send.editFee')}
            </p>
          </div>
          <div className="flex flex-col items-center">
            <div className="flex justify-center w-full my-4">
              <PriorityBar
                priority={priority}
                onClick={(value) => {
                  setPriority(value);
                  setHasCustomValues(false);
                  // Reset validation states when switching presets
                  setGasLimitValid(null);
                  setPriorityFeeValid(null);
                  setMaxFeeValid(null);
                  setGasPriceValid(null);
                }}
              />
            </div>
            <Form
              validateMessages={{ default: '' }}
              className="flex flex-col gap-3 items-center justify-center my-3 py-2 w-80 md:w-full md:max-w-md"
              name="priority-form"
              id="priority-form"
              labelCol={{ span: 8 }}
              wrapperCol={{ span: 16 }}
              autoComplete="off"
              form={form}
            >
              <div className="flex flex-col items-start justify-center">
                <p className="mb-1 text-sm">{t('send.gasLimit')}</p>
                <Form.Item
                  name="gasLimit"
                  className="text-left mb-0"
                  hasFeedback={false}
                  rules={[
                    {
                      required: false,
                      message: t('send.gasLimitMessage'),
                    },
                    () => ({
                      validator(_, value) {
                        if (value > 1000) {
                          return Promise.resolve();
                        }

                        return Promise.reject(
                          new Error(t('send.gasLimitTooLow'))
                        );
                      },
                    }),
                  ]}
                  initialValue={fee?.gasLimit}
                >
                  <div className="relative">
                    <input
                      type="number"
                      placeholder={t('send.gasLimit')}
                      className={`custom-gas-input ${
                        gasLimitValid === false ? 'border-red-500' : ''
                      }`}
                      style={{ paddingRight: '3.5rem' }}
                      value={form.getFieldValue('gasLimit') || ''}
                      onChange={(e) => {
                        const value = +e.target.value;
                        form.setFieldValue('gasLimit', value);
                        setHasCustomValues(true);
                        validateGasLimit(value);
                        setCustomFee((prevState) => ({
                          ...prevState,
                          isCustom: true,
                          gasLimit: value,
                        }));
                      }}
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
                <div className="h-4 mt-1">
                  {gasLimitValid === false && (
                    <p className="text-red-400 text-xs">
                      {t('send.gasLimitTooLow')}
                    </p>
                  )}
                </div>
              </div>

              {!isSendLegacyTransaction ? (
                <>
                  <div className="flex flex-col items-start justify-center">
                    <p className="text-sm text-white mb-1 font-normal">
                      {t('send.maxPriority')} (GWEI)
                    </p>
                    <Form.Item
                      name="maxPriorityFeePerGas"
                      className="text-left mb-0"
                      hasFeedback={false}
                      rules={[
                        {
                          required: false,
                          message: '',
                        },
                        () => ({
                          validator(_, value) {
                            const maxFee = form.getFieldValue('maxFeePerGas');
                            if (value > 0 && (!maxFee || value < maxFee)) {
                              return Promise.resolve();
                            }

                            return Promise.reject(
                              new Error(t('send.priorityFeeTooHigh'))
                            );
                          },
                        }),
                      ]}
                    >
                      <div className="relative">
                        <input
                          type="number"
                          placeholder={`${t('send.maxPriorityFee')} (GWEI)`}
                          className={`custom-gas-input ${
                            priorityFeeValid === false ? 'border-red-500' : ''
                          }`}
                          style={{ paddingRight: '3.5rem' }}
                          value={
                            form.getFieldValue('maxPriorityFeePerGas') || ''
                          }
                          onChange={(e) => {
                            const value = +e.target.value;
                            form.setFieldValue('maxPriorityFeePerGas', value);
                            setHasCustomValues(true);
                            validatePriorityFee(value);
                            setCustomFee((prevState) => ({
                              ...prevState,
                              isCustom: true,
                              maxPriorityFeePerGas: value,
                            }));
                          }}
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
                    <div className="h-4 mt-1">
                      {priorityFeeValid === false && (
                        <p className="text-red-400 text-xs">
                          {t('send.priorityFeeTooHigh')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-start justify-center">
                    <p className="text-sm text-white mb-1 font-normal">
                      {t('send.maxFee')} (GWEI)
                    </p>
                    <Form.Item
                      name="maxFeePerGas"
                      className="text-left mb-0"
                      hasFeedback={false}
                      rules={[
                        {
                          required: false,
                          message: '',
                        },
                        () => ({
                          validator(_, value) {
                            // Max fee must be greater than max priority fee
                            const maxPriorityFee = form.getFieldValue(
                              'maxPriorityFeePerGas'
                            );
                            if (value > maxPriorityFee && value > 0) {
                              return Promise.resolve();
                            }

                            return Promise.reject(
                              new Error(t('send.maxFeeTooLow'))
                            );
                          },
                        }),
                      ]}
                    >
                      <div className="relative">
                        <input
                          type="number"
                          placeholder={`${t('send.maxFee')} (GWEI)`}
                          className={`custom-gas-input ${
                            maxFeeValid === false ? 'border-red-500' : ''
                          }`}
                          style={{ paddingRight: '3.5rem' }}
                          value={form.getFieldValue('maxFeePerGas') || ''}
                          onChange={(e) => {
                            const value = +e.target.value;
                            form.setFieldValue('maxFeePerGas', value);
                            setHasCustomValues(true);
                            validateMaxFee(value);
                            setCustomFee((prevState) => ({
                              ...prevState,
                              isCustom: true,
                              maxFeePerGas: value,
                            }));
                          }}
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
                    <div className="h-4 mt-1">
                      {maxFeeValid === false && (
                        <p className="text-red-400 text-xs">
                          {t('send.maxFeeTooLow')}
                        </p>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-start justify-center">
                  <p className="text-sm text-white mb-1 font-normal">
                    {t('send.gasPrice')} (GWEI)
                  </p>
                  <Form.Item
                    name="gasPrice"
                    className="text-left mb-0"
                    hasFeedback={false}
                    rules={[
                      {
                        required: false,
                        message: '',
                      },
                      () => ({
                        validator(_, value) {
                          if (value > 0) {
                            return Promise.resolve();
                          }

                          return Promise.reject(
                            new Error(t('send.gasPriceTooLow'))
                          );
                        },
                      }),
                    ]}
                  >
                    <div className="relative">
                      <input
                        type="number"
                        placeholder={`${t('send.maxPriorityFee')} (GWEI)`}
                        className={`custom-gas-input ${
                          gasPriceValid === false ? 'border-red-500' : ''
                        }`}
                        style={{ paddingRight: '3.5rem' }}
                        value={form.getFieldValue('gasPrice') || ''}
                        onChange={(e) => {
                          const value = +e.target.value;
                          form.setFieldValue('gasPrice', value);
                          setHasCustomValues(true);
                          validateGasPrice(value);
                          setCustomFee((prevState) => ({
                            ...prevState,
                            isCustom: true,
                            gasPrice: value,
                          }));
                        }}
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
                  <div className="h-4 mt-1">
                    {gasPriceValid === false && (
                      <p className="text-red-400 text-xs">
                        {t('send.gasPriceTooLow')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </Form>
          </div>

          <div className="flex items-center justify-center mt-4 mb-4 gap-6">
            <Button
              className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-white text-base bg-transparent hover:opacity-60 border border-white rounded-[100px] transition-all duration-300 xl:flex-none"
              type="submit"
              id="confirm_btn"
              onClick={() => {
                setHasCustomValues(false);
                form.resetFields();
                // Reset validation states
                setGasLimitValid(null);
                setPriorityFeeValid(null);
                setMaxFeeValid(null);
                setGasPriceValid(null);
                setHasInitialized(false);
                setIsOpen(false);
              }}
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
              id="confirm_btn"
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
