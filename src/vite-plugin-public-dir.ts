/**
 * Standalone Assets Plugin for Vite (Uses the 'public' Directory)
 *
 * @version 1.0.4
 * @author Yusuke Kamiyamane
 * @license MIT
 * @copyright Copyright (c) Yusuke Kamiyamane
 * @see {@link https://github.com/y14e/astro-standalone-assets}
 */

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as np from 'node:path';
import autoprefixer from 'autoprefixer';
import { build } from 'esbuild';
import { globSync } from 'glob';
import postcss from 'postcss';
import { compileAsync } from 'sass';
import type { Plugin } from 'vite';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface StandaloneAssetsPluginOptions {
  hash?: 'embed' | 'query';
  script: {
    outDir: string;
    rootDir: string;
  };
  stylesheet: {
    outDir: string;
    rootDir: string;
  };
}

// -----------------------------------------------------------------------------
// APIs
// -----------------------------------------------------------------------------

export function standaloneAssetsPlugin(
  options: StandaloneAssetsPluginOptions,
): Plugin {
  const virtualModuleId = 'virtual:standalone-assets';
  const resolvedVirtualModuleId = `\0${virtualModuleId}`;
  let bundleFiles: { fileName: string; source: string }[] = [];
  let bundleMap: Record<string, string> = {};
  const devFiles = new Set<string>();
  const devCache = np.resolve('.cache/standalone-assets.json');
  let isBuild = false;

  const settings = {
    hash:
      options.hash === 'embed'
        ? 'embed'
        : options.hash === 'query'
          ? 'query'
          : 'none',
    strategies: [
      {
        compile: (p: string) => compileScript(p),
        eventName: 'script-update',
        exts: ['.ts', '.js'],
        log: () => log_('script updated.', '94'),
        outDir: trim(options.script.outDir),
        outExt: '.js',
        rootDir: np.resolve(trim(options.script.rootDir)),
      },
      {
        compile: (p: string) => compileStylesheet(p),
        eventName: 'stylesheet-update',
        exts: ['.scss', '.css'],
        log: () => log_('stylesheet updated.', '35'),
        outDir: trim(options.stylesheet.outDir),
        outExt: '.css',
        rootDir: np.resolve(trim(options.stylesheet.rootDir)),
      },
    ],
  };

  async function compileScript(path: string): Promise<string> {
    return (
      (
        await build({
          bundle: true,
          entryPoints: [path],
          minify: isBuild,
          platform: 'browser',
          write: false,
        })
      ).outputFiles[0]?.text ?? ''
    );
  }

  async function compileStylesheet(path: string): Promise<string> {
    const result = await compileAsync(path, {
      sourceMap: !isBuild,
      style: isBuild ? 'compressed' : 'expanded',
    });
    return (
      await postcss([autoprefixer()]).process(result.css, {
        from: path,
        map: isBuild
          ? false
          : { inline: true, prev: result.sourceMap ?? false },
      })
    ).css;
  }

  async function emit(path: string) {
    for (const s of settings.strategies) {
      const rootDir = s.rootDir;

      if (!within(path, rootDir)) {
        continue;
      }

      const relative = np.relative(rootDir, path);
      const dest = np.resolve(
        'public',
        s.outDir,
        `${relative.slice(0, -np.extname(relative).length)}${s.outExt}`,
      );

      try {
        const result = await s.compile(path);
        fs.mkdirSync(np.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, result);
        devFiles.add(dest);
        fs.mkdirSync(np.dirname(devCache), { recursive: true });
        fs.writeFileSync(devCache, JSON.stringify([...devFiles]));
      } catch (error: unknown) {
        error instanceof Error && console.error(error.message);
      }
    }
  }

  async function prepareBuild(): Promise<void> {
    bundleFiles = [];
    bundleMap = {};

    if (fs.existsSync(devCache)) {
      try {
        for (const f of JSON.parse(fs.readFileSync(devCache, 'utf-8'))) {
          if (!fs.existsSync(f)) {
            continue;
          }

          fs.rmSync(f, { force: true });
          const public_ = np.resolve('public');

          for (
            let current = np.dirname(f);
            current.startsWith(public_) &&
            current !== public_ &&
            fs.existsSync(current) &&
            !fs.readdirSync(current).length;
            current = np.dirname(current)
          ) {
            try {
              fs.rmdirSync(current);
            } catch {
              break;
            }
          }
        }
      } catch {}

      fs.rmSync(devCache, { force: true });
    }

    devFiles.clear();

    for (const s of settings.strategies) {
      const rootDir = s.rootDir;

      for (const p of globSync(`**/[^_]*{${s.exts.join(',')}}`, {
        absolute: true,
        cwd: rootDir,
      })) {
        const relative = np.relative(rootDir, p);
        const withoutExt = np
          .join(s.outDir, relative.slice(0, -np.extname(relative).length))
          .replaceAll(np.sep, '/');
        const result = await s.compile(p);
        const outExt = s.outExt;
        const hash = hash_(result);
        const rawPath = `${withoutExt}${outExt}`;
        const bundlePath =
          settings.hash === 'embed'
            ? `${withoutExt}.${hash}${outExt}`
            : rawPath;
        bundleFiles.push({ fileName: bundlePath, source: result });
        bundleMap[`/${rawPath}`] =
          `/${bundlePath + (settings.hash === 'query' ? `?${hash}` : '')}`;
      }
    }
  }

  async function prepareDev(): Promise<void> {
    devFiles.clear();

    for (const s of settings.strategies) {
      globSync(`**/[^_]*{${s.exts.join(',')}}`, {
        absolute: true,
        cwd: s.rootDir,
      }).map(emit);
    }
  }

  function hash_(data: string | Buffer): string {
    return generateBase36Hash(data, 8);
  }

  function log_(message: string, colorCode: string) {
    console.log(
      `\x1b[2m${new Date().toTimeString().slice(0, 8)}\x1b[0m \x1b[${colorCode}m[asset]\x1b[0m ${message}`,
    );
  }

  function trim(string: string) {
    return string.replace(/^\/+|\/+$/g, '');
  }

  function within(path: string, parent: string) {
    const relative = np.relative(parent, path);
    return (
      relative !== '..' &&
      !relative.startsWith(`..${np.sep}`) &&
      !np.isAbsolute(relative)
    );
  }

  return {
    async buildStart() {
      isBuild ? await prepareBuild() : await prepareDev();
    },
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    configureServer(server) {
      const strategies = settings.strategies;
      const watcher = server.watcher;
      const hashes = new Map<string, string>();

      for (const s of strategies) {
        watcher.add(s.rootDir);

        for (const p of globSync(`**/*{${s.exts.join(',')}}`, {
          absolute: true,
          cwd: s.rootDir,
        })) {
          hashes.set(p, hash_(fs.readFileSync(p)));
        }
      }

      let timer: ReturnType<typeof setTimeout> | undefined;

      watcher.on('change', (path) => {
        const hash = hash_(fs.readFileSync(path));

        if (hashes.get(path) === hash) {
          return;
        }

        hashes.set(path, hash);

        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }

        timer = setTimeout(async () => {
          for (const s of strategies) {
            const rootDir = s.rootDir;

            if (!within(path, rootDir)) {
              continue;
            }

            s.log();

            if (path.split(/[\\/]/).pop()?.startsWith('_')) {
              globSync(`**/[^_]*{${s.exts.join(',')}}`, {
                absolute: true,
                cwd: rootDir,
              }).map(emit);
            } else {
              await emit(path);
            }

            server.ws.send({
              data: { dir: s.outDir },
              event: `standalone-assets:${s.eventName}`,
              type: 'custom',
            });
          }
        }, 100);
      });
    },
    generateBundle() {
      for (const { fileName, source } of bundleFiles) {
        this.emitFile({ fileName, source, type: 'asset' });
      }
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `
          export function asset(path) {
            return ${isBuild ? JSON.stringify(bundleMap) : '{}'}[path] ?? path;
          }
        `;
      }
    },
    name: 'standalone-assets-plugin',
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },
  };
}

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------

const BASE36_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function generateBase36Hash(data: string | Buffer, length: number): string {
  let result = '';
  let n = BigInt(`0x${createHash('sha256').update(data).digest('hex')}`);

  while (result.length < length) {
    result = BASE36_ALPHABET[Number(n % 36n)] + result;
    n /= 36n;
  }

  return result;
}
