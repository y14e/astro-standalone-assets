/**
 * Standalone Assets Integration for Astro
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

import type { AstroIntegration } from 'astro';
import {
  standaloneAssetsPlugin as plugin,
  type StandaloneAssetsPluginOptions,
} from './vite-plugin';

// -----------------------------------------------------------------------------
// APIs
// -----------------------------------------------------------------------------

export function standaloneAssets(
  options: StandaloneAssetsPluginOptions,
): AstroIntegration {
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

          settings.forEach((s) => {
            hot.on('standalone-assets:' + s.eventName, (data) => {
              document.querySelectorAll(s.element + '[' + s.attribute + '^="/' + data.dir + '/"]').forEach((target) => {
                try {
                  const injected = document.createElement(s.element);
                  injected.addEventListener('load', () => target.remove());

                  [...target.attributes].filter((attribute) => attribute.name !== s.attribute).forEach((attribute) => {
                    injected.setAttribute(attribute.name, attribute.value);
                  });

                  const url = new URL(target.getAttribute(s.attribute) ?? '', location.origin);
                  url.searchParams.set('t', Date.now().toString());
                  injected.setAttribute(s.attribute, url.pathname + url.search);
                  target.parentNode?.insertBefore(injected, target.nextSibling);
                } catch {}
              });
            });
          });
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
