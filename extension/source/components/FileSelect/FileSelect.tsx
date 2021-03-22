import React, { ChangeEvent, FC, useRef, useState, useEffect } from 'react';
import Button from 'components/Button';

import styles from './FileSelect.scss';

interface IFileSelect {
  accept?: string;
  onChange: (val: File | null) => void;
  disabled?: boolean;
}

const FileSelect: FC<IFileSelect> = ({
  accept = 'application/JSON',
  onChange,
  disabled = false,
}) => {
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleClick = () => {
    if (fileRef && fileRef.current) {
      fileRef.current.click();
    }
  };

  useEffect(() => {
    onChange(null);
  }, []);

  const handleFileChoose = (ev: ChangeEvent<HTMLInputElement>) => {
    if (!ev.target.files?.length) {
      return;
    }
    const file: File = ev.target.files[0];
    setStatus(file.name);
    onChange(file);
  };

  return (
    <div className={styles.select}>
      <input
        type="file"
        className={styles.file}
        ref={fileRef}
        accept={accept}
        onChange={(ev) => handleFileChoose(ev)}
      />
      <Button
        type="button"
        variant={styles.button}
        onClick={handleClick}
        disabled={disabled}
      >
        Choose File
      </Button>
      <span className={styles.chosen}>{status ?? 'No file choosen'}</span>
    </div>
  );
};

export default FileSelect;
