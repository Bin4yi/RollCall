import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;
const API_PORT = 8799;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: 'list',
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node --import tsx ../api/src/server.ts',
      url: `http://localhost:${API_PORT}/api/config`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: ':memory:',
        COACH_PASSPHRASE: 'e2e-pass',
        SESSION_SECRET: 'e2e-secret',
        // Tests must never spend credit, whatever is in .env.
        SMARTSPECTRA_API_KEY: '',
        OPENAI_API_KEY: '',
      },
    },
    {
      command: `pnpm exec vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PORT: String(API_PORT) },
    },
  ],
});
