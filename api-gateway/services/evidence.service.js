// Phase 7 §4 / AI_DESIGN.md §4.2 — Stage 2, evidence retrieval. Deterministic:
// the model is never asked whether code calls something, only to interpret
// code it has already been shown. npm is fully supported; PyPI gets a
// best-effort pass (see phases/Phase_07.md §6 — npm only is the documented
// fallback if this needs to be cut, but the PyPI regex pass is cheap enough
// to keep in).

const axios = require('axios');
const tar = require('tar');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // ~25MB, per phases/Phase_07.md §4
const MAX_FILES_SEARCHED = 2000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '__pycache__', '.venv', 'venv']);
const SOURCE_EXTENSIONS = {
  npm: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  PyPI: ['.py']
};
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.gz', '.tar', '.map', '.lock', '.wasm'
]);

/** Downloads one repository tarball and extracts it to a fresh temp directory. */
async function fetchRepoTarball(owner, repoName, ref, githubToken) {
  const tmpDir = path.join(os.tmpdir(), `githygiene-${crypto.randomUUID()}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const url = `https://api.github.com/repos/${owner}/${repoName}/tarball/${ref}`;
  const response = await axios.get(url, {
    headers: { Authorization: `token ${githubToken}`, Accept: 'application/vnd.github.v3+json' },
    responseType: 'stream',
    maxRedirects: 5
  });

  let downloaded = 0;
  let aborted = false;

  await new Promise((resolve, reject) => {
    const extractor = tar.extract({
      cwd: tmpDir,
      strip: 1, // GitHub tarballs wrap everything in one "<owner>-<repo>-<sha>/" directory
      filter: (entryPath) => {
        const segments = entryPath.split('/');
        return !segments.some((seg) => SKIP_DIRS.has(seg));
      }
    });

    response.data.on('data', (chunk) => {
      downloaded += chunk.length;
      if (downloaded > MAX_DOWNLOAD_BYTES && !aborted) {
        aborted = true;
        response.data.destroy(new Error('size-cap'));
      }
    });

    response.data.pipe(extractor);
    extractor.on('finish', resolve);
    extractor.on('error', (err) => {
      // A size-cap abort still leaves a partially extracted, usable tree —
      // treat it as "truncated", not a hard failure.
      if (aborted) resolve();
      else reject(err);
    });
    response.data.on('error', (err) => {
      if (aborted) resolve();
      else reject(err);
    });
  });

  return { dir: tmpDir, truncated: aborted };
}

async function cleanup(dir) {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.error('Evidence tarball cleanup failed:', err.message);
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Walks a directory, yielding file paths with one of the given extensions, capped. */
async function* walkFiles(root, extensions, cap) {
  let count = 0;
  async function* walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= cap) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        yield* walk(full);
      } else {
        const ext = path.extname(entry.name);
        if (BINARY_EXTENSIONS.has(ext)) continue;
        if (extensions.includes(ext)) {
          count += 1;
          yield full;
        }
      }
    }
  }
  yield* walk(root);
}

function npmImportPatterns(packageName) {
  const escaped = escapeRegex(packageName);
  return [
    // require('pkg') or require('pkg/sub/path'), optionally destructured
    new RegExp(`(?:const|let|var)\\s+(\\{[^}]*\\}|\\*\\s*as\\s*\\w+|\\w+)\\s*=\\s*require\\(['"]${escaped}(?:/[^'"]*)?['"]\\)`),
    // import x from 'pkg'; import * as x from 'pkg'; import {a,b} from 'pkg'
    new RegExp(`import\\s+(\\{[^}]*\\}|\\*\\s*as\\s*\\w+|\\w+)\\s+from\\s+['"]${escaped}(?:/[^'"]*)?['"]`)
  ];
}

function pyImportPatterns(packageName) {
  const escaped = escapeRegex(packageName);
  return [
    new RegExp(`from\\s+${escaped}(?:\\.[\\w.]+)?\\s+import\\s+([\\w, *]+)`),
    new RegExp(`import\\s+${escaped}(?:\\s+as\\s+(\\w+))?`)
  ];
}

/** Extracts local binding names from a matched import/require clause. */
function bindingNames(matchGroup, isDefault) {
  if (!matchGroup) return [];
  const trimmed = matchGroup.trim();
  if (trimmed.startsWith('{')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((part) => {
        const [, alias] = part.split(/\s+as\s+/);
        return (alias || part.split(/\s+as\s+/)[0]).trim();
      })
      .filter(Boolean);
  }
  if (trimmed.startsWith('*')) {
    const name = trimmed.replace(/\*\s*as\s*/, '').trim();
    return name ? [name] : [];
  }
  return trimmed ? [trimmed] : [];
}

function snippetAround(lines, lineIndex, context = 1) {
  const start = Math.max(0, lineIndex - context);
  const end = Math.min(lines.length, lineIndex + context + 1);
  return lines.slice(start, end).join('\n');
}

/**
 * dir: extracted repo root. ecosystem: 'npm' | 'PyPI'. packageName: the
 * vulnerable dependency's name. symbols: Stage 1's vulnerable_symbols.
 */
async function searchEvidence(dir, ecosystem, packageName, symbols) {
  const extensions = SOURCE_EXTENSIONS[ecosystem] || [];
  const importPatterns = ecosystem === 'npm' ? npmImportPatterns(packageName) : pyImportPatterns(packageName);

  const importSites = [];
  const bindingsByFile = new Map();
  let searchedFiles = 0;
  let truncated = false;

  for await (const filePath of walkFiles(dir, extensions, MAX_FILES_SEARCHED)) {
    searchedFiles += 1;
    if (searchedFiles >= MAX_FILES_SEARCHED) truncated = true;

    let content;
    try {
      content = await fsp.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const relPath = path.relative(dir, filePath);

    const bindings = new Set([packageName]);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of importPatterns) {
        const match = pattern.exec(line);
        if (match) {
          importSites.push({ file: relPath, line: i + 1, text: line.trim() });
          for (const name of bindingNames(match[1], false)) bindings.add(name);
        }
      }
    }
    if (bindings.size > 1 || importSites.some((s) => s.file === relPath)) {
      bindingsByFile.set(relPath, bindings);
    }
  }

  const callSites = [];
  if (symbols && symbols.length > 0) {
    for (const [relPath, bindings] of bindingsByFile.entries()) {
      let content;
      try {
        content = await fsp.readFile(path.join(dir, relPath), 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const symbol of symbols) {
          const escapedSymbol = escapeRegex(symbol);
          for (const binding of bindings) {
            const escapedBinding = escapeRegex(binding);
            const callPattern = new RegExp(
              `\\b(?:${escapedBinding}\\.${escapedSymbol}|${escapedSymbol})\\s*\\(`
            );
            if (callPattern.test(line)) {
              callSites.push({
                file: relPath,
                line: i + 1,
                symbol,
                snippet: snippetAround(lines, i)
              });
              break;
            }
          }
        }
      }
    }
  }

  return {
    package_imported: importSites.length > 0,
    import_sites: importSites.slice(0, 50),
    call_sites: callSites.slice(0, 50),
    searched_files: searchedFiles,
    truncated
  };
}

module.exports = { fetchRepoTarball, searchEvidence, cleanup };
