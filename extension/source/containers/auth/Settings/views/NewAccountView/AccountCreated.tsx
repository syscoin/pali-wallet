import { AuthViewLayout } from 'containers/common/Layout';
import React, { FC } from 'react';
import { AddresCard } from 'components/Cards';
import { Button } from 'components/Button';
interface IAccountCreated {}
export const AccountCreated: FC<IAccountCreated> = ({}) => {
  return (
    <>
      <AuthViewLayout title="CREATE ACCOUNT"> </AuthViewLayout>
      <div className="flex flex-col min-w-full">
        <div className="pb-1 px-6">
          <p className="text-white text-base text-left">
            Your new account has been created!
          </p>
        </div>
        <AddresCard
          title="Address:"
          account="0x3126...jdi84r4js0i937d3864c983"
        />
      </div>
      <div className="pt-64 flex justify-center items-center">
        <Button type="submit">Finish</Button>
      </div>
    </>
  );
};
