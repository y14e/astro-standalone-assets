import type { AstroIntegration } from 'astro';
import { hmr } from './hmr';
import { standaloneAssetsPlugin as plugin } from './plugin';
import type { StandaloneAssetsPluginOptions as Options } from './types';

export function standaloneAssets(options: Partial<Options>): AstroIntegration {
  return {
    hooks: {
      'astro:config:setup': ({ command, injectScript, updateConfig }) => {
        updateConfig({ vite: { plugins: [plugin(options)] } });
        command === 'dev' && injectScript('page', hmr());
      },
    },
    name: 'standalone-assets',
  };
}

export type { Options as StandaloneAssetsPluginOptions };
