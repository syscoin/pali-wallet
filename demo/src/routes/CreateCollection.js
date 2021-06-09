import React from "react";
import { useSelector } from "react-redux";

import "bootstrap/dist/css/bootstrap.min.css";
import "react-dropzone-uploader/dist/styles.css";

import FormCollection from "../components/FormCollection";

const CreateCollection = () => {
  const controller = useSelector((state) => state.controller);

  const handleCreateCollection = async (event, state) => {
    event.preventDefault();

    await controller.handleCreateCollection(state);
  };

  return (
    <div className="form">
      <FormCollection formCallback={handleCreateCollection} />
    </div>
  );
};

export default CreateCollection;
