'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyBackport, isApplied, BROKEN_ROLE_LOOKUP, DEFAULT_ROLE_CALL, UTILS_PATH } =
  require('./patch-wwebjs-channel-invite.js');

function makeDependency(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openwa-channel-invite-'));
  const utils = path.join(root, UTILS_PATH);
  fs.mkdirSync(path.dirname(utils), { recursive: true });
  fs.writeFileSync(utils, source);
  return { root, utils };
}

test('patches getChannelMetadata to bypass the removed getRoleByIdentifier call', () => {
  const { root, utils } = makeDependency(`before\n${BROKEN_ROLE_LOOKUP}\nafter\n`);

  const result = applyBackport(root);

  assert.deepEqual(result, { skipped: false, note: "default role 'GUEST' supplied to channel invite lookup" });
  assert.equal(fs.readFileSync(utils, 'utf8'), `before\n${DEFAULT_ROLE_CALL}\nafter\n`);
});

test('is idempotent when the default-role bypass is already present', () => {
  const { root, utils } = makeDependency(`before\n${DEFAULT_ROLE_CALL}\nafter\n`);
  const original = fs.readFileSync(utils, 'utf8');

  assert.deepEqual(applyBackport(root), {
    skipped: true,
    reason: 'installed whatsapp-web.js already uses the default-role bypass',
  });
  assert.equal(fs.readFileSync(utils, 'utf8'), original);
});

test('reports the patch as applied only once the transform has run', () => {
  const { root } = makeDependency(`before\n${BROKEN_ROLE_LOOKUP}\nafter\n`);

  assert.equal(isApplied(root), false);
  applyBackport(root);
  assert.equal(isApplied(root), true);
});

test('rejects an unknown dependency shape without changing it', () => {
  const { root, utils } = makeDependency('window.WWebJS.getChannelMetadata = async () => {};\n');
  const original = fs.readFileSync(utils, 'utf8');

  assert.throws(() => applyBackport(root), /unsupported Utils\.js shape/);
  assert.equal(fs.readFileSync(utils, 'utf8'), original);
});

test('rejects an ambiguous dependency shape without changing it', () => {
  const { root, utils } = makeDependency(`${BROKEN_ROLE_LOOKUP}\n${DEFAULT_ROLE_CALL}\n`);
  const original = fs.readFileSync(utils, 'utf8');

  assert.throws(() => applyBackport(root), /unsupported Utils\.js shape/);
  assert.equal(fs.readFileSync(utils, 'utf8'), original);
});

test('throws when Utils.js is not found', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openwa-channel-invite-missing-'));
  assert.throws(() => applyBackport(root), /Utils\.js not found/);
});
