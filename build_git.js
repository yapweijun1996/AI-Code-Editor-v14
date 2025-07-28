const browserify = require('browserify');
const fs = require('fs');

console.log('Build script started.');

const b = browserify({
  standalone: 'git'
});
b.require('isomorphic-git');
b.require('isomorphic-git/http/web', { expose: 'isomorphic-git/http' });

console.log('Starting bundle...');

b.bundle((err, buf) => {
  if (err) {
    console.error('Error bundling isomorphic-git:', err);
    return;
  }
  console.log('Bundle finished, writing to file...');
  const outputPath = 'frontend/js/lib/git.umd.js';
  fs.writeFileSync(outputPath, buf);
  console.log(`Successfully bundled isomorphic-git to ${outputPath}`);
});