import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { normalizeRecord, todayISO, addDays } from '../dist/domain.js';
import { VAULT_KIND, MAX_VAULT_FILE_BYTES, createVault, unlockVault, sealVault, validateEnvelope, isVault } from '../dist/vault.js';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const PASSWORD = '우리집 고양이 간식을 기억해';
const RECORDS = [normalizeRecord({ id: 'secret-cat', name: '고양이 참치 간식', category: 'cat', price: 18000,
  date: '2020-09-07', quantity: '3봉', note: '내 구매 기록 🔒', shop: '동네 펫숍', cycleDays: 30,
  createdAt: '2020-09-07T09:00:00.000Z' })];
const fixture = await createVault(RECORDS, PASSWORD);

function flipBase64(value) {
  const bytes = Buffer.from(value, 'base64');
  bytes[0] ^= 1;
  return bytes.toString('base64');
}

async function customPayload(payload) {
  const { ciphertext: _ciphertext, ...metadata } = fixture.envelope;
  metadata.iv = Buffer.from(webcrypto.getRandomValues(new Uint8Array(12))).toString('base64');
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: Buffer.from(metadata.iv, 'base64'),
    additionalData: new TextEncoder().encode(JSON.stringify(metadata)), tagLength: 128 }, fixture.session.key,
  new TextEncoder().encode(JSON.stringify(payload)));
  return { ...metadata, ciphertext: Buffer.from(ciphertext).toString('base64') };
}

test('Korean records round-trip with no plaintext or passphrase in the portable envelope', async () => {
  const restored = await unlockVault(JSON.parse(JSON.stringify(fixture.envelope)), PASSWORD);
  assert.deepEqual(restored.records, RECORDS);
  assert.equal(fixture.envelope.kind, VAULT_KIND);
  assert.equal(fixture.envelope.iterations, 600_000);
  assert.equal(isVault(fixture.envelope), true);
  assert.deepEqual(validateEnvelope(fixture.envelope), fixture.envelope);
  const json = JSON.stringify(fixture.envelope);
  for (const privateValue of [PASSWORD, RECORDS[0].name, RECORDS[0].note, RECORDS[0].shop, RECORDS[0].id, '"records"', '"key"']) assert.equal(json.includes(privateValue), false);
  assert.equal(Buffer.from(fixture.envelope.salt, 'base64').length, 16);
  assert.equal(Buffer.from(fixture.envelope.iv, 'base64').length, 12);
  assert.ok(MAX_VAULT_FILE_BYTES > 32 * 1024 * 1024 * 4 / 3);
});

test('sessions hold frozen nonextractable AES-256 keys and never passwords', async () => {
  assert.equal(Object.isFrozen(fixture.session), true);
  assert.deepEqual(Object.keys(fixture.session), ['key', 'salt', 'iterations']);
  assert.equal(fixture.session.key.extractable, false);
  assert.equal(fixture.session.key.algorithm.name, 'AES-GCM');
  assert.equal(fixture.session.key.algorithm.length, 256);
  await assert.rejects(webcrypto.subtle.exportKey('raw', fixture.session.key));
  await assert.rejects(sealVault(RECORDS, null), /잠금/);
  const extractable = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  await assert.rejects(sealVault(RECORDS, { ...fixture.session, key: extractable }), /잠금/);
});

test('wrong password and authenticated tampering return the same generic unlock error', async () => {
  const errors = [];
  for (const [envelope, password] of [[fixture.envelope, '잘못된 비밀번호 입니다'],
    ...['ciphertext', 'salt', 'iv'].map(field => [{ ...fixture.envelope, [field]: flipBase64(fixture.envelope[field]) }, PASSWORD])]) {
    try { await unlockVault(envelope, password); assert.fail('tampered vault unlocked'); } catch (error) { errors.push(error.message); }
  }
  assert.deepEqual(new Set(errors), new Set(['비밀번호가 다르거나 백업 파일이 손상되었어요.']));
});

