const fs = require('fs').promises;
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const cheerio = require('cheerio');

const projectRoot = path.join(__dirname, '..');
const indexFilePath = path.join(__dirname, 'codebase_index.json');

let isLocked = false;
let writeQueue = [];

const SUPPORTED_EXTENSIONS = ['.cfm', '.js', '.html', '.md'];

// --- Symbol Extraction Logic ---

function extractCfmSymbols(content) {
    const symbols = new Set();
    const regex = /<cffunction\s+name="([^"]+)"/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        symbols.add(match[1]);
    }
    return [...symbols];
}

function extractJsSymbols(content) {
    const symbols = new Set();
    try {
        const ast = acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module', silent: true });
        walk.simple(ast, {
            FunctionDeclaration(node) {
                if (node.id) symbols.add(node.id.name);
            },
            FunctionExpression(node) {
                if (node.id) symbols.add(node.id.name);
            },
            ArrowFunctionExpression(node) {
                if (node.parent.type === 'VariableDeclarator' && node.parent.id.type === 'Identifier') {
                    symbols.add(node.parent.id.name);
                }
            },
            ClassDeclaration(node) {
                if (node.id) symbols.add(node.id.name);
            },
            VariableDeclaration(node) {
                node.declarations.forEach(declaration => {
                    if (declaration.id.type === 'Identifier' && declaration.init && (declaration.init.type === 'FunctionExpression' || declaration.init.type === 'ArrowFunctionExpression' || declaration.init.type === 'ClassExpression')) {
                         if(declaration.id.name) symbols.add(declaration.id.name);
                    }
                });
            }
        });
    } catch (e) {
        console.error(`[Indexer] Could not parse JavaScript file for symbols: ${e.message}`);
    }
    return [...symbols];
}

function extractHtmlSymbols(content) {
    const symbols = new Set();
    const $ = cheerio.load(content);
    $('[id]').each((i, el) => {
        symbols.add(`#${el.attribs.id}`);
    });
    $('[class]').each((i, el) => {
        el.attribs.class.split(/\s+/).forEach(className => {
            if (className) symbols.add(`.${className}`);
        });
    });
    return [...symbols];
}

async function extractMdSymbols(content) {
    const { marked } = await import('marked');
    const symbols = new Set();
    const tokens = marked.lexer(content);
    tokens.forEach(token => {
        if (token.type === 'heading') {
            symbols.add(token.text);
        }
    });
    return [...symbols];
}

const SymbolExtractors = {
    '.cfm': extractCfmSymbols,
    '.js': extractJsSymbols,
    '.html': extractHtmlSymbols,
    '.md': extractMdSymbols,
};

/**
 * Extracts symbol definitions from a given file's content based on its extension.
 * @param {string} filePath - The path of the file.
 * @param {string} content - The text content of the file.
 * @returns {string[]} - A list of extracted symbol names.
 */
async function extractSymbols(filePath, content) {
    const extension = path.extname(filePath);
    const extractor = SymbolExtractors[extension];
    if (extractor) {
        // Handle both sync and async extractors
        return await extractor(content);
    }
    return [];
}


/**
 * Recursively finds all files with a supported extension in a directory.
 * @param {string} dir - The directory to start scanning from.
 * @returns {Promise<string[]>} - A list of absolute file paths.
 */
async function findSupportedFiles(dir, ignorePatterns = []) {
    let results = [];
    const list = await fs.readdir(dir, { withFileTypes: true });
    const defaultIgnores = ['node_modules', '.git'];
    const combinedIgnores = [...new Set([...defaultIgnores, ...ignorePatterns])];

    for (const dirent of list) {
        const fullPath = path.resolve(dir, dirent.name);
        const relativePath = path.relative(projectRoot, fullPath);

        if (combinedIgnores.some(pattern => relativePath.startsWith(pattern))) {
            continue;
        }

        if (dirent.isDirectory()) {
            results = results.concat(await findSupportedFiles(fullPath, ignorePatterns));
        } else if (SUPPORTED_EXTENSIONS.includes(path.extname(dirent.name))) {
            results.push(fullPath);
        }
    }
    return results;
}


