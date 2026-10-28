import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // « server-only » refuse d'être importé hors du serveur Next ; neutralisé pour les tests du BFF.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./test/setup.ts'] },
});
