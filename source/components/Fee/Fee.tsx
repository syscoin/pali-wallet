import { Form, Input } from 'antd';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip } from '..';

export const Fee = ({
  recommend,
  disabled,
  form,
  fiatValue,
}: {
  disabled: boolean;
  fiatValue?: string;
  form: any;
  recommend?: number;
}) => {
  const { t } = useTranslation();
  return (
    <Tooltip content={disabled ? t('components.useRecommendedFee') : ''}>
      <div className="disabled flex cursor-not-allowed md:w-96">
        <Form.Item
          name="fee"
          className="w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
          ]}
        >
          <div className="relative">
            <Input
              disabled={disabled}
              className="sender-custom-input"
              id="fee-input"
              type="number"
              placeholder="Fee network"
              value={recommend}
              onChange={(event) =>
                form.setFieldsValue({ fee: event.target.value })
              }
            />
            <p className="flex absolute right-[10%] top-[32%] text-xs flex-col items-center justify-center p-0 max-w-xs text-center text-brand-gray200 sm:w-full md:my-4">
              <span>
                {'≈ '}
                {fiatValue}
              </span>
            </p>
          </div>
        </Form.Item>
      </div>
    </Tooltip>
  );
};
