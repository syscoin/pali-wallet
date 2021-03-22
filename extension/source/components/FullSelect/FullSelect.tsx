import React, { useState, FC } from 'react';
import clsx from 'clsx';
import DownArrowIcon from '@material-ui/icons/ExpandMore';

import styles from './FullSelect.scss';

interface IOptions {
  // key => value of Option
  // value => label of Option
  [key: string]: any;
}

interface IFullSelect {
  options: IOptions;
  value: string;
  onChange: (value: string) => void;
}

const FullSelect: FC<IFullSelect> = ({ options, value, onChange }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={clsx(styles.fullselect, { [styles.expanded]: expanded })}
      onClick={() => setExpanded(!expanded)}
    >
      <span className={styles.selected}>
        {options[value]!.label}
        <DownArrowIcon className={styles.arrow} />
      </span>
      <ul className={styles.options}>
        {Object.keys(options).map((key: string) => (
          <li key={key} onClick={() => onChange(key)}>
            {options[key]!.label}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default FullSelect;
