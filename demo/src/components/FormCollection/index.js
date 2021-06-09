import React, { useState } from "react";
import { setFormState } from "../../helpers";

const FormCollection = (props) => {
  const [state, setState] = useState({
    collectionName: "",
    description: "",
    sysAddress: "",
    symbol: "",
    property1: "",
    property2: "",
    property3: "",
    attribute1: "",
    attribute2: "",
    attribute3: "",
  });

  const { collectionName, description, sysAddress } = state;

  return (
    <form onSubmit={(event) => props.formCallback(event, state)}>
      <div className="property">
        <h2>YOU ARE CREATING COLLECTION</h2>

        <div>
          <label htmlFor="collectionName">Collection name (asset guid):</label>
          <input
            className="input"
            type="text"
            id="collectionName"
            name="collectionName"
            onBlur={(event) =>
              setFormState(event, state, "collectionName", setState)
            }
          />

          <label htmlFor="description">Description:</label>
          <input
            className="input"
            type="text"
            id="description"
            name="description"
            onBlur={(event) =>
              setFormState(event, state, "description", setState)
            }
          />

          <label htmlFor="address">Sys address:</label>
          <input
            className="input"
            type="text"
            id="address"
            name="address"
            onBlur={(event) =>
              setFormState(event, state, "sysAddress", setState)
            }
          />

          <label htmlFor="symbol">UPLOAD SYMBOL</label>
          <input
            type="file"
            name="symbol"
            id="symbol"
            onBlur={(event) => setFormState(event, state, "symbol", setState)}
          />
        </div>
      </div>

      <div className="property">
        <input
          type="text"
          placeholder="Property 1"
          onBlur={(event) => setFormState(event, state, "property1", setState)}
        />

        <input
          type="text"
          placeholder="Property 2"
          onBlur={(event) => setFormState(event, state, "property2", setState)}
        />

        <input
          type="text"
          placeholder="Property 3"
          onBlur={(event) => setFormState(event, state, "property3", setState)}
        />

        <input
          type="text"
          placeholder="Atributte 1"
          onBlur={(event) => setFormState(event, state, "attribute1", setState)}
        />

        <input
          type="text"
          placeholder="Atributte 2"
          onBlur={(event) => setFormState(event, state, "attribute2", setState)}
        />

        <input
          type="text"
          placeholder="Atributte 3"
          onBlur={(event) => setFormState(event, state, "attribute3", setState)}
        />

        <button
          className="button"
          type="submit"
          disabled={!collectionName || !description || !sysAddress}
        >
          Create
        </button>
      </div>
    </form>
  );
};

export default FormCollection;
