import React from 'react';

import { BridgeSteps } from '../../types/bridge';

import { useBridge } from './context';
import { SetAccount } from './pages/common';

export const Bridge = () => {
  const { currentStep } = useBridge();

  const RenderCurrentStep: React.FC = () => {
    switch (currentStep) {
      case BridgeSteps.FirstStep:
        return <SetAccount />;
      default:
        return <SetAccount />;
    }
  };

  return <RenderCurrentStep />;
};
