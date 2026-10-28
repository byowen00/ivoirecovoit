/* Génère une paire Ed25519 pour JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (à placer dans le gestionnaire de secrets). */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n');
console.log(`JWT_PRIVATE_KEY="${oneLine(privateKey)}"`);
console.log(`JWT_PUBLIC_KEY="${oneLine(publicKey)}"`);
