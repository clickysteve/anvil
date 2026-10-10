import { defineConfig } from 'vite';

export default defineConfig({
  // Relative by default so the build works from any folder; GitHub Pages builds pass --base=/<repo>/.
  base: './',
  server: { port: 5299 },
  test: { include: ['test/**/*.test.ts'] },
} as never);
