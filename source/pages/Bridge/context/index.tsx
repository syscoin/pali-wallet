/* eslint-disable no-shadow */
import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import {
  BridgeFlow,
  BridgeSteps,
  IBridgeContextProps,
} from '../../../types/bridge';
import { RootState } from 'state/store';

const BridgeContext = createContext<IBridgeContextProps | undefined>(undefined);

export const BridgeProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);
  const [currentStep, setCurrentStep] = useState<BridgeSteps>(
    BridgeSteps.FirstStep
  );
  const [isBridgePage, setIsBridgePage] = useState(false);
  const [bridgeFlow, setBridgeFlow] = useState<BridgeFlow>(
    BridgeFlow.UTXOtoEVM
  );
  const { pathname } = useLocation();

  const handleStepChange = (type: 'previous' | 'next') => {
    setCurrentStep((prevStep) => {
      const newStep = prevStep + (type === 'next' ? 1 : -1);

      if (newStep < BridgeSteps.FirstStep || newStep > BridgeSteps.FifthStep) {
        return prevStep;
      }

      return newStep;
    });
  };

  useEffect(() => {
    setIsBridgePage(pathname.includes('bridge'));
  }, [pathname]);

  useEffect(() => {
    if (isBitcoinBased) {
      setBridgeFlow(BridgeFlow.UTXOtoEVM);
      return;
    }

    setBridgeFlow(BridgeFlow.EVMtoUTXO);
  }, [isBitcoinBased]);

  return (
    <BridgeContext.Provider
      value={{
        currentStep,
        setCurrentStep,
        isBridgePage,
        handleStepChange,
        bridgeFlow,
      }}
    >
      {children}
    </BridgeContext.Provider>
  );
};

export const useBridge = (): IBridgeContextProps => {
  const context = useContext(BridgeContext);
  if (!context) {
    throw new Error('useBridgeContext must be used within a BridgeProvider');
  }
  return context;
};
