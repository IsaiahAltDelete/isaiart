// The page must point at the current version of every module (tools/stamp.mjs), or a CDN
// can serve a fresh page with stale scripts after a deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stampedHtml } from '../tools/stamp.mjs';

test('index.html carries up-to-date fingerprints for every module and model file', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(stampedHtml(html), html, 'stale stamp: run `node tools/stamp.mjs`');
  assert.match(html, /<script type="module">import '\.\/js\/main\.js';<\/script>/, 'main.js must be imported (not src=) so the import map applies');
});
