import { normalizeRecord, todayISO } from './domain.js';

export const VAULT_KIND = 'mwo-satji-vault';
const VERSION = 1;
const ITERATIONS = 600_000;
const KDF = 'PBKDF2-SHA256';
const CIPHER = 'AES-GCM';
const MAX_RECORDS = 100_000;
const MAX_CIPHERTEXT_BYTES = 32 * 1024 * 1024;
// Includes base64 expansion and room for the fixed envelope metadata.
export const MAX_VAULT_FILE_BYTES = Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 + 1024;
const ENVELOPE_FIELDS = ['kind', 'version', 'kdf', 'iterations', 'cipher', 'salt', 'iv', 'ciphertext'];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const UNLOCK_ERROR = '비밀번호가 다르거나 백업 파일이 손상되었어요.';

function cryptoAPI() {
  if (!globalThis.crypto?.subtle) throw new Error('이 브라우저에서는 암호화 저장을 사용할 수 없어요. HTTPS 또는 localhost로 열어 주세요.');
  return globalThis.crypto;
}

function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => fields.includes(key)
    && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
    && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
}

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

function fromBase64(value, label, minBytes, maxBytes = minBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4
    || value.length < Math.ceil(minBytes / 3) * 4 || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new TypeError(`${label}의 암호화 데이터 형식이 올바르지 않아요.`);
  }
  let binary;
  try { binary = atob(value); } catch { throw new TypeError(`${label}의 암호화 데이터 형식이 올바르지 않아요.`); }
  // Canonical encoding prevents multiple serialized representations of one value.
  if (binary.length < minBytes || binary.length > maxBytes || btoa(binary) !== value) throw new TypeError(`${label}의 암호화 데이터 길이나 형식이 올바르지 않아요.`);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** Validate untrusted imports before deriving a key or replacing any saved data. */
export function validateEnvelope(input) {
  if (!exactObject(input, ENVELOPE_FIELDS)) throw new TypeError('암호화 백업 파일의 항목이 올바르지 않아요.');
  if (input.kind !== VAULT_KIND || input.version !== VERSION) throw new TypeError('지원하지 않는 뭐샀지 암호화 백업 버전이에요.');
  if (input.kdf !== KDF || input.iterations !== ITERATIONS || input.cipher !== CIPHER) throw new TypeError('지원하지 않는 암호화 방식이에요.');
  fromBase64(input.salt, '보안 키', 16);
  fromBase64(input.iv, '저장 키', 12);
  fromBase64(input.ciphertext, '구매 기록', 16, MAX_CIPHERTEXT_BYTES);
  return Object.freeze(Object.fromEntries(ENVELOPE_FIELDS.map(field => [field, input[field]])));
}

export function isVault(value) {
  try { validateEnvelope(value); return true; } catch { return false; }
}

function passwordBytes(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length > 512) throw new TypeError('비밀번호는 10~256자로 입력해 주세요.');
  const length = [...passphrase].length;
  if (length < 10 || length > 256 || !passphrase.trim()) throw new TypeError('비밀번호는 10~256자로 입력해 주세요.');
  // Reject unpaired UTF-16 surrogates; TextEncoder would silently replace them.
  if (decoder.decode(encoder.encode(passphrase)) !== passphrase) throw new TypeError('비밀번호에 올바르지 않은 문자가 있어요.');
  return encoder.encode(passphrase);
}

async function deriveSession(passphrase, salt) {
  const bytes = passwordBytes(passphrase);
  try {
    const subtle = cryptoAPI().subtle;
    const material = await subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey({ name: 'PBKDF2', salt: fromBase64(salt, '보안 키', 16), iterations: ITERATIONS, hash: 'SHA-256' },
      material, { name: CIPHER, length: 256 }, false, ['encrypt', 'decrypt']);
    return Object.freeze({ key, salt, iterations: ITERATIONS });
  } finally { bytes.fill(0); }
}

function normalizedRecords(records) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) throw new TypeError('구매 기록은 100,000개 이하의 목록이어야 해요.');
  const ids = new Set();
  const today = todayISO();
  return Array.from(records, value => {
    const record = normalizeRecord(value);
    if (ids.has(record.id)) throw new TypeError('중복된 기록 ID가 있어요.');
    if (record.date > today) throw new TypeError('미래 구매 날짜가 있어요. 기록을 확인해 주세요.');
    ids.add(record.id);
    return record;
  });
}

function metadata(salt, iv) {
  return { kind: VAULT_KIND, version: VERSION, kdf: KDF, iterations: ITERATIONS, cipher: CIPHER, salt, iv };
}

function authenticatedData(envelope) {
  return encoder.encode(JSON.stringify(metadata(envelope.salt, envelope.iv)));
}

function checkedSession(session) {
  if (!session || session.iterations !== ITERATIONS || session.key?.type !== 'secret'
    || session.key.extractable !== false || session.key.algorithm?.name !== CIPHER
    || session.key.algorithm?.length !== 256 || !session.key.usages?.includes('encrypt')
    || !session.key.usages?.includes('decrypt')) throw new TypeError('잠금이 해제되어 있지 않아요. 비밀번호로 다시 열어 주세요.');
  fromBase64(session.salt, '보안 키', 16);
  return session;
}

/** A session contains only a nonextractable in-memory key; never persist it. */
export async function createVault(records, passphrase) {
  const normalized = normalizedRecords(records);
  const salt = toBase64(cryptoAPI().getRandomValues(new Uint8Array(16)));
  const session = await deriveSession(passphrase, salt);
  const envelope = await sealVault(normalized, session);
  return { envelope, session };
}

/** Every successful write gets a fresh IV, even when the records are unchanged. */
export async function sealVault(records, session) {
  const { key, salt } = checkedSession(session);
  const plaintext = encoder.encode(JSON.stringify({ version: VERSION, records: normalizedRecords(records) }));
  try {
    if (plaintext.length > MAX_CIPHERTEXT_BYTES - 16) throw new TypeError('구매 기록이 너무 커서 저장할 수 없어요.');
    const iv = cryptoAPI().getRandomValues(new Uint8Array(12));
    const envelope = metadata(salt, toBase64(iv));
    const ciphertext = await cryptoAPI().subtle.encrypt({ name: CIPHER, iv, additionalData: authenticatedData(envelope), tagLength: 128 }, key, plaintext);
    return Object.freeze({ ...envelope, ciphertext: toBase64(new Uint8Array(ciphertext)) });
  } finally { plaintext.fill(0); }
}

export async function unlockVault(input, passphrase) {
  const envelope = validateEnvelope(input);
  const session = await deriveSession(passphrase, envelope.salt);
  let plaintext;
  try {
    plaintext = new Uint8Array(await cryptoAPI().subtle.decrypt({ name: CIPHER,
      iv: fromBase64(envelope.iv, '저장 키', 12), additionalData: authenticatedData(envelope), tagLength: 128 },
    session.key, fromBase64(envelope.ciphertext, '구매 기록', 16, MAX_CIPHERTEXT_BYTES)));
    const payload = JSON.parse(decoder.decode(plaintext));
    if (!exactObject(payload, ['version', 'records']) || payload.version !== VERSION) throw new TypeError(UNLOCK_ERROR);
    return { records: normalizedRecords(payload.records), session };
  } catch {
    throw new Error(UNLOCK_ERROR);
  } finally { plaintext?.fill(0); }
}
