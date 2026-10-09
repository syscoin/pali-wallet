import {
  assertJsonWorkBudget,
  DAPP_REQUEST_LIMITS,
  isTypedDataMethod,
  payloadBudgetError,
} from './requestPayloadBudget';

export const TYPED_DATA_WORK_LIMITS = {
  types: 64,
  fieldsPerType: 128,
  fields: 512,
  work: 4096,
  depth: 16,
} as const;

/** Bound schema expansion as well as the JSON tree (including repeated fields). */
export const assertTypedDataWorkBudget = (data: any): void => {
  assertJsonWorkBudget(data, DAPP_REQUEST_LIMITS.signingBytes);
  if (Array.isArray(data)) {
    if (data.length > TYPED_DATA_WORK_LIMITS.fields) {
      throw payloadBudgetError('maximum 512 legacy typed fields');
    }
    return;
  }
  if (!data || typeof data !== 'object' || !data.types) return;
  let fieldCount = 0;
  let typeCount = 0;
  const definitions = data.types;
  for (const typeName of Object.keys(definitions)) {
    if (++typeCount > TYPED_DATA_WORK_LIMITS.types) {
      throw payloadBudgetError('maximum 64 typed-data types');
    }
    const fields = definitions[typeName];
    if (!Array.isArray(fields))
      throw payloadBudgetError('invalid typed-data fields');
    if (fields.length > TYPED_DATA_WORK_LIMITS.fieldsPerType) {
      throw payloadBudgetError('maximum 128 fields per type');
    }
    fieldCount += fields.length;
    if (fieldCount > TYPED_DATA_WORK_LIMITS.fields) {
      throw payloadBudgetError('maximum 512 typed-data fields');
    }
    const names = new Set<string>();
    for (const field of fields) {
      if (
        !field ||
        typeof field.name !== 'string' ||
        typeof field.type !== 'string'
      ) {
        throw payloadBudgetError('invalid typed-data field');
      }
      if (names.has(field.name))
        throw payloadBudgetError('duplicate typed-data field');
      names.add(field.name);
      const dimensions = field.type.split('[').length - 1;
      if (dimensions > TYPED_DATA_WORK_LIMITS.depth) {
        throw payloadBudgetError('maximum typed-data array depth 16');
      }
    }
  }

  const pending: Array<{ depth: number; type: string; value: any }> = [];
  if (data.primaryType && definitions[data.primaryType]) {
    pending.push({ type: data.primaryType, value: data.message, depth: 0 });
  } else {
    // Match legacy primary-type inference conservatively, without allowing a
    // missing primaryType to skip the work guard before later validation.
    for (const typeName of Object.keys(definitions)) {
      if (typeName !== 'EIP712Domain') {
        pending.push({ type: typeName, value: data.message, depth: 0 });
      }
    }
  }
  if (definitions.EIP712Domain) {
    pending.push({ type: 'EIP712Domain', value: data.domain, depth: 0 });
  }
  let work = 0;
  const push = (item: (typeof pending)[number]) => {
    if (++work > TYPED_DATA_WORK_LIMITS.work) {
      throw payloadBudgetError('maximum 4096 typed-data field operations');
    }
    if (item.depth > TYPED_DATA_WORK_LIMITS.depth) {
      throw payloadBudgetError('maximum typed-data nesting depth 16');
    }
    pending.push(item);
  };
  while (pending.length) {
    const item = pending.pop()!;
    if (item.type.endsWith(']')) {
      if (!Array.isArray(item.value)) continue; // Existing validation handles shape.
      const type = item.type.replace(/\[[0-9]*\]$/, '');
      for (const value of item.value) {
        push({ type, value, depth: item.depth + 1 });
      }
    } else if (Object.prototype.hasOwnProperty.call(definitions, item.type)) {
      if (!item.value || typeof item.value !== 'object') continue;
      for (const field of definitions[item.type]) {
        push({
          type: field.type,
          value: item.value[field.name],
          depth: item.depth + 1,
        });
      }
    }
  }
};

/** JSON strings are byte-bounded before JSON.parse, then tree/work-bounded. */
export const assertTypedDataParamsWorkBudget = (
  method: string,
  params: any
): void => {
  if (!isTypedDataMethod(method) || !Array.isArray(params)) return;
  for (const param of params) {
    if (param && typeof param === 'object') assertTypedDataWorkBudget(param);
    else if (typeof param === 'string' && /^[\s]*[\[{]/.test(param)) {
      assertJsonWorkBudget(param, DAPP_REQUEST_LIMITS.signingBytes);
      let parsed: any;
      try {
        parsed = JSON.parse(param);
      } catch {
        throw payloadBudgetError('invalid typed-data JSON');
      }
      assertTypedDataWorkBudget(parsed);
    }
  }
};
