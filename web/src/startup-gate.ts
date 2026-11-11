export function startupGate(options: { configured: boolean; visible: boolean; enabled: boolean; start: () => void }) {
  let geographyReady = false, visible = options.visible, consumed = false;
  function attempt() {
    if (consumed || !options.enabled || !options.configured || !geographyReady || !visible) return;
    consumed = true;
    try { options.start(); } catch { /* Startup failure must never rearm the entitlement. */ }
  }
  return {
    ready() { geographyReady = true; attempt(); },
    visibility(value: boolean) { visible = value; attempt(); },
    stop() { consumed = true; },
    get pending() { return !consumed && options.enabled && options.configured; },
  };
}
