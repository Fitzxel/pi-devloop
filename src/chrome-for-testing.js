import { constants as fsConstants, createWriteStream } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';

export const CHROME_FOR_TESTING_METADATA_URL = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const pendingInstallations = new Map();
const SUPPORTED_PLATFORMS = new Set(['linux64', 'linux-arm64', 'mac-x64', 'mac-arm64', 'win32', 'win64']);
const execFile = promisify(nodeExecFile);

export function getChromeForTestingPlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'linux' && arch === 'x64') return 'linux64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'mac-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64';
  if (platform === 'win32' && arch === 'x64') return 'win64';
  if (platform === 'win32' && arch === 'ia32') return 'win32';
  throw new Error(`Chrome for Testing is not available for ${platform}/${arch}`);
}

export function getChromeForTestingCacheDirectory({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const winPath = path.win32;
    const base = env.LOCALAPPDATA || winPath.join(home, 'AppData', 'Local');
    return winPath.join(base, 'pi-devloop', 'chrome-for-testing');
  }
  const base = env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(base, 'pi-devloop', 'chrome-for-testing');
}

export function selectChromeForTestingRelease(metadata, platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error(`Chrome for Testing is not available for platform ${platform}`);
  const stable = metadata?.channels?.Stable;
  const version = stable?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Chrome for Testing Stable metadata has an invalid version');
  }
  const asset = stable?.downloads?.chrome?.find((download) => download?.platform === platform);
  if (!asset || typeof asset.url !== 'string') throw new Error(`Chrome for Testing Stable has no Chrome download for ${platform}`);

  let url;
  try { url = new URL(asset.url); } catch { throw new Error('Chrome for Testing download URL is invalid'); }
  const filename = `chrome-${platform}.zip`;
  const expectedPath = `/chrome-for-testing-public/${version}/${platform}/${filename}`;
  if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' || url.port || url.username || url.password) {
    throw new Error('Chrome for Testing download URL must use the official HTTPS download host');
  }
  if (url.pathname !== expectedPath || url.search || url.hash) {
    throw new Error('Chrome for Testing download URL does not match its Stable version and platform');
  }
  return { version, platform, url: url.toString() };
}

export function createChromeForTestingResolver(deps = {}) {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const cacheDirectory = path.resolve(deps.cacheDirectory ?? getChromeForTestingCacheDirectory({
    platform,
    env: deps.env ?? process.env,
    home: deps.home ?? os.homedir(),
  }));
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const inspectArchive = deps.inspectArchive ?? inspectChromeForTestingArchive;
  const fileSystem = {
    access: deps.access ?? access,
    chmod: deps.chmod ?? chmod,
    lstat: deps.lstat ?? lstat,
    mkdir: deps.mkdir ?? mkdir,
    mkdtemp: deps.mkdtemp ?? mkdtemp,
    rename: deps.rename ?? rename,
    rm: deps.rm ?? rm,
  };

  return async function resolveChromeForTesting() {
    if (typeof fetcher !== 'function') throw new Error('Chrome for Testing requires a fetch implementation');
    const cftPlatform = getChromeForTestingPlatform(platform, arch);
    const metadataResponse = await fetcher(CHROME_FOR_TESTING_METADATA_URL, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!metadataResponse.ok) throw new Error(`Chrome for Testing metadata request failed with HTTP ${metadataResponse.status}`);
    const release = selectChromeForTestingRelease(await metadataResponse.json(), cftPlatform);
    const versionDirectory = path.join(cacheDirectory, release.version);
    const finalDirectory = path.join(versionDirectory, release.platform);
    const executablePath = getExecutablePath(finalDirectory, release.platform);
    await ensurePrivateDirectory(cacheDirectory, release.platform, fileSystem);
    await ensurePrivateDirectory(versionDirectory, release.platform, fileSystem);
    if (await isUsableExecutable(executablePath, release.platform, fileSystem)) return executablePath;

    const pending = pendingInstallations.get(executablePath);
    if (pending) return pending;
    const installation = installRelease({
      release,
      executablePath,
      finalDirectory,
      versionDirectory,
      cacheDirectory,
      fetcher,
      inspectArchive,
      runCommand,
      fileSystem,
    });
    pendingInstallations.set(executablePath, installation);
    try {
      return await installation;
    } finally {
      pendingInstallations.delete(executablePath);
    }
  };
}

