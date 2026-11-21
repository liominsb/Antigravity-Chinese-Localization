"use strict";
// Copyright Exafunction, Inc.
//
// Payload messages of the "browser_viewer" actuator type, carried as
// google.protobuf.Any in the ActuatorService envelope
// (third_party/jetski/actuator_pb/actuator.proto). The viewer reaches the
// Language Server over the authenticated remote-control channel via
// BrowserViewerService; WebRTC media travels peer to peer (or via TURN)
// between the viewer and the Desktop Hub browser host without traversing the
// Language Server, with pull-paced frame reads as a fallback.
//
// Source of truth. The AGY Hub's vendored browser_viewer.proto is generated
// from this file by its SDK sync script (copybara:strip lines removed); keep
// this file self-contained with zero cross-file dependencies and never edit
// the vendored copy by hand.
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserViewerControlActionSchema = exports.BrowserViewerControlAction = exports.BrowserViewerResultSchema = exports.BrowserViewerRequest_ReleaseControlSchema = exports.BrowserViewerRequest_TakeControlSchema = exports.BrowserViewerRequest_ReadFrameSchema = exports.BrowserViewerRequest_ControlSchema = exports.BrowserViewerRequest_ListTabsSchema = exports.BrowserViewerRequest_CloseSchema = exports.BrowserViewerRequest_RenewSchema = exports.BrowserViewerRequest_OfferSchema = exports.BrowserViewerRequestSchema = exports.BrowserViewerInputEvent_MouseButtonSchema = exports.BrowserViewerInputEvent_MouseButton = exports.BrowserViewerInputEvent_KindSchema = exports.BrowserViewerInputEvent_Kind = exports.BrowserViewerInputEventSchema = exports.BrowserTabInfoSchema = exports.BrowserViewerIceServerSchema = exports.BrowserViewerHelloSchema = exports.file_browser_viewer = void 0;
const codegenv2_1 = require("@bufbuild/protobuf/codegenv2");
/**
 * Describes the file browser_viewer.proto.
 */
