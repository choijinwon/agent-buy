import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceStore, VAULT_KEY, LEGACY_KEY } from '../dist/device-store.js';
import { normalizeRecord } from '../dist/domain.js';
import { unlockVault } from '../dist/vault.js';

const PASSWORD = 'my-device-only-비밀번호';
const record = (changes = {}) => normalizeRecord({
  id: 'cat-treat', name: '고양이 간식', category: 'cat', price: 18000,
  quantity: '3봉', date: '2026-09-07', cycleDays: 30,
  createdAt: '2026-09-07T09:00:00.000Z', ...changes,
});
const code = expected => error => error.code === expected;

class MemoryStorage {
  values = new Map();
  writes = [];
  failWrite = false;
  failRemove = false;
  discardWrite = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.failWrite) throw new DOMException('Full', 'QuotaExceededError');
    this.writes.push([key, value]);
    if (!this.discardWrite) this.values.set(key, String(value));
  }
  removeItem(key) {
    if (this.failRemove) throw new DOMException('Blocked', 'SecurityError');
    this.values.delete(key);
  }
}

function legacyStorage(records = [record()]) {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, records }));
  storage.writes = [];
  return storage;
}

test('a new device starts empty and persists only ciphertext, never examples or password', async () => {
  const storage = new MemoryStorage();
  const store = new DeviceStore(storage);
  assert.deepEqual(store.status(), { mode: 'empty' });
  assert.deepEqual(await store.create(PASSWORD), []);
  assert.deepEqual(store.status(), { mode: 'unlocked' });
  await store.save([record()]);
  assert.equal(storage.getItem(LEGACY_KEY), null);
  for (const [key, raw] of storage.writes) {
    assert.equal(key, VAULT_KEY);
    assert.equal(raw.includes(PASSWORD), false);
    assert.equal(raw.includes('고양이 간식'), false);
  }
  store.lock();
  assert.deepEqual(store.status(), { mode: 'locked' });
  assert.equal(store.isUnlocked, false);
  const exported = store.exportVault();
  assert.deepEqual((await unlockVault(exported, PASSWORD)).records, [record()]);
});

test('legacy migration removes plaintext only after a verified ciphertext write', async () => {
  const storage = legacyStorage();
  const store = new DeviceStore(storage);
  assert.deepEqual(store.status(), { mode: 'legacy' });
  assert.deepEqual(await store.create(PASSWORD), [record()]);
  assert.equal(storage.getItem(LEGACY_KEY), null);
  store.lock();
  assert.deepEqual(await store.unlock(PASSWORD), [record()]);
});

test('quota failure and an unpersisted write preserve all legacy data', async () => {
  for (const failure of ['failWrite', 'discardWrite']) {
    const storage = legacyStorage();
    const previous = storage.getItem(LEGACY_KEY);
    storage[failure] = true;
    const store = new DeviceStore(storage);
    await assert.rejects(store.create(PASSWORD), code('STORAGE_WRITE_FAILED'));
    assert.equal(storage.getItem(LEGACY_KEY), previous);
    assert.equal(storage.getItem(VAULT_KEY), null);
    assert.equal(store.isUnlocked, false);
  }
});

test('failed plaintext cleanup reports incomplete protection and unlock retries it', async () => {
  const storage = legacyStorage();
  const previous = storage.getItem(LEGACY_KEY);
  storage.failRemove = true;
  const store = new DeviceStore(storage);
  await assert.rejects(store.create(PASSWORD), code('MIGRATION_CLEANUP_FAILED'));
  assert.equal(storage.getItem(LEGACY_KEY), previous);
  assert.ok(storage.getItem(VAULT_KEY));
  assert.deepEqual(store.status(), { mode: 'locked' });
  storage.failRemove = false;
  assert.deepEqual(await store.unlock(PASSWORD), [record()]);
  assert.equal(storage.getItem(LEGACY_KEY), null);
});

test('cleanup cannot delete newer plaintext records from an older app tab', async () => {
  const storage = legacyStorage();
  storage.failRemove = true;
  const store = new DeviceStore(storage);
  await assert.rejects(store.create(PASSWORD), code('MIGRATION_CLEANUP_FAILED'));
  storage.failRemove = false;
  const newer = JSON.stringify({ version: 1, records: [record({ price: 22000 })] });
  storage.setItem(LEGACY_KEY, newer);
  await assert.rejects(store.unlock(PASSWORD), code('MIGRATION_CLEANUP_FAILED'));
  assert.equal(storage.getItem(LEGACY_KEY), newer);
  assert.equal(store.isUnlocked, false);
});

