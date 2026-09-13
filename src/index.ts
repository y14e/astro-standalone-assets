/**
 * Standalone Assets Integration for Astro
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

          for (const s of settings) {
            const { attribute, element, eventName } = s;
            hot.on('standalone-assets:' + eventName, (data) => {
              for (const e of document.querySelectorAll(element + '[' + attribute + '^="/' + data.dir + '/"]')) {
                try {
                  const injected = document.createElement(element);
                  injected.addEventListener('load', () => e.remove());

                  [...e.attributes].filter((a) => a.name !== attribute).forEach((a) => {
                    const { name, value } = a;
                    injected.setAttribute(name, value);
                  });

                  const url = new URL(e.getAttribute(attribute) ?? '', location.origin);
                  const { pathname, search, searchParams } = url;
                  searchParams.set('t', Date.now().toString());
                  injected.setAttribute(attribute, pathname + search);
                  e.parentNode?.insertBefore(injected, e.nextSibling);
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
