import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(projectRoot, 'src', 'renderer');
const targetDir = join(projectRoot, 'dist', 'renderer');

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });