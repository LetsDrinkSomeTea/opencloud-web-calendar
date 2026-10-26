// Configuration for `vue-gettext-extract` and `vue-gettext-compile` (see the l10n scripts in package.json).
// `potPath` and `jsonPath` are relative to `output.path`.
module.exports = {
  input: {
    path: './src',
    include: ['**/*.js', '**/*.ts', '**/*.vue']
  },
  output: {
    // To add a language, list it here and run `pnpm l10n:extract` to create its .po file
    locales: ['de'],
    path: './l10n/locale',
    potPath: '../template.pot',
    jsonPath: '../translations.json',
    flat: false,
    linguas: false
  }
}
