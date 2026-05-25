/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger } from './logger.js';
export class TextSnapshot {
    static nextSnapshotId = 1;
    static resetCounter() {
        TextSnapshot.nextSnapshotId = 1;
    }
    root;
    idToNode;
    snapshotId;
    selectedElementUid;
    hasSelectedElement;
    verbose;
    constructor(data) {
        this.root = data.root;
        this.idToNode = data.idToNode;
        this.snapshotId = data.snapshotId;
        this.selectedElementUid = data.selectedElementUid;
        this.hasSelectedElement = data.hasSelectedElement;
        this.verbose = data.verbose;
    }
    static async create(page, options = {}) {
        const verbose = options.verbose ?? false;
        const rootNode = await page.pptrPage.accessibility.snapshot({
            includeIframes: true,
            interestingOnly: !verbose,
        });
        if (!rootNode) {
            throw new Error('Failed to create accessibility snapshot');
        }
        const { uniqueBackendNodeIdToMcpId } = page;
        const snapshotId = TextSnapshot.nextSnapshotId++;
        // Iterate through the whole accessibility node tree and assign node ids that
        // will be used for the tree serialization and mapping ids back to nodes.
        let idCounter = 0;
        const idToNode = new Map();
        const seenUniqueIds = new Set();
        const seenBackendNodeIds = new Set();
        const assignIds = (node) => {
            let id = '';
            // @ts-expect-error untyped backendNodeId.
            const backendNodeId = node.backendNodeId;
            // @ts-expect-error untyped loaderId.
            const uniqueBackendId = `${node.loaderId}_${backendNodeId}`;
            const existingMcpId = uniqueBackendNodeIdToMcpId.get(uniqueBackendId);
            if (existingMcpId !== undefined) {
                // Re-use MCP exposed ID if the uniqueId is the same.
                id = existingMcpId;
            }
            else {
                // Only generate a new ID if we have not seen the node before.
                id = `${snapshotId}_${idCounter++}`;
                uniqueBackendNodeIdToMcpId.set(uniqueBackendId, id);
            }
            seenUniqueIds.add(uniqueBackendId);
            seenBackendNodeIds.add(backendNodeId);
            const nodeWithId = {
                ...node,
                id,
                children: node.children
                    ? node.children.map(child => assignIds(child))
                    : [],
            };
            // The AXNode for an option doesn't contain its `value`.
            // Therefore, set text content of the option as value.
            if (node.role === 'option') {
                const optionText = node.name;
                if (optionText) {
                    nodeWithId.value = optionText.toString();
                }
            }
            idToNode.set(nodeWithId.id, nodeWithId);
            return nodeWithId;
        };
        const rootNodeWithId = assignIds(rootNode);
        await TextSnapshot.insertExtraNodes(page, idToNode, seenUniqueIds, snapshotId, idCounter, rootNodeWithId, seenBackendNodeIds, options.extraHandles ?? []);
        const snapshot = new TextSnapshot({
            root: rootNodeWithId,
            snapshotId: String(snapshotId),
            idToNode,
            hasSelectedElement: false,
            verbose,
        });
        const data = options.devtoolsData ?? (await page.getDevToolsData());
        if (data?.cdpBackendNodeId) {
            snapshot.hasSelectedElement = true;
            snapshot.selectedElementUid = page.resolveCdpElementId(data.cdpBackendNodeId);
        }
        // Clean up unique IDs that we did not see anymore.
        for (const key of uniqueBackendNodeIdToMcpId.keys()) {
            if (!seenUniqueIds.has(key)) {
                uniqueBackendNodeIdToMcpId.delete(key);
            }
        }
        return snapshot;
    }
    // ExtraHandles represent DOM nodes which might not be part of the accessibility tree, e.g. DOM nodes
    // returned by in-page tools. We insert them into the tree by finding the closest ancestor in the
    // tree and inserting the node as a child. The ancestor's child nodes are re-parented if necessary.
    static async insertExtraNodes(page, idToNode, seenUniqueIds, snapshotId, idCounter, rootNodeWithId, seenBackendNodeIds, extraHandles) {
        const { uniqueBackendNodeIdToMcpId } = page;
        const createExtraNode = async (handle) => {
            const backendNodeId = await handle.backendNodeId();
            if (!backendNodeId || seenBackendNodeIds.has(backendNodeId)) {
                return null;
            }
            const uniqueBackendId = `custom_${backendNodeId}`;
            if (seenUniqueIds.has(uniqueBackendId)) {
                return null;
            }
            seenBackendNodeIds.add(backendNodeId);
            let id = '';
            const mcpId = uniqueBackendNodeIdToMcpId.get(uniqueBackendId);
            if (mcpId !== undefined) {
                id = mcpId;
            }
            else {
                id = `${snapshotId}_${idCounter++}`;
                uniqueBackendNodeIdToMcpId.set(uniqueBackendId, id);
            }
            seenUniqueIds.add(uniqueBackendId);
            const tagHandle = await handle.getProperty('localName');
            const tagValue = await tagHandle.jsonValue();
            const extraNode = {
                role: tagValue,
                id,
                backendNodeId,
                children: [],
                elementHandle: async () => handle,
            };
            return extraNode;
        };
        const findAncestorNode = async (handle) => {
            let ancestorHandle = await handle.evaluateHandle(el => el.parentElement);
            while (ancestorHandle) {
                const ancestorElement = ancestorHandle.asElement();
                if (!ancestorElement) {
                    await ancestorHandle.dispose();
                    return null;
                }
                const ancestorBackendId = await ancestorElement.backendNodeId();
                if (ancestorBackendId) {
                    const ancestorNode = idToNode
                        .values()
                        .find(node => node.backendNodeId === ancestorBackendId);
                    if (ancestorNode) {
                        await ancestorHandle.dispose();
                        return ancestorNode;
                    }
                }
                const nextHandle = await ancestorElement.evaluateHandle(el => el.parentElement);
                await ancestorHandle.dispose();
                ancestorHandle = nextHandle;
            }
            return null;
        };
        const findDescendantNodes = async (backendNodeId) => {
            const descendantIds = new Set();
            try {
                // @ts-expect-error internal API
                const client = page.pptrPage._client();
                if (client) {
                    const { node } = await client.send('DOM.describeNode', {
                        backendNodeId,
                        depth: -1,
                        pierce: true,
                    });
                    const collect = (node) => {
                        if (node.backendNodeId && node.backendNodeId !== backendNodeId) {
                            descendantIds.add(node.backendNodeId);
                        }
                        if (node.children) {
                            for (const child of node.children) {
                                collect(child);
                            }
                        }
                    };
                    collect(node);
                }
            }
            catch (e) {
                logger(`Failed to collect descendants for backend node ${backendNodeId}`, e);
            }
            return descendantIds;
        };
        const moveChildNodes = (attachTarget, extraNode, descendantIds) => {
            let firstMovedIndex = -1;
            if (descendantIds.size > 0 && attachTarget.children) {
                const remainingChildren = [];
                for (const child of attachTarget.children) {
                    if (child.backendNodeId && descendantIds.has(child.backendNodeId)) {
                        if (firstMovedIndex === -1) {
                            firstMovedIndex = remainingChildren.length;
                        }
                        extraNode.children.push(child);
                    }
                    else {
                        remainingChildren.push(child);
                    }
                }
                attachTarget.children = remainingChildren;
            }
            return firstMovedIndex !== -1
                ? firstMovedIndex
                : attachTarget.children
                    ? attachTarget.children.length
                    : 0;
        };
        if (extraHandles.length) {
            page.extraHandles = extraHandles;
        }
        for (const handle of page.extraHandles) {
            const extraNode = await createExtraNode(handle);
            if (!extraNode) {
                continue;
            }
            idToNode.set(extraNode.id, extraNode);
            const attachTarget = (await findAncestorNode(handle)) || rootNodeWithId;
            if (extraNode.backendNodeId !== undefined) {
                const descendantIds = await findDescendantNodes(extraNode.backendNodeId);
                const index = moveChildNodes(attachTarget, extraNode, descendantIds);
                attachTarget.children.splice(index, 0, extraNode);
            }
        }
    }
}
