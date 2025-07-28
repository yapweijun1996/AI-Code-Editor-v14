const fs = require('fs').promises;
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const cheerio = require('cheerio');
const { marked } = require('marked');

const projectRoot = path.join(__dirname, '..');
const indexFilePath = path.join(__dirname, 'codebase_index.json');

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

function extractMdSymbols(content) {
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
function extractSymbols(filePath, content) {
    const extension = path.extname(filePath);
    const extractor = SymbolExtractors[extension];
    return extractor ? extractor(content) : [];
}


/**
 * Recursively finds all files with a supported extension in a directory.
 * @param {string} dir - The directory to start scanning from.
 * @returns {Promise<string[]>} - A list of absolute file paths.
 */
async function findSupportedFiles(dir) {
    let results = [];
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of list) {
        const fullPath = path.resolve(dir, dirent.name);
        if (dirent.isDirectory()) {
            if (dirent.name !== 'node_modules' && dirent.name !== '.git') {
                results = results.concat(await findSupportedFiles(fullPath));
            }
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
async function buildIndex() {
    console.log('[Indexer] Starting codebase scan for supported files...');
    const files = await findSupportedFiles(projectRoot);
    const index = {};
    let totalSymbols = 0;

    for (const file of files) {
        try {
            const content = await fs.readFile(file, 'utf8');
            const symbols = extractSymbols(file, content);
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
            console.log('[Indexer] Index file not found. A new one will be created on the next build.');
            return {}; // Return empty object if index doesn't exist
        }
        throw error;
    }
}

/**
 * Adds or updates a single file in the index.
 * @param {string} filePath - The absolute path of the file to update.
 */
async function addOrUpdateFile(filePath) {
    const extension = path.extname(filePath);
    if (!SUPPORTED_EXTENSIONS.includes(extension)) return;

    try {
        const index = await getIndex();
        const content = await fs.readFile(filePath, 'utf8');
        const symbols = extractSymbols(filePath, content);
        const relativePath = path.relative(projectRoot, filePath);

        if (symbols.length > 0) {
            console.log(`[Indexer] Updating index for ${relativePath} with ${symbols.length} symbols.`);
            index[relativePath] = symbols;
        } else {
            // If no symbols are found, remove it from the index to keep it clean.
            if (index[relativePath]) {
                console.log(`[Indexer] Removing ${relativePath} from index (no symbols found).`);
                delete index[relativePath];
            }
        }
        
        await fs.writeFile(indexFilePath, JSON.stringify(index, null, 2));
    } catch (error) {
        if (error.code !== 'ENOENT') { // Ignore if the file was deleted before it could be read
           console.error(`[Indexer] Error updating index for file ${filePath}:`, error);
        }
    }
}

/**
 * Removes a single file from the index.
 * @param {string} filePath - The absolute path of the file to remove.
 */
async function removeFile(filePath) {
    try {
        const index = await getIndex();
        const relativePath = path.relative(projectRoot, filePath);
        if (index[relativePath]) {
            console.log(`[Indexer] Removing ${relativePath} from index.`);
            delete index[relativePath];
            await fs.writeFile(indexFilePath, JSON.stringify(index, null, 2));
        }
    } catch (error) {
        console.error(`[Indexer] Error removing file ${filePath} from index:`, error);
    }
}


module.exports = {
    buildIndex,
    getIndex,
    addOrUpdateFile,
    removeFile,
};