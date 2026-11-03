type HandleModule = {
  Key: unknown;
  Context: unknown;
  createContext(): {
    importKey(kind: string, usages: string[], bytes: Uint8Array): object;
    close(): void;
  };
};

/** Exercise the actual native classes in the isolated qualification binary. */
export function qualifyNativeHandleContract(module: HandleModule): void {
  const { Key, Context } = module;
  if (typeof Key !== 'function' || typeof Context !== 'function' ||
      typeof Key.prototype !== 'object' || typeof Context.prototype !== 'object')
    throw Error('QUALIFICATION_NATIVE_HANDLE_CLASSES_MISSING');
  for (const constructor of [Key, Context]) {
    let rejected = false;
    try { Reflect.construct(constructor, []); }
    catch { rejected = true; }
    if (!rejected) throw Error('QUALIFICATION_NATIVE_HANDLE_CONSTRUCTION_ALLOWED');
  }

  const context = module.createContext();
  try {
    if (!(context instanceof Context)) throw Error('QUALIFICATION_NATIVE_CONTEXT_CLASS_MISMATCH');
    const key = context.importKey('AES-GCM', ['encrypt'], new Uint8Array(32));
    if (!(key instanceof Key)) throw Error('QUALIFICATION_NATIVE_KEY_CLASS_MISMATCH');
  } finally {
    context.close();
  }
}
