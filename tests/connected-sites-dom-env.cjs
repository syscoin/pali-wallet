const { TestEnvironment } = require('jest-environment-node');
const { JSDOM } = require('jsdom');

// Keep the SDK's Node Buffer/typed-array realm while mounting the actual UI.
// Only DOM globals are added; the test supplies its own deny-by-default network.
module.exports = class ConnectedSitesEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    this.dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://connected-sites.synthetic.invalid/',
      pretendToBeVisual: true,
    });
    const window = this.dom.window;
    for (const name of [
      'document',
      'navigator',
      'HTMLElement',
      'HTMLButtonElement',
      'HTMLInputElement',
      'HTMLIFrameElement',
      'HTMLFieldSetElement',
      'HTMLLegendElement',
      'HTMLAnchorElement',
      'HTMLSelectElement',
      'HTMLOptionElement',
      'HTMLTextAreaElement',
      'HTMLFormElement',
      'SVGElement',
      'Node',
      'Element',
      'Event',
      'MouseEvent',
      'CustomEvent',
      'MutationObserver',
      'DocumentFragment',
      'NodeFilter',
      'DOMParser',
    ])
      this.global[name] = window[name];
    this.global.window = window;
    this.global.self = window;
    this.global.getComputedStyle = window.getComputedStyle.bind(window);
    this.global.requestAnimationFrame = (callback) =>
      this.global.setTimeout(() => callback(Date.now()), 16);
    this.global.cancelAnimationFrame = (id) => this.global.clearTimeout(id);
    this.global.IS_REACT_ACT_ENVIRONMENT = true;
  }
  async teardown() {
    this.dom.window.close();
    await super.teardown();
  }
};
