#!/usr/bin/env node
// Builds dist/ for GitHub Pages: the installer GUI as index.html (it switches
// itself into mock mode on *.github.io) plus .nojekyll.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(root, 'installer', 'gui.html'), path.join(dist, 'index.html'));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('built dist/index.html');
