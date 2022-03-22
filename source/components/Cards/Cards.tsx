import React from 'react';

import { Icon } from '..';

interface ISimpleCard {
  children: React.ReactNode;
  className?: string;
  onClick?: () => any;
}

interface ICopyCard extends ISimpleCard {
  label: string;
}

interface ICard extends ISimpleCard {
  type: 'success' | 'error' | 'info';
}

export const SimpleCard: React.FC<ISimpleCard> = ({
  children,
  className = 'cursor-default',
  onClick,
}) => (
  <div
    className={`${className} bg-bkg-4 border-dashed border-brand-royalblue border md:mx-20 mx-6 my-8 p-4 text-xs rounded-lg`}
    onClick={onClick}
  >
    {children}
  </div>
);

export const Card: React.FC<ICard> = ({
  children,
  className = '',
  onClick,
  type,
}) => {
  let iconName: string;

  switch (type) {
    case 'error':
      iconName = 'close';
      break;
    case 'info':
      iconName = 'warning';
      break;
    default:
    case 'success':
      iconName = 'check';
      break;
  }

  return (
    <div
      className={`${className} bg-bkg-3 border border-dashed border-warning-${type} p-4 text-xs rounded-lg gap-x-3 cursor-default flex items-center w-full md:max-w-md max-w-xs mx-auto`}
      onClick={onClick}
    >
      <Icon name={iconName} className={`text-warning-${type}`} size={25} />

      {children}
    </div>
  );
};

export const CopyCard: React.FC<ICopyCard> = ({
  children,
  className = '',
  label,
  onClick,
}) => (
  <div
    className={`${className} bg-bkg-4 border border-bkg-4 p-4 text-xs rounded-lg cursor-pointer w-full max-w-xs md:max-w-md`}
    onClick={onClick}
  >
    <div className="flex items-center justify-between w-full">
      <p>{label}</p>

      <Icon name="copy" className="text-brand-white" id="copy-btn" />
    </div>

    <p>{children}</p>
  </div>
);
