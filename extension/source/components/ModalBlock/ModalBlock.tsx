import React, { FC } from "react";
import styles from './ModalBlock.scss';

interface IModalBlock {
  title: any,
  message?: any,
  callback?: any,
  setCallback?: any
}

const ModalBlock: FC<IModalBlock> = ({
  title,
  message,
  callback,
  setCallback
}) => {
  return (
    <div className={styles.modal}>
      <div className={styles.title}>
        <small>{title}</small>
        <p onClick={() => setCallback()}>X</p>
      </div>

      <p>{message}</p>

      <div className={styles.close}>
        <button
          onClick={() => callback()}
        >
          Go
        </button>
      </div>

    </div>
  );
};

export default ModalBlock;
