import React from 'react';

interface ISteperProps {
  currentStep: number;
}

export const Steper: React.FC<ISteperProps> = ({ currentStep }) => (
  <div className="flex gap-1 w-full">
    {[...Array(5)].map((_, index) => (
      <div
        key={index}
        className={`w-1/2 h-[2px] ${
          index <= currentStep ? 'bg-red-600' : 'bg-white'
        }`}
      ></div>
    ))}
  </div>
);
