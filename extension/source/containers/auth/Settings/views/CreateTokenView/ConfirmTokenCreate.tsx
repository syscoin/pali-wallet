import { Button } from 'components/Button';
import { Icon } from 'components/Icon';
import { AuthViewLayout } from 'containers/common/Layout';
import React, { FC, useState } from 'react';
interface IConfirmTokenCreate {}
const ConfirmTokenCreate: FC<IConfirmTokenCreate> = ({}) => {
  const [selected, setSelected] = useState<boolean>(false);
  return (
    <div>
      <AuthViewLayout title="CONFIRM TOKEN CREATION"> </AuthViewLayout>
      <div className="flex flex-col gap-1 pt-4 px-5">
        <div>
          <p className="text-sm border-dashed border-b border-gray text-white pt-2">
            Precision 8
          </p>
          <p className="text-sm border-dashed border-b border-gray text-white pt-2">
            Symbol asd
          </p>
          <p className="text-sm border-dashed border-b border-gray text-white pt-2">
            Max supply 23.485.929
          </p>
          <p className="text-sm border-dashed border-b border-gray text-white pt-2">
            Description Lorem Ipsum
          </p>
          <p className="text-sm border-dashed border-b border-gray text-white pt-2">
            Receiver 3909djh3939jd9h...883
          </p>
          <p className="text-sm border-dashed border-b border-gray text-white pt-2">
            Initial supply 10.921.351
          </p>
          <p className="text-sm border-dashed border-b border-gray text-white pt-2">
            Fee 0.00001
          </p>
          <p className="text-sm border-dashed border-b border-gray text-white pt-2">
            Site sysmint.paliwallet.com
          </p>
        </div>
        <div className="pt-7">
          <button
            className="inline-flex text-sm text-brand-white w-full text-justify bg-brand-navydarker px-4 py-2"
            onClick={() => setSelected(!selected)}
          >
            Advanced Options
            {selected ? (
              <Icon
                name="up"
                className="inline-flex self-center text-sm pl-40"
                maxWidth={'1'}
              ></Icon>
            ) : (
              <Icon
                name="down"
                className="inline-flex self-center text-sm pl-40"
                maxWidth={'1'}
              ></Icon>
            )}
          </button>
          {selected ? (
            <div className="text-brand-white text-sm bg-brand-navylight px-4 py-2">
              <p className="text-sm border-dashed border-b border-gray text-white pt-2">
                Capability flags 127
              </p>
              <p className="text-sm border-dashed border-b border-gray text-white pt-2">
                Lorem ipsums Yes
              </p>
              <p className="text-sm border-dashed border-b border-gray text-white pt-2">
                Dolor asi met No
              </p>
            </div>
          ) : (
            <div></div>
          )}
        </div>
      </div>

      <div className="flex gap-1 text-center pt-4 px-5">
        <Button className="inline-flex" type="submit">
          Reject
        </Button>
        <Button className="inline-flex" type="submit">
          Next
        </Button>
      </div>
    </div>
  );
};
export default ConfirmTokenCreate;
