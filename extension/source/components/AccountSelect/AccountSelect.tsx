import React, { useState, FC, ReactNode } from 'react';
import clsx from 'clsx';
import DownArrowIcon from '@material-ui/icons/ExpandMore';

import styles from './AccountSelect.scss';

interface IOptions {
  // key => value of Option
  // value => label of Option
  [key: string]: any;
}

interface IAccountSelect {
  options: IOptions;
  value: string;
  label: string | ReactNode;
  onChange: (value: string) => void;
}

const AccountSelect: FC<IAccountSelect> = ({
  options,
  label,
  value,
  onChange,
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={clsx(styles.accselect, { [styles.expanded]: expanded })}
      onClick={() => setExpanded(!expanded)}
    >
      <span className={styles.selected}>
        {label}
        <DownArrowIcon className={styles.arrow} />
      </span>
      <ul className={styles.options}>
        {Object.keys(options).map((key: string) => (
          <li key={key} onClick={() => onChange(key)}>
            {options[key]!.label}
            {key === value && <small>(active)</small>}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AccountSelect;
