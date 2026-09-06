import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * 刻意保守：typescript-eslint 的 recommended（非 type-checked，快、假陽性少）
 * + eslint-config-prettier（把所有排版規則交給 Prettier）。
 * 目標是「一致 + 抓真正的問題」，不是重排既有程式碼。
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'public/mediapipe/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    rules: {
      // TS 自己會檢查未定義的識別字，no-undef 在 .ts 只會製造假陽性
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // 全形空白（U+3000）在中文字串／樣板／註解裡是刻意的排版，不是錯字
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipTemplates: true, skipComments: true, skipJSXText: true },
      ],
    },
  },

  // 瀏覽器端原始碼
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Node 端：檢查腳本與設定檔
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
