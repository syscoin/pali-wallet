import React from 'react';
import LogoImage from 'assets/images/logo-s.svg';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import IconButton from '@material-ui/core/IconButton';

const AccountHeader = () => {
  return (
    <div className="flex justify-between items-center bg-brand-gold">
      <div className="flex justify-between items-center">
        <img src={`/${LogoImage}`} className="mx-auto w-14 rounded-full" alt="Syscoin" />

        <div className="flex justify-start flex-col text-brand-white">
          <p>Account 1</p>
          <small>0x0000....0000000000000</small>
        </div>
      </div>

      <IconButton
        onClick={() => {
          console.log('open account settings')
        }
        }
      >
        <MoreVertIcon />
      </IconButton>
    </div>
  )
}

export default AccountHeader;