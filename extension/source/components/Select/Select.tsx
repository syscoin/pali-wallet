import * as React from 'react';
import { FC, ReactElement, ReactNode, ChangeEvent } from 'react';
// import MUISelect from '@material-ui/core/Select';
// import MUIMenuItem from '@material-ui/core/MenuItem';
// import ArrowDownIcon from '@material-ui/icons/KeyboardArrowDown';

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

const Select: FC<any> = ({
  options,
  value,
  className,
  // input,
  // fullWidth,
  onChange,
  disabled = false,
}) => {
  return (
    <div>
      <select className={className} disabled={disabled} onChange={onChange} value={value} name="" id="">
        {options.map((option: IOption) => {
          const value = Object.keys(option)[0];
          const label = option[value];
          return (
            <option key={value} value={value}>
              {label}
            </option>
          );
        })}
      </select>
    </div>
  );
};

export default Select;
