import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
    rules: {
      'no-constant-binary-expression': 'error',
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-sparse-arrays': 'error',
      'no-unreachable': 'error',
    },
  },
];
