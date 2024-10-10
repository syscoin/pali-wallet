import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

interface ISteperProps {
  currentStep: number;
}

export const Steper: React.FC<ISteperProps> = ({ currentStep }) => {
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);
  const bg = isBitcoinBased ? 'bg-brand-pink200' : 'bg-brand-blue400';

  return (
    <div className="flex gap-1 w-full">
      {[...Array(5)].map((_, index) => (
        <div
          key={index}
          className={`w-1/2 h-[3px] ${index <= currentStep ? bg : 'bg-white'}`}
        ></div>
      ))}
    </div>
  );
};
