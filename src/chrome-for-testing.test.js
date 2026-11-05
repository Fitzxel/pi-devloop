import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createChromeForTestingResolver, getChromeForTestingCacheDirectory, getChromeForTestingPlatform, selectChromeForTestingRelease } from './chrome-for-testing.js';

const VERSION = '123.4.5678.90';
const PLATFORM = 'linux64';
const DOWNLOAD_URL = `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/${PLATFORM}/chrome-${PLATFORM}.zip`;

function stableMetadata(url = DOWNLOAD_URL) {
  return {
    channels: {
      Stable: {
        version: VERSION,
        downloads: { chrome: [{ platform: PLATFORM, url }] },
      },
      Beta: {
        version: '124.0.0.0',
        downloads: { chrome: [{ platform: PLATFORM, url: 'https://example.invalid/beta.zip' }] },
      },
    },
  };
}

function makeCentralDirectoryArchive(entries) {
  const records = entries.map(({ name, mode }) => {
    const filename = Buffer.from(name, 'utf8');
    const record = Buffer.alloc(46 + filename.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE((3 << 8) | 20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(((mode ?? 0) << 16) >>> 0, 38);
    filename.copy(record, 46);
    return record;
  });
  const centralDirectory = Buffer.concat(records);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  return Buffer.concat([centralDirectory, endRecord]);
}

test('maps supported operating systems and architectures to Chrome for Testing platforms', () => {
  assert.equal(getChromeForTestingPlatform('linux', 'x64'), 'linux64');
  assert.equal(getChromeForTestingPlatform('linux', 'arm64'), 'linux-arm64');
  assert.equal(getChromeForTestingPlatform('darwin', 'arm64'), 'mac-arm64');
  assert.equal(getChromeForTestingPlatform('darwin', 'x64'), 'mac-x64');
  assert.equal(getChromeForTestingPlatform('win32', 'x64'), 'win64');
  assert.equal(getChromeForTestingPlatform('win32', 'ia32'), 'win32');
  assert.throws(() => getChromeForTestingPlatform('freebsd', 'x64'), /not available/);
});

test('selects only the Stable Chrome asset and validates the official download URL', () => {
  assert.deepEqual(selectChromeForTestingRelease(stableMetadata(), PLATFORM), {
    version: VERSION,
    platform: PLATFORM,
    url: DOWNLOAD_URL,
  });
  assert.throws(() => selectChromeForTestingRelease(stableMetadata('https://attacker.invalid/chrome.zip'), PLATFORM), /official/);
  assert.throws(() => selectChromeForTestingRelease(stableMetadata(`https://storage.googleapis.com/chrome-for-testing-public/999.0.0.0/${PLATFORM}/chrome-${PLATFORM}.zip`), PLATFORM), /match/);
  assert.throws(() => selectChromeForTestingRelease(stableMetadata(), 'unknown'), /available/);
});

test('chooses a private user cache directory on each operating system', () => {
  assert.equal(getChromeForTestingCacheDirectory({ platform: 'linux', env: { XDG_CACHE_HOME: '/home/test/.cache-root' }, home: '/home/test' }), '/home/test/.cache-root/pi-devloop/chrome-for-testing');
  assert.equal(getChromeForTestingCacheDirectory({ platform: 'darwin', env: {}, home: '/Users/test' }), '/Users/test/.cache/pi-devloop/chrome-for-testing');
  assert.equal(getChromeForTestingCacheDirectory({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }, home: 'C:\\Users\\test' }), path.win32.join('C:\\Users\\test\\AppData\\Local', 'pi-devloop', 'chrome-for-testing'));
});

test('downloads official Stable Chrome once, extracts into the cache and reuses the cached executable', async (t) => {
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-cft-test-'));
  await chmod(cacheDirectory, 0o755);
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  const requests = [];
  const commands = [];
  const resolver = createChromeForTestingResolver({
    platform: 'linux',
    arch: 'x64',
    cacheDirectory,
    inspectArchive: async () => [{ name: 'chrome-linux64/chrome', mode: 0o100755 }],
    fetch: async (url) => {
      requests.push(String(url));
      if (url === 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json') {
        return new Response(JSON.stringify(stableMetadata()), { headers: { 'content-type': 'application/json' } });
      }
      if (url === DOWNLOAD_URL) return new Response(Buffer.from('fake zip bytes'));
      throw new Error(`Unexpected URL: ${url}`);
    },
    runCommand: async (command, args) => {
      commands.push([command, args]);
      const destination = args.at(-1);
      const browserDirectory = path.join(destination, 'chrome-linux64');
      await mkdir(browserDirectory, { recursive: true });
      await writeFile(path.join(browserDirectory, 'chrome'), 'fake executable');
      return { stdout: '', stderr: '' };
    },
  });

  const firstPath = await resolver();
  const secondPath = await resolver();
  assert.equal(firstPath, path.join(cacheDirectory, VERSION, PLATFORM, 'chrome-linux64', 'chrome'));
  assert.equal(secondPath, firstPath);
  assert.equal(await readFile(firstPath, 'utf8'), 'fake executable');
  assert.equal((await stat(cacheDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(cacheDirectory, VERSION))).mode & 0o777, 0o700);
  assert.equal(requests.filter((url) => url === DOWNLOAD_URL).length, 1);
  assert.equal(commands.length, 1);
});

test('archive inspection rejects symlink entries before extraction', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-cft-zip-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archivePath = path.join(directory, 'symlink.zip');
  await writeFile(archivePath, makeCentralDirectoryArchive([
    { name: 'chrome-linux64/chrome', mode: 0o100755 },
    { name: 'chrome-linux64/escape', mode: 0o120777 },
  ]));
  const { inspectChromeForTestingArchive } = await import('./chrome-for-testing.js');
  await assert.rejects(inspectChromeForTestingArchive(archivePath), /symbolic link/);
});

test('rejects path traversal entries before extracting a downloaded archive', async (t) => {
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'pi-devloop-cft-unsafe-'));
  t.after(() => rm(cacheDirectory, { recursive: true, force: true }));
  let extractionCalls = 0;
  const resolver = createChromeForTestingResolver({
    platform: 'linux',
    arch: 'x64',
    cacheDirectory,
    inspectArchive: async () => [
      { name: 'chrome-linux64/chrome', mode: 0o100755 },
      { name: '../../outside', mode: 0o100644 },
    ],
    fetch: async (url) => url === 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'
      ? new Response(JSON.stringify(stableMetadata()))
      : new Response(Buffer.from('fake zip bytes')),
    runCommand: async () => {
      extractionCalls += 1;
      return { stdout: '', stderr: '' };
    },
  });

  await assert.rejects(resolver(), /unsafe ZIP entry/);
  assert.equal(extractionCalls, 0);
});
