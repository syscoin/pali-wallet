import * as React from 'react';
import { FC } from 'react';
import { Icon } from '..';

interface IOption {
  [key: string]: string;
}

export const Select: FC<any> = ({
  value,
  onChange,
  disabled = false,
  expanded,
  title,
  setExpanded,
  children,
  icon,
  close,
  className = "bg-brand-lightnavyborder",
  standardClass = "relative w-full transition-all duration-300 cursor-pointer text-brand-white z-10"
}) => {
  return (
    <div
      className={`${className} ${standardClass}`}
    >
      <p
        onClick={() => {
          if (close) {
            close(false);
          }

          setExpanded(!expanded);
        }}
        className="flex items-center pt-6 px-6 text-base"
      >
        {icon && (
          <Icon
            name={icon}
            className="pr-4 inline-flex self-center text-base mb-0.5"
          />
        )}

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
