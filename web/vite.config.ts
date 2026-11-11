import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig(({ command, mode }) => {
  const isolated = command === 'build' || mode === 'verify' || process.env.MOBILITY_AUTOMATION === '1';
  return {
    envDir: isolated ? false : root,
    define: { CESIUM_BASE_URL: JSON.stringify('/cesium/'), ...(isolated ? { 'import.meta.env.VITE_CESIUM_ION_TOKEN': JSON.stringify('') } : {}) },
    plugins: [{ name: 'local-cesium-assets', buildStart() {
      for (const directory of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
        const destination = resolve(root, 'public/cesium', directory);
        mkdirSync(destination, { recursive: true });
        cpSync(resolve(root, 'node_modules/cesium/Build/Cesium', directory), destination, { recursive: true });
      }
    } }],
    server: { ...(mode === 'live' ? { hmr: false, watch: null } : {}), host: '127.0.0.1', port: isolated ? 5174 : 5173, strictPort: true, cors: false, allowedHosts: ['127.0.0.1'], fs: { strict: true, allow: [root] } },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, cors: false, allowedHosts: ['127.0.0.1'] },
    build: { sourcemap: false, chunkSizeWarningLimit: 5000 },
  };
});
