import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/packages/web', { recursive: true });
cpSync('packages/web/public', 'dist/packages/web/public', { recursive: true });
cpSync('schemas', 'dist/schemas', { recursive: true });
copyFileSync('LICENSE', 'dist/LICENSE');
