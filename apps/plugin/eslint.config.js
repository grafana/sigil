const path = require('node:path');
const { fixupConfigRules, includeIgnoreFile } = require('@eslint/compat');
const grafanaConfig = require('@grafana/eslint-config/flat');
const storybook = require('eslint-plugin-storybook');

const tsconfigRootDir = __dirname;
const gitignorePath = path.join(__dirname, '.gitignore');

/** @type {Array<import('eslint').Linter.Config>} */
module.exports = [
  includeIgnoreFile(gitignorePath),
  ...fixupConfigRules(grafanaConfig),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      'react/prop-types': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir,
      },
    },
  },
  {
    files: ['tests/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  ...storybook.configs['flat/recommended'],
];
