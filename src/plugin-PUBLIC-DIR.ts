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
  const devFiles = new Set<string>();
  const devCache = path.resolve('.cache/standalone-assets.json');
  let isBuild = false;

  if (
    !options.script?.distDir ||
    !options.script?.srcDir ||
    !options.stylesheet?.distDir ||
    !options.stylesheet?.srcDir
  ) {
    throw new Error('Invalid options. All dirs are required.');
  }

  const hash = options.hash?.toLowerCase() ?? 'none';
  const settings = {
    hash: ['embed', 'query'].includes(hash) ? hash : 'none',
    strategies: [
      {
        compile: (p: string) => compileScript(p),
        distDir: trim(options.script.distDir),
        distExt: '.js',
        eventName: 'script-update',
        exts: ['.ts', '.js'],
        log: () => logger('script updated.', '94'),
        srcDir: path.resolve('src', trim(options.script.srcDir)),
      },
      {
        compile: (p: string) => compileStylesheet(p),
        distDir: trim(options.stylesheet.distDir),
        distExt: '.css',
        eventName: 'stylesheet-update',
        exts: ['.scss', '.css'],
        log: () => logger('stylesheet updated.', '35'),
        srcDir: path.resolve('src', trim(options.stylesheet.srcDir)),
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
      style: isBuild ? 'compressed' : 'expanded',
    });
    return (
      await postcss([autoprefixer()]).process(result.css, {
        from: pathName,
        map: isBuild ? false : { inline: true, prev: result.sourceMap ?? false },
      })
    ).css;
  }

  async function emit(pathName: string): Promise<void> {
    for (const { compile, distDir, distExt, srcDir } of settings.strategies) {
      if (!within(pathName, srcDir)) {
        continue;
      }

      const relative = path.relative(srcDir, pathName);
      const dest = path.resolve(
        'public',
        distDir,
        `${relative.slice(0, -path.extname(relative).length)}${distExt}`,
      );

      try {
        const result = await compile(pathName);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, result);
        devFiles.add(dest);
        fs.mkdirSync(path.dirname(devCache), { recursive: true });
        fs.writeFileSync(devCache, JSON.stringify([...devFiles]));
      } catch (error) {
        error instanceof Error && console.error(error.message);
      }
    }
  }

  async function prepareBuild(): Promise<void> {
    bundleFiles = [];
    bundleMap = {};

    if (fs.existsSync(devCache)) {
      try {
        for (const file of JSON.parse(fs.readFileSync(devCache, 'utf-8'))) {
          if (!fs.existsSync(file)) {
            continue;
          }

          fs.rmSync(file, { force: true });
          const publicDir = path.resolve('public');

          for (
            let current = path.dirname(file);
            current.startsWith(publicDir) &&
            current !== publicDir &&
            fs.existsSync(current) &&
            !fs.readdirSync(current).length;
            current = path.dirname(current)
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

    for (const { compile, distDir, distExt, exts, srcDir } of settings.strategies) {
      for (const pathName of globSync(`**/[^_]*{${exts.join(',')}}`, {
        absolute: true,
        cwd: srcDir,
      })) {
        const relative = path.relative(srcDir, pathName);
        const withoutExt = path
          .join(distDir, relative.slice(0, -path.extname(relative).length))
          .replaceAll(path.sep, '/');
        const result = await compile(pathName);
        const hash = await generateHash(result);
        const rawPath = `${withoutExt}${distExt}`;
        const bundlePath = settings.hash === 'embed' ? `${withoutExt}.${hash}${distExt}` : rawPath;
        bundleFiles.push({ fileName: bundlePath, source: result });
        bundleMap[`/${rawPath}`] = `/${bundlePath + (settings.hash === 'query' ? `?${hash}` : '')}`;
      }
    }
  }

  async function prepareDev(): Promise<void> {
    devFiles.clear();

    for (const { exts, srcDir } of settings.strategies) {
      globSync(`**/[^_]*{${exts.join(',')}}`, {
        absolute: true,
        cwd: srcDir,
      }).map(emit);
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
      isBuild ? await prepareBuild() : await prepareDev();
    },
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    async configureServer(server) {
      const strategies = settings.strategies;
      const watcher = server.watcher;
      const hashes = new Map<string, string>();

      for (const { exts, srcDir } of strategies) {
        watcher.add(srcDir);

        for (const pathName of globSync(`**/*{${exts.join(',')}}`, {
          absolute: true,
          cwd: srcDir,
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
          for (const { distDir, eventName, exts, log, srcDir } of strategies) {
            if (!within(pathName, srcDir)) {
              continue;
            }

            log();

            if (pathName.split(/[\\/]/).pop()?.startsWith('_')) {
              globSync(`**/[^_]*{${exts.join(',')}}`, {
                absolute: true,
                cwd: srcDir,
              }).map(emit);
            } else {
              await emit(pathName);
            }

            server.ws.send({
              data: { dir: distDir },
              event: `standalone-assets:${eventName}`,
              type: 'custom',
            });
          }
        }, 100);
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
