import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Isolated benchmark server (not the app). Cross-origin isolation enables threaded WASM and
// performance.measureUserAgentSpecificMemory().
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5180,
    strictPort: true,
    fs: { allow: [repoRoot] },
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
