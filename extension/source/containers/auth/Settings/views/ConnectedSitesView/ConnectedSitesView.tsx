import { Button } from 'components/Button';
import { Icon } from 'components/Icon';
import { AuthViewLayout } from 'containers/common/Layout';
import React, { FC, useState } from 'react';
import LogoImage from 'assets/images/logo-s.svg';
import { Checkbox } from 'antd';

interface IConnectedSites {}
const ConnectedSites: FC<IConnectedSites> = ({}) => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const onChange = (e) => {
    console.log(`checked = ${e.target.checked}`);
  };
  return (
    <div>
      <AuthViewLayout title="CONNECTED SITES"> </AuthViewLayout>
      <div className="flex flex-col gap-1 pt-4 p-4 text-white">
        <div>
          <p className="text-sm">
            Account1 is connected to these site. They can view your account
            address.
          </p>
        </div>
        <div className="grid grid-cols-6 gap-1 inline-flex pt-2 border-dashed border-b border-gray-100 border-opacity-10">
          <div className="col-span-5">
            <p className="text-sm">app.uniswap.org</p>
          </div>
          <div className="justify-self-end mr-3">
            <button
              onClick={() => setShowModal(!showModal)}
              className="w-1"
              type="submit"
            >
              <Icon
                name="select"
                className="text-base inline-flex self-center pb-1"
                maxWidth={'1'}
              ></Icon>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-6 gap-1 inline-flex pt-2 border-dashed border-b border-gray-100 border-opacity-10">
          <div className="col-span-5">
            <p className="text-sm">pancakeswap.finance</p>
          </div>
          <div className="justify-self-end mr-3">
            <button
              onClick={() => setShowModal(!showModal)}
              className="w-1"
              type="submit"
            >
              <Icon
                name="select"
                className="text-base inline-flex self-center pb-1"
                maxWidth={'1'}
              ></Icon>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-6 gap-1 inline-flex pt-2 border-dashed border-b border-gray-100 border-opacity-10">
          <div className="col-span-5">
            <p className="text-sm">app.sushi.com/swap</p>
          </div>
          <div className="justify-self-end mr-3">
            <button
              onClick={() => setShowModal(!showModal)}
              className="w-1"
              type="submit"
            >
              <Icon
                name="select"
                className="text-base inline-flex self-center pb-1"
                maxWidth={'1'}
              ></Icon>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-6 gap-1 inline-flex pt-2 border-dashed border-b border-gray-100 border-opacity-10">
          <div className="col-span-5">
            <p className="text-sm">traderjoexyz.com</p>
          </div>
          <div className="justify-self-end mr-3">
            <button
              onClick={() => setShowModal(!showModal)}
              className="w-1"
              type="submit"
            >
              <Icon
                name="select"
                className="text-base inline-flex self-center pb-1"
                maxWidth={'1'}
              ></Icon>
            </button>
          </div>
        </div>
        <div className="flex justify-center items-center pt-40">
          <Button type="submit">Close</Button>
        </div>
      </div>
      {showModal ? (
        <>
          <div className="fixed inset-0 bg-gray-900 bg-opacity-50 overflow-y-auto h-full w-full">
            <div className="absolute text-white flex-col gap-1 p-4 justify-center bg-brand-darkRoyalBlue rounded-lg w-80 ml-6 mt-24">
              <div className="border-dashed border-b border-light-blue-500 text-center p-4">
                <p>EDIT CONNECTED SITE</p>
              </div>
              <div>
                <div>
                  <p className="text-base">Delete connected site:</p>
                  <p className="text-sm text-brand-royalBlue mt-4">
                    Account123
                  </p>
                </div>
                <div className="inline-flex">
                  <div className="grid grid-cols-4 gap-1">
                    <div className="col-span-3">
                      <p className="text-base">app.uniswap.org</p>{' '}
                    </div>
                    <div className="justify-self-end">
                      <Icon name="delete" className="text-base" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-brand-navydarker p-2">
                <p className="text-base">Edit permissions:</p>
                <div className="flex items-center pr-12 mr-1 text-brand-white border-b border-light-blue-500">
                  <div>
                    <img
                      src={`/${LogoImage}`}
                      className="mx-auto w-10 rounded-full"
                      alt="Syscoin"
                    />
                  </div>
                  <div className="text-brand-white pl-1 justify-center items-center pr-1">
                    <p className="text-xs">Account123</p>
                    <p className="text-xs">0x3126...7d3864c983 </p>
                  </div>
                </div>
                <div>
                  <Checkbox onChange={onChange} className="text-sm">
                    View the addresses of your permitted accounts
                  </Checkbox>
                </div>
              </div>
              <div className="mt-2 flex justify-center items-center flex-col p-2">
                <Button type="submit">Save</Button>
              </div>
            </div>
          </div>
        </>
      ) : (
        ''
      )}
    </div>
  );
};
export default ConnectedSites;
