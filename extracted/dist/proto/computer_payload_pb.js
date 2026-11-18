"use strict";
// Copyright Exafunction, Inc.
//
// Payload messages of the `computer` actuator type for the shared
// ActuatorService. Messages only: the envelope (request ids, conversation ids,
// blobs, status, lease notices) is exa.actuator_pb.
//
// Source of truth. The AGY Hub's proto/computer_payload.proto is generated
// from this file by its SDK sync script (copybara:strip lines removed); never
// edit the copy by hand.
//
// R3, R4 and R5 in comments below are, in short: R3 the browser URL policy
// (ComputerUrlPolicy, fail-closed), R4 the app-confinement level the actuator
// enforces (ComputerHello.app_confinement_version), R5 idempotent redispatch
// of a repeated request ID. computeriface's package doc defines them.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComputerPageVerdictSchema = exports.ComputerPageVerdict = exports.ComputerActionTypeSchema = exports.ComputerActionType = exports.ComputerWindowGeometrySchema = exports.ComputerNamedScreenshotSchema = exports.ComputerCompletedOpSchema = exports.ComputerResultSchema = exports.ComputerActionResultSchema = exports.ComputerBrowserPageSchema = exports.ComputerUrlPolicySchema = exports.ComputerRectSchema = exports.ComputerRequestSchema = exports.ComputerVisualHintSchema = exports.ComputerActionSchema = exports.ComputerHelloSchema = exports.ComputerGrantsSchema = exports.ComputerGeometrySchema = exports.file_computer_payload = void 0;
const codegenv2_1 = require("@bufbuild/protobuf/codegenv2");
/**
 * Describes the file computer_payload.proto.
 */
