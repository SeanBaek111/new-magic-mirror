/**
 * Storage layer for user-added words.
 *
 * Primary: Supabase (when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set)
 * Fallback: IndexedDB (browser-local)
 *
 * Each word record:
 *   { id, label, category, videoBlob?, videoUrl?, refData, createdAt }
 *
 * IndexedDB stores videoBlob (Blob) locally.
 * Supabase stores videos in Storage and returns a public videoUrl.
 * refData is the extracted reference JSON (same format as public/data/*.json).
 */

import { supabase, useSupabase } from './supabaseClient.js';

// ─── IndexedDB backend ──────────────────────────────────────────────

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

async function idbGetAllWords() {
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

async function idbGetWord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSaveWord(word) {
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

async function idbDeleteWord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Supabase backend ───────────────────────────────────────────────

async function supaGetAllWords() {
  const { data, error } = await supabase
    .from('words')
    .select('id, name, category, video_url, ref_data, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data.map((w) => ({
    id: w.id,
    label: w.name,
    category: w.category || 'Uncategorised',
    createdAt: new Date(w.created_at).getTime(),
    hasVideo: !!w.video_url,
    hasRef: !!w.ref_data,
  }));
}

async function supaGetWord(id) {
  const { data, error } = await supabase
    .from('words')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    label: data.name,
    category: data.category || 'Uncategorised',
    createdAt: new Date(data.created_at).getTime(),
    videoUrl: data.video_url || null,
    refData: data.ref_data || null,
  };
}

async function supaSaveWord(word) {
  let videoUrl = null;

  if (word.videoBlob) {
    const videoPath = `${word.id}.mp4`;
    const { error: vErr } = await supabase.storage
      .from('videos')
      .upload(videoPath, word.videoBlob, { upsert: true, contentType: 'video/mp4' });
    if (vErr) throw vErr;

    const { data: urlData } = supabase.storage.from('videos').getPublicUrl(videoPath);
    videoUrl = urlData.publicUrl;
  }

  const row = {
    id: word.id,
    name: word.label,
    category: word.category || 'Uncategorised',
    video_url: videoUrl,
    ref_data: word.refData || null,
  };

  const { error } = await supabase.from('words').upsert(row);
  if (error) throw error;

  return { ...word, videoUrl, createdAt: word.createdAt || Date.now() };
}

async function supaDeleteWord(id) {
  // Delete video from Storage
  const videoPath = `${id}.mp4`;
  await supabase.storage.from('videos').remove([videoPath]);

  const { error } = await supabase.from('words').delete().eq('id', id);
  if (error) throw error;
}

// ─── Public API (unchanged interface) ───────────────────────────────
// If Supabase is configured but fails (e.g. table not created yet),
// fall back to IndexedDB so the app still works.

export async function getAllWords() {
  if (useSupabase) {
    try { return await supaGetAllWords(); }
    catch (e) { console.warn('Supabase getAllWords failed, falling back to IndexedDB:', e); }
  }
  return idbGetAllWords();
}

export async function getWord(id) {
  if (useSupabase) {
    try { return await supaGetWord(id); }
    catch (e) { console.warn('Supabase getWord failed, falling back to IndexedDB:', e); }
  }
  return idbGetWord(id);
}

export async function saveWord(word) {
  if (useSupabase) {
    try { return await supaSaveWord(word); }
    catch (e) { console.warn('Supabase saveWord failed, falling back to IndexedDB:', e); }
  }
  return idbSaveWord(word);
}

export async function deleteWord(id) {
  if (useSupabase) {
    try { return await supaDeleteWord(id); }
    catch (e) { console.warn('Supabase deleteWord failed, falling back to IndexedDB:', e); }
  }
  return idbDeleteWord(id);
}

export async function getCategories() {
  const words = await getAllWords();
  const cats = new Set(words.map((w) => w.category));
  return [...cats].sort();
}