exports.file_browser_viewer = (0, codegenv2_1.fileDesc)("ChRicm93c2VyX3ZpZXdlci5wcm90bxIdZXhhLmJyb3dzZXJfdmlld2VyX3BheWxvYWRfcGIiigEKEkJyb3dzZXJWaWV3ZXJIZWxsbxIUCgxtYXhfc2Vzc2lvbnMYASABKA0SFAoMdmlkZW9fY29kZWNzGAIgAygJEhIKCmhvc3RfbGFiZWwYAyABKAkSFwoPc3VwcG9ydHNfd2VicnRjGAQgASgIEhsKE3N1cHBvcnRzX2ZyYW1lX3JlYWQYBSABKAgiegoWQnJvd3NlclZpZXdlckljZVNlcnZlchIMCgR1cmxzGAEgAygJEhUKCHVzZXJuYW1lGAIgASgJQgOAAQESFwoKY3JlZGVudGlhbBgDIAEoCUIDgAEBEiIKGmNyZWRlbnRpYWxfZXhwaXJlc191bml4X21zGAQgASgDIrUBCg5Ccm93c2VyVGFiSW5mbxIOCgZ0YWJfaWQYASABKAkSHAoUcm9vdF9jb252ZXJzYXRpb25faWQYAiABKAkSCwoDdXJsGAMgASgJEg0KBXRpdGxlGAQgASgJEg4KBmFjdGl2ZRgFIAEoCBIPCgdsb2FkaW5nGAYgASgIEhMKC2FnZW50X293bmVkGAcgASgIEhAKCHdpZHRoX3B4GAggASgNEhEKCWhlaWdodF9weBgJIAEoDSLYBQoXQnJvd3NlclZpZXdlcklucHV0RXZlbnQSSQoEa2luZBgBIAEoDjI7LmV4YS5icm93c2VyX3ZpZXdlcl9wYXlsb2FkX3BiLkJyb3dzZXJWaWV3ZXJJbnB1dEV2ZW50LktpbmQSCQoBeBgCIAEoARIJCgF5GAMgASgBElIKBmJ1dHRvbhgEIAEoDjJCLmV4YS5icm93c2VyX3ZpZXdlcl9wYXlsb2FkX3BiLkJyb3dzZXJWaWV3ZXJJbnB1dEV2ZW50Lk1vdXNlQnV0dG9uEg8KB2J1dHRvbnMYBSABKAUSEwoLY2xpY2tfY291bnQYBiABKAUSEQoJbW9kaWZpZXJzGAcgASgFEg8KB2RlbHRhX3gYCCABKAESDwoHZGVsdGFfeRgJIAEoARILCgNrZXkYCiABKAkSDAoEY29kZRgLIAEoCRIQCghrZXlfY29kZRgMIAEoBRIOCgZyZXBlYXQYDSABKAgSDAoEdGV4dBgOIAEoCSKjAQoES2luZBIUChBLSU5EX1VOU1BFQ0lGSUVEEAASFQoRS0lORF9QT0lOVEVSX0RPV04QARITCg9LSU5EX1BPSU5URVJfVVAQAhIVChFLSU5EX1BPSU5URVJfTU9WRRADEg4KCktJTkRfV0hFRUwQBBIRCg1LSU5EX0tFWV9ET1dOEAUSDwoLS0lORF9LRVlfVVAQBhIOCgpLSU5EX1BBU1RFEAciuwEKC01vdXNlQnV0dG9uEhwKGE1PVVNFX0JVVFRPTl9VTlNQRUNJRklFRBAAEhUKEU1PVVNFX0JVVFRPTl9OT05FEAESFQoRTU9VU0VfQlVUVE9OX0xFRlQQAhIXChNNT1VTRV9CVVRUT05fTUlERExFEAMSFgoSTU9VU0VfQlVUVE9OX1JJR0hUEAQSFQoRTU9VU0VfQlVUVE9OX0JBQ0sQBRIYChRNT1VTRV9CVVRUT05fRk9SV0FSRBAGIr4KChRCcm93c2VyVmlld2VyUmVxdWVzdBIXCgpzZXNzaW9uX2lkGAEgASgJQgOAAQESSgoFb2ZmZXIYAiABKAsyOS5leGEuYnJvd3Nlcl92aWV3ZXJfcGF5bG9hZF9wYi5Ccm93c2VyVmlld2VyUmVxdWVzdC5PZmZlckgAEkoKBXJlbmV3GAMgASgLMjkuZXhhLmJyb3dzZXJfdmlld2VyX3BheWxvYWRfcGIuQnJvd3NlclZpZXdlclJlcXVlc3QuUmVuZXdIABJKCgVjbG9zZRgEIAEoCzI5LmV4YS5icm93c2VyX3ZpZXdlcl9wYXlsb2FkX3BiLkJyb3dzZXJWaWV3ZXJSZXF1ZXN0LkNsb3NlSAASUQoJbGlzdF90YWJzGAUgASgLMjwuZXhhLmJyb3dzZXJfdmlld2VyX3BheWxvYWRfcGIuQnJvd3NlclZpZXdlclJlcXVlc3QuTGlzdFRhYnNIABJOCgdjb250cm9sGAYgASgLMjsuZXhhLmJyb3dzZXJfdmlld2VyX3BheWxvYWRfcGIuQnJvd3NlclZpZXdlclJlcXVlc3QuQ29udHJvbEgAElMKCnJlYWRfZnJhbWUYByABKAsyPS5leGEuYnJvd3Nlcl92aWV3ZXJfcGF5bG9hZF9wYi5Ccm93c2VyVmlld2VyUmVxdWVzdC5SZWFkRnJhbWVIABJXCgx0YWtlX2NvbnRyb2wYCCABKAsyPy5leGEuYnJvd3Nlcl92aWV3ZXJfcGF5bG9hZF9wYi5Ccm93c2VyVmlld2VyUmVxdWVzdC5UYWtlQ29udHJvbEgAEl0KD3JlbGVhc2VfY29udHJvbBgJIAEoCzJCLmV4YS5icm93c2VyX3ZpZXdlcl9wYXlsb2FkX3BiLkJyb3dzZXJWaWV3ZXJSZXF1ZXN0LlJlbGVhc2VDb250cm9sSAAajgEKBU9mZmVyEhAKA3NkcBgBIAEoCUIDgAEBEg4KBnRhYl9pZBgCIAEoCRIXCg9leHBpcmVzX3VuaXhfbXMYAyABKAMSSgoLaWNlX3NlcnZlcnMYBCADKAsyNS5leGEuYnJvd3Nlcl92aWV3ZXJfcGF5bG9hZF9wYi5Ccm93c2VyVmlld2VySWNlU2VydmVyGiAKBVJlbmV3EhcKD2V4cGlyZXNfdW5peF9tcxgBIAEoAxoXCgVDbG9zZRIOCgZyZWFzb24YASABKAkaCgoITGlzdFRhYnMa2gEKB0NvbnRyb2wSDgoGdGFiX2lkGAEgASgJEkkKBmFjdGlvbhgCIAEoDjI5LmV4YS5icm93c2VyX3ZpZXdlcl9wYXlsb2FkX3BiLkJyb3dzZXJWaWV3ZXJDb250cm9sQWN0aW9uEgsKA3VybBgDIAEoCRJLCgtpbnB1dF9ldmVudBgEIAEoCzI2LmV4YS5icm93c2VyX3ZpZXdlcl9wYXlsb2FkX3BiLkJyb3dzZXJWaWV3ZXJJbnB1dEV2ZW50EhoKDWNvbnRyb2xfdG9rZW4YBSABKAlCA4ABARpICglSZWFkRnJhbWUSDgoGdGFiX2lkGAEgASgJEhQKDG1heF93aWR0aF9weBgCIAEoDRIVCg1tYXhfaGVpZ2h0X3B4GAMgASgNGjYKC1Rha2VDb250cm9sEg4KBnRhYl9pZBgBIAEoCRIXCg9leHBpcmVzX3VuaXhfbXMYAiABKAMaPAoOUmVsZWFzZUNvbnRyb2wSDgoGdGFiX2lkGAEgASgJEhoKDWNvbnRyb2xfdG9rZW4YAiABKAlCA4ABAUIECgJvcCKyAgoTQnJvd3NlclZpZXdlclJlc3VsdBISCgplcnJvcl9jb2RlGAEgASgJEg0KBWVycm9yGAIgASgJEhcKCmFuc3dlcl9zZHAYAyABKAlCA4ABARIRCglzdHJlYW1faWQYBCABKAkSOwoEdGFicxgFIAMoCzItLmV4YS5icm93c2VyX3ZpZXdlcl9wYXlsb2FkX3BiLkJyb3dzZXJUYWJJbmZvEjoKA3RhYhgGIAEoCzItLmV4YS5icm93c2VyX3ZpZXdlcl9wYXlsb2FkX3BiLkJyb3dzZXJUYWJJbmZvEhoKDWNvbnRyb2xfdG9rZW4YByABKAlCA4ABARIfChdjb250cm9sX2V4cGlyZXNfdW5peF9tcxgIIAEoAxIWCg5jb250cm9sX2FjdGl2ZRgJIAEoCCrLAgoaQnJvd3NlclZpZXdlckNvbnRyb2xBY3Rpb24SLQopQlJPV1NFUl9WSUVXRVJfQ09OVFJPTF9BQ1RJT05fVU5TUEVDSUZJRUQQABImCiJCUk9XU0VSX1ZJRVdFUl9DT05UUk9MX0FDVElPTl9TVE9QEAESKgomQlJPV1NFUl9WSUVXRVJfQ09OVFJPTF9BQ1RJT05fTkFWSUdBVEUQAhImCiJCUk9XU0VSX1ZJRVdFUl9DT05UUk9MX0FDVElPTl9CQUNLEAMSKQolQlJPV1NFUl9WSUVXRVJfQ09OVFJPTF9BQ1RJT05fRk9SV0FSRBAEEigKJEJST1dTRVJfVklFV0VSX0NPTlRST0xfQUNUSU9OX1JFTE9BRBAFEi0KKUJST1dTRVJfVklFV0VSX0NPTlRST0xfQUNUSU9OX0lOUFVUX0VWRU5UEAZiBnByb3RvMw");
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerHello.
 * Use `create(BrowserViewerHelloSchema)` to create a new message.
 */
