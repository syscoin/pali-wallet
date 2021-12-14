import * as React from 'react';
import { FC } from 'react';
import { Icon } from '..';

interface IOption {
  [key: string]: string;
}

export const Select: FC<any> = ({
  value,
  className,
  onChange,
  disabled = false,
  expanded,
  title,
  setExpanded,
  children,
  icon,
  close
}) => {
  return (
    <div
      className="relative w-full transition-all duration-300 cursor-pointer bg-brand-lightnavyborder text-brand-white z-10"
    >
      <p
        onClick={() => {
          close(false);

          setExpanded(!expanded);
        }}
        className="flex items-center pt-6 text-base px-6"
      >
        <Icon
          name={icon}
          className="pr-4 inline-flex self-center text-base mb-0.5"
        />

        <span>{title}</span>

        {expanded ?
          <Icon
            name="select-down"
            className="w-8 mb-2"
            wrapperClassname="absolute right-4"
          /> :
          <Icon
            name="select-up"
            className="w-8 mb-2"
            wrapperClassname="absolute right-4"
          />
        }
      </p>

      <ul
        className={expanded ?
          'block bg-brand-navy my-2 text-sm' :
          'hidden'
        }
      >
        {children}
      </ul>
    </div>
  );
};
