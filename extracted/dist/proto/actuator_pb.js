"use strict";
// ActuatorService: the one wire protocol between the Language Server and its
// actuators (Hub renderer and main process, Jetski Web tab). Messages specific
// to an actuator type travel as google.protobuf.Any; each actuator type
// registers its own payload types.
//
// An actuator type names the medium being actuated ("browser", "computer",
// later "mobile"), never the host app: the AGY Hub and Jetski Web both serve
// "browser". Which app connected is client_name; host policy lives in the
// Language Server's startup configuration, not on the wire.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActuatorService = exports.DegradedReasonSchema = exports.DegradedReason = exports.ActuatorStatusSchema = exports.ActuatorStatus = exports.ActuatorErrorCodeSchema = exports.ActuatorErrorCode = exports.ReportStatusResponseSchema = exports.ActuatorStatusReportSchema = exports.ReportStatusRequestSchema = exports.FulfillResponseSchema = exports.ActuatorErrorSchema = exports.FulfillRequestSchema = exports.BlobSchema = exports.UpdateResponseSchema = exports.UpdateRequestSchema = exports.HeartbeatSchema = exports.LeaseStatusSchema = exports.NoticeSchema = exports.ActuatorRequestSchema = exports.ActuatorLimitsSchema = exports.SubscribeAckSchema = exports.ServerMessageSchema = exports.SubscribeRequestSchema = exports.file_actuator = void 0;
const codegenv2_1 = require("@bufbuild/protobuf/codegenv2");
const wkt_1 = require("@bufbuild/protobuf/wkt");
/**
 * Describes the file actuator.proto.
 */
