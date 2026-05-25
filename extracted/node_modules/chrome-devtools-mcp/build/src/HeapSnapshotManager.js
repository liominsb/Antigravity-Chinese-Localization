/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { DevTools } from './third_party/index.js';
import { createIdGenerator, stableIdSymbol, } from './utils/id.js';
export class HeapSnapshotManager {
    #snapshots = new Map();
    async getSnapshot(filePath) {
        const absolutePath = path.resolve(filePath);
        const cached = this.#snapshots.get(absolutePath);
        if (cached) {
            return cached.snapshot;
        }
        const { snapshot, worker } = await this.#loadSnapshot(absolutePath);
        this.#snapshots.set(absolutePath, {
            snapshot,
            worker,
            uidToClassKey: new Map(),
            classKeyToUid: new Map(),
            idGenerator: createIdGenerator(),
        });
        return snapshot;
    }
    async getAggregates(filePath) {
        const snapshot = await this.getSnapshot(filePath);
        const filter = new DevTools.HeapSnapshotModel.HeapSnapshotModel.NodeFilter();
        const aggregates = await snapshot.aggregatesWithFilter(filter);
        for (const key of Object.keys(aggregates)) {
            const uid = await this.getOrCreateUidForClassKey(filePath, key);
            const aggregate = aggregates[key];
            if (aggregate) {
                aggregate[stableIdSymbol] = uid;
            }
        }
        return aggregates;
    }
    async getStats(filePath) {
        const snapshot = await this.getSnapshot(filePath);
        return await snapshot.getStatistics();
    }
    async getStaticData(filePath) {
        const snapshot = await this.getSnapshot(filePath);
        return snapshot.staticData;
    }
    async getOrCreateUidForClassKey(filePath, classKey) {
        const cached = this.#getCachedSnapshot(filePath);
        let uid = cached.classKeyToUid.get(classKey);
        if (!uid) {
            uid = cached.idGenerator();
            cached.classKeyToUid.set(classKey, uid);
            cached.uidToClassKey.set(uid, classKey);
        }
        return uid;
    }
    #getCachedSnapshot(filePath) {
        const absolutePath = path.resolve(filePath);
        const cached = this.#snapshots.get(absolutePath);
        if (!cached) {
            throw new Error(`Snapshot not loaded for ${filePath}`);
        }
        return cached;
    }
    async #loadSnapshot(absolutePath) {
        const workerProxy = new DevTools.HeapSnapshotModel.HeapSnapshotProxy.HeapSnapshotWorkerProxy(() => {
            /* noop */
        }, import.meta.resolve('./third_party/devtools-heap-snapshot-worker.js'));
        const { promise: snapshotPromise, resolve: resolveSnapshot } = Promise.withResolvers();
        const loaderProxy = workerProxy.createLoader(1, snapshotProxy => {
            resolveSnapshot(snapshotProxy);
        });
        const fileStream = fsSync.createReadStream(absolutePath, {
            encoding: 'utf-8',
            highWaterMark: 1024 * 1024,
        });
        for await (const chunk of fileStream) {
            await loaderProxy.write(chunk);
        }
        await loaderProxy.close();
        const snapshot = await snapshotPromise;
        return { snapshot, worker: workerProxy };
    }
    dispose(filePath) {
        const absolutePath = path.resolve(filePath);
        const cached = this.#snapshots.get(absolutePath);
        if (cached) {
            cached.worker.dispose();
            this.#snapshots.delete(absolutePath);
        }
    }
}
