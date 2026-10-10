export interface StandaloneAssetsPluginOptions {
  hash: 'embed' | 'query';
  script: {
    outDir: string;
    rootDir: string;
  };
  stylesheet: {
    outDir: string;
    rootDir: string;
  };
}
