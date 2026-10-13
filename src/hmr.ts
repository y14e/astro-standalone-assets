export function hmr(): string {
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
                [...target.attributes].filter((a) => a.name !== attribute).map(({ name, value }) => injected.setAttribute(name, value));
                const { pathname, search, searchParams } = new URL(target.getAttribute(attribute) ?? '', location.origin);
                searchParams.set('t', Date.now().toString());
                injected.setAttribute(attribute, pathname + '?' + searchParams.toString());
                target.parentNode?.insertBefore(injected, target.nextSibling);
              } catch {}
            }
          });
        }
      }
    })();
  `;
}
