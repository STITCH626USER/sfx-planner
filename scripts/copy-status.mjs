import fs from 'node:fs';
import path from 'node:path';

const rootStatus = path.resolve('app-status.json');
const publicStatus = path.resolve('public/app-status.json');

if (fs.existsSync(rootStatus)) {
  fs.copyFileSync(rootStatus, publicStatus);
  console.log('[copy-status] Copied app-status.json to public/app-status.json');
}
