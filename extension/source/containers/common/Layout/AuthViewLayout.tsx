import { Button } from 'antd';
import { Icon } from 'components/Icon';
import React, { FC } from 'react';
import { Header } from '../Header';

interface IAuthViewLayout {
  title: string;
  children: any;
}

export const AuthViewLayout: FC<IAuthViewLayout> = ({ title, children }) => {
  return (
    <>
      <Header normalHeader />
      <div className="overflow-hidden inline-block w-full flex justify-center items-center text-brand-white bg-brand-navyborder py-4 px-4">
        <div className="grid grid-cols-8 gap-4">
          <div className="col-span-7 justify-self-center ml-7">
            <p className="text-xl max-w-sm whitespace-nowrap">{title}</p>
          </div>
          <div className="justify-self-end">
            <Button>
              <Icon
                name="close"
                className="inline-flex self-center text-base"
              />
            </Button>
          </div>
        </div>
      </div>
      <div className="flex justify-center items-center text-brand-gray pt-6">
        <p className="pl-6 text-base">{children}</p>
      </div>
    </>
  );
};
