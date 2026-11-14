import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Unit tests cover the logic: shared core and every game's rules. Screens (js/ui, js/pwa, js/app.js) are
      // covered by the browser tests instead.
      include: ['js/core/**/*.js', 'games/**/*.js'],
      exclude: ['tests/**'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      // The shared core must stay fully tested. Games are reported but not gated here: their drawing code (mount)
      // runs only in a browser and is covered by tests/e2e; their rules are gated by tests/unit/games/<id>.test.js.
      thresholds: {
        perFile: true, // every core file must meet the bar on its own, not just on average
        'js/core/**': { statements: 100, branches: 95, functions: 100, lines: 100 },
      },
    },
  },
});
