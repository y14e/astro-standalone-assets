import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateBase36Hash } from '@y14e/basen';
import autoprefixer from 'autoprefixer';
import { build } from 'esbuild';
import { globSync } from 'glob';
import postcss from 'postcss';
import { compileAsync } from 'sass';
import type { Plugin } from 'vite';
import type { StandaloneAssetsPluginOptions as Options } from './types';

export function standaloneAssetsPlugin(options: Partial<Options>): Plugin {
  const virtualModuleId = 'virtual:standalone-assets';
  const resolvedVirtualModuleId = `\0${virtualModuleId}`;
  let bundleFiles: { fileName: string; source: string }[] = [];
  let bundleMap: Record<string, string> = {};
  let isBuild = false;

  if (
    !options.script?.outDir ||
    !options.script?.rootDir ||
    !options.stylesheet?.outDir ||
    !options.stylesheet?.rootDir
  ) {
    throw new Error('Invalid options. all dirs are required.');
  }

  const hash = options.hash?.toLowerCase() ?? 'none';
  const settings = {
    hash: ['embed', 'query'].includes(hash) ? hash : 'none',
    strategies: [
      {
        compile: (p: string) => compileScript(p),
        contentType: 'text/javascript',
        eventName: 'script-update',
        exts: ['.ts', '.js'],
        log: () => logger('script updated.', '94'),
        outDir: trim(options.script.outDir),
        outExt: '.js',
        rootDir: path.resolve(trim(options.script.rootDir)),
      },
      {
        compile: (p: string) => compileStylesheet(p),
        contentType: 'text/css',
        eventName: 'stylesheet-update',
        exts: ['.scss', '.css'],
        log: () => logger('stylesheet updated.', '35'),
        outDir: trim(options.stylesheet.outDir),
        outExt: '.css',
        rootDir: path.resolve(trim(options.stylesheet.rootDir)),
      },
    ],
  };

  async function compileScript(pathName: string): Promise<string> {
    return (
      (
        await build({
          bundle: true,
          entryPoints: [pathName],
          minify: isBuild,
          platform: 'browser',
          write: false,
        })
      ).outputFiles[0]?.text ?? ''
    );
  }

  async function compileStylesheet(pathName: string): Promise<string> {
    const result = await compileAsync(pathName, {
      sourceMap: !isBuild,
      sourceMapIncludeSources: !isBuild,
      style: isBuild ? 'compressed' : 'expanded',
    });
    const { css, sourceMap } = result;
    return (
      await postcss([autoprefixer()]).process(css, {
        from: pathName,
        map: isBuild ? false : { inline: true, prev: sourceMap ?? false },
      })
    ).css;
  }

  async function prepare(): Promise<void> {
    bundleFiles = [];
    bundleMap = {};

    for (const { compile, exts, outDir, outExt, rootDir } of settings.strategies) {
      for (const pathName of globSync(`**/[^_]*{${exts.join(',')}}`, {
        absolute: true,
        cwd: rootDir,
      })) {
        const relative = path.relative(rootDir, pathName);
        const withoutExt = path
          .join(outDir, relative.slice(0, -path.extname(relative).length))
          .replaceAll(path.sep, '/');
        const result = await compile(pathName);
        const hash = await generateHash(result);
        const rawPath = `${withoutExt}${outExt}`;
        const bundlePath = settings.hash === 'embed' ? `${withoutExt}.${hash}${outExt}` : rawPath;
        bundleFiles.push({ fileName: bundlePath, source: result });
        bundleMap[`/${rawPath}`] = `/${bundlePath + (settings.hash === 'query' ? `?${hash}` : '')}`;
      }
    }
  }

  async function generateHash(data: string | Uint8Array): Promise<string> {
    return await generateBase36Hash(data, 8);
  }

  function logger(message: string, colorCode: string): void {
    console.log(
      `\x1b[2m${new Date().toTimeString().slice(0, 8)}\x1b[0m \x1b[${colorCode}m[asset]\x1b[0m ${message}`,
    );
  }

  function trim(string: string): string {
    return string.replace(/^\/+|\/+$/g, '');
  }

  function within(pathName: string, parent: string): boolean {
    const relative = path.relative(parent, pathName);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }

  return {
    async buildStart() {
      isBuild && (await prepare());
    },
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    async configureServer(server) {
      const strategies = settings.strategies;
      const watcher = server.watcher;
      const hashes = new Map<string, string>();

      for (const { exts, rootDir } of strategies) {
        watcher.add(rootDir);

        for (const pathName of globSync(`**/*{${exts.join(',')}}`, {
          absolute: true,
          cwd: rootDir,
        })) {
          hashes.set(pathName, await generateHash(fs.readFileSync(pathName)));
        }
      }

      let timer: ReturnType<typeof setTimeout> | undefined;

      watcher.on('change', async (pathName) => {
        const hash = await generateHash(fs.readFileSync(pathName));

        if (hash === hashes.get(pathName)) {
          return;
        }

        hashes.set(pathName, hash);

        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }

        timer = setTimeout(async () => {
          for (const { eventName, log, outDir, rootDir } of strategies) {
            if (!within(pathName, rootDir)) {
              continue;
            }

            log();
            server.ws.send({
              data: { dir: outDir },
              event: `standalone-assets:${eventName}`,
              type: 'custom',
            });
          }
        }, 100);
      });

      server.middlewares.use(async (req, res, next) => {
        const pathName = req.url?.split('?')[0];

        if (!pathName) {
          return next();
        }

        for (let { compile, contentType, exts, outExt, outDir, rootDir } of settings.strategies) {
          outDir = `/${outDir}/`;

          if (!pathName.startsWith(outDir) || !pathName.endsWith(outExt)) {
            continue;
          }

          const name = pathName.slice(outDir.length, -outExt.length);
          let target: string | null = null;

          for (const ext of exts) {
            const candidate = path.resolve(rootDir, `${name}${ext}`);

            if (fs.existsSync(candidate)) {
              target = candidate;
              break;
            }
          }

          if (!target) {
            continue;
          }

          try {
            const result = await compile(target);
            res.setHeader('Content-Type', contentType).end(result);
            return;
          } catch (error) {
            error instanceof Error && console.error(error.message);
            return next();
          }
        }

        next();
      });
    },
    generateBundle() {
      bundleFiles.map(({ fileName, source }) => this.emitFile({ fileName, source, type: 'asset' }));
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `
          export function asset(pathName) {
            return ${isBuild ? JSON.stringify(bundleMap) : '{}'}[pathName] ?? pathName;
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
