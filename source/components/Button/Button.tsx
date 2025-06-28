import React, { memo } from 'react';

import { LoadingSvg } from 'components/Icon/Icon';
import { Icon } from 'components/index';

// Memoize loading icons to prevent unnecessary re-renders
const LoadingIconPrimary = memo(() => (
  <LoadingSvg className="w-6 animate-spin" style={{ color: '#4d76b8' }} />
));
LoadingIconPrimary.displayName = 'LoadingIconPrimary';

const LoadingIconWhite = memo(() => (
  <LoadingSvg className="w-5 animate-spin" style={{ color: '#ffffff' }} />
));
LoadingIconWhite.displayName = 'LoadingIconWhite';

const LoadingIconDark = memo(() => (
  <LoadingSvg className="w-5 animate-spin" style={{ color: '#1f2937' }} />
));
LoadingIconDark.displayName = 'LoadingIconDark';

interface IPrimaryButton {
  action?: boolean;
  children?: React.ReactNode;
  disabled?: boolean;
  extraStyles?: string;
  fullWidth?: boolean;
  id?: string;
  loading?: boolean;
  onClick?: () => any;
  type: 'button' | 'submit' | 'reset' | undefined;
  width?: string;
}

interface IButton {
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  loading?: boolean;
  onClick?: () => any;
  type: 'button' | 'submit' | 'reset' | undefined;
  useDefaultWidth?: boolean;
  width?: string;
}

export const Button: React.FC<IButton> = ({
  children,
  className = '',
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type,
  useDefaultWidth = true,
  width = '36',
}) => (
  <button
    className={`${className} ${useDefaultWidth && `w-${width}`} ${
      disabled || loading
        ? 'opacity-60 cursor-not-allowed'
        : 'hover:scale-105 active:scale-95'
    } flex justify-center items-center transition-all duration-200`}
    disabled={disabled || loading}
    onClick={onClick}
    type={type}
    id={id}
  >
    {loading ? <LoadingIconPrimary /> : children}
  </button>
);

export const PrimaryButton: React.FC<IPrimaryButton> = ({
  action = false,
  children,
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type = 'submit',
  width = '36',
}) => {
  const checkIcon = (
    <Icon
      name="check-outlined"
      wrapperClassname="mb-0.5"
      className={disabled ? 'text-disabled' : 'text-brand-white'}
    />
  );

  return (
    <button
      className={`tracking-normal cursor-pointer border-2 text-sm leading-4 w-${width} transition-all duration-200 h-10 rounded-full flex justify-center items-center gap-x-2 font-bold 
        ${
          disabled || loading
            ? 'opacity-60 cursor-not-allowed'
            : 'opacity-100 hover:bg-button-primaryhover hover:scale-105 active:scale-95 hover:shadow-lg'
        } border-button-primary bg-button-primary text-brand-white`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {loading ? (
        <LoadingIconWhite />
      ) : (
        <>
          {action && checkIcon}
          {children}
        </>
      )}
    </button>
  );
};

export const SecondButton: React.FC<IPrimaryButton> = ({
  action = false,
  children,
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type = 'submit',
  width = '36',
}) => {
  const closeIcon = (
    <Icon
      name="close"
      wrapperClassname="mb-0.5"
      className="text-brand-white font-bold"
    />
  );

  return (
    <button
      className={`tracking-normal cursor-pointer border-2 text-sm leading-4 w-${width} transition-all duration-200 h-10 rounded-full flex justify-center items-center gap-x-2 font-bold 
        ${
          disabled || loading
            ? 'opacity-60 cursor-not-allowed'
            : 'opacity-100 hover:bg-button-primaryhover hover:scale-105 active:scale-95 hover:shadow-lg'
        } border-button-primary text-brand-white`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {loading ? (
        <LoadingIconWhite />
      ) : (
        <>
          {action && closeIcon}
          {children}
        </>
      )}
    </button>
  );
};

export const SecondaryButton: React.FC<IPrimaryButton> = ({
  action = false,
  children,
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type,
}) => {
  const closeIcon = (
    <Icon
      name="close"
      wrapperClassname="mb-0.5"
      className="text-brand-white font-bold"
    />
  );

  return (
    <button
      className={`
      flex justify-center rounded-full gap-x-2 items-center font-bold tracking-normal text-sm leading-4 w-36 h-10 text-brand-white
      ${
        disabled || loading
          ? 'opacity-60 cursor-not-allowed'
          : 'opacity-100 hover:bg-button-secondaryhover hover:scale-105 active:scale-95 hover:shadow-lg'
      } border-2 border-button-secondary transition-all duration-200 bg-button-secondary`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {loading ? (
        <LoadingIconWhite />
      ) : (
        <>
          {action && closeIcon}
          {children}
        </>
      )}
    </button>
  );
};

export const NeutralButton: React.FC<IPrimaryButton> = ({
  children,
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type = 'button',
  fullWidth = false,
  extraStyles,
}) => (
  <button
    className={`
      flex justify-center rounded-full gap-x-2 items-center font-bold tracking-normal leading-4 ${
        fullWidth ? 'w-full' : 'w-36'
      } h-10
      ${
        disabled || loading
          ? 'opacity-60 cursor-not-allowed'
          : 'opacity-100 hover:opacity-90 hover:scale-105 active:scale-95 hover:shadow-md'
      } border-2 border-button-neutral transition-all duration-200 bg-button-neutral ${
      extraStyles ? extraStyles : 'text-sm text-brand-royalblue'
    }`}
    disabled={disabled || loading}
    onClick={onClick}
    type={type}
    id={id}
  >
    {loading ? <LoadingIconPrimary /> : <>{children}</>}
  </button>
);
