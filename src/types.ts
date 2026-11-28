export interface StandaloneAssetsPluginOptions {
  hash: 'embed' | 'query';
  script: {
    distDir: string;
    srcDir: string;
  };
  stylesheet: {
    distDir: string;
    srcDir: string;
  };
}