exports.file_computer_payload = (0, codegenv2_1.fileDesc)("ChZjb21wdXRlcl9wYXlsb2FkLnByb3RvEhdleGEuY29tcHV0ZXJfcGF5bG9hZF9wYiKWAQoQQ29tcHV0ZXJHZW9tZXRyeRISCgpkaXNwbGF5X2lkGAEgASgNEhQKDHdpZHRoX3BvaW50cxgCIAEoARIVCg1oZWlnaHRfcG9pbnRzGAMgASgBEhQKDHdpZHRoX3BpeGVscxgEIAEoDRIVCg1oZWlnaHRfcGl4ZWxzGAUgASgNEhQKDHNjYWxlX2ZhY3RvchgGIAEoASJBCg5Db21wdXRlckdyYW50cxIVCg1hY2Nlc3NpYmlsaXR5GAEgASgIEhgKEHNjcmVlbl9yZWNvcmRpbmcYAiABKAgiigIKDUNvbXB1dGVySGVsbG8SPwoMbWFpbl9kaXNwbGF5GAEgASgLMikuZXhhLmNvbXB1dGVyX3BheWxvYWRfcGIuQ29tcHV0ZXJHZW9tZXRyeRI3CgZncmFudHMYAiABKAsyJy5leGEuY29tcHV0ZXJfcGF5bG9hZF9wYi5Db21wdXRlckdyYW50cxISCgpvc192ZXJzaW9uGAMgASgJEhYKDmhlbHBlcl92ZXJzaW9uGAQgASgJEh8KF2FwcF9jb25maW5lbWVudF92ZXJzaW9uGAUgASgNEhkKEWNvbmN1cnJlbnRfYWdlbnRzGAYgASgIEhcKD3N1cHBvcnRzX3NjcmlwdBgHIAEoCCKrAwoOQ29tcHV0ZXJBY3Rpb24SOQoEdHlwZRgBIAEoDjIrLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyQWN0aW9uVHlwZRIRCgloYXNfcG9pbnQYAiABKAgSEAoIeF9wb2ludHMYAyABKAESEAoIeV9wb2ludHMYBCABKAESEwoLdG9feF9wb2ludHMYBSABKAESEwoLdG9feV9wb2ludHMYBiABKAESEQoJbW9kaWZpZXJzGAcgAygJEgwKBHRleHQYCCABKAkSDAoEa2V5cxgJIAEoCRIRCglzY3JvbGxfZHgYCiABKAUSEQoJc2Nyb2xsX2R5GAsgASgFEg8KB3dhaXRfbXMYDCABKA0SCwoDYXBwGA0gASgJEgsKA3JlZhgOIAEoCRIPCgdjb25maXJtGA8gASgIEhcKD2luY2x1ZGVfbWVudWJhchgQIAEoCBIRCgl3aW5kb3dfaWQYESABKA0SQAoLdmlzdWFsX2hpbnQYEiABKAsyKy5leGEuY29tcHV0ZXJfcGF5bG9hZF9wYi5Db21wdXRlclZpc3VhbEhpbnQiKgoSQ29tcHV0ZXJWaXN1YWxIaW50EgkKAXUYASABKAESCQoBdhgCIAEoASLuAwoPQ29tcHV0ZXJSZXF1ZXN0EhgKEGxlYXNlX2dlbmVyYXRpb24YASABKAQSGwoTZXhwZWN0ZWRfZGlzcGxheV9pZBgCIAEoDRIdChVleHBlY3RlZF93aWR0aF9wb2ludHMYAyABKAESHgoWZXhwZWN0ZWRfaGVpZ2h0X3BvaW50cxgEIAEoARI4CgdhY3Rpb25zGAUgAygLMicuZXhhLmNvbXB1dGVyX3BheWxvYWRfcGIuQ29tcHV0ZXJBY3Rpb24SFQoNY2FwdHVyZV9hZnRlchgGIAEoCBIRCglzZXR0bGVfbXMYByABKA0SIwobbWF4X3NjcmVlbnNob3RfbG9uZ19lZGdlX3B4GAggASgNEhEKCXJlYWRfb25seRgJIAEoCBIaChJhbGxvd2VkX2J1bmRsZV9pZHMYCiADKAkSPgoKdXJsX3BvbGljeRgLIAEoCzIqLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyVXJsUG9saWN5EhIKCmZvcmVncm91bmQYDCABKAgSGQoRYXhfc25hcHNob3RfYWZ0ZXIYDSABKAgSEwoLYWN0b3JfbGFiZWwYDiABKAkSGQoRbG9ja2VkX2J1bmRsZV9pZHMYDyADKAkSDgoGc2NyaXB0GBAgASgJIl8KDENvbXB1dGVyUmVjdBIQCgh4X3BvaW50cxgBIAEoARIQCgh5X3BvaW50cxgCIAEoARIUCgx3aWR0aF9wb2ludHMYAyABKAESFQoNaGVpZ2h0X3BvaW50cxgEIAEoASKjAQoRQ29tcHV0ZXJVcmxQb2xpY3kSDwoHZW5mb3JjZRgBIAEoCBINCgVlcG9jaBgGIAEoBBIeChZwb2xpY3lfYmxvY2tlZF9kb21haW5zGAcgAygJSgQIAhAGUg9hbGxvd2VkX2RvbWFpbnNSD2Jsb2NrZWRfZG9tYWluc1IVYmxvY2tfcHJpdmF0ZV9uZXR3b3JrUg9hbGxvd2VkX3NjaGVtZXMilAEKE0NvbXB1dGVyQnJvd3NlclBhZ2USEQoJYnVuZGxlX2lkGAEgASgJEgwKBGhvc3QYAiABKAkSCwoDdXJsGAMgASgJEj0KB3ZlcmRpY3QYBCABKA4yLC5leGEuY29tcHV0ZXJfcGF5bG9hZF9wYi5Db21wdXRlclBhZ2VWZXJkaWN0EhAKCHJlZGFjdGVkGAUgASgIIsQBChRDb21wdXRlckFjdGlvblJlc3VsdBINCgVpbmRleBgBIAEoDRIKCgJvaxgCIAEoCBISCgplcnJvcl9jb2RlGAMgASgJEg0KBWVycm9yGAQgASgJEhoKEnJlc29sdmVkX2J1bmRsZV9pZBgFIAEoCRIUCgxibG9ja2VkX2hvc3QYBiABKAkSPAoNdGFyZ2V0X2JvdW5kcxgHIAEoCzIlLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyUmVjdCLtBQoOQ29tcHV0ZXJSZXN1bHQSCgoCb2sYASABKAgSEgoKZXJyb3JfY29kZRgCIAEoCRINCgVlcnJvchgDIAEoCRI+CgdyZXN1bHRzGAQgAygLMi0uZXhhLmNvbXB1dGVyX3BheWxvYWRfcGIuQ29tcHV0ZXJBY3Rpb25SZXN1bHQSGQoRY29tcGxldGVkX2FjdGlvbnMYBSABKA0SGwoTc2NyZWVuc2hvdF93aWR0aF9weBgGIAEoDRIcChRzY3JlZW5zaG90X2hlaWdodF9weBgHIAEoDRI7CghnZW9tZXRyeRgIIAEoCzIpLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyR2VvbWV0cnkSGAoQZm9jdXNlZF9hcHBfbmFtZRgJIAEoCRIZChFmb2N1c2VkX2J1bmRsZV9pZBgKIAEoCRITCgtmb2N1c2VkX3BpZBgLIAEoBRIcChRmb2N1c2VkX3dpbmRvd190aXRsZRgMIAEoCRJDCg1icm93c2VyX3BhZ2VzGA0gAygLMiwuZXhhLmNvbXB1dGVyX3BheWxvYWRfcGIuQ29tcHV0ZXJCcm93c2VyUGFnZRIYChBheF9zbmFwc2hvdF90ZXh0GA4gASgJEkgKD3dpbmRvd19nZW9tZXRyeRgPIAEoCzIvLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyV2luZG93R2VvbWV0cnkSQwoNY29tcGxldGVkX29wcxgQIAMoCzIsLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyQ29tcGxldGVkT3ASGwoTdG90YWxfY29tcGxldGVkX29wcxgRIAEoDRIZChFzY3JpcHRfdmFsdWVfanNvbhgSIAEoCRJLChFleHRyYV9zY3JlZW5zaG90cxgTIAMoCzIwLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyTmFtZWRTY3JlZW5zaG90Il8KE0NvbXB1dGVyQ29tcGxldGVkT3ASCwoDc2VxGAEgASgNEg4KBm1ldGhvZBgCIAEoCRILCgNhcHAYAyABKAkSDgoGdGFyZ2V0GAQgASgJEg4KBnN0YXR1cxgFIAEoCSJwChdDb21wdXRlck5hbWVkU2NyZWVuc2hvdBIMCgRuYW1lGAEgASgJEhIKCmJsb2JfaW5kZXgYAiABKA0SEAoId2lkdGhfcHgYAyABKA0SEQoJaGVpZ2h0X3B4GAQgASgNEg4KBmFwcF9pZBgFIAEoCSKBAQoWQ29tcHV0ZXJXaW5kb3dHZW9tZXRyeRIRCgl3aW5kb3dfaWQYASABKA0SEQoJYnVuZGxlX2lkGAIgASgJEhQKDHdpZHRoX3BvaW50cxgDIAEoARIVCg1oZWlnaHRfcG9pbnRzGAQgASgBEhQKDHNjYWxlX2ZhY3RvchgFIAEoASqyBQoSQ29tcHV0ZXJBY3Rpb25UeXBlEiQKIENPTVBVVEVSX0FDVElPTl9UWVBFX1VOU1BFQ0lGSUVEEAASIwofQ09NUFVURVJfQUNUSU9OX1RZUEVfU0NSRUVOU0hPVBABEh4KGkNPTVBVVEVSX0FDVElPTl9UWVBFX0NMSUNLEAISJQohQ09NUFVURVJfQUNUSU9OX1RZUEVfRE9VQkxFX0NMSUNLEAMSJAogQ09NUFVURVJfQUNUSU9OX1RZUEVfUklHSFRfQ0xJQ0sQBBIdChlDT01QVVRFUl9BQ1RJT05fVFlQRV9NT1ZFEAUSHQoZQ09NUFVURVJfQUNUSU9OX1RZUEVfRFJBRxAGEh0KGUNPTVBVVEVSX0FDVElPTl9UWVBFX1RZUEUQBxIcChhDT01QVVRFUl9BQ1RJT05fVFlQRV9LRVkQCBIfChtDT01QVVRFUl9BQ1RJT05fVFlQRV9TQ1JPTEwQCRIdChlDT01QVVRFUl9BQ1RJT05fVFlQRV9XQUlUEAoSIgoeQ09NUFVURVJfQUNUSU9OX1RZUEVfRk9DVVNfQVBQEAsSIQodQ09NUFVURVJfQUNUSU9OX1RZUEVfQklORF9BUFAQDBIkCiBDT01QVVRFUl9BQ1RJT05fVFlQRV9BWF9TTkFQU0hPVBANEiEKHUNPTVBVVEVSX0FDVElPTl9UWVBFX0FYX1BSRVNTEA4SJQohQ09NUFVURVJfQUNUSU9OX1RZUEVfQVhfU0VUX1ZBTFVFEA8SIgoeQ09NUFVURVJfQUNUSU9OX1RZUEVfQVhfU0VMRUNUEBASIgoeQ09NUFVURVJfQUNUSU9OX1RZUEVfQVhfU0NST0xMEBESKgomQ09NUFVURVJfQUNUSU9OX1RZUEVfV0lORE9XX1NDUkVFTlNIT1QQEiqjAgoTQ29tcHV0ZXJQYWdlVmVyZGljdBIlCiFDT01QVVRFUl9QQUdFX1ZFUkRJQ1RfVU5TUEVDSUZJRUQQABIhCh1DT01QVVRFUl9QQUdFX1ZFUkRJQ1RfQUxMT1dFRBABEiEKHUNPTVBVVEVSX1BBR0VfVkVSRElDVF9ORVVUUkFMEAISKgomQ09NUFVURVJfUEFHRV9WRVJESUNUX05FRURTX1BFUk1JU1NJT04QAxIkCiBDT01QVVRFUl9QQUdFX1ZFUkRJQ1RfVU5SRUFEQUJMRRAFEigKJENPTVBVVEVSX1BBR0VfVkVSRElDVF9QT0xJQ1lfQkxPQ0tFRBAGIgQIBBAEKh1DT01QVVRFUl9QQUdFX1ZFUkRJQ1RfQkxPQ0tFRGIGcHJvdG8z");
/**
 * Describes the message exa.computer_payload_pb.ComputerGeometry.
 * Use `create(ComputerGeometrySchema)` to create a new message.
 */
