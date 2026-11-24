import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('builds a standalone portfolio site without copying configuration or runtime data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'teplicy-pages-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'site');
  const script = fileURLToPath(new URL('../scripts/build-pages.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const page = await readFile(join(output, 'index.html'), 'utf8');
  assert.match(page, /<body data-portfolio>/);
  assert.doesNotMatch(page, /(?:href|src|srcset)="\//);
  const version = page.match(/src="\.\/site\.js\?v=([a-f0-9]{12})"/)?.[1];
  assert.ok(version);
  assert.ok(page.includes(`href="./styles.css?v=${version}"`));
  const bundle = await readFile(join(output, 'site.js'), 'utf8');
  assert.ok(bundle.includes(`'./montage.js?v=${version}'`));
  assert.deepEqual((await readdir(output)).sort(), ['index.html', 'media', 'montage.js', 'site.js', 'styles.css']);
  await access(join(output, 'media', 'install.mp4'));
  await access(join(output, 'media', 'install-portrait.mp4'));
  await access(join(output, 'media', 'install.webm'));
  const frames = await readdir(join(output, 'media', 'montage-frames'));
  assert.equal(frames.length, 12);
  const source = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(source, /<body>/);
});