export async function inspectChromeForTestingArchive(archivePath) {
  const handle = await open(archivePath, 'r');
  try {
    const fileSize = (await handle.stat()).size;
    const tailSize = Math.min(fileSize, 22 + 0xffff);
    if (tailSize < 22) throw new Error('Chrome for Testing archive has an invalid ZIP end record');
    const tailOffset = fileSize - tailSize;
    const tail = await readExactly(handle, tailSize, tailOffset);
    let endRecordOffset = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== 0x06054b50) continue;
      if (offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) {
        endRecordOffset = offset;
        break;
      }
    }
    if (endRecordOffset < 0) throw new Error('Chrome for Testing archive has an invalid ZIP end record');

    const endRecord = tail.subarray(endRecordOffset);
    const diskNumber = endRecord.readUInt16LE(4);
    const centralDirectoryDisk = endRecord.readUInt16LE(6);
    const entriesOnDisk = endRecord.readUInt16LE(8);
    const entryCount = endRecord.readUInt16LE(10);
    const centralDirectorySize = endRecord.readUInt32LE(12);
    const centralDirectoryOffset = endRecord.readUInt32LE(16);
    if (diskNumber || centralDirectoryDisk || entriesOnDisk !== entryCount) throw new Error('Chrome for Testing archive uses unsupported multi-disk ZIP data');
    if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) throw new Error('Chrome for Testing archive uses unsupported ZIP64 data');
    if (entryCount > 50000 || centralDirectorySize > 32 * 1024 * 1024 || centralDirectoryOffset + centralDirectorySize > fileSize) {
      throw new Error('Chrome for Testing archive has an invalid or oversized central directory');
    }

    const centralDirectory = await readExactly(handle, centralDirectorySize, centralDirectoryOffset);
    const entries = [];
    let cursor = 0;
    while (cursor < centralDirectory.length) {
      if (cursor + 46 > centralDirectory.length || centralDirectory.readUInt32LE(cursor) !== 0x02014b50) {
        throw new Error('Chrome for Testing archive has an invalid central directory entry');
      }
      const versionMadeBy = centralDirectory.readUInt16LE(cursor + 4);
      const flags = centralDirectory.readUInt16LE(cursor + 8);
      const filenameLength = centralDirectory.readUInt16LE(cursor + 28);
      const extraLength = centralDirectory.readUInt16LE(cursor + 30);
      const commentLength = centralDirectory.readUInt16LE(cursor + 32);
      const externalAttributes = centralDirectory.readUInt32LE(cursor + 38);
      const recordLength = 46 + filenameLength + extraLength + commentLength;
      if (!filenameLength || cursor + recordLength > centralDirectory.length) throw new Error('Chrome for Testing archive has an invalid central directory entry');
      const filenameBytes = centralDirectory.subarray(cursor + 46, cursor + 46 + filenameLength);
      const name = filenameBytes.toString('utf8');
      if (name.includes('\ufffd') || (!(flags & 0x0800) && /[^\x00-\x7f]/.test(name))) throw new Error('Chrome for Testing archive contains an invalid ZIP entry name');
      const mode = externalAttributes >>> 16;
      const fileType = mode & 0o170000;
      const hostSystem = versionMadeBy >>> 8;
      if (fileType === 0o120000) throw new Error('Chrome for Testing archive contains a symbolic link entry');
      if ((hostSystem === 3 || hostSystem === 19) && fileType && fileType !== 0o100000 && fileType !== 0o040000) {
        throw new Error('Chrome for Testing archive contains an unsafe ZIP entry type');
      }
      entries.push({ name, mode });
      cursor += recordLength;
    }
    if (entries.length !== entryCount) throw new Error('Chrome for Testing archive central directory entry count does not match');
    validateArchiveEntries(entries);
    return entries;
  } finally {
    await handle.close();
  }
}

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const result = await handle.read(buffer, bytesRead, length - bytesRead, position + bytesRead);
    if (result.bytesRead === 0) throw new Error('Chrome for Testing archive ended unexpectedly');
    bytesRead += result.bytesRead;
  }
  return buffer;
}

async function ensurePrivateDirectory(directory, platform, fileSystem) {
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
  let info = await fileSystem.lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Chrome for Testing cache path is not a real directory: ${directory}`);
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error(`Chrome for Testing cache directory is not owned by the current user: ${directory}`);
  if (!platform.startsWith('win')) {
    await fileSystem.chmod(directory, 0o700);
    info = await fileSystem.lstat(directory);
    if ((info.mode & 0o777) !== 0o700) throw new Error(`Chrome for Testing cache directory is not private: ${directory}`);
  }
}

async function installRelease({ release, executablePath, finalDirectory, versionDirectory, cacheDirectory, fetcher, inspectArchive, runCommand, fileSystem }) {
  await ensurePrivateDirectory(cacheDirectory, release.platform, fileSystem);
  await ensurePrivateDirectory(versionDirectory, release.platform, fileSystem);
  const stagingDirectory = await fileSystem.mkdtemp(path.join(versionDirectory, '.install-'));
  const archivePath = path.join(stagingDirectory, `chrome-${release.platform}.zip`);
  const extractedDirectory = path.join(stagingDirectory, 'extracted');

  try {
    await fileSystem.mkdir(extractedDirectory, { mode: 0o700 });
    await downloadArchive(release.url, archivePath, fetcher);
    validateArchiveEntries(await inspectArchive(archivePath));
    await extractArchive(archivePath, extractedDirectory, release.platform, runCommand);

    const relativeExecutablePath = path.relative(finalDirectory, executablePath);
    const extractedExecutablePath = path.join(extractedDirectory, relativeExecutablePath);
    await assertSafeExtractedExecutable(extractedDirectory, extractedExecutablePath, relativeExecutablePath, fileSystem);
    if (!release.platform.startsWith('win')) await fileSystem.chmod(extractedExecutablePath, 0o755);

    try {
      await fileSystem.rename(extractedDirectory, finalDirectory);
    } catch (error) {
      if (!await isUsableExecutable(executablePath, release.platform, fileSystem)) throw error;
    }
    if (!await isUsableExecutable(executablePath, release.platform, fileSystem)) {
      throw new Error(`Chrome for Testing executable was not installed at ${executablePath}`);
    }
    return executablePath;
  } finally {
    await fileSystem.rm(stagingDirectory, { recursive: true, force: true });
  }
}

async function downloadArchive(url, destination, fetcher) {
  const response = await fetcher(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Chrome for Testing download failed with HTTP ${response.status}`);
  if (!response.body) throw new Error('Chrome for Testing download returned an empty response');
  const declaredLength = response.headers?.get?.('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_ARCHIVE_BYTES)) {
    throw new Error('Chrome for Testing archive exceeds the 1 GiB download limit');
  }

  let downloadedBytes = 0;
  const sizeLimit = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadedBytes > MAX_ARCHIVE_BYTES) callback(new Error('Chrome for Testing archive exceeds the 1 GiB download limit'));
      else callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), sizeLimit, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  if (downloadedBytes === 0) throw new Error('Chrome for Testing download returned an empty archive');
}

