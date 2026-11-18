"use strict";
// Copyright Exafunction, Inc.
//
// Payload messages of the `computer_viewer` actuator type (Phase 3 remote
// viewing): the loopback leg that relays a remote viewer's WebRTC offer from
// the Language Server to the desktop host on the same Mac, and its answer
// back. The viewer reaches the Language Server through remote control (its
// ComputerViewerService RPCs ride the authenticated remote-control channel);
// media goes peer to peer (or through TURN) between the viewer and the
// desktop host and never through the Language Server.
//
// Source of truth. The AGY Hub's proto/computer_viewer.proto is generated from
// this file by its SDK sync script (copybara:strip lines removed); never edit
// the copy by hand.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComputerViewerStreamSchema = exports.ComputerViewerResultSchema = exports.ComputerViewerCloseSchema = exports.ComputerViewerRenewSchema = exports.ComputerViewerDeviceSchema = exports.ComputerIceServerSchema = exports.ComputerViewerOfferSchema = exports.ComputerViewerRequestSchema = exports.ComputerViewerHelloSchema = exports.file_computer_viewer = void 0;
const codegenv2_1 = require("@bufbuild/protobuf/codegenv2");
/**
 * Describes the file computer_viewer.proto.
 */
exports.file_computer_viewer = (0, codegenv2_1.fileDesc)("ChVjb21wdXRlcl92aWV3ZXIucHJvdG8SF2V4YS5jb21wdXRlcl9wYXlsb2FkX3BiIlgKE0NvbXB1dGVyVmlld2VySGVsbG8SFAoMbWF4X3Nlc3Npb25zGAEgASgNEhQKDHZpZGVvX2NvZGVjcxgCIAMoCRIVCg1kZXNrdG9wX2xhYmVsGAMgASgJIu4BChVDb21wdXRlclZpZXdlclJlcXVlc3QSEgoKc2Vzc2lvbl9pZBgBIAEoCRI9CgVvZmZlchgCIAEoCzIsLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyVmlld2VyT2ZmZXJIABI9CgVjbG9zZRgDIAEoCzIsLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyVmlld2VyQ2xvc2VIABI9CgVyZW5ldxgEIAEoCzIsLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyVmlld2VyUmVuZXdIAEIECgJvcCLZAQoTQ29tcHV0ZXJWaWV3ZXJPZmZlchILCgNzZHAYASABKAkSHAoUcm9vdF9jb252ZXJzYXRpb25faWQYAiABKAkSFwoPZXhwaXJlc191bml4X21zGAMgASgDEj8KC2ljZV9zZXJ2ZXJzGAQgAygLMiouZXhhLmNvbXB1dGVyX3BheWxvYWRfcGIuQ29tcHV0ZXJJY2VTZXJ2ZXISPQoGZGV2aWNlGAUgASgLMi0uZXhhLmNvbXB1dGVyX3BheWxvYWRfcGIuQ29tcHV0ZXJWaWV3ZXJEZXZpY2UiRwoRQ29tcHV0ZXJJY2VTZXJ2ZXISDAoEdXJscxgBIAMoCRIQCgh1c2VybmFtZRgCIAEoCRISCgpjcmVkZW50aWFsGAMgASgJImAKFENvbXB1dGVyVmlld2VyRGV2aWNlEhcKD3B1YmxpY19rZXlfc3BraRgBIAEoCRINCgVsYWJlbBgCIAEoCRINCgVub25jZRgDIAEoCRIRCglzaWduYXR1cmUYBCABKAkiLgoTQ29tcHV0ZXJWaWV3ZXJSZW5ldxIXCg9leHBpcmVzX3VuaXhfbXMYASABKAMiJQoTQ29tcHV0ZXJWaWV3ZXJDbG9zZRIOCgZyZWFzb24YASABKAkijQEKFENvbXB1dGVyVmlld2VyUmVzdWx0EhIKCmFuc3dlcl9zZHAYASABKAkSPgoHc3RyZWFtcxgCIAMoCzItLmV4YS5jb21wdXRlcl9wYXlsb2FkX3BiLkNvbXB1dGVyVmlld2VyU3RyZWFtEhIKCmVycm9yX2NvZGUYAyABKAkSDQoFZXJyb3IYBCABKAkiTwoUQ29tcHV0ZXJWaWV3ZXJTdHJlYW0SEQoJc3RyZWFtX2lkGAEgASgJEhEKCWJ1bmRsZV9pZBgCIAEoCRIRCgl3aW5kb3dfaWQYAyABKA1iBnByb3RvMw");
/**
 * Describes the message exa.computer_payload_pb.ComputerViewerHello.
 * Use `create(ComputerViewerHelloSchema)` to create a new message.
 */
exports.ComputerViewerHelloSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_viewer, 0);
/**
 * Describes the message exa.computer_payload_pb.ComputerViewerRequest.
 * Use `create(ComputerViewerRequestSchema)` to create a new message.
 */
exports.ComputerViewerRequestSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_viewer, 1);
/**
 * Describes the message exa.computer_payload_pb.ComputerViewerOffer.
 * Use `create(ComputerViewerOfferSchema)` to create a new message.
 */
exports.ComputerViewerOfferSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_viewer, 2);
/**
 * Describes the message exa.computer_payload_pb.ComputerIceServer.
 * Use `create(ComputerIceServerSchema)` to create a new message.
 */
exports.ComputerIceServerSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_viewer, 3);
/**
 * Describes the message exa.computer_payload_pb.ComputerViewerDevice.
 * Use `create(ComputerViewerDeviceSchema)` to create a new message.
 */
exports.ComputerViewerDeviceSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_viewer, 4);
/**
 * Describes the message exa.computer_payload_pb.ComputerViewerRenew.
 * Use `create(ComputerViewerRenewSchema)` to create a new message.
 */
exports.ComputerViewerRenewSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_viewer, 5);
/**
 * Describes the message exa.computer_payload_pb.ComputerViewerClose.
 * Use `create(ComputerViewerCloseSchema)` to create a new message.
 */
exports.ComputerViewerCloseSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_viewer, 6);
/**
 * Describes the message exa.computer_payload_pb.ComputerViewerResult.
 * Use `create(ComputerViewerResultSchema)` to create a new message.
 */
exports.ComputerViewerResultSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_viewer, 7);
/**
 * Describes the message exa.computer_payload_pb.ComputerViewerStream.
 * Use `create(ComputerViewerStreamSchema)` to create a new message.
 */
exports.ComputerViewerStreamSchema = (0, codegenv2_1.messageDesc)(exports.file_computer_viewer, 8);
