const test = require('node:test');
const assert = require('node:assert/strict');
const { pickSigningIdentity } = require('../build/afterPack');

test('packaging prefers the stable IRiXi local signing identity', () => {
  const output = [
    '  1) ABC "Other Developer"',
    '  2) 0123456789ABCDEF0123456789ABCDEF01234567 "IRiXi Local Code Signing"',
    '  3) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "IRiXi Local Code Signing 2026"',
    '  2 valid identities found',
  ].join('\n');
  assert.equal(pickSigningIdentity(output), '0123456789ABCDEF0123456789ABCDEF01234567');
});

test('packaging reports no identity when a stable identity is unavailable', () => {
  assert.equal(pickSigningIdentity('  0 valid identities found'), null);
});
