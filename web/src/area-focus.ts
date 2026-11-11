import { areaTarget } from './zones.ts';
import type { AreaTarget, ZoneCollection } from './zones.ts';
export interface CameraFocusPort { move(target: AreaTarget, options: {duration:number;complete:()=>boolean;cancel:()=>boolean}): void; cancel(): void }
export function areaFocus(geography: ZoneCollection, camera: CameraFocusPort) {
  let disposed = false, generation = 0;
  let pending: { resolve: (moved: boolean) => void } | undefined;
  function cancel() {
    if (!pending) return;
    const previous = pending; pending = undefined; ++generation;
    try { camera.cancel(); } catch { /* Cancellation must not block teardown. */ } finally { previous.resolve(false); }
  }
  return {
    focus(id: number, reducedMotion: boolean): Promise<boolean> {
      if (disposed || pending) return Promise.resolve(false);
      const target = areaTarget(geography, id);
      if (!target) return Promise.resolve(false);
      const current = ++generation;
      return new Promise(resolve => {
        pending = { resolve };
        const finish = (moved: boolean) => {
          if (current !== generation || !pending) return false;
          pending = undefined; resolve(moved); return true;
        };
        try { camera.move(target, { duration: reducedMotion ? 0 : 1.2, complete: () => finish(true), cancel: () => finish(false) }); }
        catch { finish(false); }
      });
    },
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}
