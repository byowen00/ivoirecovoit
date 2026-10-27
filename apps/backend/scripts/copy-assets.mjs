// Copie dans dist/ les fichiers non TypeScript nécessaires à l'exécution (migrations SQL, données de référence).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

cpSync('src/database/migrations', 'dist/database/migrations', { recursive: true });
mkdirSync('dist/database/seeds', { recursive: true });
for (const f of readdirSync('src/database/seeds')) {
  if (f.endsWith('.sql') || f.endsWith('.json')) cpSync(`src/database/seeds/${f}`, `dist/database/seeds/${f}`);
}
