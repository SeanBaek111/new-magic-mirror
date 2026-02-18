/**
 * Storage layer for user-added words.
 *
 * Primary: Supabase (when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set)
 * Fallback: IndexedDB (browser-local)
 *
 * Each word record:
 *   { id, label, category, videoBlob, refData, createdAt }
 *
 * videoBlob  – the original MP4 file as a Blob
 * refData    – extracted reference JSON (same format as public/data/*.json)
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
    .select('id, label, category, video_path, ref_data_path, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data.map((w) => ({
    id: w.id,
    label: w.label,
    category: w.category || 'Uncategorised',
    createdAt: new Date(w.created_at).getTime(),
    hasVideo: !!w.video_path,
    hasRef: !!w.ref_data_path,
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

  let videoBlob = null;
  if (data.video_path) {
    const { data: videoData, error: videoErr } = await supabase.storage
      .from('videos')
      .download(data.video_path);
    if (videoErr) throw videoErr;
    videoBlob = videoData;
  }

  let refData = null;
  if (data.ref_data_path) {
    const { data: refBlob, error: refErr } = await supabase.storage
      .from('ref-data')
      .download(data.ref_data_path);
    if (refErr) throw refErr;
    refData = JSON.parse(await refBlob.text());
  }

  return {
    id: data.id,
    label: data.label,
    category: data.category || 'Uncategorised',
    createdAt: new Date(data.created_at).getTime(),
    videoBlob,
    refData,
  };
}

async function supaSaveWord(word) {
  const videoPath = `${word.id}.mp4`;
  const refPath = `${word.id}.json`;

  if (word.videoBlob) {
    const { error: vErr } = await supabase.storage
      .from('videos')
      .upload(videoPath, word.videoBlob, { upsert: true, contentType: 'video/mp4' });
    if (vErr) throw vErr;
  }

  if (word.refData) {
    const refBlob = new Blob([JSON.stringify(word.refData)], { type: 'application/json' });
    const { error: rErr } = await supabase.storage
      .from('ref-data')
      .upload(refPath, refBlob, { upsert: true, contentType: 'application/json' });
    if (rErr) throw rErr;
  }

  const row = {
    id: word.id,
    label: word.label,
    category: word.category || 'Uncategorised',
    video_path: word.videoBlob ? videoPath : null,
    ref_data_path: word.refData ? refPath : null,
  };

  const { error } = await supabase.from('words').upsert(row);
  if (error) throw error;

  return { ...word, createdAt: word.createdAt || Date.now() };
}

async function supaDeleteWord(id) {
  const { data } = await supabase
    .from('words')
    .select('video_path, ref_data_path')
    .eq('id', id)
    .single();

  if (data?.video_path) {
    await supabase.storage.from('videos').remove([data.video_path]);
  }
  if (data?.ref_data_path) {
    await supabase.storage.from('ref-data').remove([data.ref_data_path]);
  }

  const { error } = await supabase.from('words').delete().eq('id', id);
  if (error) throw error;
}

// ─── Public API (unchanged interface) ───────────────────────────────

export async function getAllWords() {
  return useSupabase ? supaGetAllWords() : idbGetAllWords();
}

export async function getWord(id) {
  return useSupabase ? supaGetWord(id) : idbGetWord(id);
}

export async function saveWord(word) {
  return useSupabase ? supaSaveWord(word) : idbSaveWord(word);
}

export async function deleteWord(id) {
  return useSupabase ? supaDeleteWord(id) : idbDeleteWord(id);
}

export async function getCategories() {
  const words = await getAllWords();
  const cats = new Set(words.map((w) => w.category));
  return [...cats].sort();
}
