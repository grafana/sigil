import type { Configuration } from 'webpack';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  return {
    ...baseConfig,
    resolve: {
      ...baseConfig.resolve,
      // Extend webpack's built-in conditionNames with 'import' so
      // package.json "exports" field resolution works for dynamic imports
      // of gpt-tokenizer encoding sub-paths.
      conditionNames: [...(baseConfig.resolve?.conditionNames ?? []), 'import', 'module', 'require', 'default'],
    },
  };
};

export default config;
