/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../third_party/index.js';
export function defineTool(definition) {
    if (typeof definition === 'function') {
        const factory = definition;
        return (args) => {
            return factory(args);
        };
    }
    return definition;
}
export function definePageTool(definition) {
    if (typeof definition === 'function') {
        return (args) => {
            const tool = definition(args);
            return {
                ...tool,
                pageScoped: true,
            };
        };
    }
    return {
        ...definition,
        pageScoped: true,
    };
}
export const CLOSE_PAGE_ERROR = 'The last open page cannot be closed. It is fine to keep it open.';
export const pageIdSchema = {
    pageId: zod.number().optional().describe('Targets a specific page by ID.'),
};
export const timeoutSchema = {
    timeout: zod
        .number()
        .int()
        .optional()
        .describe(`Maximum wait time in milliseconds. If set to 0, the default timeout will be used.`)
        .transform(value => {
        return value && value <= 0 ? undefined : value;
    }),
};
export function viewportTransform(arg) {
    if (!arg) {
        return undefined;
    }
    const [dimensions, ...tags] = arg.split(',');
    const isMobile = tags.includes('mobile');
    const hasTouch = tags.includes('touch');
    const isLandscape = tags.includes('landscape');
    const [width, height, dpr] = dimensions.split('x').map(Number);
    return {
        width,
        height,
        deviceScaleFactor: dpr,
        isMobile: isMobile,
        isLandscape: isLandscape,
        hasTouch: hasTouch,
    };
}
export function geolocationTransform(arg) {
    if (!arg) {
        return undefined;
    }
    const [latitude, longitude] = arg.split('x').map(Number);
    return {
        latitude,
        longitude,
    };
}
