/** Pre-parse work bound shared by authenticated note formats. Syntax is still checked by JSON.parse. */
const fail = (): never => {
  throw new Error('Invalid JSON work budget');
};
export function assertJsonTextBudget(
  text: string,
  limits: Readonly<{
    depth: number;
    nodes: number;
    tokenCharacters: number;
    whitespace?: boolean;
  }>
): void {
  let depth = 0;
  let nodes = 0;
  const node = () => {
    if (++nodes > limits.nodes) fail();
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (limits.whitespace && /[\t\n\r ]/.test(char)) continue;
    if (char === '{' || char === '[') {
      node();
      if (++depth > limits.depth) fail();
    } else if (char === '}' || char === ']') {
      if (--depth < 0) fail();
    } else if (char === '"') {
      const start = ++i;
      for (; i < text.length; i++) {
        if (i - start > limits.tokenCharacters) fail();
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
      if (i >= text.length) fail();
      if (text[i + 1]! !== ':') node();
    } else if (char === ',' || char === ':') {
      // Syntax is checked by JSON.parse after this work budget.
    } else {
      if (char <= ' ') fail();
      node();
      while (
        i + 1 < text.length &&
        !',]}:'.includes(text[i + 1]!) &&
        !(limits.whitespace && /[\t\n\r ]/.test(text[i + 1]!))
      ) {
        if (text[++i]! <= ' ') fail();
      }
    }
  }
  if (depth !== 0) fail();
}
