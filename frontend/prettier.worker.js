// prettier.worker.js

self.importScripts(
  'https://unpkg.com/prettier@2.8.4/standalone.js',
  'https://unpkg.com/prettier@2.8.4/parser-babel.js',
  'https://unpkg.com/prettier@2.8.4/parser-html.js',
  'https://unpkg.com/prettier@2.8.4/parser-postcss.js'
);

self.onmessage = (event) => {
  const { code, parser } = event.data;

  try {
    const formattedCode = prettier.format(code, {
      parser: parser,
      plugins: prettierPlugins,
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: 'all',
    });
    self.postMessage({ success: true, formattedCode });
  } catch (error) {
    self.postMessage({ success: false, error: error.message });
  }
};