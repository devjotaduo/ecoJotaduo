import eslintJs from '@eslint/js';
import tseslint from 'typescript-eslint';

// Bibliotecas de infraestrutura que as camadas internas (domain/application)
// jamais podem enxergar — ver docs/architecture/component-view.md.
const infraLibs = [
  '@nestjs/*',
  'fastify',
  'drizzle-orm',
  'drizzle-orm/*',
  'ioredis',
  'bullmq',
  '@modelcontextprotocol/*',
  'react',
  'react-dom',
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  {
    // `.tsx` junto: sem isso o aplicativo web ficaria sem lint nenhum, que é
    // pior do que lint frouxo.
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      eslintJs.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        // Resolve o tsconfig do pacote a partir do cwd (turbo executa cada
        // script dentro do próprio pacote).
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Fronteira entre pacotes: só a superfície pública é importável.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ecojotaduo/*/src/*'],
              message:
                'Importe apenas os exports públicos do pacote (contracts/), nunca o interior src/**.',
            },
          ],
        },
      ],
    },
  },
  {
    // domain: puro. Não conhece framework, banco, transporte nem outras camadas.
    files: ['**/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...infraLibs, 'zod'],
              message:
                'A camada domain não pode depender de framework ou infraestrutura.',
            },
            {
              group: ['**/application/**', '**/adapters/**', '**/ports/**'],
              message:
                'A camada domain não importa application, ports nem adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    // application: orquestra domínio via ports. Nunca enxerga adapters/infra.
    files: ['**/src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: infraLibs.filter((lib) => lib !== '@nestjs/*'),
              message:
                'A camada application acessa infraestrutura apenas através de ports.',
            },
            {
              group: ['**/adapters/**'],
              message: 'A camada application não importa adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [eslintJs.configs.recommended],
  },
);