exports.file_actuator = (0, codegenv2_1.fileDesc)("Cg5hY3R1YXRvci5wcm90bxIPZXhhLmFjdHVhdG9yX3BiIv0CChBTdWJzY3JpYmVSZXF1ZXN0EhgKEHByb3RvY29sX3ZlcnNpb24YASABKA0SFQoNYWN0dWF0b3JfdHlwZRgCIAEoCRITCgthY3R1YXRvcl9pZBgDIAEoCRIdChVhY3R1YXRvcl90eXBlX3ZlcnNpb24YBCABKA0SIwoFaGVsbG8YBSABKAsyFC5nb29nbGUucHJvdG9idWYuQW55EhgKEGNvbnZlcnNhdGlvbl9pZHMYBiADKAkSPQoOaW5pdGlhbF9zdGF0dXMYByABKAsyJS5leGEuYWN0dWF0b3JfcGIuQWN0dWF0b3JTdGF0dXNSZXBvcnQSEwoLY2xpZW50X25hbWUYCCABKAkSFgoOY2xpZW50X3ZlcnNpb24YCSABKAkSGgoSY2xpZW50X2luc3RhbmNlX2lkGAogASgJEj0KDmluaXRpYWxfcGF1c2VzGAsgAygLMiUuZXhhLmFjdHVhdG9yX3BiLkFjdHVhdG9yU3RhdHVzUmVwb3J0ItkBCg1TZXJ2ZXJNZXNzYWdlEiwKA2FjaxgBIAEoCzIdLmV4YS5hY3R1YXRvcl9wYi5TdWJzY3JpYmVBY2tIABIzCgdyZXF1ZXN0GAIgASgLMiAuZXhhLmFjdHVhdG9yX3BiLkFjdHVhdG9yUmVxdWVzdEgAEikKBm5vdGljZRgDIAEoCzIXLmV4YS5hY3R1YXRvcl9wYi5Ob3RpY2VIABIvCgloZWFydGJlYXQYBCABKAsyGi5leGEuYWN0dWF0b3JfcGIuSGVhcnRiZWF0SABCCQoHbWVzc2FnZSLIAgoMU3Vic2NyaWJlQWNrEhMKC2FjdHVhdG9yX2lkGAEgASgJEhUKDXNlc3Npb25fdG9rZW4YAiABKAkSGAoQcHJvdG9jb2xfdmVyc2lvbhgDIAEoDRIhChlhY3R1YXRvcl90eXBlX3ZlcnNpb25fbWluGAQgASgNEiEKGWFjdHVhdG9yX3R5cGVfdmVyc2lvbl9tYXgYBSABKA0SIAoYYWN0dWF0b3JfdHlwZV9jb21wYXRpYmxlGAYgASgIEi8KBmxpbWl0cxgHIAEoCzIfLmV4YS5hY3R1YXRvcl9wYi5BY3R1YXRvckxpbWl0cxIbChNzZXJ2ZXJfdGltZV91bml4X21zGAggASgDEjwKDWFjdGl2ZV9wYXVzZXMYCSADKAsyJS5leGEuYWN0dWF0b3JfcGIuQWN0dWF0b3JTdGF0dXNSZXBvcnQiqQIKDkFjdHVhdG9yTGltaXRzEhQKDG1heF9pZF9ieXRlcxgBIAEoDRIcChRtYXhfY29udmVyc2F0aW9uX2lkcxgCIAEoDRIXCg9tYXhfaGVsbG9fYnl0ZXMYAyABKA0SGQoRbWF4X3BheWxvYWRfYnl0ZXMYBCABKA0SEQoJbWF4X2Jsb2JzGAUgASgNEhYKDm1heF9ibG9iX2J5dGVzGAYgASgNEhkKEW1heF9mdWxmaWxsX2J5dGVzGAcgASgNEhcKD21heF9lcnJvcl9ieXRlcxgIIAEoDRIYChBtYXhfZGV0YWlsX2J5dGVzGAkgASgNEh0KFW1heF9ibG9iX2RpbWVuc2lvbl9weBgKIAEoDRIXCg9ibG9iX21pbWVfdHlwZXMYCyADKAki2AEKD0FjdHVhdG9yUmVxdWVzdBISCgpyZXF1ZXN0X2lkGAEgASgJEhUKDWFjdHVhdG9yX3R5cGUYAiABKAkSHAoUcm9vdF9jb252ZXJzYXRpb25faWQYAyABKAkSEgoKY2FzY2FkZV9pZBgEIAEoCRIYChBkZWFkbGluZV91bml4X21zGAUgASgDEhYKDnJlZGlzcGF0Y2hhYmxlGAYgASgIEg8KB2F0dGVtcHQYByABKA0SJQoHcGF5bG9hZBgIIAEoCzIULmdvb2dsZS5wcm90b2J1Zi5BbnkiiAEKBk5vdGljZRIVCg1hY3R1YXRvcl90eXBlGAEgASgJEjQKDGxlYXNlX3N0YXR1cxgCIAEoCzIcLmV4YS5hY3R1YXRvcl9wYi5MZWFzZVN0YXR1c0gAEicKB3BheWxvYWQYAyABKAsyFC5nb29nbGUucHJvdG9idWYuQW55SABCCAoGbm90aWNlIqcBCgtMZWFzZVN0YXR1cxIcChRyb290X2NvbnZlcnNhdGlvbl9pZBgBIAEoCRIdChVvd25lcl9jb252ZXJzYXRpb25faWQYAiABKAkSGQoRb3duZXJfYWN0dWF0b3JfaWQYAyABKAkSEgoKZ2VuZXJhdGlvbhgEIAEoBBIUCgxhZ2VudF9hY3RpdmUYBSABKAgSFgoOcGF1c2VkX2J5X3VzZXIYBiABKAgiCwoJSGVhcnRiZWF0IrMBCg1VcGRhdGVSZXF1ZXN0EhUKDWFjdHVhdG9yX3R5cGUYASABKAkSEwoLYWN0dWF0b3JfaWQYAiABKAkSFQoNc2Vzc2lvbl90b2tlbhgDIAEoCRIjCgVoZWxsbxgEIAEoCzIULmdvb2dsZS5wcm90b2J1Zi5BbnkSIAoYcmVwbGFjZV9jb252ZXJzYXRpb25faWRzGAUgASgIEhgKEGNvbnZlcnNhdGlvbl9pZHMYBiADKAkiEAoOVXBkYXRlUmVzcG9uc2UiWgoEQmxvYhIMCgRuYW1lGAEgASgJEhEKCW1pbWVfdHlwZRgCIAEoCRIMCgRkYXRhGAMgASgMEhAKCHdpZHRoX3B4GAQgASgNEhEKCWhlaWdodF9weBgFIAEoDSLyAQoORnVsZmlsbFJlcXVlc3QSEgoKcmVxdWVzdF9pZBgBIAEoCRIVCg1hY3R1YXRvcl90eXBlGAIgASgJEhMKC2FjdHVhdG9yX2lkGAMgASgJEhUKDXNlc3Npb25fdG9rZW4YBCABKAkSJwoHcGF5bG9hZBgFIAEoCzIULmdvb2dsZS5wcm90b2J1Zi5BbnlIABIvCgVlcnJvchgGIAEoCzIeLmV4YS5hY3R1YXRvcl9wYi5BY3R1YXRvckVycm9ySAASJAoFYmxvYnMYByADKAsyFS5leGEuYWN0dWF0b3JfcGIuQmxvYkIJCgdvdXRjb21lIlIKDUFjdHVhdG9yRXJyb3ISMAoEY29kZRgBIAEoDjIiLmV4YS5hY3R1YXRvcl9wYi5BY3R1YXRvckVycm9yQ29kZRIPCgdtZXNzYWdlGAIgASgJIhEKD0Z1bGZpbGxSZXNwb25zZSKPAQoTUmVwb3J0U3RhdHVzUmVxdWVzdBIVCg1hY3R1YXRvcl90eXBlGAEgASgJEhMKC2FjdHVhdG9yX2lkGAIgASgJEhUKDXNlc3Npb25fdG9rZW4YAyABKAkSNQoGc3RhdHVzGAQgASgLMiUuZXhhLmFjdHVhdG9yX3BiLkFjdHVhdG9yU3RhdHVzUmVwb3J0IswBChRBY3R1YXRvclN0YXR1c1JlcG9ydBIvCgZzdGF0dXMYASABKA4yHy5leGEuYWN0dWF0b3JfcGIuQWN0dWF0b3JTdGF0dXMSHAoUcm9vdF9jb252ZXJzYXRpb25faWQYAiABKAkSOAoPZGVncmFkZWRfcmVhc29uGAMgASgOMh8uZXhhLmFjdHVhdG9yX3BiLkRlZ3JhZGVkUmVhc29uEg4KBmRldGFpbBgEIAEoCRIbChNvYnNlcnZlZF9hdF91bml4X21zGAUgASgDIhYKFFJlcG9ydFN0YXR1c1Jlc3BvbnNlKpgCChFBY3R1YXRvckVycm9yQ29kZRIjCh9BQ1RVQVRPUl9FUlJPUl9DT0RFX1VOU1BFQ0lGSUVEEAASKwonQUNUVUFUT1JfRVJST1JfQ09ERV9VTlNVUFBPUlRFRF9SRVFVRVNUEAESJwojQUNUVUFUT1JfRVJST1JfQ09ERV9JTlZBTElEX1JFUVVFU1QQAhIlCiFBQ1RVQVRPUl9FUlJPUl9DT0RFX1VTRVJfVEFLRU9WRVIQAxIcChhBQ1RVQVRPUl9FUlJPUl9DT0RFX0JVU1kQBBIhCh1BQ1RVQVRPUl9FUlJPUl9DT0RFX0FCQU5ET05FRBAFEiAKHEFDVFVBVE9SX0VSUk9SX0NPREVfSU5URVJOQUwQBirvAQoOQWN0dWF0b3JTdGF0dXMSHwobQUNUVUFUT1JfU1RBVFVTX1VOU1BFQ0lGSUVEEAASGwoXQUNUVUFUT1JfU1RBVFVTX0hFQUxUSFkQARIcChhBQ1RVQVRPUl9TVEFUVVNfREVHUkFERUQQAhIhCh1BQ1RVQVRPUl9TVEFUVVNfVVNFUl9UQUtFT1ZFUhADEh0KGUFDVFVBVE9SX1NUQVRVU19VU0VSX1NUT1AQBBIfChtBQ1RVQVRPUl9TVEFUVVNfVVNFUl9SRVNVTUUQBRIeChpBQ1RVQVRPUl9TVEFUVVNfR09JTkdfQVdBWRAGKvEBCg5EZWdyYWRlZFJlYXNvbhIfChtERUdSQURFRF9SRUFTT05fVU5TUEVDSUZJRUQQABIqCiZERUdSQURFRF9SRUFTT05fRVhFQ1VUT1JfTk9UX0lOU1RBTExFRBABEikKJURFR1JBREVEX1JFQVNPTl9FWEVDVVRPUl9ESVNDT05ORUNURUQQAhImCiJERUdSQURFRF9SRUFTT05fUEVSTUlTU0lPTl9NSVNTSU5HEAMSJAogREVHUkFERURfUkVBU09OX0VYRUNVVE9SX0NSQVNIRUQQBBIZChVERUdSQURFRF9SRUFTT05fT1RIRVIQBTLhAgoPQWN0dWF0b3JTZXJ2aWNlElIKCVN1YnNjcmliZRIhLmV4YS5hY3R1YXRvcl9wYi5TdWJzY3JpYmVSZXF1ZXN0Gh4uZXhhLmFjdHVhdG9yX3BiLlNlcnZlck1lc3NhZ2UiADABEksKBlVwZGF0ZRIeLmV4YS5hY3R1YXRvcl9wYi5VcGRhdGVSZXF1ZXN0Gh8uZXhhLmFjdHVhdG9yX3BiLlVwZGF0ZVJlc3BvbnNlIgASTgoHRnVsZmlsbBIfLmV4YS5hY3R1YXRvcl9wYi5GdWxmaWxsUmVxdWVzdBogLmV4YS5hY3R1YXRvcl9wYi5GdWxmaWxsUmVzcG9uc2UiABJdCgxSZXBvcnRTdGF0dXMSJC5leGEuYWN0dWF0b3JfcGIuUmVwb3J0U3RhdHVzUmVxdWVzdBolLmV4YS5hY3R1YXRvcl9wYi5SZXBvcnRTdGF0dXNSZXNwb25zZSIAYgZwcm90bzM", [wkt_1.file_google_protobuf_any]);
/**
 * Describes the message exa.actuator_pb.SubscribeRequest.
 * Use `create(SubscribeRequestSchema)` to create a new message.
 */
