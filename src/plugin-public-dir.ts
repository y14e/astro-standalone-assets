import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as p from 'node:path';
import autoprefixer from 'autoprefixer';
import { build } from 'esbuild';
import { globSync } from 'glob';
import postcss from 'postcss';
import { compileAsync } from 'sass';
import type { Plugin } from 'vite';

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

export function standaloneAssetsPlugin(
  options: StandaloneAssetsPluginOptions,
): Plugin {
  const virtualModuleId = 'virtual:standalone-assets';
  const resolvedVirtualModuleId = `\0${virtualModuleId}`;
  let bundleFiles: { fileName: string; source: string }[] = [];
  let bundleMap: Record<string, string> = {};
  const devFiles = new Set<string>();
  const devCache = p.resolve('.cache/standalone-assets.json');
  let isBuild = false;

  if (
    !options.script?.outDir ||
    !options.script?.rootDir ||
    !options.stylesheet?.outDir ||
    !options.stylesheet?.rootDir
  ) {
    throw new Error(
      'Invalid options: script.outDir, script.rootDir, stylesheet.outDir, and stylesheet.rootDir are required.',
    );
  }

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
        log: () => logger('script updated.', '94'),
        outDir: trim(options.script.outDir),
        outExt: '.js',
        rootDir: p.resolve(trim(options.script.rootDir)),
      },
      {
        compile: (p: string) => compileStylesheet(p),
        eventName: 'stylesheet-update',
        exts: ['.scss', '.css'],
        log: () => logger('stylesheet updated.', '35'),
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
      const { compile, outDir, outExt, rootDir } = s;

      if (!within(path, rootDir)) {
        continue;
      }

      const relative = p.relative(rootDir, path);
      const dest = p.resolve(
        'public',
        outDir,
        `${relative.slice(0, -p.extname(relative).length)}${outExt}`,
      );

      try {
        const result = await compile(path);
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
        for (const file of JSON.parse(fs.readFileSync(devCache, 'utf-8'))) {
          if (!fs.existsSync(file)) {
            continue;
          }

          fs.rmSync(file, { force: true });
          const public_ = p.resolve('public');

          for (
            let current = p.dirname(file);
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
        }
      } catch {}

      fs.rmSync(devCache, { force: true });
    }

    devFiles.clear();

    for (const s of settings.strategies) {
      const { compile, exts, outDir, outExt, rootDir } = s;

      for (const path of globSync(`**/[^_]*{${exts.join(',')}}`, {
        absolute: true,
        cwd: rootDir,
      })) {
        const relative = p.relative(rootDir, path);
        const withoutExt = p
          .join(outDir, relative.slice(0, -p.extname(relative).length))
          .replaceAll(p.sep, '/');
        const result = await compile(path);
        const hash = generateHash(result);
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
      const { exts, rootDir } = s;
      globSync(`**/[^_]*{${exts.join(',')}}`, {
        absolute: true,
        cwd: rootDir,
      }).map(emit);
    }
  }

  function generateHash(data: string | Uint8Array): string {
    return generateBase36Hash(data, 8);
  }

  function logger(message: string, colorCode: string) {
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
      const strategies = settings.strategies;
      const watcher = server.watcher;
      const hashes = new Map<string, string>();

      for (const s of strategies) {
        const { exts, rootDir } = s;
        watcher.add(rootDir);

        for (const path of globSync(`**/*{${exts.join(',')}}`, {
          absolute: true,
          cwd: rootDir,
        })) {
          hashes.set(path, generateHash(fs.readFileSync(path)));
        }
      }

      let timer: ReturnType<typeof setTimeout> | undefined;

      watcher.on('change', (path) => {
        const hash = generateHash(fs.readFileSync(path));

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
            const { eventName, exts, log, outDir, rootDir } = s;

            if (!within(path, rootDir)) {
              continue;
            }

            log();

            if (path.split(/[\\/]/).pop()?.startsWith('_')) {
              globSync(`**/[^_]*{${exts.join(',')}}`, {
                absolute: true,
                cwd: rootDir,
              }).map(emit);
            } else {
              await emit(path);
            }

            server.ws.send({
              data: { dir: outDir },
              event: `standalone-assets:${eventName}`,
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

const BASE36_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function generateBase36Hash(data: string | Uint8Array, length: number): string {
  const chars: string[] = [];
  let n = BigInt(`0x${createHash('sha512').update(data).digest('hex')}`);

  while (chars.length < length) {
    chars.unshift(BASE36_ALPHABET[Number(n % 36n)] ?? '');
    n /= 36n;
  }

  return chars.join('');
}
