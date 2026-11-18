'use strict';

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const MAX_HEADER_BYTES = 4 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function readExactly(fd, size, position) {
  const buffer = Buffer.alloc(size);
  let received = 0;
  while (received < size) {
    const count = fs.readSync(fd, buffer, received, size - received, position + received);
    if (count === 0) throw new Error('Truncated ASAR data');
    received += count;
  }
  return buffer;
}

function packageVersion(bytes) {
  const metadata = JSON.parse(utf8.decode(bytes));
  if (!object(metadata) || typeof metadata.version !== 'string' ||
      metadata.version.length > 128 || !metadata.version.trim() || /[\x00-\x1f\x7f]/.test(metadata.version)) return null;
  return metadata.version;
}

function unpackedPackage(asarPath, size) {
  // Never follow an archive entry's link/path. The only external metadata path
  // accepted is the standard, fixed <archive>.unpacked/package.json file.
  // Check only <archive>.unpacked and package.json themselves rather than walking
  // ancestor directories to '/', preventing false positives on macOS (/var -> private/var)
  // and Linux symlinked /home setups [H-02].
  const directory = `${asarPath}.unpacked`;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  const packagePath = path.join(directory, 'package.json');
  const file = fs.lstatSync(packagePath);
  if (!file.isFile() || file.isSymbolicLink() || file.size !== size) return null;
  let fd;
  try {
    fd = fs.openSync(packagePath, 'r');
    if (fs.fstatSync(fd).size !== size) return null;
    return packageVersion(readExactly(fd, size, 0));
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// ASAR's official writer emits an eight-byte size Pickle, then a header Pickle
// containing a length-prefixed UTF-8 JSON string. File offsets are relative to
// the data section at 8 + headerPickleSize. Only package metadata is read here;
// this function does not execute, extract, or modify anything in the archive.
function readAsarPackageVersion(asarPath) {
  let fd;
  try {
    if (typeof asarPath !== 'string' || !asarPath) return null;
    const archive = path.resolve(asarPath);
    const stat = fs.lstatSync(archive);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    fd = fs.openSync(archive, 'r');
    const archiveSize = fs.fstatSync(fd).size;
    if (!Number.isSafeInteger(archiveSize) || archiveSize < 16) return null;
    const prefix = readExactly(fd, 8, 0);
    if (prefix.readUInt32LE(0) !== 4) return null;
    const headerSize = prefix.readUInt32LE(4);
    if (headerSize < 8 || headerSize > MAX_HEADER_BYTES || headerSize % 4 !== 0 || headerSize > archiveSize - 8) return null;
    const header = readExactly(fd, headerSize, 8);
    const payloadSize = header.readUInt32LE(0);
    const jsonSize = header.readInt32LE(4);
    if (payloadSize !== headerSize - 4 || jsonSize <= 0 || jsonSize > headerSize - 8 ||
        8 + Math.ceil(jsonSize / 4) * 4 !== headerSize) return null;
    const tree = JSON.parse(utf8.decode(header.subarray(8, 8 + jsonSize)));
    if (!object(tree) || !object(tree.files) || !Object.prototype.hasOwnProperty.call(tree.files, 'package.json')) return null;
    const entry = tree.files['package.json'];
    if (!object(entry) || entry.link !== undefined || entry.files !== undefined ||
        !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > MAX_PACKAGE_BYTES ||
        (entry.unpacked !== undefined && typeof entry.unpacked !== 'boolean')) return null;
    if (entry.unpacked === true) return unpackedPackage(archive, entry.size);
    if (typeof entry.offset !== 'string' || !/^\d+$/.test(entry.offset)) return null;
    const offset = Number(entry.offset);
    const position = 8 + headerSize + offset;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(position) ||
        position < 8 + headerSize || entry.size > archiveSize - position) return null;
    return packageVersion(readExactly(fd, entry.size, position));
  } catch (_) {
    // Status polling must remain usable when a package is missing, locked,
    // malformed, or being replaced by an official update.
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

module.exports = { readAsarPackageVersion };
