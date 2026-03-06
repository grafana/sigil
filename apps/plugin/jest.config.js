process.env.TZ = 'UTC';

const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');
const path = require('path');

module.exports = {
  ...require('./.config/jest.config'),
  moduleNameMapper: {
    ...require('./.config/jest.config').moduleNameMapper,
    '\\.svg$': path.resolve(__dirname, '.config/jest/mocks/svgAssetMock.js'),
  },
  testEnvironmentOptions: {
    url: 'http://localhost:3000',
  },
  transformIgnorePatterns: [nodeModulesToTransform([...grafanaESModules])],
};
