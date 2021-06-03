import React, { Component, useEffect, useState, useCallback } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "react-dropzone-uploader/dist/styles.css";
import FormCreateToken from "../../components/FormCreateToken";

const CreateNFT = () => {
  const handleCreateNFT = async (
    event,
    { precision, maxSupply, description, symbol, fee, sysAddress, rbf }
  ) => {
    event.preventDefault();

    console.log(await window.ConnectionsController.getWalletState());

    // await controller.handleCreateNFT(precision, maxSupply, description, symbol, fee, sysAddress, rbf);

    console.log(
      "handle create nft",
      precision,
      maxSupply,
      description,
      symbol,
      fee,
      sysAddress,
      rbf
    );
  };

  return (
    <div className="form">
      <FormCreateToken formCallback={handleCreateNFT} token="NFT" />
    </div>
  );
};
export default CreateNFT;
