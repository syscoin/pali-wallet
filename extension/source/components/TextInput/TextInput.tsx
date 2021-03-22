import React, { FC, useState, MouseEvent, ReactNode } from 'react';
import clsx from 'clsx';
import MUITextInput, {
  OutlinedInputProps,
} from '@material-ui/core/OutlinedInput';
import InputAdornment from '@material-ui/core/InputAdornment';
import IconButton from '@material-ui/core/IconButton';
import Visibility from '@material-ui/icons/Visibility';
import VisibilityOff from '@material-ui/icons/VisibilityOff';

import styles from './TextInput.scss';

interface ITextInput extends Partial<OutlinedInputProps> {
  endAdornment?: ReactNode;
  type?: 'text' | 'password' | 'number';
  variant?: string;
  visiblePassword?: boolean;
}

const TextInput: FC<ITextInput> = ({
  type = 'text',
  visiblePassword = false,
  variant = '',
  endAdornment,
  ...otherProps
}) => {
  const [showed, setShowed] = useState(false);
  const inputType = showed && type === 'password' ? 'text' : type;

  const handleClickShowPassword = () => {
    setShowed(!showed);
  };

  const handleMouseDownPassword = (event: MouseEvent) => {
    event.preventDefault();
  };

  return (
    <MUITextInput
      className={clsx(styles.textInput, variant)}
      type={inputType}
      {...otherProps}
      endAdornment={
        endAdornment ||
        (type === 'password' && visiblePassword ? (
          <InputAdornment position="end">
            <IconButton
              aria-label="toggle password visibility"
              className={styles.iconButton}
              onMouseDown={handleMouseDownPassword}
              onClick={handleClickShowPassword}
              edge="end"
            >
              {showed ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ) : null)
      }
    />
  );
};

export default TextInput;
