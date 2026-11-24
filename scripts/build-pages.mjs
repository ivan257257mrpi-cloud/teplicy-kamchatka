import { createHash } from 'node:crypto';
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

const outputScript = resolve(outputDirectory, 'site.js');
const [script, montage, styles] = await Promise.all([
  readFile(outputScript, 'utf8'),
  readFile(resolve(outputDirectory, 'montage.js')),
  readFile(resolve(outputDirectory, 'styles.css'))
]);
const version = createHash('sha256').update(script).update(montage).update(styles).digest('hex').slice(0, 12);
await Promise.all([
  writeFile(outputScript, script.replace("'./montage.js'", `'./montage.js?v=${version}'`)),
  writeFile(outputHtml, page.replace('<body>', '<body data-portfolio>')
    .replace('src="./site.js"', `src="./site.js?v=${version}"`)
    .replace('href="./styles.css"', `href="./styles.css?v=${version}"`))
]);
