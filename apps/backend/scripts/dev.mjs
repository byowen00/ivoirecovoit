// Développement : recompile à chaque modification et relance l'API. Sans syntaxe de shell, pour fonctionner aussi
// sous Windows (cmd.exe ne sait pas lancer deux commandes en parallèle avec « & »).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' });

const children = [
  run([tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput']),
  run(['--env-file-if-exists=../../.env', '--watch', 'dist/main.js']),
];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => { stop(); process.exitCode = code ?? 0; }));
