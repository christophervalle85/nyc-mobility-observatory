export type Phase = 'setup' | 'idle' | 'loading' | 'ready' | 'partial' | 'error' | 'stopped';
export type Failure = 'auth' | 'rate' | 'timeout' | 'webgl' | 'network';
export interface SessionState { phase: Phase; attempts: number; failure?: Failure; draining: boolean; focusing: boolean }
export interface SceneAdapter {
  load(update: (phase: 'ready' | 'partial') => void): Promise<void>;
  select(id: number | null): void;
  dispose(): void;
  whenSettled(): Promise<void>;
  focus(id: number, reducedMotion: boolean): Promise<boolean>;
  cancelFocus(): void;
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
  private selected: number | null = null;
  private focusEpoch = 0;
  private isKnownZone: (id: number) => boolean;
  constructor(configured: boolean, create: () => SceneAdapter, change: (state: SessionState) => void, timeout = 30_000, isKnownZone: (id: number) => boolean = () => false) {
    this.configured = configured; this.create = create; this.change = change; this.timeout = timeout; this.isKnownZone = isKnownZone;
    this.state = { phase: configured ? 'idle' : 'setup', attempts: 0, draining: false, focusing: false };
  }
  private cancelMovement(): void {
    ++this.focusEpoch;
    if (this.state.focusing) this.adapter?.cancelFocus();
    this.state = { ...this.state, focusing: false };
  }
  private publish(phase: Phase, failure?: Failure): void {
    if (phase !== 'ready') this.cancelMovement();
    this.state = { phase, attempts: this.state.attempts, draining: this.state.draining, focusing: this.state.focusing, ...(failure ? { failure } : {}) };
    this.change(this.state);
  }
  load(): Promise<void> {
    if (!this.configured) { this.publish('setup'); return Promise.resolve(); }
    if (this.inFlight) return this.pending ?? Promise.resolve();
    if (this.state.attempts >= 2 || this.state.phase === 'ready' || this.state.phase === 'partial') return Promise.resolve();
    const generation = ++this.generation;
    this.state = { phase: 'loading', attempts: this.state.attempts + 1, draining: true, focusing: false };
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
      if (generation === this.generation) {
        this.adapter?.select(this.selected);
        this.publish(this.state.phase === 'partial' ? 'partial' : 'ready');
      }
    }).catch((error: unknown) => {
      if (generation !== this.generation) return;
      ++this.generation; this.cancelMovement();
      this.adapter?.dispose(); this.adapter = undefined;
      this.publish('error', failureCategory(error));
    }).finally(() => {
      clearTimeout(timer); this.cancel = undefined; this.pending = undefined;
    });
    return this.pending;
  }
  stop(): void {
    ++this.generation; this.cancelMovement(); this.cancel?.(); this.adapter?.dispose(); this.adapter = undefined; this.publish('stopped');
  }
  async focus(reducedMotion = false): Promise<boolean> {
    if (this.state.phase !== 'ready' || this.state.draining || this.state.focusing || this.selected === null || !this.adapter) return false;
    const epoch = ++this.focusEpoch, generation = this.generation;
    this.state = { ...this.state, focusing: true }; this.change(this.state);
    try {
      const moved = await this.adapter.focus(this.selected, reducedMotion);
      return epoch === this.focusEpoch && generation === this.generation && moved;
    } catch { return false; }
    finally {
      if (epoch === this.focusEpoch && generation === this.generation) {
        this.state = { ...this.state, focusing: false }; this.change(this.state);
      }
    }
  }
  select(id: number | null): void {
    const next = id !== null && this.isKnownZone(id) ? id : null;
    if (next === this.selected) return;
    this.cancelMovement(); this.selected = next; this.adapter?.select(next); this.change(this.state);
  }
}