exports.ComputerGeometrySchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 0);
/**
 * Describes the message exa.computer_payload_pb.ComputerGrants.
 * Use `create(ComputerGrantsSchema)` to create a new message.
 */
exports.ComputerGrantsSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 1);
/**
 * Describes the message exa.computer_payload_pb.ComputerHello.
 * Use `create(ComputerHelloSchema)` to create a new message.
 */
exports.ComputerHelloSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 2);
/**
 * Describes the message exa.computer_payload_pb.ComputerAction.
 * Use `create(ComputerActionSchema)` to create a new message.
 */
exports.ComputerActionSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 3);
/**
 * Describes the message exa.computer_payload_pb.ComputerVisualHint.
 * Use `create(ComputerVisualHintSchema)` to create a new message.
 */
exports.ComputerVisualHintSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 4);
/**
 * Describes the message exa.computer_payload_pb.ComputerRequest.
 * Use `create(ComputerRequestSchema)` to create a new message.
 */
exports.ComputerRequestSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 5);
/**
 * Describes the message exa.computer_payload_pb.ComputerRect.
 * Use `create(ComputerRectSchema)` to create a new message.
 */
exports.ComputerRectSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 6);
/**
 * Describes the message exa.computer_payload_pb.ComputerUrlPolicy.
 * Use `create(ComputerUrlPolicySchema)` to create a new message.
 */
