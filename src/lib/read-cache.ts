// Process-local, bounded cache. In-flight work is shared; failures are never cached.
export class ReadCache<T> {
  private entries = new Map<string, { expires: number; value: Promise<T> }>();
  constructor(
    private ttl: number,
    private limit = 100,
    private now = Date.now,
  ) {}
  get(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && entry.expires > this.now()) return entry.value;
    this.entries.delete(key);
    while (this.entries.size >= this.limit)
      this.entries.delete(this.entries.keys().next().value!);
    const next = { expires: Infinity, value: Promise.resolve().then(load) };
    this.entries.set(key, next);
    next.value.then(
      () => {
        next.expires = this.now() + this.ttl;
      },
      () => {
        if (this.entries.get(key) === next) this.entries.delete(key);
      },
    );
    return next.value;
  }
  clear(key?: string) {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }
}
