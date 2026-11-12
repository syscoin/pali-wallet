/** Require a sequence for every input before showing the non-RBF status. */
export function hasNonReplaceableUtxoSequences(inputs: unknown): boolean {
  return (
    Array.isArray(inputs) &&
    inputs.length > 0 &&
    inputs.every(
      (input) =>
        input?.sequence === 0xfffffffe || input?.sequence === 0xffffffff
    )
  );
}

/** Display-only Z-DAG classification; it never establishes block confirmation. */
export function isPendingZdagActivity({
  asset,
  inBlock,
  inputs,
}: {
  asset: boolean;
  inBlock: boolean;
  inputs: unknown;
}): boolean {
  return asset && !inBlock && hasNonReplaceableUtxoSequences(inputs);
}