test('each write uses a fresh IV while keeping the current session and salt', async () => {
  const another = await sealVault(RECORDS, fixture.session);
  assert.equal(another.salt, fixture.envelope.salt);
  assert.notEqual(another.iv, fixture.envelope.iv);
  assert.notEqual(another.ciphertext, fixture.envelope.ciphertext);
  assert.deepEqual((await unlockVault(another, PASSWORD)).records, RECORDS);
  const empty = await sealVault([], fixture.session);
  assert.deepEqual((await unlockVault(empty, PASSWORD)).records, []);
});

test('envelope validation rejects unknown fields, unsupported crypto and malformed encodings before key derivation', async () => {
  const bad = [null, [], {}, { ...fixture.envelope, debug: true }, { ...fixture.envelope, version: 2 },
    { ...fixture.envelope, kind: 'other' }, { ...fixture.envelope, iterations: 2 ** 31 },
    { ...fixture.envelope, iterations: '600000' }, { ...fixture.envelope, iterations: 1 },
    { ...fixture.envelope, kdf: 'PBKDF2-SHA1' }, { ...fixture.envelope, cipher: 'AES-CBC' },
    { ...fixture.envelope, salt: 'A'.repeat(24) }, { ...fixture.envelope, iv: '123' },
    { ...fixture.envelope, ciphertext: 'AAAA' }, { ...fixture.envelope, ciphertext: '!!!!'.repeat(20) },
    { ...fixture.envelope, salt: fixture.envelope.salt + '\n' },
    { ...fixture.envelope, ciphertext: 'A'.repeat(Math.ceil(32 * 1024 * 1024 / 3) * 4 + 4) }];
  const { salt: _salt, ...missingField } = fixture.envelope;
  bad.push(missingField);
  const accessor = { ...fixture.envelope };
  Object.defineProperty(accessor, 'iterations', { get() { throw new Error('must not run'); }, enumerable: true });
  bad.push(accessor);
  for (const value of bad) {
    assert.throws(() => validateEnvelope(value), /올바르지|지원하지/);
    assert.equal(isVault(value), false);
    await assert.rejects(unlockVault(value, PASSWORD), /올바르지|지원하지/);
  }
});

test('invalid record data cannot be encrypted, including duplicate IDs and future purchase dates', async () => {
  for (const records of [null, {}, new Array(100_001).fill(RECORDS[0]), new Array(1), [RECORDS[0], RECORDS[0]],
    [{ ...RECORDS[0], price: -1 }], [{ ...RECORDS[0], name: 'a'.repeat(121) }],
    [{ ...RECORDS[0], date: addDays(todayISO(), 1) }], [{ ...RECORDS[0], date: '2020-02-30' }],
    [{ ...RECORDS[0], id: '<script>' }], [{ ...RECORDS[0], category: '__proto__' }]]) {
    await assert.rejects(sealVault(records, fixture.session));
    await assert.rejects(createVault(records, PASSWORD));
  }
});

test('authenticated but invalid payloads fail closed on unlock', async () => {
  for (const payload of [{ version: 2, records: [] }, { version: 1, records: [], extra: 'not supported' },
    { version: 1, records: [RECORDS[0], RECORDS[0]] }, { version: 1, records: [{ ...RECORDS[0], price: -1 }] },
    { version: 1, records: [{ ...RECORDS[0], date: addDays(todayISO(), 1) }] }, { version: 1, records: {} }]) {
    await assert.rejects(unlockVault(await customPayload(payload), PASSWORD), /비밀번호가 다르거나 백업 파일이 손상/);
  }
});

test('passphrases require 10–256 Unicode characters and are never silently normalized', async () => {
  for (const password of [null, 123, '', '짧은암호', '😀'.repeat(9), ' '.repeat(12), 'a'.repeat(257), '😀'.repeat(257), '0123456789\ud800']) await assert.rejects(createVault([], password), /비밀번호/);
  const passphrase = '😀'.repeat(10);
  const unicode = await createVault([], passphrase);
  assert.deepEqual((await unlockVault(unicode.envelope, passphrase)).records, []);
  await assert.rejects(unlockVault(unicode.envelope, `${passphrase} `), /비밀번호가 다르거나/);
});
