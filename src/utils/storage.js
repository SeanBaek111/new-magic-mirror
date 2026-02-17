/**
 * IndexedDB storage for user-added Auslan words.
 *
 * Each word record:
 *   { id, label, category, videoBlob, refData, createdAt }
 *
 * videoBlob  – the original MP4 file as a Blob
 * refData    – extracted reference JSON (same format as public/data/*.json)
 */

const DB_NAME = "magic-mirror";
const DB_VERSION = 1;
const STORE_NAME = "words";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("category", "category", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all stored words (without videoBlob for listing perf).
 * Returns array of { id, label, category, createdAt, hasVideo, hasRef }
 */
export async function getAllWords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const words = req.result.map((w) => ({
        id: w.id,
        label: w.label,
        category: w.category || "Uncategorised",
        createdAt: w.createdAt,
        hasVideo: !!w.videoBlob,
        hasRef: !!w.refData,
      }));
      resolve(words);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get a full word record (including videoBlob and refData).
 */
export async function getWord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Save a word record.
 * @param {{ id, label, category, videoBlob, refData }} word
 */
export async function saveWord(word) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const record = {
      ...word,
      createdAt: word.createdAt || Date.now(),
    };
    const req = tx.objectStore(STORE_NAME).put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete a word by ID.
 */
export async function deleteWord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all unique categories.
 */
export async function getCategories() {
  const words = await getAllWords();
  const cats = new Set(words.map((w) => w.category));
  return [...cats].sort();
}
