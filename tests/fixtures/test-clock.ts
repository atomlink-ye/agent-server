export class TestClock {
  #current: Date;

  public constructor(startAt: string | Date) {
    this.#current = new Date(startAt);
  }

  public now = (): Date => new Date(this.#current);

  public iso(): string {
    return this.#current.toISOString();
  }

  public advanceMs(ms: number): Date {
    this.#current = new Date(this.#current.getTime() + ms);
    return this.now();
  }

  public set(value: string | Date): Date {
    this.#current = new Date(value);
    return this.now();
  }
}
