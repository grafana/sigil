import type { Configuration } from 'webpack';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  return {
    ...baseConfig,
    resolve: {
      ...baseConfig.resolve,
      // Enable package.json "exports" field resolution so dynamic imports
      // of gpt-tokenizer encoding sub-paths resolve correctly.
      conditionNames: ['import', 'module', 'require', 'default'],
    },
  };
};

export default config;
