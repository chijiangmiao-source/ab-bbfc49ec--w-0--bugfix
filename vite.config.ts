/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Purely browser-side build. No backend, no external calls.
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173 },
  test: {
    // Playwright specs live in test/e2e and must not be collected by vitest.
    include: ['src/**/*.{test,spec}.ts'],
    globals: true,
  },
});