/**
 * Builds the codebase index by scanning all supported files.
 * @returns {Promise<{indexedFiles: number, totalSymbols: number}>}
 */
async function buildIndex(options = {}) {
   const { ignorePatterns = [] } = options;
    console.log('[Indexer] Starting codebase scan for supported files...');
    const files = await findSupportedFiles(projectRoot, ignorePatterns);
    const index = {};
    let totalSymbols = 0;

    for (const file of files) {
        try {
            const content = await fs.readFile(file, 'utf8');
            const symbols = await extractSymbols(file, content);
            if (symbols.length > 0) {
                const relativePath = path.relative(projectRoot, file);
                index[relativePath] = symbols;
                totalSymbols += symbols.length;
            }
        } catch (error) {
            console.error(`[Indexer] Error reading or parsing file ${file}:`, error);
        }
    }

    await fs.writeFile(indexFilePath, JSON.stringify(index, null, 2));
    console.log(`[Indexer] Finished indexing. Found ${totalSymbols} symbols in ${Object.keys(index).length} files.`);
    
    return {
        indexedFiles: Object.keys(index).length,
        totalSymbols: totalSymbols,
    };
}

/**
 * Loads the index from the JSON file.
 * @returns {Promise<object>}
 */
async function getIndex() {
    try {
        const data = await fs.readFile(indexFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {}; // Index doesn't exist, return empty object
        }
        // If parsing fails, it might be due to a write operation in progress.
        // For now, we'll log the error and return an empty object to avoid crashing.
        console.error(`[Indexer] Error reading or parsing index file, returning empty index:`, error);
        return {};
    }
}

/**
 * Adds or updates a single file in the index.
 * @param {string} filePath - The absolute path of the file to update.
 */
async function processWriteQueue() {
    if (isLocked || writeQueue.length === 0) {
        return;
    }
    isLocked = true;

    const { filePath, operation } = writeQueue.shift();

    try {
        const index = await getIndex();
        const relativePath = path.relative(projectRoot, filePath);

        if (operation === 'remove') {
            if (index[relativePath]) {
                console.log(`[Indexer] Removing ${relativePath} from index.`);
                delete index[relativePath];
            }
        } else { // 'addOrUpdate'
            const extension = path.extname(filePath);
            if (SUPPORTED_EXTENSIONS.includes(extension)) {
                try {
                    const content = await fs.readFile(filePath, 'utf8');
                    const symbols = await extractSymbols(filePath, content);
                    if (symbols.length > 0) {
                        console.log(`[Indexer] Updating index for ${relativePath} with ${symbols.length} symbols.`);
                        index[relativePath] = symbols;
                    } else if (index[relativePath]) {
                        console.log(`[Indexer] Removing ${relativePath} from index (no symbols found).`);
                        delete index[relativePath];
                    }
                } catch (readError) {
                    if (readError.code !== 'ENOENT') {
                        console.error(`[Indexer] Error reading file ${filePath}:`, readError);
                    }
                }
            }
        }

        await fs.writeFile(indexFilePath, JSON.stringify(index, null, 2));
    } catch (error) {
        console.error(`[Indexer] Error processing write queue for file ${filePath}:`, error);
    } finally {
        isLocked = false;
        processWriteQueue(); // Process next item in the queue
    }
}

function queueWriteOperation(filePath, operation) {
    // To prevent redundant operations, we can remove previous operations for the same file
    writeQueue = writeQueue.filter(item => item.filePath !== filePath);
    writeQueue.push({ filePath, operation });
    processWriteQueue();
}


async function addOrUpdateFile(filePath) {
    queueWriteOperation(filePath, 'addOrUpdate');
}

/**
 * Removes a single file from the index.
 * @param {string} filePath - The absolute path of the file to remove.
 */
async function removeFile(filePath) {
    queueWriteOperation(filePath, 'remove');
}


module.exports = {
    buildIndex,
    getIndex,
    addOrUpdateFile,
    removeFile,
};