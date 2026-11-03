/* eslint-disable @typescript-eslint/no-var-requires -- Exercise the project's actual CommonJS Tailwind configuration. */
const postcss = require('postcss');
const tailwind = require('tailwindcss');

const config = require('../../tailwind.config.js');

/** Inspect generated utility behavior, not a hard-coded class-name expectation. */
export const readRenderedWhiteSpace = async (element: HTMLElement) => {
  const { css } = await postcss([
    tailwind({
      ...config,
      content: [{ raw: element.outerHTML, extension: 'html' }],
      corePlugins: { preflight: false },
    }),
  ]).process('@tailwind utilities;', { from: undefined });
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  try {
    return getComputedStyle(element).whiteSpace;
  } finally {
    style.remove();
  }
};
