import { useState, useEffect, useCallback } from "react";
import MagicMirror from "./components/MagicMirror";
import AdminPage from "./components/AdminPage";
import { getAllWords, getWord } from "./utils/storage";
import BUILTIN_WORDS from "./words";

const PAGE = {
  SELECT: "select",
  PRACTICE: "practice",
  ADMIN: "admin",
};

export default function App() {
  const [page, setPage] = useState(PAGE.SELECT);
  const [allWords, setAllWords] = useState([]);
  const [selectedWord, setSelectedWord] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load all words (built-in + custom from IndexedDB)
  const loadAllWords = useCallback(async () => {
    setLoading(true);
    try {
      const builtIn = BUILTIN_WORDS.map((w) => ({
        ...w,
        source: "builtin",
      }));

      const customList = await getAllWords();
      const custom = customList.map((w) => ({
        id: w.id,
        label: w.label,
        category: w.category,
        source: "custom",
      }));

      setAllWords([...builtIn, ...custom]);
    } catch (e) {
      console.error("Failed to load words:", e);
      setAllWords(BUILTIN_WORDS.map((w) => ({ ...w, source: "builtin" })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllWords();
  }, [loadAllWords]);

  const handleBackFromAdmin = () => {
    loadAllWords();
    setPage(PAGE.SELECT);
  };

  const handleSelectWord = async (word) => {
    if (word.source === "builtin") {
      setSelectedWord({
        id: word.id,
        label: word.label,
        videoPath: word.videoPath,
        refDataPath: word.refDataPath,
        source: "builtin",
      });
      setPage(PAGE.PRACTICE);
    } else {
      try {
        const full = await getWord(word.id);
        if (!full || !full.videoBlob || !full.refData) {
          alert("This word is missing video or reference data.");
          return;
        }
        const videoUrl = URL.createObjectURL(full.videoBlob);
        setSelectedWord({
          id: full.id,
          label: full.label,
          videoPath: videoUrl,
          refData: full.refData,
          source: "custom",
          _blobUrl: videoUrl,
        });
        setPage(PAGE.PRACTICE);
      } catch (e) {
        console.error("Failed to load word:", e);
        alert("Failed to load word: " + e.message);
      }
    }
  };

  const handleBackToMenu = () => {
    if (selectedWord?._blobUrl) {
      URL.revokeObjectURL(selectedWord._blobUrl);
    }
    setSelectedWord(null);
    setPage(PAGE.SELECT);
  };

  // === ADMIN PAGE ===
  if (page === PAGE.ADMIN) {
    return <AdminPage onBack={handleBackFromAdmin} />;
  }

  // === PRACTICE PAGE ===
  if (page === PAGE.PRACTICE && selectedWord) {
    return <MagicMirror word={selectedWord} onBack={handleBackToMenu} />;
  }

  // === SELECT PAGE ===
  const categories = {};
  for (const w of allWords) {
    const cat = w.category || "Uncategorised";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(w);
  }

  return (
    <div className="select-root">
      <div className="ambient idle" />
      <div className="select-content">
        <div className="select-header">
          <div className="subtitle">AUSLAN LEARNING TOOL</div>
          <h1>MAGIC MIRROR</h1>
          <p className="select-hint">Choose a sign to learn</p>
        </div>

        {loading ? (
          <div className="select-loading">Loading words...</div>
        ) : allWords.length === 0 ? (
          <div className="select-empty">
            <div className="select-empty-emoji">📝</div>
            <p>No words available yet.</p>
            <p>Go to the admin page to add signs.</p>
          </div>
        ) : (
          <div className="word-grid">
            {Object.entries(categories)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([cat, words]) => (
                <div key={cat} className="category-group">
                  <div className="category-label">{cat}</div>
                  <div className="category-words">
                    {words.map((w) => (
                      <button
                        key={w.id}
                        className={`word-card ${w.source}`}
                        onClick={() => handleSelectWord(w)}
                      >
                        <span className="word-card-label">{w.label}</span>
                        {w.source === "custom" && (
                          <span className="word-card-badge">custom</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        <div className="select-footer">
          <button className="admin-link" onClick={() => setPage(PAGE.ADMIN)}>
            ⚙ MANAGE WORDS
          </button>
          <div className="footer-text">
            PROTOTYPE · INCLUSIVE TECHNOLOGIES GROUP · QUT
          </div>
        </div>
      </div>
    </div>
  );
}
