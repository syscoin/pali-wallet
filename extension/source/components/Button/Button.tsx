import React, { FC } from 'react';
import { Icon } from '..';

type IPrimaryButton = {
  children: any;
  disabled?: boolean;
  loading?: boolean;
  type: "button" | "submit" | "reset" | undefined;
  onClick?: any;
  width?: string;
  action?: boolean;
}

export const Button = ({
  children,
  disabled = false,
  loading = false,
  type,
  onClick,
  className = "",
}) => {
  return (
    <button
      className={className}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
};

const disabledStyle = "text-button-disabled cursor-not-allowed font-light border border-button-disabled";

export const PrimaryButton: FC<IPrimaryButton> = ({
  children,
  disabled = false,
  loading = false,
  type,
  onClick,
  width = '36',
  action = false
}) => {
  return (
    <button
      className={`${disabled || loading ? disabledStyle : 'text-brand-white cursor-pointer border border-button-primary bg-button-primary hover:bg-button-primaryhover'} tracking-normal text-sm leading-4 ${action ? 'w-40' : `w-${width}`} transition-all duration-300 rounded-full ${action ? 'py-2' : 'py-2.5'} flex justify-center gap-x-2 h-10 items-center font-bold`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      {action ? (
        <>
          <Icon name="check-outlined" wrapperClassname="mb-0.5" className="text-brand-white" />

          <>
            {loading ? (
              <Icon name="loading" className="text-brand-white" />
            ) : children}
          </>
        </>
      ) : (
        <>
          {loading ? (
            <Icon name="loading" className="text-brand-white" />
          ) : children}
        </>
      )}
    </button>
  );
}

export const SecondaryButton: FC<IPrimaryButton> = ({
  children,
  disabled = false,
  loading = false,
  type,
  onClick,
  action = false,
}) => {
  return (
    <button
      className={`${disabled || loading ? disabledStyle : 'text-brand-white cursor-pointer border border-button-secondary bg-button-secondary hover:bg-button-secondaryhover'} tracking-normal text-sm leading-4 ${action ? 'w-40' : 'w-36'} transition-all duration-300 rounded-full ${action ? 'py-2' : 'py-2.5'} flex justify-center gap-x-2 h-10 items-center font-bold`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      {action ? (
        <>
          <Icon name="close" wrapperClassname="mb-0.5" className="text-brand-white" />

          <>
            {loading ? (
              <Icon name="loading" className="text-brand-white" />
            ) : children}
          </>
        </>
      ) : (
        <>
          {loading ? (
            <Icon name="loading" className="text-brand-white" />
          ) : children}
        </>
      )}
    </button>
  );
}
