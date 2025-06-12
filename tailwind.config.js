const palette = require('./palette.js');

module.exports = {
  content: [
    './source/components/**/*.{html,js,jsx,ts,tsx}',
    './source/pages/**/*.{html,js,jsx,ts,tsx}',
    './views/*.html',
  ],
  media: false, //darkMode is outdated
  theme: {
    extend: {
      colors: palette,
      boxShadow: {
        btn: '0px 1px 5px rgba(0, 0, 0, 0.25)',
        tooltip: '0px 0px 5px rgba(0, 0, 0, 0.25)',
      },
      filter: {
        blur: 'blur(3.5px)',
      },
      scale: {
        103: '1.03',
      },
      inset: {
        '5percent': '5%',
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
      },
      maxWidth: {
        popup: '620px',
        input: '18rem',
        '1/2': '50%',
        70: '70%',
        95: '95%',
      },
      maxHeight: {
        popup: '620px',
      },
      minWidth: {
        popup: '400px',
        xs: '1rem',
      },
      minHeight: {
        popup: '620px',
      },
      height: {
        popup: '620px',
        menu: '27rem',
        bigmenu: '31rem',
        85: '23rem',
        tokenHeader: '70px',
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
        small: { min: '640px', max: '1280px' },
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'drop-up': 'dropFadeInUp 1.5s linear',
        'drop-down': 'dropFadeInDown 1.5s linear',
        fadeIn: 'fadeIn 0.3s ease-in-out',
      },
      keyframes: {
        dropFadeInDown: {
          '0%': { opacity: '0', transform: 'translateY(40px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        dropFadeInUp: {
          '0%': { opacity: '1', transform: 'translateY(-40px)' },
          '100%': { opacity: '0', transform: 'none' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [],
};
