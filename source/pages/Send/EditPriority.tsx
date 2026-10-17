import { AdjustmentsIcon } from '@heroicons/react/outline';
import { Form, Input } from 'antd';
import React, { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CenterPanel,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogActions,
  DialogActionButton,
} from 'components/Dialog';
import { EditFeeModalBase } from 'components/Modal/EditFeeModalBase';
import { ICustomFeeParams, IFeeState } from 'types/transactions';
import removeScientificNotation from 'utils/removeScientificNotation';

import { PriorityBar } from './components';

interface IEditPriorityModalProps {
  customFee: ICustomFeeParams;
  defaultGasLimit?: number;
  estimatedFeeFloor?: IFeeState;
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
    defaultGasLimit = 0,
    estimatedFeeFloor,
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
  const fieldId = useId();
  const [form] = Form.useForm();
  const editorWasOpen = useRef(false);

  // Validation states for visual feedback
  // Start with null to avoid showing validation errors before user interaction
  const [gasLimitValid, setGasLimitValid] = useState<boolean | null>(null);
  const [priorityFeeValid, setPriorityFeeValid] = useState<boolean | null>(
    null
  );
  const [maxFeeValid, setMaxFeeValid] = useState<boolean | null>(null);
  const [gasPriceValid, setGasPriceValid] = useState<boolean | null>(null);

  // Track specific validation errors
  const [, setPriorityFeeError] = useState<string | null>(null);
  const [, setMaxFeeError] = useState<string | null>(null);

  // Use actual gas prices, even if 0 (cancellation now handles this properly)
  const maxFeePerGas = fee?.maxFeePerGas ?? 0;
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas ?? 0;
  const gasPrice = fee?.gasPrice ?? 0;
  const gasLimit = customFee.isCustom
    ? customFee.gasLimit
    : fee?.gasLimit ?? defaultGasLimit;
  // Prefer the successful raw estimate for this transaction. Other callers
  // retain their known quote conservatively; it is not claimed to be raw gas.
  const minimumGasLimit =
    fee?.minimumGasLimit ??
    estimatedFeeFloor?.minimumGasLimit ??
    fee?.gasLimit ??
    defaultGasLimit;
  const isValidGasLimit = (value: number | string) =>
    Number.isSafeInteger(minimumGasLimit) &&
    minimumGasLimit > 0 &&
    (typeof value === 'number' || /^\d+$/.test(value)) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= minimumGasLimit;
  const watchedGasLimit = Form.useWatch('gasLimit', form);
  const watchedGasPrice = Form.useWatch('gasPrice', form);
  const watchedMaxFeePerGas = Form.useWatch('maxFeePerGas', form);
  const watchedMaxPriorityFeePerGas = Form.useWatch(
    'maxPriorityFeePerGas',
    form
  );

  const belowEstimateWarnings = React.useMemo(() => {
    const warnings: string[] = [];
    const currentGasLimit = Number(
      watchedGasLimit ?? form.getFieldValue('gasLimit') ?? 0
    );
    const gasLimitFloor = estimatedFeeFloor?.gasLimit;

    if (
      gasLimitFloor &&
      currentGasLimit > 0 &&
      currentGasLimit < gasLimitFloor
    ) {
      warnings.push(
        t('send.gasLimitBelowEstimate', { estimate: gasLimitFloor })
      );
    }

    if (isSendLegacyTransaction) {
      const currentGasPrice = Number(
        watchedGasPrice ?? form.getFieldValue('gasPrice') ?? 0
      );
      const gasPriceFloor = estimatedFeeFloor?.gasPrice;

      if (
        gasPriceFloor !== null &&
        gasPriceFloor !== undefined &&
        currentGasPrice > 0 &&
        currentGasPrice < gasPriceFloor
      ) {
        warnings.push(
          t('send.gasPriceBelowEstimate', { estimate: gasPriceFloor })
        );
      }

      return warnings;
    }

    const currentMaxFee = Number(
      watchedMaxFeePerGas ?? form.getFieldValue('maxFeePerGas') ?? 0
    );
    const maxFeeFloor = estimatedFeeFloor?.maxFeePerGas;

    if (
      maxFeeFloor !== null &&
      maxFeeFloor !== undefined &&
      currentMaxFee > 0 &&
      currentMaxFee < maxFeeFloor
    ) {
      warnings.push(t('send.maxFeeBelowEstimate', { estimate: maxFeeFloor }));
    }

    const currentPriorityFee = Number(
      watchedMaxPriorityFeePerGas ??
        form.getFieldValue('maxPriorityFeePerGas') ??
        0
    );
    const priorityFeeFloor = estimatedFeeFloor?.maxPriorityFeePerGas;

    if (
      priorityFeeFloor !== null &&
      priorityFeeFloor !== undefined &&
      currentPriorityFee >= 0 &&
      currentPriorityFee < priorityFeeFloor
    ) {
      warnings.push(
        t('send.priorityFeeBelowEstimate', { estimate: priorityFeeFloor })
      );
    }

    return warnings;
  }, [
    estimatedFeeFloor,
    form,
    isSendLegacyTransaction,
    t,
    watchedGasLimit,
    watchedGasPrice,
    watchedMaxFeePerGas,
    watchedMaxPriorityFeePerGas,
  ]);

