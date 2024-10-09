export enum BridgeSteps {
  FirstStep = 0,
  SecondStep = 1,
  ThirdStep = 2,
  FourthStep = 3,
  FifthStep = 4,
}

export enum BridgeFlow {
  EVMtoUTXO = 'EVM <-> UTXO',
  UTXOtoEVM = 'UTXO <-> EVM',
}

export interface IBridgeContextProps {
  bridgeFlow: BridgeFlow;
  currentStep: BridgeSteps;
  handleStepChange: (type: 'previous' | 'next') => void;
  isBridgePage: boolean;
  setCurrentStep: (step: BridgeSteps) => void;
}
