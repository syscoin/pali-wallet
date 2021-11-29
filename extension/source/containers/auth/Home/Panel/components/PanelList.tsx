import { Icon } from 'components/Icon';
import React, { FC, useEffect, useState } from 'react';

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
  const [status, setStatus] = useState<string>('');

  return (
    <div>
      {activity && (
        <ul>
          <div className="bg-brand-navydarker text-sm text-center">
            17-09-21
          </div>
          {dataFAke.map((data) => {
            return (
              <li className="border-dashed border-b border-gray-200 py-2">
                <div className="flex text-xs">
                  <div>
                    <p>{data.account}</p>
                    <p className="text-yellow-300">{data.status}</p>
                  </div>
                  <div className="pl-16">
                    <p className="text-blue-300">{data.hour}</p>
                    <p>{data.stp}</p>
                  </div>
                  <div className="pl-20 leading-8">
                    <button className="w-1" type="submit">
                      <Icon
                        name="select"
                        className="text-base"
                        maxWidth={'1'}
                      ></Icon>
                    </button>
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
              <li className="border-dashed border-b border-gray-200 py-2">
                <div className="flex text-xs">
                  <div>
                    <p>{data.idk}</p>
                  </div>
                  <div className="pl-8">
                    <p>{data.value}</p>
                  </div>
                  <div className="pl-8 text-blue-300">
                    <p>{data.idk2}</p>
                  </div>
                  <div className="pl-20">
                    <button className="w-1" type="submit">
                      <Icon
                        name="select"
                        className="text-base inline-flex self-center"
                        maxWidth={'1'}
                      ></Icon>
                    </button>
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
