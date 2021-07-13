import React, { useState, FC } from 'react';
import clsx from 'clsx';
import DownArrowIcon from '@material-ui/icons/ExpandMore';

import styles from './FullSelect.scss';

interface IOptions {
  [key: string]: any;
}

interface IFullSelect {
  onChange: (value: string) => void;
  options: IOptions;
  value: string;
}

const FullSelect: FC<IFullSelect> = ({ options, value, onChange }) => {
  const [expanded, setExpanded] = useState<boolean>(false);

  return (
    <div
      className={clsx(styles.fullselect, { [styles.expanded]: expanded })}
      onClick={() => setExpanded(!expanded)}
    >
      <span className={styles.selected}>
        {options.find((el: any) => el.id === Number(value))!.label}
        <DownArrowIcon className={styles.arrow} />
      </span>
      <ul className={styles.options}>
        {(options).map((option: any) => (
          <li key={String(option.id)} onClick={() => onChange(String(option.id))}>
            {option!.label}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default FullSelect;
