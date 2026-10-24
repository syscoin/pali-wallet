import { Form, Input } from 'antd';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon, Tooltip } from '..';
import { usePrice } from 'hooks/index';
import { RootState } from 'state/store';

// Keep small recommended rates readable instead of exposing exponent notation.
// Strings are user edits and must remain untouched while they are being typed.
const feeInputValue = (value: number | string) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', {
        useGrouping: false,
        maximumSignificantDigits: 21,
      })
    : value;

type FeeFieldSemantics = Pick<
  React.AriaAttributes,
  'aria-describedby' | 'aria-errormessage' | 'aria-invalid' | 'aria-required'
>;
type FeeFieldProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  children: (semantics: FeeFieldSemantics) => React.ReactNode;
};

// Keep the existing Form.Item control/ref and layout on the outer DIV, while
// applying its current validation semantics to the already-labelled input.
const FeeField = React.forwardRef<HTMLDivElement, FeeFieldProps>(
  function renderFeeField(
    {
      children,
      'aria-describedby': describedBy,
      'aria-errormessage': errorMessage,
      'aria-invalid': invalid,
      'aria-required': required,
      ...wrapperProps
    },
    ref
  ) {
    return (
      <div {...wrapperProps} ref={ref}>
        {children({
          'aria-describedby': describedBy,
          'aria-errormessage': errorMessage,
          'aria-invalid': invalid,
          'aria-required': required,
        })}
      </div>
    );
  }
);

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
  const { getFiatAmount, isFiatAvailable } = usePrice();
  const { isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { fiat } = useSelector((state: RootState) => state.price);

  // State to track current fee value for real-time validation
  const [currentFee, setCurrentFee] = useState<string>('');
  const feeWarningId = React.useId();

  // Memoize the fee change handler to avoid triggering effects
  const handleFeeChange = useCallback(
    (value: number | undefined) => {
      // Only call onFeeChange if value is a valid positive number
      if (onFeeChange && Number.isFinite(value) && value > 0) {
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
      form.setFieldsValue({ fee: feeInputValue(recommend) });
      setCurrentFee(String(feeInputValue(recommend)));
      // Notify parent component of initial fee
      handleFeeChange(recommend);
    } else if (currentFormValue) {
      // Use existing form value if user has already entered something
      setCurrentFee(String(feeInputValue(currentFormValue)));
      // Notify parent component of existing fee
      const numValue = Number(currentFormValue);
      // Only call if it's a valid positive number
      if (numValue > 0 && Number.isFinite(numValue)) {
        handleFeeChange(numValue);
      }
    } else {
      // Default case
      setCurrentFee(String(feeInputValue(recommend || '')));
    }
  }, [form, recommend, handleFeeChange]);

  const validateFeeRate = (value: number) => {
    if (!isBitcoinBased || !value) return null;

    // The form is coin/vbyte; the SDK rounds up to atomic units/vbyte.
    // Match its normal 5,000 sat/vbyte extraction guard here, before signing.
    // The finalized transaction is still checked by that guard independently.
    const satoshisPerVbyte = Math.ceil(value * 1e8);
    if (satoshisPerVbyte >= 5000) {
      return {
        level: 'error',
        message: t('send.feeRateSafetyLimit', {
          value: value.toFixed(8),
          currency: activeNetwork.currency.toUpperCase(),
          limit: '0.00005000',
        }),
      };
    } else if (satoshisPerVbyte >= 1000) {
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
    if (!isFiatAvailable || !isBitcoinBased || !feeRate || feeRate <= 0)
      return null;

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

  const displayedFeeValidation = (() => {
    const feeToValidate = currentFee || recommend;
    if (!feeToValidate) return null;
    const numValue = parseFloat(String(feeToValidate));
    return isNaN(numValue) ? null : validateFeeRate(numValue);
  })();

  return (
    <div className="flex flex-col gap-2 w-full">
      <label
        htmlFor="fee-input"
        className="text-left text-xs text-brand-gray200"
      >
        {getPlaceholder()}
      </label>
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
                  const numValue = Number(value);
                  if (!Number.isFinite(numValue) || numValue <= 0) {
                    return Promise.reject(new Error(t('send.invalidFeeRate')));
                  }

                  const validation = validateFeeRate(numValue);
                  if (validation && validation.level === 'error') {
                    // Message rendered by the styled warning card below;
                    // empty reject keeps the error border without a
                    // duplicate explain line.
                    return Promise.reject('');
                  }

                  return Promise.resolve();
                },
              }),
            ]}
          >
            <FeeField>
              {(fieldProps) => (
                <>
                  <div className="relative">
                    <Input
                      {...fieldProps}
                      aria-describedby={
                        [
                          fieldProps['aria-describedby'],
                          displayedFeeValidation?.level === 'error'
                            ? feeWarningId
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                      disabled={disabled}
                      id="fee-input"
                      type="number"
                      step="any"
                      placeholder={getPlaceholder()}
                      suffix={(() => {
                        const feeToEstimate = currentFee || recommend;
                        if (!feeToEstimate) return null;
                        const numValue = parseFloat(String(feeToEstimate));
                        if (isNaN(numValue)) return null;
                        const estimatedFiat = getEstimatedFiatCost(numValue);
                        if (!estimatedFiat) return null;
                        return (
                          <span className="text-xs text-brand-gray200 whitespace-nowrap">
                            ~ {estimatedFiat}{' '}
                            {t('components.estimatedAbbreviation')}
                          </span>
                        );
                      })()}
                      value={feeInputValue(
                        form.getFieldValue('fee') ?? (recommend || '')
                      )}
                      onChange={(event) => {
                        const newValue = event.target.value;
                        setCurrentFee(newValue); // Update local state for real-time validation
                        // Manually set form value to ensure it's in sync
                        form.setFieldsValue({ fee: newValue });
                        // Trigger form validation to update the visual feedback
                        void form
                          .validateFields(['fee'])
                          .catch(() => undefined);
                        // Notify parent component of fee change
                        // Only call if newValue is not empty and converts to a valid positive number
                        if (newValue && newValue.trim() !== '') {
                          const numValue = Number(newValue);
                          if (numValue > 0 && Number.isFinite(numValue)) {
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
                  </div>

                  {/* Fee rate warning display */}
                  {(() => {
                    const validation = displayedFeeValidation;
                    if (!validation) return null;

                    return (
                      <div
                        id={feeWarningId}
                        className={`text-xs p-2 rounded mt-1 ${
                          validation.level === 'error'
                            ? 'bg-red-900/20 text-red-400 border border-red-600/30'
                            : 'bg-yellow-900/20 text-yellow-400 border border-yellow-600/30'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <Icon
                            name={
                              validation.level === 'error'
                                ? 'warning'
                                : 'question'
                            }
                            className="w-3 h-3"
                          />
                          <span>{validation.message}</span>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </FeeField>
          </Form.Item>
        </div>
      </div>
    </div>
  );
};
