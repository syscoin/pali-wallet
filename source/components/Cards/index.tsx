import React, { FC } from 'react';
import { Icon } from 'components/index';

export type ICard = {
  children: any;
  className?: string;
  onClick?: any;
};

export type CopyCarType = {
  children: any;
  className?: string;
  label: string;
  onClick?: any;
};

export const Card: FC<ICard> = ({
  onClick,
  children,
  className = 'cursor-default',
}) => (
  <div
    className={`${className} bg-bkg-4 border-dashed border-brand-royalblue border mx-6 my-8 p-4 text-xs rounded-lg`}
    onClick={() => (onClick ? onClick() : undefined)}
  >
    {children}
  </div>
);

export const SuccessCard: FC<ICard> = ({
  onClick,
  children,
  className = '',
}) => (
  <div
    className={`${className} bg-bkg-3 border border-dashed border-warning-success p-4 text-xs rounded-lg gap-x-3 cursor-default flex items-center w-full max-w-xs`}
    onClick={() => (onClick ? onClick() : undefined)}
  >
    <Icon name="check" className="text-warning-success" size={25} />

    {children}
  </div>
);

export const ErrorCard: FC<ICard> = ({ onClick, children, className = '' }) => (
  <div
    className={`${className} bg-bkg-3 border border-dashed border-warning-error p-4 text-xs rounded-lg gap-x-3 cursor-default flex items-center w-full max-w-xs`}
    onClick={() => (onClick ? onClick() : undefined)}
  >
    <Icon name="close" className="text-warning-error" size={25} />

    {children}
  </div>
);

export const InfoCard: FC<ICard> = ({ onClick, children, className = '' }) => (
  <div
    className={`${className} bg-bkg-3 border border-dashed border-warning-info p-4 text-xs rounded-lg gap-x-3 cursor-default flex items-center w-full max-w-xs`}
    onClick={() => (onClick ? onClick() : undefined)}
  >
    <Icon name="warning" className="text-warning-info" size={25} />

    {children}
  </div>
);

export const CopyCard: FC<CopyCarType> = ({
  onClick,
  children,
  label,
  className = '',
}) => (
  <div
    className={`${className} bg-bkg-4 border border-bkg-4 p-4 text-xs rounded-lg cursor-pointer w-full max-w-xs`}
    onClick={() => (onClick ? onClick() : undefined)}
  >
    <div className="flex items-center justify-between w-full">
      <p>{label}</p>

      <Icon name="copy" className="text-brand-white" />
    </div>

    <p>{children}</p>
  </div>
);
