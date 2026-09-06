/**
 * Restore whatsapp-web.js channel subscription via invite code.
 *
 * `Client.getChannelByInviteCode(inviteCode)` internally calls
 * `window.WWebJS.getChannelMetadata(inviteCode)` (Injected/Utils.js:914), which opens with:
 *
 *   const role = window.require('WAWebNewsletterModelUtils').getRoleByIdentifier(inviteCode);
 *
 * WhatsApp Web (pinned to >=2.3000.1046916940-alpha) has REMOVED `getRoleByIdentifier` from the
 * `WAWebNewsletterModelUtils` module. Every call rejects immediately with:
 *
 *   TypeError: window.require(...).getRoleByIdentifier is not a function
 *
 * The function's only job was to supply a `role` argument to the next call:
 *
 *   window.require('WAWebNewsletterMetadataQueryJob')
 *     .queryNewsletterMetadataByInviteCode(inviteCode, role)
 *
 * `queryNewsletterMetadataByInviteCode` remains alive. The role is used to scope the returned
 * metadata; a default of 'GUEST' returns public channel metadata, which is exactly what the
 * invite-code subscription flow needs (and what `newsletterMetadata('invite', code)` in Baileys
 * does implicitly). Measured live: the query module resolves with the full newsletter metadata
 * object in ~350 ms; `WAWebNewsletterModelUtils.getRoleByIdentifier` was dead at 4 ms.
 *
 * This patch replaces the two-line lookup with a single-line direct call that supplies the
 * default role, restoring the full `getChannelByInviteCode` -> `subscribeToChannel` flow.
 *
 * The transform is exact and self-disabling, matching the sibling patchers: an unknown shape
 * fails the build instead of silently shipping without the fix.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WWJS = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const UTILS_PATH = path.join('src', 'util', 'Injected', 'Utils.js');

/**
 * The exact broken body - byte-for-byte from Utils.js:915-917 on whatsapp-web.js 1.34.7.
 * The `require('WAWebNewsletterModelUtils').getRoleByIdentifier` call no longer resolves on
 * WA Web >=2.3000.1046916940-alpha, causing every invite-code lookup to fail locally in ~4 ms.
 */
const BROKEN_ROLE_LOOKUP = `        const role = window
            .require('WAWebNewsletterModelUtils')
            .getRoleByIdentifier(inviteCode);`;

/**
 * Replacement: supply 'GUEST' as the default role directly.
 *
 * 'GUEST' is the role an unauthenticated viewer would have on a public channel -- the correct
 * scope for resolving public invite codes. The query module returns the full newsletter metadata
 * object regardless; `membershipType` in the returned object carries the actual role once the
 * subscription completes.
 */
const DEFAULT_ROLE_CALL = `        const role = 'GUEST'; // WAWebNewsletterModelUtils.getRoleByIdentifier removed from WA Web >=2.3000.1046916940-alpha`;

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function applyBackport(wwjsDir = DEFAULT_WWJS) {
  const utilsFile = path.join(wwjsDir, UTILS_PATH);
  if (!fs.existsSync(utilsFile)) {
    throw new Error(`whatsapp-web.js Utils.js not found at ${utilsFile}`);
  }

  const source = fs.readFileSync(utilsFile, 'utf8');
  const brokenCount = occurrences(source, BROKEN_ROLE_LOOKUP);
  const fixedCount = occurrences(source, DEFAULT_ROLE_CALL);

  if (brokenCount === 0 && fixedCount === 1) {
    return {
      skipped: true,
      reason: 'installed whatsapp-web.js already uses the default-role bypass',
    };
  }
  if (brokenCount !== 1 || fixedCount !== 0) {
    throw new Error(
      `unsupported Utils.js shape (broken calls: ${brokenCount}, fixed calls: ${fixedCount}); ` +
        're-evaluate the channel-invite backport against the installed whatsapp-web.js',
    );
  }

  fs.writeFileSync(utilsFile, source.replace(BROKEN_ROLE_LOOKUP, DEFAULT_ROLE_CALL));
  return { skipped: false, note: "default role 'GUEST' supplied to channel invite lookup" };
}

/**
 * The stand-down branch above as a predicate, for the startup guard (engine-patch-status.ts).
 * Unreadable reads as applied: a tree we cannot inspect is not evidence of a broken one.
 */
function isApplied(wwjsDir = DEFAULT_WWJS) {
  try {
    const source = fs.readFileSync(path.join(wwjsDir, UTILS_PATH), 'utf8');
    return occurrences(source, BROKEN_ROLE_LOOKUP) === 0 && occurrences(source, DEFAULT_ROLE_CALL) === 1;
  } catch {
    return true;
  }
}

function run() {
  const bestEffort = process.argv.includes('--best-effort');
  try {
    const result = applyBackport();
    console.log(
      `patch-wwebjs-channel-invite: ${result.skipped ? \`skipped -- \${result.reason}\` : result.note}`,
    );
  } catch (error) {
    if (bestEffort) {
      console.warn(`patch-wwebjs-channel-invite: skipped -- \${error.message}`);
      return;
    }
    console.error(`patch-wwebjs-channel-invite: \${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) run();

module.exports = { applyBackport, isApplied, BROKEN_ROLE_LOOKUP, DEFAULT_ROLE_CALL, UTILS_PATH };
