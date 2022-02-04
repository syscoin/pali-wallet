import React, { FC } from 'react';

import { Icon } from '..';

type IPrimaryButton = {
  action?: boolean;
  children: any | null;
  disabled?: boolean;
  id?: string;
  loading?: boolean;
  onClick?: any;
  type: 'button' | 'submit' | 'reset' | undefined;
  width?: string;
};

type ICommonButton = {
  children: any | null;
  className?: string;
  disabled?: boolean;
  id?: string;
  loading?: boolean;
  onClick?: any;
  type: 'button' | 'submit' | 'reset' | undefined;
  useDefaultWidth?: boolean;
  width?: string;
};

export const Button = ({
  children = null,
  disabled = false,
  loading = false,
  type,
  onClick,
  className = '',
  width = '36',
  id = '',
  useDefaultWidth = true,
}: ICommonButton): any => (
  <button
    className={`${className} ${useDefaultWidth && `w-${width}`}`}
    disabled={disabled || loading}
    onClick={onClick}
    type={type}
    id={id}
  >
    {children}
  </button>
);

const disabledStyle =
  'text-button-disabled cursor-not-allowed font-light border-2 border-button-disabled';

export const PrimaryButton: FC<IPrimaryButton> = ({
  children,
  disabled = false,
  loading = false,
  type = 'submit',
  onClick,
  width = '36',
  action = false,
  id = '',
}) => {
  const enabledStyle = action
    ? 'border-warning-success bg-warning-success hover:bg-warning-successhover text-brand-white w-40'
    : `border-button-primary bg-button-primary hover:bg-button-primaryhover text-brand-white w-${width}`;

  return (
    <button
      className={`tracking-normal cursor-pointer border-2 text-sm leading-4 w-${width} transition-all duration-300 h-10 rounded-full flex justify-center items-center gap-x-2 font-bold 
        ${disabled || loading ? disabledStyle : enabledStyle}`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
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
                className={
                  disabled ? 'text-button-disabled' : 'text-brand-white'
                }
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
  id = '',
}) => {
  const actionStyle = action
    ? 'bg-transparent border-2 border-brand-white hover:bg-warning-error hover:border-warning-error hover:text-brand-white w-40'
    : 'border-button-secondary hover:bg-button-secondaryhover bg-button-secondary text-brand-white w-36 py-2.5';

  return (
    <button
      className={`
      flex justify-center rounded-full gap-x-2 items-center font-bold tracking-normal text-sm leading-4 w-36 h-10
      ${disabled || loading ? disabledStyle : actionStyle}`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
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
