import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit, property and component test runner (Requirement 1 AC8, AC12).
// `vitest run` performs a single execution without entering watch mode.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    css: false,
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    reporters: ['default'],
  },
})
