// @ts-check
import { defineConfig } from 'astro/config';
import { standaloneAssets } from './src';

// https://astro.build/config
export default defineConfig({
  integrations: [
    standaloneAssets({
      hash: 'embed',
      script: {
        distDir: 'assets/scripts',
        srcDir: 'scripts',
      },
      stylesheet: {
        distDir: 'assets/stylesheets',
        srcDir: 'stylesheets',
      },
    }),
  ],
});
