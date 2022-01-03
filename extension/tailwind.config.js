const palette = require('./palette.js');

module.exports = {
  purge: [],
  darkMode: false, // or 'media' or 'class'
  theme: {
    extend: {
      colors: palette,
      boxShadow: {
        'btn': '0px 1px 5px rgba(0, 0, 0, 0.25)',
        'tooltip': '0px 0px 5px rgba(0, 0, 0, 0.25)'
      },
      inset: {
        '5percent': '5%'
      },
      top: {
        '3rem': '4rem'
      },
      right: {
        '5percent': '5%',
        '45r': '0.45rem',
      },
      margin: {
        '0.8': '0.2rem'
      },
      maxWidth: {
        popup: '600px',
        input: '18rem',
        '1/2': '50%',
        '70': '70%',
        '95': '95%'
      },
      minWidth: {
        popup: '372px'
      },
      height: {
        popup: '600px',
        menu: '27rem',
        bigmenu: '30rem',
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
        primary: 'linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0)), linear-gradient(30deg, rgba(255, 62, 145, 0.8) 20%, #4d76b8 50%)'
      },
      fontFamily: {
        'poppins': 'Poppins',
        'rubik': 'Rubik'
      },
      fontSize: {
        'xxs': '0.01px',
        '10px': '10px'
      }
    },
  },
  variants: {
    extend: {},
  },
  plugins: [],
}
