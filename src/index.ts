import type { AstroIntegration } from 'astro';
import {
  type StandaloneAssetsPluginOptions as Options,
  standaloneAssetsPlugin as plugin,
} from './plugin';

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
              for (const target of document.querySelectorAll(element + '[' + attribute + '^="/' + data.dir + '/"]')) {
                try {
                  const injected = document.createElement(element);
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
      'astro:config:setup': ({ command, injectScript, updateConfig }) => {
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