exports.ComputerUrlPolicySchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 7);
/**
 * Describes the message exa.computer_payload_pb.ComputerBrowserPage.
 * Use `create(ComputerBrowserPageSchema)` to create a new message.
 */
exports.ComputerBrowserPageSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 8);
/**
 * Describes the message exa.computer_payload_pb.ComputerActionResult.
 * Use `create(ComputerActionResultSchema)` to create a new message.
 */
exports.ComputerActionResultSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 9);
/**
 * Describes the message exa.computer_payload_pb.ComputerResult.
 * Use `create(ComputerResultSchema)` to create a new message.
 */
exports.ComputerResultSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 10);
/**
 * Describes the message exa.computer_payload_pb.ComputerCompletedOp.
 * Use `create(ComputerCompletedOpSchema)` to create a new message.
 */
exports.ComputerCompletedOpSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 11);
/**
 * Describes the message exa.computer_payload_pb.ComputerNamedScreenshot.
 * Use `create(ComputerNamedScreenshotSchema)` to create a new message.
 */
exports.ComputerNamedScreenshotSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 12);
/**
 * Describes the message exa.computer_payload_pb.ComputerWindowGeometry.
 * Use `create(ComputerWindowGeometrySchema)` to create a new message.
 */
exports.ComputerWindowGeometrySchema = (0, codegenv2_1.messageDesc)(exports.file_computer_payload, 13);
/**
 * @generated from enum exa.computer_payload_pb.ComputerActionType
 */
