import React, { FC } from 'react';
import Header from 'containers/common/Header';

interface IAuthViewLayout {
  title: string;
  children: any;
}

export const AuthViewLayout: FC<IAuthViewLayout> = ({
  title,
  children
}) => {
  return (
    <div>
      <Header normalHeader />

      <div className="flex justify-center items-center bg-brand-gold py-4 px-2">
        {title}
      </div>

      {children}
    </div>
  );
};
