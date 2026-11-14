export type WalletModalEntry<T> = Readonly<{
  id: string;
  parent: string | null;
  content: T;
  close(): void;
  transparent: boolean;
  animation: 'none' | 'slide' | 'fade';
}>;

/** UI ownership only. Removing a sheet also removes its nested sheets. */
export class WalletModalState<T> {
  private entries = new Map<string, WalletModalEntry<T>>();
  private dismissed = new Set<string>();
  private snapshot: readonly WalletModalEntry<T>[] = [];
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish() { this.snapshot = [...this.entries.values()]; for (const listener of this.listeners) listener(); }
  set(entry: WalletModalEntry<T>) {
    if (this.dismissed.has(entry.id)) return;
    if (entry.parent && !this.entries.has(entry.parent)) return;
    this.entries.set(entry.id, entry); this.publish();
  }
  remove(id: string) {
    this.dismissed.delete(id);
    const removing = new Set([id]);
    for (const entry of this.entries.values()) if (entry.parent && removing.has(entry.parent)) removing.add(entry.id);
    let changed = false;
    for (const key of removing) changed = this.entries.delete(key) || changed;
    if (changed) this.publish();
  }
  requestClose = () => {
    const top = this.snapshot.at(-1);
    if (!top) return false;
    top.close(); return true;
  };
  dismissAll = () => {
    const closing = [...this.snapshot].reverse();
    for (const entry of closing) this.dismissed.add(entry.id);
    this.entries.clear(); this.publish();
    for (const entry of closing) {
      try { entry.close(); } catch { /* The hidden UI must remain dismissed. */ }
    }
  };
}
