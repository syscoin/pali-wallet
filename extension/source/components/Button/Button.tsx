import React, { ReactNode, FC } from 'react';

interface IButton {
  children: ReactNode;
  className?: string;
  classNameBorder?: string;
  disabled?: boolean;
  id?: string;
  loading?: boolean;
  noStandard?: boolean;
  onClick?: any;
  standardClass?: string;
  type: 'button' | 'submit';
}

export const Button: FC<IButton> = ({
  children,
  id = '',
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
  className = '',
  standardClass = 'text-brand-white tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer font-light transition-all duration-300 rounded-full bg-brand-navy hover:bg-transparent',
  noStandard = false,
  classNameBorder = '',
}) => {
  return (
    <>
      {noStandard ? (
        <button
          id={id}
          className={className}
          disabled={disabled || loading}
          onClick={onClick}
          type={type}
        >
          {children}
        </button>
      ) : (
        <div className={`p-0.5 bg-primary rounded-full ${classNameBorder}`}>
          <button
            className={`${className} ${standardClass}`}
            disabled={disabled || loading}
            onClick={onClick}
            type={type}
            id={id}
          >
            {children}
          </button>
        </div>
      )}
    </>
  );
};
