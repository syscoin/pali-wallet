import * as React from 'react';
import { FC, ReactElement, ReactNode, ChangeEvent } from 'react';
import MUISelect from '@material-ui/core/Select';
import MUIMenuItem from '@material-ui/core/MenuItem';
import ArrowDownIcon from '@material-ui/icons/KeyboardArrowDown';

interface IOption {
  [key: string]: string;
}

interface ISelect {
  disabled?: boolean;
  fullWidth?: boolean;
  input?: ReactElement;
  onChange?: (
    event: ChangeEvent<{
      name?: string | undefined,
      value: unknown,
    }>,
    child: ReactNode
  ) => void;
  options: Array<IOption>;
  value?: unknown;
}

const Select: FC<ISelect> = ({
  options,
  value,
  input,
  fullWidth,
  onChange,
  disabled = false,
}) => {
  return (
    <div>
      <MUISelect
        value={value}
        input={input}
        disabled={disabled}
        onChange={onChange}
        fullWidth={fullWidth}
        IconComponent={ArrowDownIcon}
        MenuProps={{
          anchorOrigin: {
            vertical: 'bottom',
            horizontal: 'left',
          },
          getContentAnchorEl: null,
        }}
      >
        {options.map((option: IOption) => {
          const value = Object.keys(option)[0];
          const label = option[value];
          return (
            <MUIMenuItem key={value} value={value}>
              {label}
            </MUIMenuItem>
          );
        })}
      </MUISelect>
    </div>
  );
};

export default Select;
