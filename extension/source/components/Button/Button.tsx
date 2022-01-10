import React, { FC } from 'react';
import { Icon } from '..';

type IPrimaryButton = {
  children: any;
  disabled?: boolean;
  loading?: boolean;
  type: 'button' | 'submit' | 'reset' | undefined;
  onClick?: any;
  width?: string;
  action?: boolean;
};

export const Button = ({
  children,
  disabled = false,
  loading = false,
  type,
  onClick,
  className = '',
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

const disabledStyle =
  'text-button-disabled cursor-not-allowed font-light border-2 border-button-disabled';

export const PrimaryButton: FC<IPrimaryButton> = ({
  children,
  disabled = false,
  loading = false,
  type,
  onClick,
  width = '36',
  action = false,
}) => {
  return (
    <button
      className={`tracking-normal cursor-pointer border-2 text-sm leading-4 ${
        action ? 'w-40' : `w-${width}`
      } transition-all duration-300 h-10 ${
        action ? 'py-2' : 'py-2.5'
      } rounded-full flex justify-center items-center gap-x-2 font-bold 
      
      ${
        disabled || loading
          ? disabledStyle
          : action
          ? 'border-warning-success bg-warning-success hover:bg-warning-successhover text-brand-white'
          : 'border-button-primary bg-button-primary hover:bg-button-primaryhover text-brand-white'
      }`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      {action ? (
        <>
          {loading ? (
            <Icon name="loading" className="text-brand-white" />
          ) : (
            <>
              <Icon
                name="check-outlined"
                wrapperClassname="mb-0.5"
                className={`${
                  disabled ? 'text-button-disabled' : 'text-brand-white'
                }`}
              />
              {children}
            </>
          )}
        </>
      ) : (
        <>
          {loading ? (
            <Icon name="loading" className="text-brand-white" />
          ) : (
            children
          )}
        </>
      )}
    </button>
  );
};

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
      className={`${
        disabled || loading
          ? disabledStyle
          : 'text-brand-white cursor-pointer border-2 '
      } tracking-normal text-sm leading-4 ${
        action
          ? ''
          : 'border-button-secondary hover:bg-button-secondaryhover bg-button-secondary'
      } ${
        action ? 'w-40' : 'w-36'
      } transition-all duration-300 h-10 rounded-full ${
        action ? 'py-2' : 'py-2.5'
      } flex justify-center gap-x-2 items-center font-bold
      
      ${
        disabled || loading
          ? disabledStyle
          : action
          ? 'bg-transparent border-2 border-brand-white hover:bg-warning-error hover:border-warning-error hover:text-brand-white'
          : 'border-button-primary bg-button-primary hover:bg-button-primaryhover text-brand-white'
      }
      `}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      {action ? (
        <>
          {loading ? (
            <Icon name="loading" className="text-brand-white" />
          ) : (
            <>
              <Icon
                name="close"
                wrapperClassname="mb-0.5"
                className="font-bold"
              />
              {children}
            </>
          )}
        </>
      ) : (
        <>
          {loading ? (
            <Icon name="loading" className="text-brand-white" />
          ) : (
            children
          )}
        </>
      )}
    </button>
  );
};
