import * as React from 'react';
import { FC, ReactElement, ReactNode, ChangeEvent } from 'react';
import MUISelect from '@material-ui/core/Select';
import MUIMenuItem from '@material-ui/core/MenuItem';
import ArrowDownIcon from '@material-ui/icons/KeyboardArrowDown';

import styles from './Select.scss';
import { useSettingsView } from 'hooks/index';

import { CONFIGURE_NETWORK_VIEW } from 'containers/auth/Settings/views/routes';

interface IOption {
  [key: string]: string;
}

interface ISelect {
  showSettings?: any;
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
  showSettings,
}) => {
  const showView = useSettingsView();

  return (
    <div className={styles.select}>
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
        <MUIMenuItem
          onClick={() => {
            showSettings(true)
            showView(CONFIGURE_NETWORK_VIEW)
          }}
          key="configure"
          value="configure"
          style={{ borderTop: "1px solid black", paddingTop: ".5rem" }}
        >
          Configure network
        </MUIMenuItem>
      </MUISelect>
    </div>
  );
};

export default Select;