var ComputerActionType;
(function (ComputerActionType) {
    /**
     * @generated from enum value: COMPUTER_ACTION_TYPE_UNSPECIFIED = 0;
     */
    ComputerActionType[ComputerActionType["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /**
     * @generated from enum value: COMPUTER_ACTION_TYPE_SCREENSHOT = 1;
     */
    ComputerActionType[ComputerActionType["SCREENSHOT"] = 1] = "SCREENSHOT";
    /**
     * left click
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_CLICK = 2;
     */
    ComputerActionType[ComputerActionType["CLICK"] = 2] = "CLICK";
    /**
     * @generated from enum value: COMPUTER_ACTION_TYPE_DOUBLE_CLICK = 3;
     */
    ComputerActionType[ComputerActionType["DOUBLE_CLICK"] = 3] = "DOUBLE_CLICK";
    /**
     * @generated from enum value: COMPUTER_ACTION_TYPE_RIGHT_CLICK = 4;
     */
    ComputerActionType[ComputerActionType["RIGHT_CLICK"] = 4] = "RIGHT_CLICK";
    /**
     * @generated from enum value: COMPUTER_ACTION_TYPE_MOVE = 5;
     */
    ComputerActionType[ComputerActionType["MOVE"] = 5] = "MOVE";
    /**
     * left-button drag x,y -> to_x,to_y
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_DRAG = 6;
     */
    ComputerActionType[ComputerActionType["DRAG"] = 6] = "DRAG";
    /**
     * unicode text; "\n" = Return
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_TYPE = 7;
     */
    ComputerActionType[ComputerActionType["TYPE"] = 7] = "TYPE";
    /**
     * key combo, e.g. "cmd+shift+t"
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_KEY = 8;
     */
    ComputerActionType[ComputerActionType["KEY"] = 8] = "KEY";
    /**
     * at x,y (or current pointer if has_point=false)
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_SCROLL = 9;
     */
    ComputerActionType[ComputerActionType["SCROLL"] = 9] = "SCROLL";
    /**
     * @generated from enum value: COMPUTER_ACTION_TYPE_WAIT = 10;
     */
    ComputerActionType[ComputerActionType["WAIT"] = 10] = "WAIT";
    /**
     * activate, launching if needed
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_FOCUS_APP = 11;
     */
    ComputerActionType[ComputerActionType["FOCUS_APP"] = 11] = "FOCUS_APP";
    /**
     * Background actions (app_confinement_version >= 3). They never activate an
     * app, move the cursor or post HID events: they use the app's
     * accessibility (AX) tree and window-scoped capture, so the user keeps
     * working. Every AX call is confined like input (deny list,
     * allowed_bundle_ids, R3 for browsers), re-checked on the element's pid.
     *
     * attach or launch app without activating it
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_BIND_APP = 12;
     */
    ComputerActionType[ComputerActionType["BIND_APP"] = 12] = "BIND_APP";
    /**
     * app's AX tree as text with refs
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_AX_SNAPSHOT = 13;
     */
    ComputerActionType[ComputerActionType["AX_SNAPSHOT"] = 13] = "AX_SNAPSHOT";
    /**
     * press the element ref
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_AX_PRESS = 14;
     */
    ComputerActionType[ComputerActionType["AX_PRESS"] = 14] = "AX_PRESS";
    /**
     * set ref's value to text
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_AX_SET_VALUE = 15;
     */
    ComputerActionType[ComputerActionType["AX_SET_VALUE"] = 15] = "AX_SET_VALUE";
    /**
     * select ref (row, tab, item)
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_AX_SELECT = 16;
     */
    ComputerActionType[ComputerActionType["AX_SELECT"] = 16] = "AX_SELECT";
    /**
     * scroll ref's scroll area
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_AX_SCROLL = 17;
     */
    ComputerActionType[ComputerActionType["AX_SCROLL"] = 17] = "AX_SCROLL";
    /**
     * capture app's window only
     *
     * @generated from enum value: COMPUTER_ACTION_TYPE_WINDOW_SCREENSHOT = 18;
     */
    ComputerActionType[ComputerActionType["WINDOW_SCREENSHOT"] = 18] = "WINDOW_SCREENSHOT";
})(ComputerActionType || (exports.ComputerActionType = ComputerActionType = {}));
/**
 * Describes the enum exa.computer_payload_pb.ComputerActionType.
 */
exports.ComputerActionTypeSchema = (0, codegenv2_1.enumDesc)(exports.file_computer_payload, 0);
/**
 * @generated from enum exa.computer_payload_pb.ComputerPageVerdict
 */
var ComputerPageVerdict;
(function (ComputerPageVerdict) {
    /**
     * @generated from enum value: COMPUTER_PAGE_VERDICT_UNSPECIFIED = 0;
     */
    ComputerPageVerdict[ComputerPageVerdict["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /**
     * @generated from enum value: COMPUTER_PAGE_VERDICT_ALLOWED = 1;
     */
    ComputerPageVerdict[ComputerPageVerdict["ALLOWED"] = 1] = "ALLOWED";
    /**
     * about:blank, new tab, start page
     *
     * @generated from enum value: COMPUTER_PAGE_VERDICT_NEUTRAL = 2;
     */
    ComputerPageVerdict[ComputerPageVerdict["NEUTRAL"] = 2] = "NEUTRAL";
    /**
     * refused because enforce is set
     *
     * @generated from enum value: COMPUTER_PAGE_VERDICT_NEEDS_PERMISSION = 3;
     */
    ComputerPageVerdict[ComputerPageVerdict["NEEDS_PERMISSION"] = 3] = "NEEDS_PERMISSION";
    /**
     * the window's URL can't be verified
     *
     * @generated from enum value: COMPUTER_PAGE_VERDICT_UNREADABLE = 5;
     */
    ComputerPageVerdict[ComputerPageVerdict["UNREADABLE"] = 5] = "UNREADABLE";
    /**
     * compliance hard deny
     *
     * @generated from enum value: COMPUTER_PAGE_VERDICT_POLICY_BLOCKED = 6;
     */
    ComputerPageVerdict[ComputerPageVerdict["POLICY_BLOCKED"] = 6] = "POLICY_BLOCKED";
})(ComputerPageVerdict || (exports.ComputerPageVerdict = ComputerPageVerdict = {}));
/**
 * Describes the enum exa.computer_payload_pb.ComputerPageVerdict.
 */
exports.ComputerPageVerdictSchema = (0, codegenv2_1.enumDesc)(exports.file_computer_payload, 1);
