import React, { FC, ReactNode } from 'react';

interface IContainer {
  children?: ReactNode;
}

export const Container: FC<IContainer> = ({ children }) => (
  <div className="m-0 mx-auto p-0 w-full min-w-popup min-h-popup font-poppins text-xl md:max-w-2xl">
    {children}
  </div>
);
