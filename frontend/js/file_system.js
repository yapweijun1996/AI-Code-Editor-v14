export async function getFileHandleFromPath(dirHandle, path, options = {}) {
    const parts = path.split('/').filter((p) => p);
    let currentHandle = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: options.create });
    }
    return await currentHandle.getFileHandle(parts[parts.length - 1], options);
}

export async function getParentDirectoryHandle(rootDirHandle, path) {
    const parts = path.split('/').filter((p) => p);
    if (parts.length === 0) {
        throw new Error('Invalid path provided. Cannot get parent of root.');
    }

    let currentHandle = rootDirHandle;
    // Traverse to the parent directory
    for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
    }

    const entryName = parts[parts.length - 1];
    return { parentHandle: currentHandle, entryName };
}

export async function createDirectoryFromPath(dirHandle, path) {
    const parts = path.split('/').filter((p) => p);
    let currentHandle = dirHandle;
    for (const part of parts) {
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
    }
    return currentHandle;
}

async function getDirectoryHandleFromPath(dirHandle, path) {
    const parts = path.split('/').filter((p) => p);
    let currentHandle = dirHandle;
    for (const part of parts) {
        currentHandle = await currentHandle.getDirectoryHandle(part);
    }
    return currentHandle;
}

export async function renameEntry(rootDirHandle, oldPath, newPath) {
    try {
        const oldFileHandle = await getFileHandleFromPath(rootDirHandle, oldPath);
        const file = await oldFileHandle.getFile();
        const content = await file.arrayBuffer();

        const newFileHandle = await getFileHandleFromPath(rootDirHandle, newPath, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        const { parentHandle, entryName } = await getParentDirectoryHandle(rootDirHandle, oldPath);
        await parentHandle.removeEntry(entryName);
    } catch (fileError) {
        if (fileError.name === 'TypeMismatchError') {
            try {
                const oldDirHandle = await getDirectoryHandleFromPath(rootDirHandle, oldPath);
                const newDirHandle = await createDirectoryFromPath(rootDirHandle, newPath);

                for await (const entry of oldDirHandle.values()) {
                    await renameEntry(
                        rootDirHandle,
                        `${oldPath}/${entry.name}`,
                        `${newPath}/${entry.name}`
                    );
                }

                const { parentHandle, entryName: dirNameToDelete } = await getParentDirectoryHandle(rootDirHandle, oldPath);
                await parentHandle.removeEntry(dirNameToDelete, { recursive: true });
            } catch (dirError) {
                throw new Error(`Failed to rename directory: ${dirError.message}`);
            }
        } else {
            throw new Error(`Failed to rename file: ${fileError.message}`);
        }
    }
}

export async function searchInDirectory(
dirHandle,
searchTerm,
currentPath,
results,
) {
    for await (const entry of dirHandle.values()) {
        const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
            try {
                const file = await entry.getFile();
                const content = await file.text();
                const lines = content.split('\n');
                const fileMatches = [];
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(searchTerm.toLowerCase())) {
                        fileMatches.push({
                            line_number: i + 1,
                            line_content: lines[i].trim(),
                        });
                    }
                }
                if (fileMatches.length > 0) {
                    results.push({
                        file: newPath,
                        matches: fileMatches,
                    });
                }
            } catch (readError) {
                console.warn(`Could not read file ${newPath}:`, readError);
            }
        } else if (entry.kind === 'directory') {
            await searchInDirectory(entry, searchTerm, newPath, results);
        }
    }
}

export async function buildStructureTree(dirHandle) {
    const root = {
        name: dirHandle.name,
        kind: 'directory',
        children: []
    };

    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
            const childNode = await buildStructureTree(entry);
            root.children.push(childNode);
        } else {
            root.children.push({
                name: entry.name,
                kind: 'file',
            });
        }
    }

    // Sort so folders appear before files
    root.children.sort((a, b) => {
        if (a.kind === 'directory' && b.kind !== 'directory') return -1;
        if (a.kind !== 'directory' && b.kind === 'directory') return 1;
        return a.name.localeCompare(b.name);
    });

    return root;
}

export function formatTreeToString(node, prefix = '') {
    let result = '';
    const children = node.children || [];
    children.forEach((child, index) => {
        const isLast = index === children.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        result += `${prefix}${connector}${child.name}\n`;
        if (child.kind === 'directory') {
            const newPrefix = prefix + (isLast ? '    ' : '│   ');
            result += formatTreeToString(child, newPrefix);
        }
    });
    return result;
};

export const buildTree = async (dirHandle, currentPath = '') => {
    const children = [];
    for await (const entry of dirHandle.values()) {
        const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
            children.push({
                id: newPath,
                text: entry.name,
                type: 'folder',
                children: await buildTree(entry, newPath),
            });
        } else {
            children.push({
                id: newPath,
                text: entry.name,
                type: 'file',
                li_attr: { 'data-path': newPath, 'data-handle': entry }, // Store path and handle
            });
        }
    }
    // Sort so folders appear before files
    children.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.text.localeCompare(b.text);
    });
    return children;
};