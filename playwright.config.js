import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

const windowsChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const executablePath = process.env.CHROME_PATH || (existsSync(windowsChrome) ? windowsChrome : undefined)
const port = 4177

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:' + port,
    launchOptions: { executablePath },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --mode pwa --host 127.0.0.1 --port ' + port + ' --strictPort',
    url: 'http://127.0.0.1:' + port,
    reuseExistingServer: false,
  },
})