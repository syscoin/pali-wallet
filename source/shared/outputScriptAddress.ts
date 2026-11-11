import { address, type Network } from 'bitcoinjs-lib';

/** Decode public script bytes only on the host's explicitly selected network. */
export function decodeOutputScriptAddress(
  scriptHex: unknown,
  network: Network
): string | null {
  if (
    !network ||
    typeof scriptHex !== 'string' ||
    scriptHex.length > 20_000 ||
    !/^(?:[\da-fA-F]{2})+$/.test(scriptHex)
  )
    return null;
  try {
    const script = Uint8Array.from(scriptHex.match(/../g)!, (byte) =>
      parseInt(byte, 16)
    );
    return address.fromOutputScript(script, network);
  } catch {
    return null;
  }
}
