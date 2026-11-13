import type { FootprintState } from './study-footprint.ts';
import type { SceneAdapter } from './session.ts';
export interface OwnedResource { destroy(): void }
export interface SceneRuntime {
  tiles(): Promise<OwnedResource>; zones(): Promise<OwnedResource>;
  attachTiles(resource: OwnedResource): void; attachZones(resource: OwnedResource): void;
  watchPartial(change: () => void): () => void;
  select(id: number | null): void; destroy(): void;
  focus(id: number, reducedMotion: boolean): Promise<boolean>; cancelFocus(): void;
  overview?(): boolean; footprint?(): FootprintState | undefined;
}
export function managedAdapter(open: () => SceneRuntime): SceneAdapter {
  let scene: SceneRuntime | undefined, disposed = false, remove: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  let ready = false, partialSeen = false;
  let drained: Promise<void> = Promise.resolve();
  return {
    load(update) {
      if (pending) return pending;
      if (disposed) return Promise.resolve();
      scene = open();
      remove = scene.watchPartial(() => { if (!disposed) { ready = false; partialSeen = true; scene?.cancelFocus(); update('partial'); } });
      const current = scene;
      const attach = async (resource: Promise<OwnedResource>, add: (value: OwnedResource) => void) => {
        const value = await resource;
        if (disposed) value.destroy(); else add(value);
      };
      const branches = [
        attach(Promise.resolve().then(() => current.tiles()), value => current.attachTiles(value)),
        attach(Promise.resolve().then(() => current.zones()), value => current.attachZones(value)),
      ];
      // Promise.all rejects promptly; allSettled independently owns the retry gate.
      drained = Promise.allSettled(branches).then(() => undefined);
      pending = Promise.all(branches).then(() => { if (!disposed) ready = !partialSeen; });
      return pending;
    },
    whenSettled() { return drained; },
    overview() { return !disposed && ready ? scene?.overview?.() ?? false : false; },
    footprint() { return scene?.footprint?.(); },
    focus(id, reducedMotion) { return !disposed && ready && scene ? scene.focus(id, reducedMotion) : Promise.resolve(false); },
    cancelFocus() { scene?.cancelFocus(); },
    select(id) { if (!disposed) scene?.select(id); },
    dispose() { if (disposed) return; disposed = true; ready = false; remove?.(); scene?.cancelFocus(); scene?.destroy(); scene = undefined; },
  };
}
