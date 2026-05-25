/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Enums
export var OsType;
(function (OsType) {
    OsType[OsType["OS_TYPE_UNSPECIFIED"] = 0] = "OS_TYPE_UNSPECIFIED";
    OsType[OsType["OS_TYPE_WINDOWS"] = 1] = "OS_TYPE_WINDOWS";
    OsType[OsType["OS_TYPE_MACOS"] = 2] = "OS_TYPE_MACOS";
    OsType[OsType["OS_TYPE_LINUX"] = 3] = "OS_TYPE_LINUX";
})(OsType || (OsType = {}));
export var ChromeChannel;
(function (ChromeChannel) {
    ChromeChannel[ChromeChannel["CHROME_CHANNEL_UNSPECIFIED"] = 0] = "CHROME_CHANNEL_UNSPECIFIED";
    ChromeChannel[ChromeChannel["CHROME_CHANNEL_CANARY"] = 1] = "CHROME_CHANNEL_CANARY";
    ChromeChannel[ChromeChannel["CHROME_CHANNEL_DEV"] = 2] = "CHROME_CHANNEL_DEV";
    ChromeChannel[ChromeChannel["CHROME_CHANNEL_BETA"] = 3] = "CHROME_CHANNEL_BETA";
    ChromeChannel[ChromeChannel["CHROME_CHANNEL_STABLE"] = 4] = "CHROME_CHANNEL_STABLE";
})(ChromeChannel || (ChromeChannel = {}));
export var McpClient;
(function (McpClient) {
    McpClient[McpClient["MCP_CLIENT_UNSPECIFIED"] = 0] = "MCP_CLIENT_UNSPECIFIED";
    McpClient[McpClient["MCP_CLIENT_CLAUDE_CODE"] = 1] = "MCP_CLIENT_CLAUDE_CODE";
    McpClient[McpClient["MCP_CLIENT_GEMINI_CLI"] = 2] = "MCP_CLIENT_GEMINI_CLI";
    McpClient[McpClient["MCP_CLIENT_DT_MCP_CLI"] = 4] = "MCP_CLIENT_DT_MCP_CLI";
    McpClient[McpClient["MCP_CLIENT_OPENCLAW"] = 5] = "MCP_CLIENT_OPENCLAW";
    McpClient[McpClient["MCP_CLIENT_CODEX"] = 6] = "MCP_CLIENT_CODEX";
    McpClient[McpClient["MCP_CLIENT_ANTIGRAVITY"] = 7] = "MCP_CLIENT_ANTIGRAVITY";
    McpClient[McpClient["MCP_CLIENT_OTHER"] = 3] = "MCP_CLIENT_OTHER";
})(McpClient || (McpClient = {}));
// IPC types for messages between the main process and the
// telemetry watchdog process.
export var WatchdogMessageType;
(function (WatchdogMessageType) {
    WatchdogMessageType["LOG_EVENT"] = "log-event";
})(WatchdogMessageType || (WatchdogMessageType = {}));
