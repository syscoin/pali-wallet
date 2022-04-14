import React, { FC } from 'react';
import { Progress } from 'antd';
import { Layout, SecondaryButton } from 'components/index';
import low from 'assets/images/low.png';
import high from 'assets/images/high.png';

export const EditGasFee: FC = () => (
  <Layout title="EDIT GAS FEE">
    <div className="flex flex-col items-center justify-center p-4 w-full md:max-w-md">
      <div className="flex gap-2 items-center justify-between w-full">
        <div className="flex items-center justify-between p-4 w-full h-16 text-xs border border-dashed border-dashed-dark rounded-lg cursor-pointer">
          <img src={low} alt="low fee" />

          <div className="flex flex-col gap-0.5 items-center">
            <div>
              <p className="text-brand-white text-sm">
                <span className="mr-1">Low</span>
                <small className="text-brand-royalblue">2 - 3 min</small>
              </p>

              <p>
                3.08 USD <span>?</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 w-full h-16 text-xs border border-dashed border-dashed-dark rounded-lg cursor-pointer">
          <img src={high} alt="high fee" />

          <div className="flex flex-col gap-0.5 items-center">
            <div>
              <p className="text-brand-white text-sm">
                <span className="mr-1">High</span>
                <small className="text-brand-royalblue">2 - 3 min</small>
              </p>

              <p>
                3.08 USD <span>?</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="mb-1 mt-24 text-center text-brand-white text-base font-bold">
        Network status
      </p>

      <div className="flex items-center justify-center w-full text-center text-brand-white text-sm font-bold">
        <div className="flex flex-1 flex-col items-center justify-center p-3 h-16 text-brand-graylight bg-bkg-3">
          <p>49 GWEI</p>
          <small>Base fee</small>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-3 h-16 text-brand-graylight bg-bkg-3">
          <p>49 GWEI</p>
          <small>Priority fee</small>
        </div>
        <div className="flex flex-1 flex-col gap-1 items-center justify-center p-3 h-16 text-brand-graylight bg-bkg-3">
          <Progress
            percent={30}
            showInfo={false}
            strokeColor={{
              '0%': '#FF3E91',
              '100%': '#4CA1CF',
            }}
          />

          <small>Stable</small>
        </div>
      </div>

      <div className="absolute bottom-12 md:static md:mt-6">
        <SecondaryButton type="button">Done</SecondaryButton>
      </div>
    </div>
  </Layout>
);