exports.BrowserViewerHelloSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 0);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerIceServer.
 * Use `create(BrowserViewerIceServerSchema)` to create a new message.
 */
exports.BrowserViewerIceServerSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 1);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserTabInfo.
 * Use `create(BrowserTabInfoSchema)` to create a new message.
 */
exports.BrowserTabInfoSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 2);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerInputEvent.
 * Use `create(BrowserViewerInputEventSchema)` to create a new message.
 */
exports.BrowserViewerInputEventSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 3);
/**
 * @generated from enum exa.browser_viewer_payload_pb.BrowserViewerInputEvent.Kind
 */
var BrowserViewerInputEvent_Kind;
(function (BrowserViewerInputEvent_Kind) {
    /**
     * @generated from enum value: KIND_UNSPECIFIED = 0;
     */
    BrowserViewerInputEvent_Kind[BrowserViewerInputEvent_Kind["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /**
     * @generated from enum value: KIND_POINTER_DOWN = 1;
     */
    BrowserViewerInputEvent_Kind[BrowserViewerInputEvent_Kind["POINTER_DOWN"] = 1] = "POINTER_DOWN";
    /**
     * @generated from enum value: KIND_POINTER_UP = 2;
     */
    BrowserViewerInputEvent_Kind[BrowserViewerInputEvent_Kind["POINTER_UP"] = 2] = "POINTER_UP";
    /**
     * @generated from enum value: KIND_POINTER_MOVE = 3;
     */
    BrowserViewerInputEvent_Kind[BrowserViewerInputEvent_Kind["POINTER_MOVE"] = 3] = "POINTER_MOVE";
    /**
     * @generated from enum value: KIND_WHEEL = 4;
     */
    BrowserViewerInputEvent_Kind[BrowserViewerInputEvent_Kind["WHEEL"] = 4] = "WHEEL";
    /**
     * @generated from enum value: KIND_KEY_DOWN = 5;
     */
    BrowserViewerInputEvent_Kind[BrowserViewerInputEvent_Kind["KEY_DOWN"] = 5] = "KEY_DOWN";
    /**
     * @generated from enum value: KIND_KEY_UP = 6;
     */
    BrowserViewerInputEvent_Kind[BrowserViewerInputEvent_Kind["KEY_UP"] = 6] = "KEY_UP";
    /**
     * @generated from enum value: KIND_PASTE = 7;
     */
    BrowserViewerInputEvent_Kind[BrowserViewerInputEvent_Kind["PASTE"] = 7] = "PASTE";
})(BrowserViewerInputEvent_Kind || (exports.BrowserViewerInputEvent_Kind = BrowserViewerInputEvent_Kind = {}));
/**
 * Describes the enum exa.browser_viewer_payload_pb.BrowserViewerInputEvent.Kind.
 */
exports.BrowserViewerInputEvent_KindSchema = (0, codegenv2_1.enumDesc)(exports.file_browser_viewer, 3, 0);
/**
 * Offset from 0 so DOM button 0 (left) cannot collide with proto default 0.
 *
 * @generated from enum exa.browser_viewer_payload_pb.BrowserViewerInputEvent.MouseButton
 */
var BrowserViewerInputEvent_MouseButton;
(function (BrowserViewerInputEvent_MouseButton) {
    /**
     * @generated from enum value: MOUSE_BUTTON_UNSPECIFIED = 0;
     */
    BrowserViewerInputEvent_MouseButton[BrowserViewerInputEvent_MouseButton["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /**
     * @generated from enum value: MOUSE_BUTTON_NONE = 1;
     */
    BrowserViewerInputEvent_MouseButton[BrowserViewerInputEvent_MouseButton["NONE"] = 1] = "NONE";
    /**
     * @generated from enum value: MOUSE_BUTTON_LEFT = 2;
     */
    BrowserViewerInputEvent_MouseButton[BrowserViewerInputEvent_MouseButton["LEFT"] = 2] = "LEFT";
    /**
     * @generated from enum value: MOUSE_BUTTON_MIDDLE = 3;
     */
    BrowserViewerInputEvent_MouseButton[BrowserViewerInputEvent_MouseButton["MIDDLE"] = 3] = "MIDDLE";
    /**
     * @generated from enum value: MOUSE_BUTTON_RIGHT = 4;
     */
    BrowserViewerInputEvent_MouseButton[BrowserViewerInputEvent_MouseButton["RIGHT"] = 4] = "RIGHT";
    /**
     * @generated from enum value: MOUSE_BUTTON_BACK = 5;
     */
    BrowserViewerInputEvent_MouseButton[BrowserViewerInputEvent_MouseButton["BACK"] = 5] = "BACK";
    /**
     * @generated from enum value: MOUSE_BUTTON_FORWARD = 6;
     */
    BrowserViewerInputEvent_MouseButton[BrowserViewerInputEvent_MouseButton["FORWARD"] = 6] = "FORWARD";
})(BrowserViewerInputEvent_MouseButton || (exports.BrowserViewerInputEvent_MouseButton = BrowserViewerInputEvent_MouseButton = {}));
/**
 * Describes the enum exa.browser_viewer_payload_pb.BrowserViewerInputEvent.MouseButton.
 */
exports.BrowserViewerInputEvent_MouseButtonSchema = (0, codegenv2_1.enumDesc)(exports.file_browser_viewer, 3, 1);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerRequest.
 * Use `create(BrowserViewerRequestSchema)` to create a new message.
 */
exports.BrowserViewerRequestSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 4);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerRequest.Offer.
 * Use `create(BrowserViewerRequest_OfferSchema)` to create a new message.
 */
exports.BrowserViewerRequest_OfferSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 4, 0);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerRequest.Renew.
 * Use `create(BrowserViewerRequest_RenewSchema)` to create a new message.
 */
exports.BrowserViewerRequest_RenewSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 4, 1);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerRequest.Close.
 * Use `create(BrowserViewerRequest_CloseSchema)` to create a new message.
 */
exports.BrowserViewerRequest_CloseSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 4, 2);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerRequest.ListTabs.
 * Use `create(BrowserViewerRequest_ListTabsSchema)` to create a new message.
 */
