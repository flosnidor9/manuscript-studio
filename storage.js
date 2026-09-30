import { sanitizeImported } from './model.js';

const DB_VERSION = 3;
const MAX_RECOVERY_POINTS = 12;

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('write-supporter', DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('trash')) db.createObjectStore('trash', { keyPath: 'id' });
      const recovery = db.objectStoreNames.contains('recoveryPoints') ? request.transaction.objectStore('recoveryPoints') : db.createObjectStore('recoveryPoints', { keyPath: 'id' });
      if (!recovery.indexNames.contains('documentId')) recovery.createIndex('documentId', 'documentId', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function complete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function withDb(action) {
  const db = await openDb();
  try { return await action(db); }
  finally { db.close(); }
}

export function writeDocument(db, record) {
  const tx = db.transaction('documents', 'readwrite');
  tx.objectStore('documents').put(record);
  return complete(tx);
}

export function readLibrary(db) {
  const tx = db.transaction(['documents', 'trash'], 'readonly');
  const documents = tx.objectStore('documents').getAll();
  const trash = tx.objectStore('trash').getAll();
  return complete(tx).then(() => ({ documents: documents.result, trash: trash.result }));
}

export function moveToTrash(db, deleted) {
  const tx = db.transaction(['documents', 'trash'], 'readwrite');
  tx.objectStore('trash').put(deleted);
  tx.objectStore('documents').delete(deleted.id);
  return complete(tx);
}

export function restoreFromTrash(db, deleted, restored) {
  const tx = db.transaction(['documents', 'trash', 'recoveryPoints'], 'readwrite');
  if (deleted.version === 1) tx.objectStore('recoveryPoints').put({ id: `${restored.id}:migration:${Date.now()}:${Math.random().toString(36).slice(2)}`, documentId: restored.id, reason: '삭제 원고 이전 버전 백업', createdAt: new Date().toISOString(), data: deleted });
  tx.objectStore('documents').put(restored);
  tx.objectStore('trash').delete(restored.id);
  return complete(tx);
}

export function deleteFromTrash(db, id) {
  const tx = db.transaction('trash', 'readwrite');
  tx.objectStore('trash').delete(id);
  return complete(tx);
}

export function storeRecoveryPoint(db, record, reason) {
  const point = { id: `${record.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`, documentId: record.id, reason, createdAt: new Date().toISOString(), data: record };
  const tx = db.transaction('recoveryPoints', 'readwrite');
  const store = tx.objectStore('recoveryPoints');
  store.put(point);
  const request = store.index('documentId').getAll(record.id);
  request.onsuccess = () => request.result.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, Math.max(0, request.result.length - MAX_RECOVERY_POINTS)).forEach(item => store.delete(item.id));
  return complete(tx);
}

export async function migrateLegacyRecords(db, records) {
  const legacy = records.filter(record => record?.version === 1);
  if (!legacy.length) return records;
  const converted = legacy.flatMap(record => { try { return [{ original: record, next: sanitizeImported(record) }]; } catch (_) { return []; } });
  if (!converted.length) return records;
  const tx = db.transaction(['documents', 'recoveryPoints'], 'readwrite');
  for (const { original, next } of converted) {
    tx.objectStore('recoveryPoints').put({ id: `${next.id}:migration:${Date.now()}:${Math.random().toString(36).slice(2)}`, documentId: next.id, reason: '여백 설정 이전 버전 백업', createdAt: new Date().toISOString(), data: original });
    tx.objectStore('documents').put(next);
  }
  await complete(tx);
  const byId = new Map(converted.map(({ next }) => [next.id, next]));
  return records.map(record => byId.get(record.id) || record);
}
