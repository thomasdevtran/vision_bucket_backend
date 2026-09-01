const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const roots = ['src', 'scripts'];
const files = [];

const collectJavaScript = directory => {
  for (const entry of readdirSync(directory)) {
    const absolutePath = path.join(directory, entry);
    if (statSync(absolutePath).isDirectory()) collectJavaScript(absolutePath);
    else if (absolutePath.endsWith('.js')) files.push(absolutePath);
  }
};

for (const root of roots) collectJavaScript(root);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write(`Build check passed for ${files.length} JavaScript files.\n`);
