// @ts-check
import { defineConfig } from 'astro/config';
import { standaloneAssets } from './src';

// https://astro.build/config
export default defineConfig({
  integrations: [
    standaloneAssets({
      hash: 'embed',
      script: {
        outDir: 'assets/scripts',
        rootDir: 'src/scripts',
      },
      stylesheet: {
        outDir: 'assets/stylesheets',
        rootDir: 'src/stylesheets',
      },
    }),
  ],
});
