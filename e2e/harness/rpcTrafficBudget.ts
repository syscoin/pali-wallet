export type RpcTraffic = {
  batchCapabilityProbe?: boolean;
  finished?: number;
  methods: readonly string[];
  requestBytes: number;
  requestFailure?: string;
  responseBytes?: number;
  responseFailure?: string;
  started: number;
};

export const countRpcTraffic = (rows: readonly RpcTraffic[]) => ({
  httpRequests: rows.length,
  rpcMethods: rows.reduce((total, row) => total + row.methods.length, 0),
  requestBytes: rows.reduce((total, row) => total + row.requestBytes, 0),
  responseBytes: rows.reduce(
    (total, row) => total + (row.responseBytes ?? 0),
    0
  ),
});

/** Refused envelopes still count as attempted methods and physical requests. */
export function assertRpcTrafficBudget(
  rows: readonly RpcTraffic[],
  limits: Readonly<{
    methods: number;
    posts: number;
    requestBytes: number;
    responseBytes: number;
  }>,
  label: string
): void {
  if (
    rows.some(
      (row) =>
        row.finished === undefined ||
        row.responseFailure !== undefined ||
        (row.responseBytes === undefined && row.requestFailure === undefined)
    )
  )
    throw new Error(`${label} RPC traffic has incomplete response accounting`);
  const traffic = countRpcTraffic(rows);
  if (
    traffic.rpcMethods > limits.methods ||
    traffic.httpRequests > limits.posts ||
    traffic.requestBytes > limits.requestBytes ||
    traffic.responseBytes > limits.responseBytes
  )
    throw new Error(
      `${label} RPC traffic exceeded budget: ${JSON.stringify(traffic)}`
    );
}

/** A cold or expired capability can produce only bounded concurrent probes. */
export function assertRpcCapabilityProbes(
  rows: readonly RpcTraffic[],
  label: string
): void {
  const probes = rows.filter((row) => row.batchCapabilityProbe);
  if (!probes.length) return;
  const firstRefusal = Math.min(
    ...probes.map((row) => row.finished ?? row.started)
  );
  if (
    probes.length > 4 ||
    probes.some((row) => row.methods.length > 40 || row.started > firstRefusal)
  )
    throw new Error(`${label} RPC capability probes exceeded budget`);
}
