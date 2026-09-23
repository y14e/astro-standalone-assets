import type { AstroIntegration } from 'astro';
import { hmr } from './hmr';
import {
  type StandaloneAssetsPluginOptions as Options,
  standaloneAssetsPlugin as plugin,
} from './plugin';

export function standaloneAssets(options: Options): AstroIntegration {
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
