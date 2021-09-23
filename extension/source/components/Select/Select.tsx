import * as React from 'react';
import { FC, ReactElement, ReactNode, ChangeEvent } from 'react';
import MUISelect from '@material-ui/core/Select';
import MUIMenuItem from '@material-ui/core/MenuItem';
import ArrowDownIcon from '@material-ui/icons/KeyboardArrowDown';
import Settings from '@material-ui/icons/Settings';
import Icon from 'components/Icon';

import styles from './Select.scss';
import { useSettingsView } from 'hooks/index';

import { CONFIGURE_NETWORK_VIEW } from 'containers/auth/Settings/views/routes';
import { formatURL } from 'containers/auth/helpers';

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
          return (
            <MUIMenuItem key={option.id} value={option.id}>
              {formatURL(String(option.label), 12)}
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
          style={{ borderBottom: "1px solid transparent", paddingTop: ".7rem", color: "#4ca1cf", marginRight: ".5rem" }}
        >
          <Icon Component={Settings} />
          <span style={{ marginLeft: "-6px" }}>Settings</span>
        </MUIMenuItem>
      </MUISelect>
    </div>
  );
};

export default Select;
