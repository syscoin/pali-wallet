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
        <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
          <div className="col-span-2">
            <p className="text-sm">Precision</p>
          </div>
          <div className="text-sm justify-self-end col-span-2">
            <p>8</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
          <div className="col-span-2">
            <p className="text-sm">Symbol</p>
          </div>
          <div className="text-sm justify-self-end col-span-2">
            <p>asd</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
          <div className="col-span-2">
            <p className="text-sm">Max supply</p>
          </div>
          <div className="text-sm justify-self-end col-span-2">
            <p>23.485.929</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
          <div className="col-span-2">
            <p className="text-sm">Description</p>
          </div>
          <div className="text-sm justify-self-end col-span-2">
            <p>Lorem Ipsum</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
          <div className="col-span-2">
            <p className="text-sm">Receiver</p>
          </div>
          <div className="text-sm justify-self-end col-span-2">
            <p>3909djh3939jd9h...883</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
          <div className="col-span-2">
            <p className="text-sm">Initial supply</p>
          </div>
          <div className="text-sm justify-self-end col-span-2">
            <p>10.921.351</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
          <div className="col-span-2">
            <p className="text-sm">Fee</p>
          </div>
          <div className="text-sm justify-self-end col-span-2">
            <p>0.00001</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
          <div className="col-span-2">
            <p className="text-sm">Site</p>
          </div>
          <div className="text-sm justify-self-end col-span-2">
            <p>sysmint.paliwallet.com</p>
          </div>
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
            <div className="text-brand-white text-sm bg-brand-navydark px-4 py-2">
              <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
                <div className="col-span-2">
                  <p className="text-sm">Capability flags</p>
                </div>
                <div className="text-sm justify-self-end col-span-2">
                  <p> 127</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
                <div className="col-span-2">
                  <p className="text-sm"> Lorem ipsums</p>
                </div>
                <div className="text-sm justify-self-end col-span-2">
                  <p> Yes</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1 border-dashed border-b border-gray border-opacity-10 text-white pt-2 pb-1">
                <div className="col-span-2">
                  <p className="text-sm"> Dolor asi</p>
                </div>
                <div className="text-sm justify-self-end col-span-2">
                  <p> No</p>
                </div>
              </div>
            </div>
          ) : (
            <div></div>
          )}
        </div>
      </div>
      <div className="flex justify-center items-center flex-col gap-4 text-center pt-4">
        <div className="inline-flex">
          <button
            className="text-white mr-14 inline-flex tracking-normal text-base leading-4 py-2.5 px-8 cursor-pointer font-light border border-brand-royalBlue transition-all duration-300 tracking-normal text-base rounded-full hover:bg-brand-royalBlue hove:text-white"
            type="button"
          >
            <Icon
              name="close"
              className="inline-flex self-center text-base"
              maxWidth={'1'}
            />
            Cancel
          </button>
          <button
            className="text-white inline-flex tracking-normal text-base leading-4 py-2.5 px-8 cursor-pointer font-light border border-brand-deepPink transition-all duration-300 tracking-normal text-base rounded-full hover:bg-brand-deepPink hover:text-white"
            type="submit"
          >
            <Icon
              name="delete"
              className="inline-flex self-center text-base"
              maxWidth={'1'}
            />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};
export default ConfirmTokenCreate;