test('wrong passwords preserve ciphertext and keep a locked store locked', async () => {
  const storage = legacyStorage();
  const store = new DeviceStore(storage);
  await store.create(PASSWORD);
  store.lock();
  const previous = storage.getItem(VAULT_KEY);
  await assert.rejects(store.unlock('this-is-the-wrong-password'));
  assert.equal(storage.getItem(VAULT_KEY), previous);
  assert.deepEqual(store.status(), { mode: 'locked' });
  assert.deepEqual(await store.unlock(PASSWORD), [record()]);
});

test('two tabs cannot silently save over a changed ciphertext baseline', async () => {
  const storage = new MemoryStorage();
  const first = new DeviceStore(storage);
  const second = new DeviceStore(storage);
  await first.create(PASSWORD);
  await second.unlock(PASSWORD);
  await first.save([record({ price: 21000 })]);
  const latest = storage.getItem(VAULT_KEY);
  await assert.rejects(second.save([record({ price: 5000 })]), code('STALE_STORAGE'));
  assert.equal(storage.getItem(VAULT_KEY), latest);
  assert.equal(second.isUnlocked, false);
  assert.deepEqual(await second.unlock(PASSWORD), [record({ price: 21000 })]);
});

test('simultaneous saves from different tabs reject one stale write', async () => {
  const storage = new MemoryStorage();
  const first = new DeviceStore(storage);
  const second = new DeviceStore(storage);
  await first.create(PASSWORD);
  await second.unlock(PASSWORD);
  const results = await Promise.allSettled([
    first.save([record({ price: 11111 })]),
    second.save([record({ price: 22222 })]),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'STALE_STORAGE');
});

test('same-store saves serialize and capture caller data at invocation time', async () => {
  const storage = new MemoryStorage();
  const store = new DeviceStore(storage);
  await store.create(PASSWORD);
  const firstRecords = [record({ price: 11000 })];
  const secondRecords = [record({ price: 22000 })];
  const firstSave = store.save(firstRecords);
  const secondSave = store.save(secondRecords);
  secondRecords[0].price = 99999;
  await Promise.all([firstSave, secondSave]);
  store.lock();
  assert.equal((await store.unlock(PASSWORD))[0].price, 22000);
});

test('quota failures preserve encrypted records and allow a later successful save', async () => {
  const storage = legacyStorage();
  const store = new DeviceStore(storage);
  await store.create(PASSWORD);
  const previous = storage.getItem(VAULT_KEY);
  storage.failWrite = true;
  await assert.rejects(store.save([record({ price: 99999 })]), code('STORAGE_WRITE_FAILED'));
  assert.equal(storage.getItem(VAULT_KEY), previous);
  storage.failWrite = false;
  await store.save([record({ price: 25000 })]);
  store.lock();
  assert.equal((await store.unlock(PASSWORD))[0].price, 25000);
});

test('locking during create, unlock or save prevents late writes and session resurrection', async () => {
  const storage = legacyStorage();
  const store = new DeviceStore(storage);
  const legacy = storage.getItem(LEGACY_KEY);
  const creating = store.create(PASSWORD);
  await Promise.resolve();
  store.lock();
  await assert.rejects(creating, code('OPERATION_CANCELLED'));
  assert.equal(storage.getItem(VAULT_KEY), null);
  assert.equal(storage.getItem(LEGACY_KEY), legacy);
  assert.equal(store.isUnlocked, false);

  await store.create(PASSWORD);
  store.lock();
  const before = storage.getItem(VAULT_KEY);
  const unlocking = store.unlock(PASSWORD);
  await Promise.resolve();
  store.lock();
  await assert.rejects(unlocking, code('OPERATION_CANCELLED'));
  assert.equal(store.isUnlocked, false);
  assert.equal(storage.getItem(VAULT_KEY), before);

  await store.unlock(PASSWORD);
  const saving = store.save([record({ price: 99999 })]);
  const queuedSave = store.save([record({ price: 88888 })]);
  await Promise.resolve();
  store.lock();
  await assert.rejects(saving, code('OPERATION_CANCELLED'));
  await assert.rejects(queuedSave, code('OPERATION_CANCELLED'));
  assert.equal(storage.getItem(VAULT_KEY), before);
  assert.equal(store.isUnlocked, false);
});

test('status detects storage changes and corruption without revealing or overwriting records', async () => {
  const storage = new MemoryStorage();
  const store = new DeviceStore(storage);
  await store.create(PASSWORD);
  storage.setItem(VAULT_KEY, '{broken');
  assert.throws(() => store.status(), code('CORRUPT_STORAGE'));
  assert.equal(store.isUnlocked, false);
  assert.equal(storage.getItem(VAULT_KEY), '{broken');
  const blocked = new DeviceStore({ getItem() { throw new Error('Access denied'); } });
  assert.throws(() => blocked.status(), code('STORAGE_UNAVAILABLE'));
});
