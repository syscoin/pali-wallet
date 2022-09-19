import { Form, Input } from 'antd';
import React from 'react';

import { Icon, Tooltip } from '..';

export const Fee = ({
  recommend,
  disabled,
  form,
}: {
  disabled: boolean;
  form: any;
  recommend?: number;
}) => (
  <Tooltip
    content={
      disabled
        ? 'Use recommended fee. Disabled for SYS networks because the fee used in transactions is already the recommended with current network conditions.'
        : ''
    }
  >
    <div className="disabled flex w-80 cursor-not-allowed md:w-96">
      <span className="inline-flex items-center mb-2 px-5 bg-fields-input-primary border-2 border-fields-input-primary rounded-l-full">
        <Icon name="verified" />
      </span>

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
        <Input
          disabled={disabled}
          className="mixed-border-input"
          id="fee-input"
          type="number"
          placeholder="Fee network"
          value={recommend}
          onChange={(event) => form.setFieldsValue({ fee: event.target.value })}
        />
      </Form.Item>
    </div>
  </Tooltip>
);
