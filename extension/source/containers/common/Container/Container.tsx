import React, { FC, ReactNode } from 'react';

interface IContainer {
  children?: ReactNode;
}

const Container: FC<IContainer> = ({ children }) => {
  return (
    <div className="font-poppins w-full min-w-popup max-w-popup h-popup text-xl p-0 m-0">
      {children}
    </div>
  );
};

export default Container;
