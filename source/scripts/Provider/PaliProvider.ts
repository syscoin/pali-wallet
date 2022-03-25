import { getController } from 'utils/browser';

export const PaliProvider = () => {
  const getNetwork = () => {};

  const getAccounts = () => ({ accounts: 456 });

  const getChainId = () => {};

  const getAddress = () => {};

  const getBalance = () => {};

  const getXpub = () => {};

  const getTokens = () => {};

  const getState = () => {};

  const sendToken = async (items: any) => {
    const controller = getController();

    const handleSendToken = await controller?.connections?.handleSendToken(
      items
    );

    return handleSendToken;
  };

  const createToken = async (items: any) => {
    const controller = getController();

    const handleCreateToken = await controller?.connections?.handleCreateToken(
      items
    );

    return handleCreateToken;
  };

  const transferToken = async (items: any) => {
    const controller = getController();

    const handleTransferToken =
      await controller?.connections?.handleTransferOwnership(items);

    return handleTransferToken;
  };

  const signPSBT = async (psbtToSign: any) => {
    const controller = getController();

    const handleSignPSBT = await controller?.connections?.signPSBT(psbtToSign);

    return handleSignPSBT;
  };

  const getSignedPSBT = async (psbtToSign: any) => {
    const controller = getController();

    return {
      isSigned: Boolean(await controller?.connections?.signPSBT(psbtToSign)),
    };
  };

  return {
    getAccounts,
    getNetwork,
    getChainId,
    getAddress,
    getBalance,
    getXpub,
    getTokens,
    getState,
    sendToken,
    createToken,
    transferToken,
    signPSBT,
    getSignedPSBT,
  };
};
