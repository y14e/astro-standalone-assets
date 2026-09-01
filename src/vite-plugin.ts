/**
 * Standalone Assets Plugin for Vite
 *
 * @version 1.0.1
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
        contentType: 'text/javascript',
        eventName: 'script-update',
        exts: ['.ts', '.js'],
        log: () => log_('script updated.', '94'),
        outDir: trim(options.script.outDir),
        outExt: '.js',
        rootDir: p.resolve(trim(options.script.rootDir)),
      },
      {
        compile: (path: string) => compileStylesheet(path),
        contentType: 'text/css',
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
      sourceMapIncludeSources: !isBuild,
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

  async function prepare(): Promise<void> {
    bundleFiles = [];
    bundleMap = {};

    settings.strategies.forEach(async (s) => {
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
        const hash = hash_(result);
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

  function hash_(data: string | Buffer): string {
    return generateBase36Hash(data);
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
      isBuild && (await prepare());
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

        for (const path of globSync(`**/*{${s.exts.join(',')}}`, {
          absolute: true,
          cwd: s.rootDir,
        })) {
          hashes.set(path, hash_(fs.readFileSync(path)));
        }
      }

      let timer: NodeJS.Timeout | undefined;

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
            if (!within(path, s.rootDir)) {
              continue;
            }

            s.log();

            server.ws.send({
              data: { dir: s.outDir },
              event: `standalone-assets:${s.eventName}`,
              type: 'custom',
            });
          }
        }, 100);
      });

      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];

        if (!path) {
          return next();
        }

        for (const s of settings.strategies) {
          const outDir = `/${s.outDir}/`;
          const outExt = s.outExt;

          if (!path.startsWith(outDir) || !path.endsWith(outExt)) {
            continue;
          }

          const name = path.slice(outDir.length, -outExt.length);
          let target: string | null = null;

          for (const ext of s.exts) {
            const candidate = p.resolve(s.rootDir, `${name}${ext}`);

            if (fs.existsSync(candidate)) {
              target = candidate;
              break;
            }
          }

          if (!target) {
            continue;
          }

          try {
            const result = await s.compile(target);
            res.setHeader('Content-Type', s.contentType).end(result);
            return;
          } catch (error: unknown) {
            error instanceof Error && console.error(error);
            return next();
          }
        }

        next();
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

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------

const BASE36_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

function generateBase36Hash(data: string | Buffer, length = 8): string {
  let result = '';
  let n = BigInt(`0x${createHash('sha256').update(data).digest('hex')}`);

  while (result.length < length) {
    result = BASE36_CHARS[Number(n % 36n)] + result;
    n /= 36n;
  }

  return result;
}
