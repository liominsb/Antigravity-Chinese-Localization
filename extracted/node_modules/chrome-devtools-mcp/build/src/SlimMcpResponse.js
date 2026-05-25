/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpResponse } from './McpResponse.js';
export class SlimMcpResponse extends McpResponse {
    async handle(_toolName, _context) {
        const text = {
            type: 'text',
            text: this.responseLines.join('\n'),
        };
        return {
            content: [text],
            structuredContent: text,
        };
    }
}