exports.BrowserViewerRequest_ListTabsSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 4, 3);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerRequest.Control.
 * Use `create(BrowserViewerRequest_ControlSchema)` to create a new message.
 */
exports.BrowserViewerRequest_ControlSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 4, 4);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerRequest.ReadFrame.
 * Use `create(BrowserViewerRequest_ReadFrameSchema)` to create a new message.
 */
exports.BrowserViewerRequest_ReadFrameSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 4, 5);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerRequest.TakeControl.
 * Use `create(BrowserViewerRequest_TakeControlSchema)` to create a new message.
 */
exports.BrowserViewerRequest_TakeControlSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 4, 6);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerRequest.ReleaseControl.
 * Use `create(BrowserViewerRequest_ReleaseControlSchema)` to create a new message.
 */
exports.BrowserViewerRequest_ReleaseControlSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 4, 7);
/**
 * Describes the message exa.browser_viewer_payload_pb.BrowserViewerResult.
 * Use `create(BrowserViewerResultSchema)` to create a new message.
 */
exports.BrowserViewerResultSchema = (0, codegenv2_1.messageDesc)(exports.file_browser_viewer, 5);
/**
 * Remote control action applied to an existing built-in browser tab. Tab
 * creation and closure are intentionally excluded so remote viewers cannot
 * open or destroy tabs. `BROWSER_VIEWER_CONTROL_ACTION_STOP` is session-scoped
 * (no `control_token` required), whereas `NAVIGATE`, `BACK`, `FORWARD`,
 * `RELOAD`, and `INPUT_EVENT` require an active `control_token` issued by
 * `TakeControl`.
 *
 * @generated from enum exa.browser_viewer_payload_pb.BrowserViewerControlAction
 */