exports.SubscribeRequestSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 0);
/**
 * Describes the message exa.actuator_pb.ServerMessage.
 * Use `create(ServerMessageSchema)` to create a new message.
 */
exports.ServerMessageSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 1);
/**
 * Describes the message exa.actuator_pb.SubscribeAck.
 * Use `create(SubscribeAckSchema)` to create a new message.
 */
exports.SubscribeAckSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 2);
/**
 * Describes the message exa.actuator_pb.ActuatorLimits.
 * Use `create(ActuatorLimitsSchema)` to create a new message.
 */
exports.ActuatorLimitsSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 3);
/**
 * Describes the message exa.actuator_pb.ActuatorRequest.
 * Use `create(ActuatorRequestSchema)` to create a new message.
 */
exports.ActuatorRequestSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 4);
/**
 * Describes the message exa.actuator_pb.Notice.
 * Use `create(NoticeSchema)` to create a new message.
 */
exports.NoticeSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 5);
/**
 * Describes the message exa.actuator_pb.LeaseStatus.
 * Use `create(LeaseStatusSchema)` to create a new message.
 */
exports.LeaseStatusSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 6);
/**
 * Describes the message exa.actuator_pb.Heartbeat.
 * Use `create(HeartbeatSchema)` to create a new message.
 */
