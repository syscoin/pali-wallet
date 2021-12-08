import { Icon } from 'components/Icon';
import React, { FC } from 'react';

interface IPanelList {
  dataFAke: any;
  assets: boolean;
  activity: boolean;
}

export const PanelList: FC<IPanelList> = ({
  dataFAke,
  assets = false,
  activity = false,
}) => {

  return (
    <div>
      {activity && (
        <ul>
          <div className="bg-brand-navydarker text-sm text-center">
            17-09-21
          </div>
          {dataFAke.map((data) => {
            return (
              <li className="border-dashed border-b border-gray-200 py-2 border-opacity-10">
                <div className="flex text-xs">
                  <div className="grid grid-cols-5 gap-1">
                    <div className="col-span-3">
                      <p>{data.account}</p>
                      <p
                        className={
                          data.status == 'Pending'
                            ? 'text-yellow-300'
                            : data.status == 'Completed'
                            ? 'text-brand-greensettings'
                            : ''
                        }
                      >
                        {data.status}
                      </p>
                    </div>
                    <div>
                      <p className="text-blue-300">{data.hour}</p>
                      <p>{data.stp}</p>
                    </div>
                    <div className="leading-8 justify-self-end">
                      <button className="w-1" type="submit">
                        <Icon
                          name="select"
                          className="text-base"
                          maxWidth={'1'}
                        ></Icon>
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {assets && (
        <ul>
          {dataFAke.map((data) => {
            return (
              <li className="border-dashed border-b border-gray-200 border-opacity-10 py-2">
                <div className="flex text-xs">
                  <div className="grid grid-cols-9 gap-1 w-full">
                    <div className="col-span-3">
                      <p>{data.idk}</p>
                    </div>
                    <div className="col-span-2">
                      <p>{data.value}</p>
                    </div>
                    <div className="text-brand-blueWarningTest opacity-60 col-span-3 justify-self-center ">
                      <p>{data.idk2}</p>
                    </div>
                    <div className="justify-self-end mr-4">
                      <button className="w-1" type="submit">
                        <Icon
                          name="select"
                          className="text-base inline-flex self-center"
                          maxWidth={'1'}
                        ></Icon>
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
