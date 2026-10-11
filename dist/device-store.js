import { normalizeRecord } from './domain.js';
import { createVault, unlockVault, sealVault, validateEnvelope } from './vault.js';

export const VAULT_KEY = 'mwo-satji.vault.v1';
export const LEGACY_KEY = 'mwo-satji.records.v1';

function problem(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function readLegacy(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.records)) throw new Error('Invalid legacy data');
    return data.records.map(normalizeRecord);
  } catch (cause) {
    throw problem('CORRUPT_STORAGE', '이전에 저장한 기록 형식이 올바르지 않아요. 기존 데이터는 그대로 보관했어요.', cause);
  }
}

function readEnvelope(raw) {
  try {
    const envelope = JSON.parse(raw);
    return validateEnvelope(envelope);
  } catch (cause) {
    throw problem('CORRUPT_STORAGE', '암호화된 기록 형식이 올바르지 않아요. 기존 데이터는 그대로 보관했어요.', cause);
  }
}

/** Only ciphertext is written to this device's localStorage; keys live in memory. */
export class DeviceStore {
  #storage;
  #session = null;
  #baseline = null;
  #epoch = 0;
  #queue = Promise.resolve();

  constructor(storage) {
    this.#storage = storage;
  }

  get isUnlocked() { return this.#session !== null; }

  status() {
    const snapshot = this.#snapshot();
    if (this.#session && !this.#sameSnapshot(snapshot, this.#baseline)) this.lock();
    if (snapshot.vault !== null) {
      readEnvelope(snapshot.vault);
      return { mode: this.#session ? 'unlocked' : 'locked' };
    }
    if (snapshot.legacy !== null) {
      readLegacy(snapshot.legacy);
      return { mode: 'legacy' };
    }
    return { mode: 'empty' };
  }

  create(password) {
    return this.#enqueue(async epoch => {
      const before = this.#snapshot();
      if (before.vault !== null) throw problem('VAULT_EXISTS', '이미 저장된 기록이 있어요. 기존 비밀번호로 잠금을 해제해 주세요.');
      const records = before.legacy === null ? [] : readLegacy(before.legacy);
      const { envelope, session } = await createVault(records, password);
      this.#checkEpoch(epoch);
      this.#expectSnapshot(before);
      const raw = JSON.stringify(envelope);
      this.#writeAndVerify(raw);
      this.#finishMigration(raw, before.legacy, records, false);
      this.#checkEpoch(epoch);
      this.#session = session;
      this.#baseline = { vault: raw, legacy: null };
      return records;
    });
  }

  unlock(password) {
    return this.#enqueue(async epoch => {
      const before = this.#snapshot();
      if (before.vault === null) throw problem('VAULT_MISSING', '아직 암호화된 기록이 없어요. 먼저 이 기기의 비밀번호를 설정해 주세요.');
      const { records, session } = await unlockVault(readEnvelope(before.vault), password);
      this.#checkEpoch(epoch);
      this.#expectSnapshot(before);
      this.#finishMigration(before.vault, before.legacy, records);
      this.#checkEpoch(epoch);
      this.#session = session;
      this.#baseline = { vault: before.vault, legacy: null };
      return records;
    });
  }

  save(records) {
    // Take the caller's snapshot now, before waiting behind another save.
    let snapshot;
    try {
      if (!Array.isArray(records)) throw new TypeError('구매 기록 목록이 올바르지 않아요.');
      snapshot = records.map(normalizeRecord);
    } catch (error) { return Promise.reject(error); }
    return this.#enqueue(async epoch => {
      if (!this.#session) throw problem('LOCKED', '기록을 저장하려면 먼저 잠금을 해제해 주세요.');
      const before = this.#baseline;
      this.#expectSnapshot(before);
      const envelope = await sealVault(snapshot, this.#session);
      this.#checkEpoch(epoch);
      this.#expectSnapshot(before);
      const raw = JSON.stringify(envelope);
      this.#writeAndVerify(raw);
      this.#baseline = { vault: raw, legacy: null };
    });
  }

  lock() {
    this.#epoch += 1;
    this.#session = null;
    this.#baseline = null;
  }

  exportVault() {
    const raw = this.#read(VAULT_KEY);
    if (raw === null) throw problem('VAULT_MISSING', '아직 백업할 기록이 없어요. 먼저 이 기기의 비밀번호를 설정해 주세요.');
    return readEnvelope(raw);
  }

  #enqueue(operation) {
    const epoch = this.#epoch;
    const pending = this.#queue.then(() => {
      this.#checkEpoch(epoch);
      return operation(epoch);
    });
    // A rejected save must not poison later operations or expose an unhandled rejection.
    this.#queue = pending.catch(() => {});
    return pending;
  }

  #checkEpoch(epoch) {
    if (epoch !== this.#epoch) throw problem('OPERATION_CANCELLED', '잠금 상태가 바뀌어 작업을 중단했어요. 다시 잠금을 해제해 주세요.');
  }

  #read(key) {
    try { return this.#storage.getItem(key); }
    catch (cause) { throw problem('STORAGE_UNAVAILABLE', '이 기기의 저장 공간을 읽을 수 없어요. 브라우저의 저장 권한을 확인해 주세요.', cause); }
  }

  #snapshot() { return { vault: this.#read(VAULT_KEY), legacy: this.#read(LEGACY_KEY) }; }

  #sameSnapshot(left, right) {
    return right !== null && left.vault === right.vault && left.legacy === right.legacy;
  }

  #expectSnapshot(expected) {
    if (!this.#sameSnapshot(this.#snapshot(), expected)) {
      this.lock();
      throw problem('STALE_STORAGE', '다른 창에서 기록이 바뀌었어요. 잠금을 다시 해제한 뒤 최신 기록에서 시도해 주세요.');
    }
  }

  #writeAndVerify(raw) {
    try { this.#storage.setItem(VAULT_KEY, raw); }
    catch (cause) {
      throw problem('STORAGE_WRITE_FAILED', '기록을 저장하지 못했어요. 기존 기록은 유지되니 기기의 저장 공간과 브라우저 권한을 확인해 주세요.', cause);
    }
    if (this.#read(VAULT_KEY) !== raw) {
      this.lock();
      throw problem('STORAGE_WRITE_FAILED', '기록이 저장됐는지 확인할 수 없어요. 잠금을 다시 해제해 저장된 기록을 확인해 주세요.');
    }
  }

  #finishMigration(vaultRaw, legacyRaw, records, verifyContents = true) {
    if (legacyRaw === null) return;
    try {
      this.#expectSnapshot({ vault: vaultRaw, legacy: legacyRaw });
      if (verifyContents && JSON.stringify(readLegacy(legacyRaw)) !== JSON.stringify(records)) {
        throw new Error('Legacy records differ from the encrypted copy');
      }
      this.#storage.removeItem(LEGACY_KEY);
      if (this.#read(LEGACY_KEY) !== null) throw new Error('Legacy removal was not persisted');
    } catch (cause) {
      this.lock();
      throw problem('MIGRATION_CLEANUP_FAILED', '암호화 사본은 보관됐지만 이전 일반 기록을 지우지 못했어요. 보호 설정이 아직 끝나지 않았으니 브라우저 저장 권한을 확인하고 잠금을 다시 해제해 주세요.', cause);
    }
  }
}