exports.HeartbeatSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 7);
/**
 * Describes the message exa.actuator_pb.UpdateRequest.
 * Use `create(UpdateRequestSchema)` to create a new message.
 */
exports.UpdateRequestSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 8);
/**
 * Describes the message exa.actuator_pb.UpdateResponse.
 * Use `create(UpdateResponseSchema)` to create a new message.
 */
exports.UpdateResponseSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 9);
/**
 * Describes the message exa.actuator_pb.Blob.
 * Use `create(BlobSchema)` to create a new message.
 */
exports.BlobSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 10);
/**
 * Describes the message exa.actuator_pb.FulfillRequest.
 * Use `create(FulfillRequestSchema)` to create a new message.
 */
exports.FulfillRequestSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 11);
/**
 * Describes the message exa.actuator_pb.ActuatorError.
 * Use `create(ActuatorErrorSchema)` to create a new message.
 */
exports.ActuatorErrorSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 12);
/**
 * Describes the message exa.actuator_pb.FulfillResponse.
 * Use `create(FulfillResponseSchema)` to create a new message.
 */
exports.FulfillResponseSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 13);
/**
 * Describes the message exa.actuator_pb.ReportStatusRequest.
 * Use `create(ReportStatusRequestSchema)` to create a new message.
 */
exports.ReportStatusRequestSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 14);
/**
 * Describes the message exa.actuator_pb.ActuatorStatusReport.
 * Use `create(ActuatorStatusReportSchema)` to create a new message.
 */
