import { Form, Input } from 'antd';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon, Tooltip } from '..';
import { usePrice } from 'hooks/index';
import { RootState } from 'state/store';

export const Fee = ({
  recommend,
  disabled,
  form,
  onFeeChange,
}: {
  disabled: boolean;
  form: any;
  onFeeChange?: (newFee: number) => void;
  recommend?: number;
}) => {
  const { t } = useTranslation();
  const { getFiatAmount } = usePrice();
  const { isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { fiat } = useSelector((state: RootState) => state.price);

  // State to track current fee value for real-time validation
  const [currentFee, setCurrentFee] = useState<string>('');

  // Memoize the fee change handler to avoid triggering effects
  const handleFeeChange = useCallback(
    (value: number | undefined) => {
      // Only call onFeeChange if value is a valid positive number
      if (onFeeChange && value !== undefined && value > 0 && !isNaN(value)) {
        onFeeChange(value);
      }
    },
    [onFeeChange]
  );

  // Initialize and sync form value with recommend
  useEffect(() => {
    const currentFormValue = form.getFieldValue('fee');
    // Set form value if we have a recommend value and form is empty
    if (recommend !== null && recommend !== undefined && !currentFormValue) {
      form.setFieldsValue({ fee: recommend });
      setCurrentFee(String(recommend));
      // Notify parent component of initial fee
      handleFeeChange(recommend);
    } else if (currentFormValue) {
      // Use existing form value if user has already entered something
      setCurrentFee(String(currentFormValue));
      // Notify parent component of existing fee
      const numValue = Number(currentFormValue);
      // Only call if it's a valid positive number
      if (numValue > 0 && !isNaN(numValue)) {
        handleFeeChange(numValue);
      }
    } else {
      // Default case
      setCurrentFee(String(recommend || ''));
    }
  }, [form, recommend, handleFeeChange]);

  // Fee rate validation thresholds for UTXO networks (coin/byte)
  const getFeeRateThresholds = () => {
    if (isBitcoinBased) {
      return {
        normal: 0.001, // 1000 satoshis/byte = 0.001 coin/byte
        high: 0.01, // 10000 satoshis/byte = 0.01 coin/byte
        extreme: 0.1, // 100000 satoshis/byte = 0.1 coin/byte
        insane: 1.0, // 1 coin/byte - definitely wrong
      };
    }
    return null;
  };

  const validateFeeRate = (value: number) => {
    if (!isBitcoinBased || !value) return null;

    const thresholds = getFeeRateThresholds();
    if (!thresholds) return null;

    if (value >= thresholds.insane) {
      return {
        level: 'error',
        message: t('send.feeRateInsane', {
          value: value.toFixed(8),
          currency: activeNetwork.currency.toUpperCase(),
        }),
      };
    } else if (value >= thresholds.extreme) {
      return {
        level: 'error',
        message: t('send.feeRateExtreme', {
          value: value.toFixed(8),
          currency: activeNetwork.currency.toUpperCase(),
        }),
      };
    } else if (value >= thresholds.high) {
      return {
        level: 'warning',
        message: t('send.feeRateHigh', {
          value: value.toFixed(8),
          currency: activeNetwork.currency.toUpperCase(),
        }),
      };
    } else if (value >= thresholds.normal) {
      return {
        level: 'warning',
        message: t('send.feeRateNormal', {
          value: value.toFixed(8),
          currency: activeNetwork.currency.toUpperCase(),
        }),
      };
    }

    return null;
  };

  const getPlaceholder = () => {
    if (isBitcoinBased) {
      return t('components.feeRateLabel', {
        currency: activeNetwork.currency.toUpperCase(),
      });
    }
    return t('components.gasPriceLabel');
  };

  const getTooltipText = () => {
    if (isBitcoinBased) {
      return t('components.feeRateTooltip', {
        currency: activeNetwork.currency.toUpperCase(),
      });
    }
    return t('components.gasPriceTooltip');
  };

  const getEstimatedFiatCost = (feeRate: number) => {
    if (!isBitcoinBased || !feeRate || feeRate <= 0) return null;

    // Use typical transaction size (300 bytes) for estimate
    const typicalTxSize = 300;
    const estimatedFee = feeRate * typicalTxSize;

    try {
      const fiatAmount = getFiatAmount(
        estimatedFee,
        6,
        String(fiat.asset).toUpperCase()
      );
      return fiatAmount;
    } catch (error) {
      return null;
    }
  };

  return (
    <div className="flex flex-col gap-2 md:w-96">
      <div className="flex">
        <div className="sender-custom-input w-full">
          <Form.Item
            name="fee"
            className="w-full"
            hasFeedback
            rules={[
              {
                required: true,
                message: '',
              },
              () => ({
                validator(_, value) {
                  if (!value) return Promise.resolve();

                  const numValue = parseFloat(value);
                  if (isNaN(numValue)) {
                    return Promise.reject(new Error('Invalid fee rate'));
                  }

                  const validation = validateFeeRate(numValue);
                  if (validation && validation.level === 'error') {
                    return Promise.reject(new Error(validation.message));
                  }

                  // Warnings don't block submission, just show in console/UI
                  if (validation && validation.level === 'warning') {
                    console.warn('Fee rate warning:', validation.message);
                  }

                  return Promise.resolve();
                },
              }),
            ]}
          >
            <div>
              <div className="relative">
                <Input
                  disabled={disabled}
                  id="fee-input"
                  type="number"
                  placeholder={getPlaceholder()}
                  value={form.getFieldValue('fee') ?? (recommend || '')}
                  onChange={(event) => {
                    const newValue = event.target.value;
                    setCurrentFee(newValue); // Update local state for real-time validation
                    // Manually set form value to ensure it's in sync
                    form.setFieldsValue({ fee: newValue });
                    // Trigger form validation to update the visual feedback
                    form.validateFields(['fee']);
                    // Notify parent component of fee change
                    // Only call if newValue is not empty and converts to a valid positive number
                    if (newValue && newValue.trim() !== '') {
                      const numValue = Number(newValue);
                      if (numValue > 0 && !isNaN(numValue)) {
                        handleFeeChange(numValue);
                      }
                    }
                  }}
                />
                {disabled && (
                  <Tooltip
                    content={getTooltipText()}
                    childrenClassName="absolute right-3 top-1/2 transform -translate-y-1/2 z-20"
                  >
                    <Icon
                      isSvg
                      name="Info"
                      className="w-4 h-4 text-brand-gray200 hover:text-brand-white transition-colors"
                    />
                  </Tooltip>
                )}

                {/* Estimated fiat cost display */}
                {(() => {
                  const feeToEstimate = currentFee || recommend;
                  if (!feeToEstimate) return null;

                  const numValue = parseFloat(String(feeToEstimate));
                  if (isNaN(numValue)) return null;

                  const estimatedFiat = getEstimatedFiatCost(numValue);
                  if (!estimatedFiat) return null;

                  return (
                    <p className="flex absolute right-[15%] top-[32%] text-xs flex-col items-center justify-center p-0 max-w-xs text-center text-brand-gray200 sm:w-full md:my-4">
                      <span>
                        {'~ '}
                        {estimatedFiat} est.
                      </span>
                    </p>
                  );
                })()}
              </div>

              {/* Fee rate warning display */}
              {(() => {
                const feeToValidate = currentFee || recommend;

                if (!feeToValidate) return null;

                const numValue = parseFloat(String(feeToValidate));
                if (isNaN(numValue)) return null;

                const validation = validateFeeRate(numValue);
                if (!validation) return null;

                return (
                  <div
                    className={`text-xs p-2 rounded mt-1 ${
                      validation.level === 'error'
                        ? 'bg-red-900/20 text-red-400 border border-red-600/30'
                        : 'bg-yellow-900/20 text-yellow-400 border border-yellow-600/30'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <Icon
                        name={
                          validation.level === 'error' ? 'warning' : 'question'
                        }
                        className="w-3 h-3"
                      />
                      <span>{validation.message}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </Form.Item>
        </div>
      </div>
    </div>
  );
};
