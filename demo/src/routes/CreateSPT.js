import React, { Component, useEffect, useState, useCallback } from "react";

import FormCreateToken from "../components/FormCreateToken";

import "bootstrap/dist/css/bootstrap.min.css";
import "react-dropzone-uploader/dist/styles.css";

const CreateSPT = () => {
  const handleCreateToken = async (
    event,
    precision,
    maxSupply,
    description,
    symbol,
    receiver,
    rbf
  ) => {
    event.preventDefault();

    await await window.ConnectionsController.handleCreateToken(
      Number(precision),
      symbol,
      Number(maxSupply),
      // Number(fee),
      description,
      receiver,
      rbf
    );
  };

  return (
    <div className="form">
      <FormCreateToken formCallback={handleCreateToken} token="SPT" />
    </div>
  );
};
export default CreateSPT;
