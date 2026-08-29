/**
 * Standalone Assets Plugin for Vite (Uses the 'public' Directory)
 * A Vite plugin to compile and bundle standalone script and stylesheet assets
 * into specified output directories.
 *
 * @version 1.0.0
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
import * as p from 'node:path';
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
  let bundleFiles: { path: string; source: string }[] = [];
  let bundleMap: Record<string, string> = {};
  const devFiles = new Set<string>();
  const devCache = p.resolve('.cache/standalone-assets.json');
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
        compile: (path: string) => compileScript(path),
        eventName: 'script-update',
        exts: ['.ts', '.js'],
        log: () => log_('script updated.', '94'),
        outDir: trim(options.script.outDir),
        outExt: '.js',
        rootDir: p.resolve(trim(options.script.rootDir)),
      },
      {
        compile: (path: string) => compileStylesheet(path),
        eventName: 'stylesheet-update',
        exts: ['.scss', '.css'],
        log: () => log_('stylesheet updated.', '35'),
        outDir: trim(options.stylesheet.outDir),
        outExt: '.css',
        rootDir: p.resolve(trim(options.stylesheet.rootDir)),
      },
    ],
  };

  async function compileScript(path: string): Promise<string> {
    return (
      await build({
        bundle: true,
        entryPoints: [path],
        minify: isBuild,
        platform: 'browser',
        write: false,
      })
    ).outputFiles[0].text;
  }

  async function compileStylesheet(path: string): Promise<string> {
    const result = await compileAsync(path, {
      sourceMap: !isBuild,
      style: isBuild ? 'compressed' : 'expanded',
    });
    return (
      await postcss([autoprefixer()]).process(result.css, {
        from: path,
        map: isBuild ? false : { inline: true, prev: result.sourceMap },
      })
    ).css;
  }

  async function emit(path: string) {
    for (const s of settings.strategies) {
      const rootDir = s.rootDir;

      if (!within(path, rootDir)) {
        continue;
      }

      const relative = p.relative(rootDir, path);
      const dest = p.resolve(
        'public',
        s.outDir,
        `${relative.slice(0, -p.extname(relative).length)}${s.outExt}`,
      );

      try {
        const result = await s.compile(path);
        fs.mkdirSync(p.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, result);
        devFiles.add(dest);
        fs.mkdirSync(p.dirname(devCache), { recursive: true });
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
        JSON.parse(fs.readFileSync(devCache, 'utf-8')).forEach((f: string) => {
          if (!fs.existsSync(f)) {
            return;
          }

          fs.rmSync(f, { force: true });
          const public_ = p.resolve('public');

          for (
            let current = p.dirname(f);
            current.startsWith(public_) &&
            current !== public_ &&
            fs.existsSync(current) &&
            !fs.readdirSync(current).length;
            current = p.dirname(current)
          ) {
            try {
              fs.rmdirSync(current);
            } catch {
              break;
            }
          }
        });
      } catch {}

      fs.rmSync(devCache, { force: true });
    }

    devFiles.clear();

    settings.strategies.forEach((s) => {
      const rootDir = s.rootDir;

      globSync(`**/[^_]*{${s.exts.join(',')}}`, {
        absolute: true,
        cwd: rootDir,
      }).forEach(async (path) => {
        const relative = p.relative(rootDir, path);
        const withoutExt = p
          .join(s.outDir, relative.slice(0, -p.extname(relative).length))
          .replaceAll(p.sep, '/');
        const result = await s.compile(path);
        const outExt = s.outExt;
        const hash = createHash('sha256')
          .update(result)
          .digest('hex')
          .slice(0, 8);
        const rawPath = `${withoutExt}${outExt}`;
        const bundlePath =
          settings.hash === 'embed'
            ? `${withoutExt}.${hash}${outExt}`
            : rawPath;
        bundleFiles.push({ path: bundlePath, source: result });
        bundleMap[`/${rawPath}`] =
          `/${bundlePath + (settings.hash === 'query' ? `?${hash}` : '')}`;
      });
    });
  }

  async function prepareDev(): Promise<void> {
    devFiles.clear();

    settings.strategies.forEach(async (s) => {
      globSync(`**/[^_]*{${s.exts.join(',')}}`, {
        absolute: true,
        cwd: s.rootDir,
      }).forEach(async (path) => {
        await emit(path);
      });
    });
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
    const relative = p.relative(parent, path);
    return (
      relative !== '..' &&
      !relative.startsWith(`..${p.sep}`) &&
      !p.isAbsolute(relative)
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
      const watcher = server.watcher;
      const strategies = Object.values(settings.strategies);
      watcher.add(strategies.map((s) => s.rootDir));
      let timer: NodeJS.Timeout | undefined;

      watcher.on('change', async (path) => {
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
              }).forEach(async (p) => {
                await emit(p);
              });
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
      bundleFiles.forEach(({ path, source }) => {
        this.emitFile({ fileName: path, source, type: 'asset' });
      });
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
