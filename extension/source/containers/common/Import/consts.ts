import * as Yup from 'yup';

export const CREATE_PASS_TITLE1 = `Let's create a \nStargazer password`;
export const CREATE_PASS_TITLE2 = `Your Wallet is Ready`;

export const CREATE_PASS_COMMENT1 = `Do not forget to save your password.\nYou will need this Password to unlock your wallet.`;
export const CREATE_PASS_COMMENT2 = `Your wallet and all connected accounts have been imported.`;

export const schema = Yup.object().shape({
  password: Yup.string()
    .required('Password is a required field!')
    .matches(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#~\$%\^&\*\"\%\'\?\]\[\/\{\}\_\:\;\=\<\>\,\.\+\|`\)\(\-\\])(?=.{8,})/,
      'Please check the above requirements!'
    ),
  repassword: Yup.string()
    .required('Confirm password is a required field!')
    .oneOf([Yup.ref('password'), ''], 'Incorrect please re-enter password!')
    .matches(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#~\$%\^&\*\"\%\'\?\]\[\/\{\}\_\:\;\=\<\>\,\.\+\|`\)\(\-\\])(?=.{8,})/,
      'Please check the above requirements!'
    ),
});
