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
        <p onClick={() => setCallback()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 1.41L12.59 0L7 5.59L1.41 0L0 1.41L5.59 7L0 12.59L1.41 14L7 8.41L12.59 14L14 12.59L8.41 7L14 1.41Z" fill="#808080" />
          </svg>
        </p>
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
