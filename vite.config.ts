import { defineConfig, type Plugin } from 'vite';

/**
 * ORT references its .wasm via import.meta.url, which Vite would hash into dist/assets.
 * The runtime loads WASM from public/ort via ort.env.wasm.wasmPaths instead, so drop the
 * duplicate hashed copy.
 */
function dropBundledOrtWasm(): Plugin {
  return {
    name: 'drop-bundled-ort-wasm',
    generateBundle(_options, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === 'asset' && fileName.includes('ort-wasm') && fileName.endsWith('.wasm')) delete bundle[fileName];
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [dropBundledOrtWasm()],
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
