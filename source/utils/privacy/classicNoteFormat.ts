export const matchClassicNote = (note: string) =>
  note.length <= 256
    ? /^tornado-eth-(0\.1|1|10|100)-1-0x([0-9a-fA-F]{124})$/.exec(note.trim())
    : null;
