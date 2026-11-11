export type Phase = 'setup' | 'idle' | 'loading' | 'ready' | 'partial' | 'error' | 'stopped';
export type Failure = 'auth' | 'rate' | 'timeout' | 'webgl' | 'network';
export interface SessionState { phase: Phase; attempts: number; failure?: Failure; draining: boolean }
export interface SceneAdapter {
  load(update: (phase: 'ready' | 'partial') => void): Promise<void>;
  select(id: number | null): void;
  dispose(): void;
  whenSettled(): Promise<void>;
}
export class SceneFailure extends Error {
  readonly category: Failure;
  constructor(category: Failure) { super(category); this.category = category; }
}
export function failureCategory(error: unknown): Failure {
  if (error instanceof SceneFailure) return error.category;
  const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  return 'network';
}
export class SessionController {
  state: SessionState;
  private configured: boolean;
  private create: () => SceneAdapter;
  private change: (state: SessionState) => void;
  private timeout: number;
  private adapter?: SceneAdapter;
  private generation = 0;
  private pending?: Promise<void>;
  private inFlight?: Promise<void>;
  private cancel?: () => void;
  constructor(configured: boolean, create: () => SceneAdapter, change: (state: SessionState) => void, timeout = 30_000) {
    this.configured = configured; this.create = create; this.change = change; this.timeout = timeout;
    this.state = { phase: configured ? 'idle' : 'setup', attempts: 0, draining: false };
  }
  private publish(phase: Phase, failure?: Failure): void {
    this.state = { phase, attempts: this.state.attempts, draining: this.state.draining, ...(failure ? { failure } : {}) };
    this.change(this.state);
  }
  load(): Promise<void> {
    if (!this.configured) { this.publish('setup'); return Promise.resolve(); }
    if (this.inFlight) return this.pending ?? Promise.resolve();
    if (this.state.attempts >= 2 || this.state.phase === 'ready' || this.state.phase === 'partial') return Promise.resolve();
    const generation = ++this.generation;
    this.state = { phase: 'loading', attempts: this.state.attempts + 1, draining: true };
    this.change(this.state);
    let timer: ReturnType<typeof setTimeout>;
    const abort = new Promise<void>((resolve, reject) => {
      this.cancel = resolve;
      timer = setTimeout(() => reject(new SceneFailure('timeout')), this.timeout);
    });
    let current: SceneAdapter | undefined;
    const work = Promise.resolve().then(() => {
      if (generation !== this.generation) return;
      current = this.adapter = this.create();
      return this.adapter.load((phase) => { if (generation === this.generation) this.publish(phase); });
    });
    // A user-visible Stop/error may finish before async factories do. Keep the
    // retry lock until both load and every sibling resource factory have settled.
    this.inFlight = work.catch(() => undefined).then(() => current?.whenSettled()).catch(() => undefined).then(() => {
      this.inFlight = undefined;
      this.state = { ...this.state, draining: false };
      this.change(this.state);
    });
    this.pending = Promise.race([work, abort]).then(() => {
      if (generation === this.generation) this.publish(this.state.phase === 'partial' ? 'partial' : 'ready');
    }).catch((error: unknown) => {
      if (generation !== this.generation) return;
      ++this.generation;
      this.adapter?.dispose(); this.adapter = undefined;
      this.publish('error', failureCategory(error));
    }).finally(() => {
      clearTimeout(timer); this.cancel = undefined; this.pending = undefined;
    });
    return this.pending;
  }
  stop(): void {
    ++this.generation; this.cancel?.(); this.adapter?.dispose(); this.adapter = undefined; this.publish('stopped');
  }
  select(id: number | null): void { this.adapter?.select(id); }
}
