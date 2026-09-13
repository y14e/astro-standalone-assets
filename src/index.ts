/**
 * Standalone Assets Integration for Astro
 *
 * @version 1.0.5
 * @author Yusuke Kamiyamane
 * @license MIT
 * @copyright Copyright (c) Yusuke Kamiyamane
 * @see {@link https://github.com/y14e/astro-standalone-assets}
 */

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

import type { AstroIntegration } from 'astro';
import {
  type StandaloneAssetsPluginOptions as Options,
  standaloneAssetsPlugin as plugin,
} from './vite-plugin';

// -----------------------------------------------------------------------------
// APIs
// -----------------------------------------------------------------------------

export function standaloneAssets(options: Options): AstroIntegration {
  function hmr(): string {
    return `
      (() => {
        const hot = import.meta.hot;

        if (hot) {
          const settings = [
            {
              attribute: 'src',
              element: 'script',
              eventName: 'script-update',
            },
            {
              attribute: 'href',
              element: 'link',
              eventName: 'stylesheet-update',
            },
          ];

          for (const setting of settings) {
            const { attribute, element, eventName } = setting;
            hot.on('standalone-assets:' + eventName, (data) => {
              for (const target of document.querySelectorAll(element + '[' + attribute + '^="/' + data.dir + '/"]')) {
                try {
                  const injected = document.createElement(setting.element);
                  injected.addEventListener('load', () => target.remove());

                  [...target.attributes].filter((a) => a.name !== attribute).forEach((attribute) => {
                    const { name, value } = attribute;
                    injected.setAttribute(name, value);
                  });

                  const url = new URL(target.getAttribute(attribute) ?? '', location.origin);
                  const { pathname, search, searchParams } = url;
                  searchParams.set('t', Date.now().toString());
                  injected.setAttribute(attribute, pathname + search);
                  target.parentNode?.insertBefore(injected, target.nextSibling);
                } catch {}
              }
            });
          }
        }
      })();
    `;
  }

  return {
    hooks: {
      'astro:config:setup': ({ command, updateConfig, injectScript }) => {
        updateConfig({
          vite: {
            plugins: [plugin(options)],
          },
        });
        command === 'dev' && injectScript('page', hmr());
      },
    },
    name: 'standalone-assets',
  };
}
