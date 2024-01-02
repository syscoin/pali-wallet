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
  let borderColor: string;

  switch (type) {
    case 'error':
      iconName = 'close';
      break;
    case 'info':
      iconName = 'warning';
      borderColor = 'border-brand-yellowInfo';
      break;
    default:
    case 'success':
      iconName = 'check';
      break;
  }

  return (
    <div
      className={`${className} bg-transparent border border-dashed ${borderColor} p-4 text-xs rounded-[20px] gap-x-[19px] cursor-default flex items-start w-full `}
      onClick={onClick}
    >
      <Icon name={iconName} className={`text-warning-${type}`} size={24} />
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

    <div>{children}</div>
  </div>
);
