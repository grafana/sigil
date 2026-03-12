import path from 'path';
import type { Configuration, WebpackPluginInstance } from 'webpack';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const filterPlugins = (
  plugins: Configuration['plugins'],
  disableTypecheck: boolean,
  disableLint: boolean
): WebpackPluginInstance[] => {
  if (!plugins) {
    return [];
  }

  return plugins.filter((plugin): plugin is WebpackPluginInstance => {
    if (!plugin) {
      return false;
    }

    const pluginName = plugin.constructor?.name;
    if (disableTypecheck && pluginName === 'ForkTsCheckerWebpackPlugin') {
      return false;
    }

    if (disableLint && pluginName === 'ESLintWebpackPlugin') {
      return false;
    }

    return true;
  });
};

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  const isDevelopment = Boolean(env.development);

  if (isDevelopment) {
    const disableTypecheck = process.env.WEBPACK_TYPE_CHECK === 'false';
    const disableLint = process.env.WEBPACK_LINT === 'false';

    if (disableTypecheck || disableLint) {
      baseConfig.plugins = filterPlugins(baseConfig.plugins, disableTypecheck, disableLint);
    }
  }

  if (baseConfig.cache && typeof baseConfig.cache === 'object') {
    const cacheWithDeps = baseConfig.cache as { buildDependencies?: { config?: string[] } };
    cacheWithDeps.buildDependencies = {
      ...cacheWithDeps.buildDependencies,
      config: [...(cacheWithDeps.buildDependencies?.config ?? []), path.resolve(process.cwd(), 'webpack.config.ts')],
    };
  }

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
