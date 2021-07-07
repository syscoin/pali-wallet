import React, { useState, FC } from 'react';
import clsx from 'clsx';
import DownArrowIcon from '@material-ui/icons/ExpandMore';

import styles from './FullSelect.scss';

interface IOptions {
  [key: string]: any;
}

interface IFullSelect {
  options: IOptions;
  value: string;
  onChange: (value: string) => void;
}

const FullSelect: FC<IFullSelect> = ({ options, value, onChange }) => {
  const [expanded, setExpanded] = useState<boolean>(false);
  (options).map((option: any) => { console.log(option) })
  return (
    <div
      className={clsx(styles.fullselect, { [styles.expanded]: expanded })}
      onClick={() => setExpanded(!expanded)}
    >
      <span className={styles.selected}>
        {/* {options[value]!.label} */}
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
