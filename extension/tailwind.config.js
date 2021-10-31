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
      maxWidth: {
        popup: '600px'
      },
      minWidth: {
        popup: '372px'
      },
      height: {
        popup: '900px'
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
        primary: 'linear-gradient(to right top, #ff3e91, #da53b2, #ab66c3, #7971c5, #4d76b8)'
      }
    },
  },
  variants: {
    extend: {},
  },
  plugins: [],
}
