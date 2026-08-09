import { defineConfig } from 'vitest/config';

// Tests cover src/core only — pure TypeScript, no DOM and no JSX, so this config
// deliberately carries no plugins (docs/01 §2: the dependency rule).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
