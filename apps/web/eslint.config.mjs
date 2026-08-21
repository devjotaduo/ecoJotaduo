import base from '@ecojotaduo/eslint-config';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Regras do repositório mais as Rules of Hooks.
 *
 * Hook chamado condicionalmente ou dependência esquecida não são erro de
 * tipo: são bug de runtime silencioso, com estado velho na tela. É o tipo de
 * coisa que só o plugin pega.
 */
export default [
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