exports.ActuatorStatusReportSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 15);
/**
 * Describes the message exa.actuator_pb.ReportStatusResponse.
 * Use `create(ReportStatusResponseSchema)` to create a new message.
 */
exports.ReportStatusResponseSchema = (0, codegenv2_1.messageDesc)(exports.file_actuator, 16);
/**
 * @generated from enum exa.actuator_pb.ActuatorErrorCode
 */
var ActuatorErrorCode;
(function (ActuatorErrorCode) {
    /**
     * @generated from enum value: ACTUATOR_ERROR_CODE_UNSPECIFIED = 0;
     */
    ActuatorErrorCode[ActuatorErrorCode["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /**
     * unknown action for this actuator
     *
     * @generated from enum value: ACTUATOR_ERROR_CODE_UNSUPPORTED_REQUEST = 1;
     */
    ActuatorErrorCode[ActuatorErrorCode["UNSUPPORTED_REQUEST"] = 1] = "UNSUPPORTED_REQUEST";
    /**
     * payload failed actuator validation
     *
     * @generated from enum value: ACTUATOR_ERROR_CODE_INVALID_REQUEST = 2;
     */
    ActuatorErrorCode[ActuatorErrorCode["INVALID_REQUEST"] = 2] = "INVALID_REQUEST";
    /**
     * user paused this scope mid-request
     *
     * @generated from enum value: ACTUATOR_ERROR_CODE_USER_TAKEOVER = 3;
     */
    ActuatorErrorCode[ActuatorErrorCode["USER_TAKEOVER"] = 3] = "USER_TAKEOVER";
    /**
     * @generated from enum value: ACTUATOR_ERROR_CODE_BUSY = 4;
     */
    ActuatorErrorCode[ActuatorErrorCode["BUSY"] = 4] = "BUSY";
    /**
     * actuator gave up on a run (deadline / reload)
     *
     * @generated from enum value: ACTUATOR_ERROR_CODE_ABANDONED = 5;
     */
    ActuatorErrorCode[ActuatorErrorCode["ABANDONED"] = 5] = "ABANDONED";
    /**
     * @generated from enum value: ACTUATOR_ERROR_CODE_INTERNAL = 6;
     */
    ActuatorErrorCode[ActuatorErrorCode["INTERNAL"] = 6] = "INTERNAL";
})(ActuatorErrorCode || (exports.ActuatorErrorCode = ActuatorErrorCode = {}));
/**
 * Describes the enum exa.actuator_pb.ActuatorErrorCode.
 */
exports.ActuatorErrorCodeSchema = (0, codegenv2_1.enumDesc)(exports.file_actuator, 0);
/**
 * @generated from enum exa.actuator_pb.ActuatorStatus
 */
var ActuatorStatus;
(function (ActuatorStatus) {
    /**
     * @generated from enum value: ACTUATOR_STATUS_UNSPECIFIED = 0;
     */
    ActuatorStatus[ActuatorStatus["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /**
     * clears DEGRADED
     *
     * @generated from enum value: ACTUATOR_STATUS_HEALTHY = 1;
     */
    ActuatorStatus[ActuatorStatus["HEALTHY"] = 1] = "HEALTHY";
    /**
     * not a fence; the actuator type's policy decides Capable
     *
     * @generated from enum value: ACTUATOR_STATUS_DEGRADED = 2;
     */
    ActuatorStatus[ActuatorStatus["DEGRADED"] = 2] = "DEGRADED";
    /**
     * fence (scope)
     *
     * @generated from enum value: ACTUATOR_STATUS_USER_TAKEOVER = 3;
     */
    ActuatorStatus[ActuatorStatus["USER_TAKEOVER"] = 3] = "USER_TAKEOVER";
    /**
     * fence (scope)
     *
     * @generated from enum value: ACTUATOR_STATUS_USER_STOP = 4;
     */
    ActuatorStatus[ActuatorStatus["USER_STOP"] = 4] = "USER_STOP";
    /**
     * clears the fence for the scope ("" clears all)
     *
     * @generated from enum value: ACTUATOR_STATUS_USER_RESUME = 5;
     */
    ActuatorStatus[ActuatorStatus["USER_RESUME"] = 5] = "USER_RESUME";
    /**
     * clean unsubscribe: no reconnect grace
     *
     * @generated from enum value: ACTUATOR_STATUS_GOING_AWAY = 6;
     */
    ActuatorStatus[ActuatorStatus["GOING_AWAY"] = 6] = "GOING_AWAY";
})(ActuatorStatus || (exports.ActuatorStatus = ActuatorStatus = {}));
/**
 * Describes the enum exa.actuator_pb.ActuatorStatus.
 */
exports.ActuatorStatusSchema = (0, codegenv2_1.enumDesc)(exports.file_actuator, 1);
/**
 * @generated from enum exa.actuator_pb.DegradedReason
 */
var DegradedReason;
(function (DegradedReason) {
    /**
     * @generated from enum value: DEGRADED_REASON_UNSPECIFIED = 0;
     */
    DegradedReason[DegradedReason["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /**
     * no extension / no helper / no isolated-world IPC
     *
     * @generated from enum value: DEGRADED_REASON_EXECUTOR_NOT_INSTALLED = 1;
     */
    DegradedReason[DegradedReason["EXECUTOR_NOT_INSTALLED"] = 1] = "EXECUTOR_NOT_INSTALLED";
    /**
     * was connected; transient (MV3 SW restart, helper restart)
     *
     * @generated from enum value: DEGRADED_REASON_EXECUTOR_DISCONNECTED = 2;
     */
    DegradedReason[DegradedReason["EXECUTOR_DISCONNECTED"] = 2] = "EXECUTOR_DISCONNECTED";
    /**
     * macOS TCC grant missing or revoked
     *
     * @generated from enum value: DEGRADED_REASON_PERMISSION_MISSING = 3;
     */
    DegradedReason[DegradedReason["PERMISSION_MISSING"] = 3] = "PERMISSION_MISSING";
    /**
     * @generated from enum value: DEGRADED_REASON_EXECUTOR_CRASHED = 4;
     */
    DegradedReason[DegradedReason["EXECUTOR_CRASHED"] = 4] = "EXECUTOR_CRASHED";
    /**
     * @generated from enum value: DEGRADED_REASON_OTHER = 5;
     */
    DegradedReason[DegradedReason["OTHER"] = 5] = "OTHER";
})(DegradedReason || (exports.DegradedReason = DegradedReason = {}));
/**
 * Describes the enum exa.actuator_pb.DegradedReason.
 */
exports.DegradedReasonSchema = (0, codegenv2_1.enumDesc)(exports.file_actuator, 2);
/**
 * Served by the Language Server on its HTTP port. Actuators (clients) dial the
 * LS. Every procedure requires the admin CSRF token (never a scoped token).
 * Binary protobuf only (application/proto, application/connect+proto, grpc);
 * JSON codecs are rejected with INVALID_ARGUMENT / ACTUATOR_BINARY_REQUIRED.
 *
 * @generated from service exa.actuator_pb.ActuatorService
 */
exports.ActuatorService = (0, codegenv2_1.serviceDesc)(exports.file_actuator, 0);
