import React, { useState, FC, ReactNode } from 'react';
import DownArrowIcon from '@material-ui/icons/ExpandMore';

interface IOptions {
  [key: string]: any;
}

interface IAccountSelect {
  label: string | ReactNode;
  onChange: (value: string) => void;
  options: IOptions;
  value: string;
}

const AccountSelect: FC<IAccountSelect> = ({
  options,
  label,
  value,
  onChange,
}) => {
  const [expanded, setExpanded] = useState<boolean>(false);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
    >
      <span>
        {label}
        <DownArrowIcon />
      </span>
      <ul>
        {Object.keys(options).map((key: string) => (
          <li key={key} onClick={() => onChange(key)}>
            {options[key].label}
            {key === value && <small>(active)</small>}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AccountSelect;
