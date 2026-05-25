/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { stableIdSymbol } from '../utils/id.js';
export class HeapSnapshotFormatter {
    #aggregates;
    constructor(aggregates) {
        this.#aggregates = aggregates;
    }
    #getSortedAggregates() {
        return Object.values(this.#aggregates).sort((a, b) => b.self - a.self);
    }
    toString() {
        const sorted = this.#getSortedAggregates();
        const lines = [];
        lines.push('uid,className,count,selfSize,maxRetainedSize');
        for (const info of sorted) {
            const uid = info[stableIdSymbol] ?? '';
            lines.push(`${uid},"${info.name}",${info.count},${info.self},${info.maxRet}`);
        }
        return lines.join('\n');
    }
    toJSON() {
        const sorted = this.#getSortedAggregates();
        return sorted.map(info => ({
            uid: info[stableIdSymbol],
            className: info.name,
            count: info.count,
            selfSize: info.self,
            retainedSize: info.maxRet,
        }));
    }
    static sort(aggregates) {
        return Object.entries(aggregates).sort((a, b) => b[1].self - a[1].self);
    }
}
