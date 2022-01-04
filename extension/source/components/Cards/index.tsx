import React, { FC } from 'react';

export type ICard = {
  onClick?: any,
  children: any,
  background?: string,
  border?: string,
  cursor?: string,
}

export const Card: FC<ICard> = ({
  onClick,
  children,
  background = 'bg-bkg-4',
  border = 'border-brand-royalblue',
  cursor = 'cursor-default',
}) => {
  return (
    <div
      className={`${background} border border-dashed ${border} mx-6 my-8 p-4 text-xs rounded-lg ${cursor}`}
      onClick={() => onClick ? onClick() : undefined}
    >
      {children}
    </div>
  )
}
