import { IMasterController } from 'scripts/Background/controllers';

export const handleFiatPrice = (masterController: IMasterController) => {
  const { utils } = masterController;

  setInterval(utils.setFiat, 3 * 60 * 1000);

  utils.setFiat();
};
