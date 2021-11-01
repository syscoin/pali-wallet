import React, { useState, FC } from 'react';
import DownArrowIcon from '@material-ui/icons/ExpandMore';

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
      onClick={() => setExpanded(!expanded)}
    >
      <span>
        {options.find((el: any) => el.id === Number(value)).label}
        <DownArrowIcon />
      </span>
      <ul>
        {(options).map((option: any) => (
          <li key={String(option.id)} onClick={() => onChange(String(option.id))}>
            {option.label}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default FullSelect;
