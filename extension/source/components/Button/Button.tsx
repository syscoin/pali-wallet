import React, { ReactNode, FC } from 'react';

interface IButton {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: any;
  type: 'button' | 'submit';
  standardClass?: string;
  className?: string;
  noStandard?: boolean;
  classNameBorder?: string;
}

export const Button: FC<IButton> = ({
  children,
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
  className = "",
  standardClass = "text-brand-white tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer font-light transition-all duration-300 rounded-full bg-brand-navy hover:bg-transparent",
  noStandard = false,
  classNameBorder = "",
}) => {
  return (
    <>
      {noStandard ? (
        <button
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
          >
            {children}
          </button>
        </div>
      )}
    </>
  );
};
