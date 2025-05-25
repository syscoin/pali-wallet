import { Form, Input } from 'antd';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { Icon, Tooltip } from '..';

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
    <div className="flex flex-col gap-2 md:w-96">
      <div className="flex">
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
            {disabled && (
              <Tooltip
                content={t('components.useRecommendedFee')}
                childrenClassName="absolute right-3 top-1/2 transform -translate-y-1/2 z-20"
              >
                <Icon
                  isSvg
                  name="Info"
                  className="w-4 h-4 text-brand-gray200 hover:text-brand-white transition-colors"
                />
              </Tooltip>
            )}
            <p className="flex absolute right-[15%] top-[32%] text-xs flex-col items-center justify-center p-0 max-w-xs text-center text-brand-gray200 sm:w-full md:my-4">
              <span>
                {'≈ '}
                {fiatValue}
              </span>
            </p>
          </div>
        </Form.Item>
      </div>
    </div>
  );
};