  // Validation functions
  const validateGasLimit = (value: number) => {
    const isValid = isValidGasLimit(value);
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
    if (!showModal) {
      editorWasOpen.current = false;
      return;
    }
    // Form edits are a local draft until Save. Do not replace them on a
    // rerender or publish them to the transaction behind this dialog.
    if (editorWasOpen.current) return;
    editorWasOpen.current = true;

    const currentPrice = isSendLegacyTransaction
      ? customFee.gasPrice
      : customFee.maxFeePerGas;
    const quotedPrice = isSendLegacyTransaction ? gasPrice : maxFeePerGas;
    const ratio =
      customFee.isCustom && quotedPrice > 0
        ? (currentPrice ?? 0) / quotedPrice
        : 1;
    const openingPriority =
      Math.abs(ratio - 0.8) < 0.01 ? 0 : Math.abs(ratio - 1.2) < 0.01 ? 2 : 1;
    setPriority(openingPriority);

    // Preserve the quoted/edited gas units; price presets do not change gas.
    const feeGasLimit = fee?.gasLimit ?? defaultGasLimit;
    const validGasLimit = customFee.isCustom ? customFee.gasLimit : feeGasLimit;

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
      const multiplier =
        openingPriority === 0 ? 0.8 : openingPriority === 2 ? 1.2 : 1;

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
  }, [
    showModal,
    customFee.isCustom,
    defaultGasLimit,
    fee?.gasLimit,
    gasPrice,
    isSendLegacyTransaction,
    maxFeePerGas,
    maxPriorityFeePerGas,
    minimumGasLimit,
    priority,
  ]);

  React.useEffect(() => {
    // Preserve the draft on quote refresh, but never retain a stale valid
    // indication if the successfully estimated minimum gas requirement moves.
    if (showModal) validateGasLimit(form.getFieldValue('gasLimit'));
  }, [showModal, minimumGasLimit]);

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
      const finalGasLimit = Number(values.gasLimit);

      // Update custom fee with final values based on transaction type
      if (isSendLegacyTransaction) {
        setCustomFee({
          isCustom: true,
          gasLimit: finalGasLimit,
          gasPrice: Number(values.gasPrice),
          // Clear EIP-1559 fields for legacy transactions
          maxFeePerGas: 0,
          maxPriorityFeePerGas: 0,
        });
      } else {
        setCustomFee({
          isCustom: true,
          gasLimit: finalGasLimit,
          maxFeePerGas: Number(values.maxFeePerGas),
          maxPriorityFeePerGas: Number(values.maxPriorityFeePerGas),
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

    // Changing a price preset must not silently replace edited gas units.
    const currentGasLimit =
      form.getFieldValue('gasLimit') ?? gasLimit ?? defaultGasLimit;
    const validGasLimit = Number(currentGasLimit);

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
    }
  };

  const handleFieldChange = (field: string, value: string) => {
    const numValue = value === '' ? 0 : Number(value);
    const validNumValue = isNaN(numValue) ? 0 : numValue;

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
  };

  const handleClose = () => {
    // Discard only this editor's draft; preserve the last saved transaction fee.
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
      <CenterPanel padded={false} scroll={false} className="flex flex-col">
        <DialogHeader
          title={t('send.editFee')}
          icon={<AdjustmentsIcon />}
          onClose={handleClose}
        />
        <DialogBody>
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
              <label htmlFor={`${fieldId}-gasLimit`} className="mb-1 text-sm">
                {t('send.gasLimit')}
              </label>
              <Form.Item
                name="gasLimit"
                className="w-full mb-0"
                hasFeedback
                validateStatus={
                  gasLimitValid === false
                    ? 'error'
                    : gasLimitValid
                    ? 'success'
                    : undefined
                }
                rules={[
                  {
                    validator: (_, value) => {
                      if (!isValidGasLimit(value)) {
                        return Promise.reject(
                          new Error(
                            t('send.gasLimitTooLow', {
                              minimum: minimumGasLimit,
                            })
                          )
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <div className="relative">
                  <Input
                    id={`${fieldId}-gasLimit`}
                    type="number"
                    placeholder={t('send.gasLimit')}
                    className="w-full"
                    value={form.getFieldValue('gasLimit') || ''}
                    onChange={(e) =>
                      handleFieldChange('gasLimit', e.target.value)
                    }
                  />
                </div>
              </Form.Item>
            </div>

            {!isSendLegacyTransaction ? (
              <>
                <div className="flex flex-col items-start justify-center w-full">
                  <label
                    htmlFor={`${fieldId}-priority`}
                    className="text-sm text-white mb-1 font-normal"
                  >
                    {t('send.maxPriority')} (GWEI)
                  </label>
                  <Form.Item
                    name="maxPriorityFeePerGas"
                    className="w-full mb-0"
                    hasFeedback
                    validateStatus={
                      priorityFeeValid === false
                        ? 'error'
                        : priorityFeeValid
                        ? 'success'
                        : undefined
                    }
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
                      <Input
                        id={`${fieldId}-priority`}
                        type="number"
                        placeholder={`${t('send.maxPriorityFee')} (GWEI)`}
                        className="w-full"
                        value={
                          form.getFieldValue('maxPriorityFeePerGas') !==
                          undefined
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
                    </div>
                  </Form.Item>
                </div>

                <div className="flex flex-col items-start justify-center w-full">
                  <label
                    htmlFor={`${fieldId}-maxFee`}
                    className="text-sm text-white mb-1 font-normal"
                  >
                    {t('send.maxFee')} (GWEI)
                  </label>
                  <Form.Item
                    name="maxFeePerGas"
                    className="w-full mb-0"
                    hasFeedback
                    validateStatus={
                      maxFeeValid === false
                        ? 'error'
                        : maxFeeValid
                        ? 'success'
                        : undefined
                    }
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
                      <Input
                        id={`${fieldId}-maxFee`}
                        type="number"
                        placeholder={`${t('send.maxFee')} (GWEI)`}
                        className="w-full"
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
                    </div>
                  </Form.Item>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start justify-center w-full">
                <label
                  htmlFor={`${fieldId}-gasPrice`}
                  className="text-sm text-white mb-1 font-normal"
                >
                  {t('send.gasPrice')} (GWEI)
                </label>
                <Form.Item
                  name="gasPrice"
                  className="w-full mb-0"
                  hasFeedback
                  validateStatus={
                    gasPriceValid === false
                      ? 'error'
                      : gasPriceValid
                      ? 'success'
                      : undefined
                  }
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
                    <Input
                      id={`${fieldId}-gasPrice`}
                      type="number"
                      placeholder={`${t('send.gasPrice')} (GWEI)`}
                      className="w-full"
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
                  </div>
                </Form.Item>
              </div>
            )}
          </Form>
          {belowEstimateWarnings.length > 0 && (
            <div className="w-full mt-2 rounded-lg border border-warning-info bg-warning-info bg-opacity-10 p-3 text-left">
              <p className="text-warning-info text-xs font-medium mb-1">
                {t('send.feeBelowEstimateTitle')}
              </p>
              {belowEstimateWarnings.map((warning) => (
                <p
                  key={warning}
                  className="text-warning-info text-xs leading-5"
                >
                  {warning}
                </p>
              ))}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <DialogActions>
            <DialogActionButton
              tone="secondary"
              type="button"
              onClick={handleClose}
            >
              {t('buttons.cancel')}
            </DialogActionButton>
            <DialogActionButton
              type="button"
              onClick={handleSubmit}
              disabled={!isFormValid()}
            >
              {t('buttons.save')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </CenterPanel>
    </EditFeeModalBase>
  );
};
