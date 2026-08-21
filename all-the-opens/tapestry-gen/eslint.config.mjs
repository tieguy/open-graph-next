// The linter is here for one job: catching wiring that does not resolve.
//
// A refactor moved a `return` into a helper that referenced two names it did
// not take as parameters. Every test passed — nothing exercises discover
// through to a rendered page — and every lede lost its extras. `no-undef`
// finds that in milliseconds, without a fixture and without the network.
//
// Deliberately NOT a style checker. There is no formatter in this tree and
// this file is not the place to introduce opinions about one; every rule below
// is about code that cannot do what it says.
import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', '.cache/**', 'demo/**', 'src/icons.js'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // An argument named for the reader — `(_, d) => …` in a replacer, the
      // `tag` a callback is handed — is documentation, not a leftover. Only
      // unused variables and imports are the smell this rule is kept for.
      //
      // `ignoreRestSiblings` keeps the omit idiom legal: in holder.js,
      // `const { _collection, ...picked } = h` names a field precisely so the
      // rest does not carry it. The name being unused IS the point.
      'no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      // Off, deliberately. It fires on `let rows = []` followed by a try/catch
      // whose catch always `continue`s — six sites, all correct, all reading
      // as a deliberate default rather than an oversight. Nothing it reports
      // here is code that cannot do what it says, which is the only thing this
      // config is for.
      'no-useless-assignment': 'off',
    },
  },
  {
    // Browser globals: the one script the page ships runs in a document.
    files: ['src/inline-script.js', 'src/client/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
]
