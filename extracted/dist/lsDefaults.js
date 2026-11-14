"use strict";
// Every LS's base flags. No Electron imports: pure modules use this file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.LS_CLOUD_CODE_ENDPOINT = exports.LS_API_SERVER_URL = void 0;
exports.baseLsArgs = baseLsArgs;
exports.LS_API_SERVER_URL = 'https://generativelanguage.googleapis.com';
exports.LS_CLOUD_CODE_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com';
function baseLsArgs(opts) {
    return [
        '--standalone',
        '--override_ide_name',
        'antigravity',
        '--subclient_type',
        'hub',
        '--override_ide_version',
        opts.ideVersion,
        '--override_user_agent_name',
        'antigravity',
        '--https_server_port',
        String(opts.httpsServerPort),
        '--csrf_token',
        opts.csrfToken,
        '--app_data_dir',
        opts.appDataDir,
        '--api_server_url',
        exports.LS_API_SERVER_URL,
        '--cloud_code_endpoint',
        exports.LS_CLOUD_CODE_ENDPOINT,
    ];
}