var BrowserViewerControlAction;
(function (BrowserViewerControlAction) {
    /**
     * @generated from enum value: BROWSER_VIEWER_CONTROL_ACTION_UNSPECIFIED = 0;
     */
    BrowserViewerControlAction[BrowserViewerControlAction["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /**
     * @generated from enum value: BROWSER_VIEWER_CONTROL_ACTION_STOP = 1;
     */
    BrowserViewerControlAction[BrowserViewerControlAction["STOP"] = 1] = "STOP";
    /**
     * @generated from enum value: BROWSER_VIEWER_CONTROL_ACTION_NAVIGATE = 2;
     */
    BrowserViewerControlAction[BrowserViewerControlAction["NAVIGATE"] = 2] = "NAVIGATE";
    /**
     * @generated from enum value: BROWSER_VIEWER_CONTROL_ACTION_BACK = 3;
     */
    BrowserViewerControlAction[BrowserViewerControlAction["BACK"] = 3] = "BACK";
    /**
     * @generated from enum value: BROWSER_VIEWER_CONTROL_ACTION_FORWARD = 4;
     */
    BrowserViewerControlAction[BrowserViewerControlAction["FORWARD"] = 4] = "FORWARD";
    /**
     * @generated from enum value: BROWSER_VIEWER_CONTROL_ACTION_RELOAD = 5;
     */
    BrowserViewerControlAction[BrowserViewerControlAction["RELOAD"] = 5] = "RELOAD";
    /**
     * @generated from enum value: BROWSER_VIEWER_CONTROL_ACTION_INPUT_EVENT = 6;
     */
    BrowserViewerControlAction[BrowserViewerControlAction["INPUT_EVENT"] = 6] = "INPUT_EVENT";
})(BrowserViewerControlAction || (exports.BrowserViewerControlAction = BrowserViewerControlAction = {}));
/**
 * Describes the enum exa.browser_viewer_payload_pb.BrowserViewerControlAction.
 */
exports.BrowserViewerControlActionSchema = (0, codegenv2_1.enumDesc)(exports.file_browser_viewer, 0);
