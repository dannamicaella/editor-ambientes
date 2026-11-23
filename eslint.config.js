import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  { ignores: ['dist/**', 'dist-pwa/**', '.npm-cache/**', '.tmp/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  { files: ['src/**/*.{js,vue}'], languageOptions: { globals: { ...globals.browser, __PWA__: 'readonly' } } },
  { files: ['src/**/*.worker.js', 'tools/sw-template.js'], languageOptions: { globals: globals.serviceworker } },
  { files: ['*.js', 'tests/**/*.js', 'tools/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['tests/**/*.spec.js'], languageOptions: { globals: globals.browser } },
]
