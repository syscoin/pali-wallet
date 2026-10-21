// jsdom supplies its own Uint8Array realm; the installed SDK creates native
// Buffer values. Use the real Node constructor consistently, not a crypto mock.
global.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
