/** Public navigation token; contains no account data or wallet capabilities. */
export class TabDeparture {
  private generation = 0;
  invalidate() { this.generation++; }
  request(scope: string, current: () => string | null, leave: ((navigate: () => void) => void) | null, navigate: () => void) {
    const generation = ++this.generation;
    const complete = () => { if (generation === this.generation && current() === scope) { this.generation++; navigate(); } };
    if (leave) leave(complete); else complete();
  }
}
