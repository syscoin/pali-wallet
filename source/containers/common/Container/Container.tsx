import React, { FC, ReactNode } from 'react';

interface IContainer {
  children?: ReactNode;
}

const Container: FC<IContainer> = ({ children }) => (
  <div className="font-poppins w-full min-w-popup min-h-popup mx-auto md:max-w-2xl h-full text-xl p-0 m-0">
    {children}
  </div>
);

export default Container;
