module.exports = {
  root: true,
  extends: '@react-native',
  // Generated and vendored output is not source. Linting it produced most of
  // the noise that made `pnpm lint` useless to read.
  ignorePatterns: [
    'coverage/',
    'android/',
    'ios/',
    '.expo/',
    'dist/',
    'node_modules/',
  ],
  overrides: [
    {
      files: ['__tests__/**/*', 'jest-setup.js', 'jest.config.js'],
      env: { jest: true, node: true },
    },
    {
      files: ['babel.config.js', 'metro.config.js', '.eslintrc.js', '.prettierrc.js'],
      env: { node: true },
    },
  ],
};
