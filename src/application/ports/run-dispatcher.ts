export interface RunDispatcher {
  start(): void;
  stop(): Promise<void>;
}
