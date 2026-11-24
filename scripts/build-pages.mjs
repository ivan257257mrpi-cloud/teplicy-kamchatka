import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const outputDirectory = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../dist/pages/', import.meta.url));

await mkdir(outputDirectory, { recursive: true });
await cp(publicDirectory, outputDirectory, {
  recursive: true,
  filter: path => !/[\\/]media[\\/]montage(?:-\d+\.webp|\.mp4)$/.test(path)
});

const outputHtml = resolve(outputDirectory, 'index.html');
const page = await readFile(outputHtml, 'utf8');
if (!page.includes('<body>')) throw new Error('Expected the unmodified site layout.');
await writeFile(outputHtml, page.replace('<body>', '<body data-portfolio>'));
