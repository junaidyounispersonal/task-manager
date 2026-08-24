'use strict';

const fs = require('fs');
const path = require('path');

const IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.data',
  '.vite',
  'agentforge',
  'package-lock.json',
]);

const FIRST_DIRS = ['frontend', 'backend', 'src', 'app', 'lib'];

function listFiles(root, { maxFiles = 120, maxDepth = 6 } = {}, current = '', depth = 0, acc = []) {
  if (acc.length >= maxFiles || depth > maxDepth) return acc;
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, current), { withFileTypes: true });
  } catch {
    return acc;
  }
  entries.sort((a, b) => {
    const ap = FIRST_DIRS.includes(a.name) ? 0 : 1;
    const bp = FIRST_DIRS.includes(b.name) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    if (acc.length >= maxFiles) break;
    if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
    const rel = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      listFiles(root, { maxFiles, maxDepth }, rel, depth + 1, acc);
    } else {
      acc.push(rel.replace(/\\/g, '/'));
    }
  }
  return acc;
}

function readIfExists(root, rel, maxBytes = 8000) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  return buf.slice(0, maxBytes).toString('utf8');
}

function analyzeRepository(repoPath) {
  const files = listFiles(repoPath);
  return {
    repoPath,
    files,
    readme: readIfExists(repoPath, 'README.md'),
    rootPackage: readIfExists(repoPath, 'package.json'),
    frontendPackage: readIfExists(repoPath, 'frontend/package.json'),
    backendPackage: readIfExists(repoPath, 'backend/package.json'),
  };
}

module.exports = { analyzeRepository, listFiles, readIfExists };
