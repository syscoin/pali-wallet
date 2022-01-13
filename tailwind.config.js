const palette = require('./palette.js');

module.exports = {
  purge: ['./source/**/*.tsx'],
  darkMode: false, // or 'media' or 'class'
  theme: {
    extend: {
      colors: palette,
      boxShadow: {
        btn: '0px 1px 5px rgba(0, 0, 0, 0.25)',
        tooltip: '0px 0px 5px rgba(0, 0, 0, 0.25)',
      },
      inset: {
        '5percent': '5%',
      },
      spacing: {
        '5dot5': '5.5rem',
      },
      top: {
        '3rem': '4rem',
      },

      right: {
        '5percent': '5%',
        '45r': '0.45rem',
      },
      margin: {
        0.8: '0.2rem',
        auto: '0 auto',
      },
      padding: {
        18: '0 4.5rem',
        '15px': '0 0.938rem',
      },
      maxWidth: {
        popup: '600px',
        input: '18rem',
        '1/2': '50%',
        60: '60%',
        70: '70%',
        80: '80%',
        95: '95%',
      },
      minWidth: {
        popup: '372px',
      },
      height: {
        popup: '600px',
        menu: '27rem',
        bigmenu: '31rem',
        85: '23rem',
      },
      letterSpacing: {
        tightest: '-.075em',
        tighter: '-.05em',
        tight: '-.025em',
        normal: '0.03em',
        wide: '.5rem',
        wider: '.5em',
        widest: '.8em',
        widest: '.9em',
      },
      backgroundImage: {
        primary:
          'linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0)), linear-gradient(30deg, rgba(255, 62, 145, 0.8) 20%, #4d76b8 50%)',
      },
      fontFamily: {
        poppins: 'Poppins',
        rubik: 'Rubik',
      },
      fontSize: {
        xxs: '0.01px',
        '10px': '10px',
      },
      screens: {
        'small-device-size': { raw: '(min-width: 0px) and (max-width: 767px)' },
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [],
};
