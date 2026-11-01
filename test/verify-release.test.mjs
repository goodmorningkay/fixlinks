import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyReleaseArtifacts } from '../scripts/verify-release.mjs';

function fixture(t, version = '1.4.0', packageVersion = version) {
  const directory = mkdtempSync(join(tmpdir(), 'fixlinks-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const name = `fixlinks-${packageVersion}-full.nupkg`;
  const bytes = Buffer.from('test package');
  const hash = createHash('sha1').update(bytes).digest('hex');
  writeFileSync(join(directory, name), bytes);
  writeFileSync(join(directory, 'FixLinksSetup.exe'), 'test installer');
  writeFileSync(
    join(directory, 'RELEASES'),
    `${hash} ${name} ${bytes.length}\r\n`
  );
  return {
    directory,
    name,
    verify: () => verifyReleaseArtifacts(directory, version, `v${version}`)
  };
}

test('accepts a complete Squirrel release', (t) => {
  const { verify } = fixture(t);
  assert.equal(verify().length, 3);
});

test('accepts the NuGet package name for a prerelease', (t) => {
  const { verify } = fixture(t, '1.4.0-beta.1', '1.4.0-beta1');
  assert.equal(verify().length, 3);
});

test('rejects a tag that differs from the package version', (t) => {
  const { directory } = fixture(t);
  assert.throws(
    () => verifyReleaseArtifacts(directory, '1.4.0', 'v1.3.1'),
    /tag must match/
  );
});

for (const file of [
  'FixLinksSetup.exe',
  'RELEASES',
  'fixlinks-1.4.0-full.nupkg'
]) {
  test(`rejects a release without ${file}`, (t) => {
    const { directory, verify } = fixture(t);
    rmSync(join(directory, file));
    assert.throws(verify, /missing release files/);
  });
}

test('rejects stale packages mixed with the current release', (t) => {
  const { directory, verify } = fixture(t);
  writeFileSync(join(directory, 'fixlinks-1.3.1-full.nupkg'), 'stale package');
  assert.throws(verify, /Unexpected or missing/);
});

test('rejects an empty installer', (t) => {
  const { directory, verify } = fixture(t);
  writeFileSync(join(directory, 'FixLinksSetup.exe'), '');
  assert.throws(verify, /nonempty file/);
});

test('rejects a package with a different size', (t) => {
  const { directory, name, verify } = fixture(t);
  writeFileSync(join(directory, name), 'truncated');
  assert.throws(verify, /size does not match/);
});

test('rejects a package with a different hash', (t) => {
  const { directory, name, verify } = fixture(t);
  writeFileSync(join(directory, name), 'TEST PACKAGE');
  assert.throws(verify, /hash does not match/);
});

test('rejects a malformed RELEASES manifest', (t) => {
  const { directory, verify } = fixture(t);
  writeFileSync(join(directory, 'RELEASES'), 'not a release entry');
  assert.throws(verify, /Invalid Squirrel/);
});

test('rejects a manifest that refers to an older package', (t) => {
  const { directory, name, verify } = fixture(t);
  writeFileSync(
    join(directory, 'RELEASES'),
    `${'a'.repeat(40)} ${name.replace('1.4.0', '1.3.1')} 12`
  );
  assert.throws(verify, /current full package/);
});
