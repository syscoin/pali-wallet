import { Button } from 'antd';
import { Icon } from 'components/Icon';
import React, { FC } from 'react';
import { Header } from '../Header';


interface IAuthViewLayout {
  title: string;
  children: any
}

export const AuthViewLayout: FC<IAuthViewLayout> = ({
  title,
  children
}) => {
  return (
    <>
      <Header normalHeader />
      <div className="w-full flex justify-center items-center text-brand-white bg-brand-navyborder py-4 px-4">
        <p className="text-xl max-w-sm">{title}</p>
        <Button ><Icon name="close" className="inline-flex self-center text-base" /></Button>
      </div>
      <div className="flex justify-center items-center text-brand-gray pt-6">
        <p className="pl-6 text-base">{children}</p>
      </div>
    </>
  );
};
