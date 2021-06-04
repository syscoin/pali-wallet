import React from "react";
import { useSelector } from "react-redux";

import "bootstrap/dist/css/bootstrap.min.css";
import "react-dropzone-uploader/dist/styles.css";

import FormMintSPT from "../components/Forms/FormMintSPT";

const MintSPT = () => {
  const controller = useSelector((state) => state.controller);

  async function handleIssueSPT(event, amount, receiver, assetGuid) {
    event.preventDefault();

    if (!controller) return;

    await controller.handleIssueSPT(amount, receiver, assetGuid);
  }

  return <FormMintSPT formCallback={handleIssueSPT} />;
};

export default MintSPT;
