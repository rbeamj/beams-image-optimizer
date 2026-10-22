import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Locally fetched model weights and benchmark images live in public/ but must not ship by accident.
 * Hosting weights is an explicit decision: BEAMS_INCLUDE_MODELS=u2netp.onnx,realesr-general-x4v3.onnx
 */
function stripLocalAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'strip-local-model-assets',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle() {
      const allowed = new Set((process.env.BEAMS_INCLUDE_MODELS ?? '').split(',').map(name => name.trim()).filter(Boolean));
      rmSync(join(outDir, 'bench'), { recursive: true, force: true });
      const models = join(outDir, 'models');
      let entries: string[] = [];
      try { entries = readdirSync(models); } catch { return; }
      for (const name of entries) if (name.endsWith('.onnx') && !allowed.has(name)) rmSync(join(models, name), { force: true });
      rmSync(join(models, '.work'), { recursive: true, force: true });
      // The manifest must only advertise models that actually ship, or the editor would try to load stripped files.
      const manifestPath = join(models, 'manifest.json');
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: Record<string, unknown> };
        manifest.files = Object.fromEntries(Object.entries(manifest.files).filter(([name]) => allowed.has(name)));
        if (Object.keys(manifest.files).length) writeFileSync(manifestPath, JSON.stringify(manifest));
        else rmSync(manifestPath, { force: true });
      } catch { /* no manifest */ }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [dropBundledOrtWasm(), stripLocalAssets()],
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
