import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const root = resolve(import.meta.dirname, '../..');
const MOUNTS: Record<string, string> = {
  '/hush-assets/': resolve(root, 'assets'),
  '/sessions/': resolve(root, 'data/sessions'),
};
const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jsonl': 'text/plain',
};

/** Serves the art pack and sessions in dev, and copies only what the game needs into builds. */
function hushData(): Plugin {
  let outDir = '';
  return {
    name: 'hush-data',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        for (const [prefix, dir] of Object.entries(MOUNTS)) {
          if (!url.startsWith(prefix)) continue;
          const file = normalize(join(dir, url.slice(prefix.length)));
          if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) break;
          res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(res);
          return;
        }
        next();
      });
    },
    closeBundle() {
      const copy = (from: string, to: string): void => {
        mkdirSync(dirname(to), { recursive: true });
        cpSync(from, to);
      };
      const assets = MOUNTS['/hush-assets/']!;
      const manifestPath = join(assets, 'manifest.json');
      if (existsSync(manifestPath)) {
        copy(manifestPath, join(outDir, 'hush-assets/manifest.json'));
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          images: Record<string, { picked: number; files: string[] }>;
          animations: Record<string, { sheet?: string; sheetJson?: string }>;
        };
        for (const image of Object.values(manifest.images)) {
          const file = image.files[image.picked - 1];
          if (file && existsSync(join(assets, file))) {
            copy(join(assets, file), join(outDir, 'hush-assets', file));
          }
        }
        const sheets = Object.values(manifest.animations).flatMap((a) => [a.sheet, a.sheetJson]);
        for (const file of sheets) {
          if (file && existsSync(join(assets, file))) {
            copy(join(assets, file), join(outDir, 'hush-assets', file));
          }
        }
      }
      const sessions = MOUNTS['/sessions/']!;
      for (const sub of ['', 'synthetic']) {
        const dir = join(sessions, sub);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
          copy(join(dir, name), join(outDir, 'sessions', sub, name));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [hushData()],
  server: { port: 5173, fs: { allow: [root] } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        signalTest: resolve(import.meta.dirname, 'signal-test.html'),
      },
    },
  },
});
