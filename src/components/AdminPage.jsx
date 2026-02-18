import { useState, useEffect, useRef, useCallback } from "react";
import { getAllWords, getWord, saveWord, deleteWord } from "../utils/storage";
import { processVideo } from "../utils/videoProcessor";
import BUILTIN_WORDS from "../words";
import "./AdminPage.css";

export default function AdminPage({ onBack }) {
  // Word list
  const [customWords, setCustomWords] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [wordLabel, setWordLabel] = useState("");
  const [wordCategory, setWordCategory] = useState("");
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [refData, setRefData] = useState(null);

  // Messages
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fileInputRef = useRef(null);

  // Load custom words from storage
  const loadWords = useCallback(async () => {
    try {
      const words = await getAllWords();
      setCustomWords(words);
    } catch (e) {
      console.error("Failed to load words:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  // Clean up preview URL
  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  // Handle video file selection
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      setError("Please select a video file (MP4, WebM, etc.)");
      return;
    }

    setVideoFile(file);
    setError(null);
    setSuccess(null);
    setRefData(null);

    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(URL.createObjectURL(file));

    // Auto-fill label from filename if empty
    if (!wordLabel) {
      const name = file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
      setWordLabel(name.charAt(0).toUpperCase() + name.slice(1));
    }
  };

  // Process video to extract reference data
  const handleProcess = async () => {
    if (!videoFile) {
      setError("Please select a video file first.");
      return;
    }

    setProcessing(true);
    setError(null);
    setSuccess(null);
    setRefData(null);

    try {
      const data = await processVideo(videoFile, (msg, pct) => {
        setProgressMsg(msg);
        setProgressPct(pct);
      });

      if (data.frames.length < 3) {
        setError(
          `Only ${data.frames.length} frames detected. The video may be too short or no person is visible.`
        );
        setProcessing(false);
        return;
      }

      setRefData(data);
      setSuccess(
        `Extracted ${data.frames.length} frames (${data.duration}s at ~${data.fps} fps)`
      );
    } catch (e) {
      console.error("Processing failed:", e);
      setError("Processing failed: " + e.message);
    } finally {
      setProcessing(false);
    }
  };

  // Save word to storage
  const handleSave = async () => {
    if (!wordLabel.trim()) {
      setError("Please enter a word label.");
      return;
    }
    if (!videoFile) {
      setError("Please select a video file.");
      return;
    }
    if (!refData) {
      setError("Please process the video first to extract reference data.");
      return;
    }

    // Generate ID: keep unicode letters/digits, replace spaces with underscores
    let id = wordLabel
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    // Fallback to timestamp if label produces empty ID
    if (!id) id = `word_${Date.now()}`;

    // Check for duplicate
    const existing = await getWord(id);
    if (existing) {
      const overwrite = window.confirm(
        `A word with ID "${id}" already exists. Overwrite it?`
      );
      if (!overwrite) return;
    }

    try {
      // Read video file as blob
      const videoBlob = new Blob([await videoFile.arrayBuffer()], {
        type: videoFile.type,
      });

      // Fill in ref data metadata
      const finalRef = {
        ...refData,
        word: wordLabel.trim(),
      };

      await saveWord({
        id,
        label: wordLabel.trim(),
        category: wordCategory.trim() || "Uncategorised",
        videoBlob,
        refData: finalRef,
      });

      setSuccess(`"${wordLabel.trim()}" saved successfully!`);

      // Reset form
      setWordLabel("");
      setWordCategory("");
      setVideoFile(null);
      setRefData(null);
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      setVideoPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Refresh list
      await loadWords();
    } catch (e) {
      console.error("Save failed:", e);
      setError("Save failed: " + e.message);
    }
  };

  // Delete a custom word
  const handleDelete = async (id, label) => {
    const confirmed = window.confirm(`Delete "${label}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteWord(id);
      await loadWords();
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  return (
    <div className="admin-root">
      <div className="admin-header">
        <div className="title-group">
          <div>
            <div className="subtitle">MAGIC MIRROR</div>
            <h1>WORD MANAGER</h1>
          </div>
        </div>
        <button className="admin-back" onClick={onBack}>
          ← BACK
        </button>
      </div>

      <div className="admin-layout">
        {/* LEFT: Add new word */}
        <div className="admin-card">
          <h2>ADD NEW WORD</h2>

          <div className="form-group">
            <label>WORD / PHRASE</label>
            <input
              type="text"
              value={wordLabel}
              onChange={(e) => setWordLabel(e.target.value)}
              placeholder="e.g. Hello, Thank You"
            />
          </div>

          <div className="form-group">
            <label>CATEGORY</label>
            <input
              type="text"
              value={wordCategory}
              onChange={(e) => setWordCategory(e.target.value)}
              placeholder="e.g. Greetings, Animals"
            />
          </div>

          <div className="form-group">
            <label>SIGN VIDEO</label>
            <div className={`upload-zone ${videoFile ? "has-file" : ""}`}>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileChange}
              />
              {videoFile ? (
                <>
                  <div className="upload-icon">🎬</div>
                  <div className="upload-filename">{videoFile.name}</div>
                  <div className="upload-text">
                    {(videoFile.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                </>
              ) : (
                <>
                  <div className="upload-icon">📁</div>
                  <div className="upload-text">
                    Click or drag to upload video
                  </div>
                </>
              )}
            </div>

            {videoPreviewUrl && (
              <video
                src={videoPreviewUrl}
                className="video-preview"
                controls
                muted
                playsInline
              />
            )}
          </div>

          {/* Process button */}
          <button
            className={`btn-process ${refData ? "success" : ""}`}
            onClick={handleProcess}
            disabled={!videoFile || processing}
          >
            {processing
              ? "PROCESSING..."
              : refData
              ? "✓ PROCESSED"
              : "EXTRACT LANDMARKS"}
          </button>

          {/* Progress */}
          {processing && (
            <div className="process-progress">
              <div className="progress-text">{progressMsg}</div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Ref data stats */}
          {refData && (
            <div className="ref-stats">
              {refData.frames.length} frames · {refData.duration}s duration ·
              ~{refData.fps} fps
              <br />
              Hands detected:{" "}
              {refData.frames.filter((f) => f.rightHand || f.leftHand).length}{" "}
              frames
            </div>
          )}

          {/* Save button */}
          {refData && (
            <button
              className="btn-process"
              onClick={handleSave}
              disabled={!wordLabel.trim()}
              style={{ marginTop: "8px" }}
            >
              SAVE WORD
            </button>
          )}

          {error && <div className="error-msg">⚠ {error}</div>}
          {success && !processing && (
            <div className="success-msg">✓ {success}</div>
          )}
        </div>

        {/* RIGHT: Word list */}
        <div className="admin-card">
          <h2>WORD LIBRARY</h2>

          <div className="word-list">
            {/* Built-in words */}
            {BUILTIN_WORDS.map((w) => (
              <div key={`builtin-${w.id}`} className="word-item builtin">
                <div className="word-info">
                  <div className="word-label">{w.label}</div>
                  <div className="word-meta">Built-in · {w.category}</div>
                </div>
                <div className="word-actions">
                  <span className="word-category">{w.category}</span>
                </div>
              </div>
            ))}

            {/* Custom words */}
            {loading && (
              <div className="word-list-empty">Loading...</div>
            )}

            {!loading && customWords.length === 0 && (
              <div className="word-list-empty">
                No custom words yet.
                <br />
                Upload a sign video to get started.
              </div>
            )}

            {customWords.map((w) => (
              <div key={w.id} className="word-item">
                <div className="word-info">
                  <div className="word-label">{w.label}</div>
                  <div className="word-meta">
                    Custom ·{" "}
                    {new Date(w.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="word-actions">
                  <span className="word-category">{w.category}</span>
                  <button
                    className="btn-delete"
                    onClick={() => handleDelete(w.id, w.label)}
                  >
                    DELETE
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
