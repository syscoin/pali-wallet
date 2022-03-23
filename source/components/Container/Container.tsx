import React, { FC, ReactNode } from 'react';

interface IContainer {
  children?: ReactNode;
}

export const Container: FC<IContainer> = ({ children }) => (
  <div className="min-w-popup min-h-popup font-poppins text-xl">{children}</div>
);
