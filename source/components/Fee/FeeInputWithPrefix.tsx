import { isNumber } from 'lodash';
import React from 'react';
import { useFormContext } from 'react-hook-form';

import { Icon, Tooltip } from '..';

export const FeeInputWithPrefix = ({ disabled }: { disabled: boolean }) => {
  const { register } = useFormContext();

  return (
    <Tooltip
      content={
        disabled
          ? 'Use recommended fee. Disabled for SYS networks because the fee used in transactions is already the recommended with current network conditions.'
          : ''
      }
    >
      <div className="disabled flex w-80 cursor-not-allowed md:w-96">
        <span className="flex items-center justify-center pb-2 w-16 bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-l-full outline-none">
          <Icon name="verified" />
        </span>

        <input
          type="text"
          placeholder="Network fee"
          className="mixed-border-input"
          {...register('fee', {
            required: true,
            disabled,
            validate: {
              lessThanOne: (value) => Number(value) < 1,
              isNumber: (value) => isNumber(value),
            },
          })}
        />
      </div>
    </Tooltip>
  );
};
