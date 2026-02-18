import { useState, useEffect, useRef, useCallback } from "react";
import { drawLiveSkeleton } from "../utils/drawing";
import { compareDTW, generateFeedback } from "../utils/poseComparison";
import useMediaPipe from "../hooks/useMediaPipe";
import { getAllWords, getWord } from "../utils/storage";
import BUILTIN_WORDS from "../words";

/**
 * Debug page for testing skeleton alignment and scoring algorithm.
 * Access via ?debug in the URL.
 */
export default function DebugMirror() {
  const [webcamReady, setWebcamReady] = useState(false);
  const [fps, setFps] = useState(0);
  const [words, setWords] = useState([]);
  const [selectedWord, setSelectedWord] = useState(null);
  const [refData, setRefData] = useState(null);
  const [recording, setRecording] = useState(false);
  const [scoreResult, setScoreResult] = useState(null);

  const canvasRef = useRef(null);
  const webcamRef = useRef(null);
  const streamRef = useRef(null);
  const animRef = useRef(null);
  const frameRef = useRef(null);
  const fpsRef = useRef({ count: 0, last: performance.now() });
  const recordedFramesRef = useRef([]);
  const recordingRef = useRef(false);

  const { loading: mpLoading, error: mpError, detect, cleanup: mpCleanup } = useMediaPipe();

  // Load word list
  useEffect(() => {
    (async () => {
      const builtIn = BUILTIN_WORDS.map(w => ({ ...w, source: "builtin" }));
      try {
        const customList = await getAllWords();
        const custom = customList.map(w => ({ id: w.id, label: w.label, category: w.category, source: "custom" }));
        setWords([...builtIn, ...custom]);
      } catch {
        setWords(builtIn);
      }
    })();
  }, []);

  // Load ref data when word selected
  useEffect(() => {
    if (!selectedWord) { setRefData(null); return; }
    if (selectedWord.source === "builtin") {
      fetch(selectedWord.refDataPath).then(r => r.json()).then(setRefData).catch(() => setRefData(null));
    } else {
      getWord(selectedWord.id).then(full => setRefData(full?.refData || null)).catch(() => setRefData(null));
    }
  }, [selectedWord]);

  // Canvas resize
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = frameRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  // Webcam
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        });
        if (webcamRef.current) {
          webcamRef.current.srcObject = stream;
          await webcamRef.current.play();
        }
        streamRef.current = stream;
        setWebcamReady(true);
      } catch (e) {
        console.warn("Webcam unavailable:", e);
      }
    })();
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      mpCleanup();
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [mpCleanup]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !webcamReady) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0c0c14";
      ctx.fillRect(0, 0, w, h);

      // Compute viewport
      const vw = webcamRef.current?.videoWidth || w;
      const vh = webcamRef.current?.videoHeight || h;
      const videoAspect = vw / vh;
      const canvasAspect = w / h;
      let dw, dh, dx, dy;
      if (videoAspect > canvasAspect) {
        dw = w; dh = w / videoAspect;
        dx = 0; dy = (h - dh) / 2;
      } else {
        dh = h; dw = h * videoAspect;
        dx = (w - dw) / 2; dy = 0;
      }

      // Draw mirrored webcam
      if (webcamRef.current) {
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(webcamRef.current, dx, dy, dw, dh);
        ctx.restore();
      }

      // MediaPipe detection + skeleton
      if (!mpLoading) {
        const result = detect(webcamRef.current, performance.now());
        if (result.pose || result.rightHand || result.leftHand) {
          ctx.save();
          ctx.translate(dx, dy);
          drawLiveSkeleton(ctx, result, dw, dh, true, {
            poseColor: "#00ff88",
            handColor: "#ff6b6b",
            leftHandColor: "#6bc5ff",
            poseWidth: 3,
            handWidth: 2.5,
            dotRadius: 5,
          });
          ctx.restore();

          // Record frames if recording
          if (recordingRef.current) {
            const now = Date.now();
            const frames = recordedFramesRef.current;
            const lastT = frames.length > 0 ? frames[frames.length - 1]._t : 0;
            if (now - lastT >= 100) {
              frames.push({
                pose: result.pose?.map(p => [p[0], p[1]]),
                rightHand: result.rightHand?.map(p => [p[0], p[1]]),
                leftHand: result.leftHand?.map(p => [p[0], p[1]]),
                _t: now,
              });
            }
          }
        }

        // FPS
        fpsRef.current.count++;
        const now = performance.now();
        if (now - fpsRef.current.last >= 1000) {
          setFps(fpsRef.current.count);
          fpsRef.current.count = 0;
          fpsRef.current.last = now;
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [webcamReady, mpLoading, detect]);

  const toggleRecording = () => {
    if (!recording) {
      recordedFramesRef.current = [];
      recordingRef.current = true;
      setRecording(true);
      setScoreResult(null);
    } else {
      recordingRef.current = false;
      setRecording(false);
      // Score immediately
      if (refData && recordedFramesRef.current.length >= 3) {
        const dtw = compareDTW(recordedFramesRef.current, refData.frames);
        const fb = generateFeedback(dtw);
        setScoreResult({ ...dtw, feedback: fb });
        console.log("Debug DTW result:", dtw, fb);
      } else {
        setScoreResult({ error: `Not enough frames (${recordedFramesRef.current.length}) or no ref data` });
      }
    }
  };

  const panelStyle = {
    position: "absolute", top: 10, left: 10, zIndex: 10,
    background: "rgba(0,0,0,0.8)", padding: "12px", borderRadius: "10px",
    color: "#fff", fontFamily: "'DM Mono', monospace", fontSize: "12px",
    maxWidth: "320px", maxHeight: "90vh", overflowY: "auto",
  };

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#08080e", position: "relative" }}>
      <div ref={frameRef} style={{ width: "100%", height: "100%", position: "relative" }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        <video ref={webcamRef} style={{ display: "none" }} playsInline muted />
      </div>

      <div style={panelStyle}>
        <div style={{ color: "#4ecdc4", marginBottom: 8, fontWeight: 700 }}>DEBUG PANEL</div>
        <div style={{ marginBottom: 4 }}>{fps} FPS {mpLoading ? "(loading...)" : ""} {mpError ? `Error: ${mpError}` : ""}</div>

        {/* Word selector */}
        <div style={{ marginTop: 8, marginBottom: 4, color: "#4ecdc4" }}>Reference Word:</div>
        <select
          onChange={e => {
            const w = words.find(w => w.id === e.target.value);
            setSelectedWord(w || null);
            setScoreResult(null);
          }}
          value={selectedWord?.id || ""}
          style={{ width: "100%", padding: 4, background: "#1a1a2e", color: "#fff", border: "1px solid #333", borderRadius: 4, fontFamily: "inherit", fontSize: 12 }}
        >
          <option value="">-- none --</option>
          {words.map(w => <option key={w.id} value={w.id}>{w.label} ({w.source})</option>)}
        </select>
        {refData && <div style={{ color: "#4ecdc4", marginTop: 4 }}>Ref loaded: {refData.frames.length} frames, {refData.duration?.toFixed(1)}s</div>}

        {/* Record + Score */}
        <div style={{ marginTop: 8 }}>
          <button
            onClick={toggleRecording}
            disabled={!refData}
            style={{
              padding: "6px 16px", borderRadius: 6, border: "none", cursor: refData ? "pointer" : "not-allowed",
              background: recording ? "#ff6b6b" : "#4ecdc4", color: "#000", fontWeight: 700, fontFamily: "inherit", fontSize: 12,
            }}
          >
            {recording ? `STOP (${recordedFramesRef.current.length} frames)` : "RECORD"}
          </button>
        </div>

        {/* Score output */}
        {scoreResult && (
          <div style={{ marginTop: 8, padding: 8, background: "rgba(78,205,196,0.1)", borderRadius: 6 }}>
            {scoreResult.error ? (
              <div style={{ color: "#ff6b6b" }}>{scoreResult.error}</div>
            ) : (
              <>
                <div style={{ color: "#4ecdc4", fontWeight: 700, fontSize: 14 }}>Score: {scoreResult.score}</div>
                <div>Avg distance: {scoreResult.avgDistance?.toFixed(3)}</div>
                <div>Live features: {scoreResult.liveFeatureCount}</div>
                <div>Ref features: {scoreResult.refFeatureCount}</div>
                <div>Mirrored: {scoreResult.mirrored ? "yes" : "no"}</div>
                <div>Low motion: {scoreResult.lowMotion ? "YES" : "no"}</div>
                <div style={{ marginTop: 4, color: "#ffe66d" }}>
                  Tier: {scoreResult.score >= 75 ? "Amazing (3 stars)" : scoreResult.score >= 50 ? "Well Done (2 stars)" : scoreResult.score >= 25 ? "Good Try (1 star)" : "Let's Try Again (heart)"}
                </div>
                {scoreResult.feedback?.tips?.map((t, i) => (
                  <div key={i} style={{ marginTop: 2, color: "rgba(255,255,255,0.6)" }}>{t}</div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
