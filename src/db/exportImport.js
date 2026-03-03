import db from './database.js';
import { getMemoryItemsForWorkspace } from './memoryHelpers.js';

export async function exportAllData() {
    const data = {};
    for (const table of db.tables) {
        data[table.name] = await table.toArray();
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().split('T')[0];
    a.download = `synapse-backup-${date}.json`;
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export only the memoryItems for a specific workspace (includes globals).
 * Produces a smaller JSON focused on the knowledge graph.
 */
export async function exportMemoryItems(workspaceId) {
    const items = workspaceId
        ? await getMemoryItemsForWorkspace(workspaceId)
        : await db.memoryItems.toArray();

    const payload = {
        _format: 'synapse-memory',
        _version: 1,
        exportedAt: new Date().toISOString(),
        workspaceId: workspaceId || null,
        itemCount: items.length,
        items,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().split('T')[0];
    a.download = `synapse-memory-${date}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Import a memory-items-only export. Merges by ID (upsert).
 * Also handles full-backup format (just pulls memoryItems table).
 */
export async function importMemoryItems(file, { targetWorkspaceId } = {}) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);

        let items;
        if (data._format === 'synapse-memory' || data._format === 'snapshot-ai-memory') {
            items = data.items;
        } else if (data.memoryItems) {
            // Full backup — extract memoryItems
            items = data.memoryItems;
        } else {
            return { success: false, error: 'Unrecognized file format' };
        }

        if (!Array.isArray(items) || items.length === 0) {
            return { success: false, error: 'No memory items found in file' };
        }

        // Optionally re-scope to a target workspace
        if (targetWorkspaceId) {
            items = items.map(i => ({
                ...i,
                workspaceId: i.scope === 'global' ? null : targetWorkspaceId,
            }));
        }

        await db.transaction('rw', db.memoryItems, async () => {
            for (const item of items) {
                const existing = await db.memoryItems.get(item.id);
                if (existing) {
                    // Upsert — keep newer
                    if ((item.updatedAt || 0) > (existing.updatedAt || 0)) {
                        await db.memoryItems.put(item);
                    }
                } else {
                    await db.memoryItems.add(item);
                }
            }
        });

        return { success: true, imported: items.length };
    } catch (err) {
        console.error('Memory import failed:', err);
        return { success: false, error: err.message };
    }
}

export async function importData(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);

        await db.transaction('rw', db.tables, async () => {
            for (const table of db.tables) {
                if (data[table.name]) {
                    await table.clear();
                    await table.bulkAdd(data[table.name]);
                }
            }
        });
        return { success: true };
    } catch (err) {
        console.error('Import failed:', err);
        return { success: false, error: err.message };
    }
}
