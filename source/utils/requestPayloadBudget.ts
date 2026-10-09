// Wallet policy limits, not RPC/protocol maximums. Reject; never truncate signed data.
export const DAPP_REQUEST_LIMITS = {
  bytes: 1024 * 1024,
  signingBytes: 64 * 1024,
  batchBytes: 128 * 1024,
  depth: 32,
  nodes: 10_000,
  calls: 50,
} as const;

export const payloadBudgetError = (detail: string): Error & { code: number } =>
  Object.assign(new Error(`Request exceeds wallet work limits: ${detail}`), {
    code: -32602,
  });

/** Bound JSON serialization work without recursively walking or stringifying it. */
export const assertJsonWorkBudget = (
  value: unknown,
  maxBytes: number = DAPP_REQUEST_LIMITS.bytes,
  maxDepth: number = DAPP_REQUEST_LIMITS.depth,
  maxNodes: number = DAPP_REQUEST_LIMITS.nodes
): void => {
  let bytes = 0;
  let nodes = 0;
  let scheduled = 1;
  const stack: Array<{ depth: number; exit?: boolean; value: unknown }> = [
    { value, depth: 0 },
  ];
  const ancestors = new Set<object>();
  const addBytes = (count: number) => {
    bytes += count;
    if (bytes > maxBytes) throw payloadBudgetError(`maximum ${maxBytes} bytes`);
  };
  const addString = (text: string) => {
    // Every UTF-16 code unit needs at least one serialized byte. Stop huge
    // strings before scanning them; accepted scans share the same byte budget.
    if (text.length > maxBytes - bytes) {
      throw payloadBudgetError(`maximum ${maxBytes} bytes`);
    }
    addBytes(2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92) addBytes(2);
      else if (code < 32) addBytes(6);
      else if (code < 128) addBytes(1);
      else if (code < 2048) addBytes(2);
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff
      ) {
        addBytes(4);
        i++;
      } else addBytes(code >= 0xd800 && code <= 0xdfff ? 6 : 3);
    }
  };

  while (stack.length) {
    const item = stack.pop()!;
    const current = item.value;
    if (item.exit) {
      ancestors.delete(current as object);
      continue;
    }
    if (++nodes > maxNodes)
      throw payloadBudgetError(`maximum ${maxNodes} values`);
    if (item.depth > maxDepth)
      throw payloadBudgetError(`maximum depth ${maxDepth}`);
    if (typeof current === 'string') {
      addString(current);
    } else if (current === null || current === undefined) {
      addBytes(4);
    } else if (typeof current === 'number' || typeof current === 'boolean') {
      addBytes(String(current).length);
    } else if (typeof current === 'object') {
      if (ancestors.has(current)) throw payloadBudgetError('cyclic data');
      const prototype = Object.getPrototypeOf(current);
      if (
        prototype !== Object.prototype &&
        prototype !== Array.prototype &&
        prototype !== null
      ) {
        throw payloadBudgetError('non-JSON object');
      }
      const serializer = Object.getOwnPropertyDescriptor(current, 'toJSON');
      if (
        serializer &&
        (!('value' in serializer) || typeof serializer.value === 'function')
      ) {
        throw payloadBudgetError('custom JSON serialization');
      }
      if (Array.isArray(current) && current.length > maxNodes - scheduled) {
        throw payloadBudgetError(`maximum ${maxNodes} values`);
      }
      ancestors.add(current);
      stack.push({ ...item, exit: true });
      addBytes(2);
      if (Array.isArray(current)) {
        // JSON serializes holes as null and includes non-enumerable indexes.
        // Charge every slot globally, rather than only enumerated properties.
        for (let index = 0; index < current.length; index++) {
          const property = Object.getOwnPropertyDescriptor(current, index);
          if (property && !('value' in property))
            throw payloadBudgetError('accessor properties');
          scheduled++;
          addBytes(1);
          stack.push({ value: property?.value, depth: item.depth + 1 });
        }
        continue;
      }
      // Do not allocate Object.keys for an untrusted, potentially huge object.
      for (const key in current) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        if (++scheduled > maxNodes) {
          throw payloadBudgetError(`maximum ${maxNodes} values`);
        }
        const property = Object.getOwnPropertyDescriptor(current, key)!;
        if (!('value' in property))
          throw payloadBudgetError('accessor properties');
        addString(key);
        addBytes(2);
        stack.push({ value: property.value, depth: item.depth + 1 });
      }
    } else {
      throw payloadBudgetError('non-JSON value');
    }
  }
};

export const isTypedDataMethod = (method: string): boolean =>
  method === 'eth_signTypedData' ||
  method === 'eth_signTypedData_v3' ||
  method === 'eth_signTypedData_v4';

/** Cheap pre-transport and pre-queue gate; the background also checks semantics. */
export const assertProviderRequestBudget = (request: any): void => {
  const method = request?.method;
  const signing = method === 'personal_sign' || isTypedDataMethod(method);
  let bytes: number = DAPP_REQUEST_LIMITS.bytes;
  if (signing) bytes = DAPP_REQUEST_LIMITS.signingBytes;
  else if (method === 'wallet_sendCalls')
    bytes = DAPP_REQUEST_LIMITS.batchBytes;
  assertJsonWorkBudget(request, bytes);
  if (method === 'wallet_sendCalls') {
    const params = request.params;
    const calls = (Array.isArray(params) ? params[0] : params)?.calls;
    if (Array.isArray(calls) && calls.length > DAPP_REQUEST_LIMITS.calls) {
      throw payloadBudgetError(`maximum ${DAPP_REQUEST_LIMITS.calls} calls`);
    }
  }
};
