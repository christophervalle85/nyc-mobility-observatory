import type { SceneAdapter } from './session.ts';
export interface OwnedResource { destroy(): void }
export interface SceneRuntime {
  tiles(): Promise<OwnedResource>; zones(): Promise<OwnedResource>;
  attachTiles(resource: OwnedResource): void; attachZones(resource: OwnedResource): void;
  watchPartial(change: () => void): () => void;
  select(id: number | null): void; destroy(): void;
}
export function managedAdapter(open: () => SceneRuntime): SceneAdapter {
  let scene: SceneRuntime | undefined, disposed = false, remove: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  let drained: Promise<void> = Promise.resolve();
  return {
    load(update) {
      if (pending) return pending;
      if (disposed) return Promise.resolve();
      scene = open();
      remove = scene.watchPartial(() => { if (!disposed) update('partial'); });
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
      pending = Promise.all(branches).then(() => undefined);
      return pending;
    },
    whenSettled() { return drained; },
    select(id) { if (!disposed) scene?.select(id); },
    dispose() { if (disposed) return; disposed = true; remove?.(); scene?.destroy(); scene = undefined; },
  };
}