async function extractArchive(archivePath, destination, platform, runCommand) {
  if (platform.startsWith('win')) {
    const encodedArchive = encodePowerShellString(archivePath);
    const encodedDestination = encodePowerShellString(destination);
    const script = [
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$archive=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedArchive}'))`,
      `$destination=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedDestination}'))`,
      '$root=[IO.Path]::GetFullPath($destination)',
      "$prefix=$root.TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar))+[IO.Path]::DirectorySeparatorChar",
      '$zip=[IO.Compression.ZipFile]::OpenRead($archive)',
      'try { foreach($entry in $zip.Entries) { $target=[IO.Path]::GetFullPath([IO.Path]::Combine($root,$entry.FullName)); if(-not $target.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw \'Unsafe ZIP entry\' } } } finally { $zip.Dispose() }',
      '[IO.Compression.ZipFile]::ExtractToDirectory($archive,$root)',
    ].join(';');
    await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return;
  }

  try {
    await runCommand('unzip', ['-q', archivePath, '-d', destination]);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Cannot extract Chrome for Testing: the unzip utility is required', { cause: error });
    throw error;
  }
}

function validateArchiveEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('Chrome for Testing archive has an invalid central directory');
  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    const mode = typeof entry === 'object' ? entry?.mode : undefined;
    const type = Number.isInteger(mode) ? mode & 0o170000 : 0;
    if (type === 0o120000) throw new Error('Chrome for Testing archive contains a symbolic link entry');
    if (type && type !== 0o100000 && type !== 0o040000) throw new Error('Chrome for Testing archive contains an unsafe ZIP entry type');
    if (typeof name !== 'string' || !name || /[\0-\x1f\x7f]/.test(name)) throw new Error('Chrome for Testing archive contains an unsafe ZIP entry');
    const normalized = name.replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) throw new Error('Chrome for Testing archive contains an unsafe ZIP entry');
    const segments = normalized.split('/').filter((segment) => segment !== '');
    if (segments.some((segment) => segment === '.' || segment === '..')) throw new Error('Chrome for Testing archive contains an unsafe ZIP entry');
  }
}

async function assertSafeExtractedExecutable(extractionRoot, executablePath, relativePath, fileSystem) {
  const parts = relativePath.split(path.sep).filter(Boolean);
  let current = extractionRoot;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const info = await fileSystem.lstat(current);
    if (info.isSymbolicLink()) throw new Error('Chrome for Testing archive contains a symbolic link in its executable path');
    const isExecutable = index === parts.length - 1;
    if (isExecutable ? !info.isFile() : !info.isDirectory()) throw new Error('Chrome for Testing archive has an invalid executable layout');
  }
  if (path.resolve(current) !== path.resolve(executablePath)) throw new Error('Chrome for Testing executable path escaped its extraction directory');
}

async function isUsableExecutable(executablePath, platform, fileSystem) {
  try {
    const info = await fileSystem.lstat(executablePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0) return false;
    if (!platform.startsWith('win')) await fileSystem.access(executablePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getExecutablePath(directory, platform) {
  const root = `chrome-${platform}`;
  if (platform.startsWith('mac-')) return path.join(directory, root, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  if (platform.startsWith('win')) return path.join(directory, root, 'chrome.exe');
  return path.join(directory, root, 'chrome');
}

function encodePowerShellString(value) {
  return Buffer.from(value, 'utf16le').toString('base64');
}

async function defaultRunCommand(command, args) {
  return execFile(command, args, {
    windowsHide: true,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: 300000,
  });
}
