import { useState, useEffect, useRef, useCallback } from "react";
import { drawLiveSkeleton } from "../utils/drawing";
import { compareDTW, generateFeedback, getStarRating } from "../utils/poseComparison";
import useMediaPipe from "../hooks/useMediaPipe";
import "./MagicMirror.css";

const PHASE = {
  SELECT: "select",
  WATCH: "watch",
  COUNTDOWN: "countdown",
  PRACTICE: "practice",
  SCORING: "scoring",
  FEEDBACK: "feedback",
};

export default function MagicMirror({ word, onBack }) {
  const [phase, setPhase] = useState(PHASE.SELECT);
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [practiceTime, setPracticeTime] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [prevBestScore, setPrevBestScore] = useState(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [refData, setRefData] = useState(null);
  const [fps, setFps] = useState(0);
  const [detectedPose, setDetectedPose] = useState(false);

  const canvasRef = useRef(null);
  const webcamRef = useRef(null);
  const demoVideoRef = useRef(null);
  const streamRef = useRef(null);
  const animRef = useRef(null);
  const practiceStartRef = useRef(null);
  const frameRef = useRef(null);
  const fpsRef = useRef({ count: 0, last: performance.now() });

  // Recorded frames during practice
  const recordedFramesRef = useRef([]);

  const { loading: mpLoading, error: mpError, detect, cleanup: mpCleanup } = useMediaPipe();

  // Load reference data
  useEffect(() => {
    if (word.refData) {
      // Custom word: refData passed directly from IndexedDB
      setRefData(word.refData);
    } else if (word.refDataPath) {
      // Built-in word: fetch from static file
      fetch(word.refDataPath)
        .then((r) => r.json())
        .then(setRefData)
        .catch((e) => console.error("Failed to load ref data:", e));
    }
  }, [word.refData, word.refDataPath]);

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
  const startWebcam = useCallback(async () => {
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
  }, []);

  const stopWebcam = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setWebcamReady(false);
  }, []);

  useEffect(() => () => {
    stopWebcam();
    mpCleanup();
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, [stopWebcam, mpCleanup]);

  // === WATCH ===
  useEffect(() => {
    if (phase !== PHASE.WATCH) return;
    setVideoProgress(0);
    const vid = demoVideoRef.current;
    if (!vid) return;
    vid.currentTime = 0;
    vid.play().catch(() => {});
    const onTime = () => vid.duration && setVideoProgress(vid.currentTime / vid.duration);
    const onEnd = () => { setVideoProgress(1); setTimeout(() => setPhase(PHASE.COUNTDOWN), 600); };
    vid.addEventListener("timeupdate", onTime);
    vid.addEventListener("ended", onEnd);
    return () => { vid.pause(); vid.removeEventListener("timeupdate", onTime); vid.removeEventListener("ended", onEnd); };
  }, [phase]);

  // === COUNTDOWN ===
  useEffect(() => {
    if (phase !== PHASE.COUNTDOWN) return;
    setCountdown(3);
    startWebcam();
    resizeCanvas();
    recordedFramesRef.current = [];
    setDetectedPose(false);
    const iv = setInterval(() => {
      setCountdown((p) => {
        if (p <= 1) { clearInterval(iv); setPhase(PHASE.PRACTICE); return 0; }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, startWebcam, resizeCanvas]);

  // === PRACTICE ===
  useEffect(() => {
    if (phase !== PHASE.PRACTICE || !refData) return;
    practiceStartRef.current = Date.now();
    const dur = refData.duration * 1000 + 800;

    const timer = setInterval(() => {
      setPracticeTime(Math.min((Date.now() - practiceStartRef.current) / dur, 1));
    }, 50);

    const timeout = setTimeout(() => {
      clearInterval(timer);
      setPhase(PHASE.SCORING);
    }, dur);

    return () => { clearInterval(timer); clearTimeout(timeout); };
  }, [phase, refData]);

  // === SCORING (runs DTW comparison) ===
  useEffect(() => {
    if (phase !== PHASE.SCORING || !refData) return;

    const recorded = recordedFramesRef.current;
    console.log(`Scoring: ${recorded.length} recorded frames vs ${refData.frames.length} reference frames`);

    if (recorded.length < 3) {
      setScore(0);
      setFeedback({ tips: ["Could not detect your pose. Make sure your upper body is visible."] });
      setAttempts((p) => p + 1);
      setPhase(PHASE.FEEDBACK);
      return;
    }

    // Run DTW comparison
    const dtwResult = compareDTW(recorded, refData.frames);
    const fb = generateFeedback(dtwResult);

    console.log("DTW result:", dtwResult);

    setScore(dtwResult.score);
    setFeedback(fb);
    setAttempts((p) => p + 1);
    setPrevBestScore(bestScore);
    setBestScore((p) => Math.max(p, dtwResult.score));
    setPhase(PHASE.FEEDBACK);
  }, [phase, refData]);

  // === Canvas rendering ===
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (phase !== PHASE.PRACTICE && phase !== PHASE.COUNTDOWN) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0c0c14";
      ctx.fillRect(0, 0, w, h);

      // Compute webcam viewport (maintain original aspect ratio)
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

      // Mirrored webcam
      if (webcamReady && webcamRef.current) {
        ctx.save();
        if (phase === PHASE.COUNTDOWN) ctx.globalAlpha = 0.3;
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(webcamRef.current, dx, dy, dw, dh);
        ctx.restore();
      }

      // MediaPipe detection
      if (webcamReady && webcamRef.current && !mpLoading) {
        const result = detect(webcamRef.current, performance.now());

        if (result.pose || result.rightHand || result.leftHand) {
          setDetectedPose(true);

          // Draw skeleton in the same viewport as the webcam
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

          // Record frame during practice (subsample to ~10fps)
          if (phase === PHASE.PRACTICE) {
            const now = Date.now();
            const lastRecorded = recordedFramesRef.current.length > 0
              ? recordedFramesRef.current[recordedFramesRef.current.length - 1]._t
              : 0;
            if (now - lastRecorded >= 100) {
              recordedFramesRef.current.push({
                pose: result.pose?.map(p => [p[0], p[1]]),
                rightHand: result.rightHand?.map(p => [p[0], p[1]]),
                leftHand: result.leftHand?.map(p => [p[0], p[1]]),
                face: result.face,
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
  }, [phase, webcamReady, practiceTime, refData, mpLoading, detect]);

  // Actions
  const startWatch = () => setPhase(PHASE.WATCH);
  const retry = () => {
    setScore(null);
    setFeedback(null);
    setPracticeTime(0);
    recordedFramesRef.current = [];
    setPhase(PHASE.WATCH);
  };
  const backToMenu = () => {
    stopWebcam();
    setScore(null);
    setFeedback(null);
    setPracticeTime(0);
    recordedFramesRef.current = [];
    if (onBack) {
      onBack();
    } else {
      setPhase(PHASE.SELECT);
    }
  };

  // Tier-based feedback (no numeric score shown to users)
  // 0 stars: 0-30, 1 star: 31-60, 2 stars: 61-85, 3 stars: 86-100
  const getTier = (s) => {
    const stars = getStarRating(s);
    if (stars === 3) return { emoji: "\u{1F31F}", label: "Amazing!", stars: 3, color: "#4ecdc4" };
    if (stars === 2) return { emoji: "\u{1F44F}", label: "Great Job!", stars: 2, color: "#ffe66d" };
    if (stars === 1) return { emoji: "\u{1F4AA}", label: "Good Try!", stars: 1, color: "#f0a86e" };
    return { emoji: "\u{1F917}", label: "Let's Try Again!", stars: 0, color: "#e8a0bf" };
  };

  const getTierMessages = (s) => {
    const stars = getStarRating(s);
    if (stars === 3) return ["Perfect sign!", "You nailed it!", "Brilliant work!"];
    if (stars === 2) return ["Almost perfect!", "Great signing!", "So close to perfect!"];
    if (stars === 1) return ["You're getting closer!", "Good start, keep going!", "You're learning!"];
    return ["Let's watch the video once more!", "Every try helps you learn!", "You can do it!"];
  };

  const getGrowthMessage = (currentScore) => {
    if (attempts === 0) return "Great first try!";
    if (prevBestScore === null || prevBestScore === 0) return null;
    const improvement = currentScore - prevBestScore;
    if (improvement >= 10) return "You're improving! \u{1F389}";
    if (improvement >= 5) return "Even better than last time! \u2B06\uFE0F";
    return null;
  };

  const showCanvas = phase === PHASE.PRACTICE || phase === PHASE.COUNTDOWN;
  const showVideo = phase === PHASE.WATCH;

  return (
    <div className="mirror-root">
      <div className={`ambient ${phase === PHASE.PRACTICE ? "active" : "idle"}`} />
      <div className="content">
        <div className="mirror-header">
          <div className="subtitle">SIGN LANGUAGE LEARNING TOOL</div>
          <h1>MAGIC MIRROR</h1>
        </div>

        <div className="mirror-frame" ref={frameRef}>
          <video ref={demoVideoRef} src={word.videoPath} playsInline muted preload="auto"
            className={`demo-video ${showVideo ? "" : "hidden"}`} />
          <canvas ref={canvasRef} className={showCanvas ? "" : "hidden"} />
          <video ref={webcamRef} className="hidden" playsInline muted />

          {/* SELECT */}
          {phase === PHASE.SELECT && (
            <div className="overlay select">
              <div className="emoji">🤟</div>
              <div className="label">LEARN TO SIGN</div>
              <div className="word-title">"{word.label}"</div>
              <div className="hint">Watch the demonstration, then try it yourself</div>
              {mpLoading && <div className="loading-badge">Loading MediaPipe models...</div>}
              {mpError && <div className="error-badge">⚠ {mpError}</div>}
              {!mpLoading && !mpError && (
                <button className="btn-primary" onClick={startWatch}>START</button>
              )}
              {attempts > 0 && <div className="stats">Attempts: {attempts}</div>}
            </div>
          )}

          {/* WATCH */}
          {phase === PHASE.WATCH && (
            <>
              <div className="phase-badge watch">👀 WATCH CAREFULLY</div>
              <div className="progress-bar teal"><div className="fill" style={{ width: `${videoProgress * 100}%` }} /></div>
            </>
          )}

          {/* COUNTDOWN */}
          {phase === PHASE.COUNTDOWN && (
            <div className="overlay countdown">
              <div className="countdown-label">GET READY</div>
              <div className="countdown-number">{countdown}</div>
            </div>
          )}

          {/* PRACTICE */}
          {phase === PHASE.PRACTICE && (
            <>
              <div className="phase-badge practice">● RECORDING</div>
              <div className="progress-bar red"><div className="fill" style={{ width: `${practiceTime * 100}%` }} /></div>
              <div className="fps-badge">{fps} FPS · {recordedFramesRef.current.length} frames</div>
              {!detectedPose && (
                <div className="ghost-hint">Stand back so your upper body is visible</div>
              )}
            </>
          )}

          {/* SCORING */}
          {phase === PHASE.SCORING && (
            <div className="overlay scoring">
              <div className="loading-badge">Calculating score...</div>
            </div>
          )}

          {/* FEEDBACK */}
          {phase === PHASE.FEEDBACK && score !== null && (() => {
            const tier = getTier(score);
            const messages = getTierMessages(score);
            const tierMsg = messages[Math.floor(Math.random() * messages.length)];
            const growthMsg = getGrowthMessage(score);
            return (
              <div className="overlay feedback">
                <div className="feedback-emoji">{tier.emoji}</div>
                <div className="stars" style={{ color: tier.color }}>
                  {tier.stars > 0
                    ? "\u2605".repeat(tier.stars) + "\u2606".repeat(3 - tier.stars)
                    : "\u2764\uFE0F"}
                </div>
                <div className="tier-label" style={{ color: tier.color }}>{tier.label}</div>
                <div className="tier-message">{tierMsg}</div>
                {growthMsg && (
                  <div className="growth-badge">{growthMsg}</div>
                )}
                {feedback && feedback.tips.length > 0 && (
                  <div className="feedback-tips">
                    {feedback.tips.map((tip, i) => (
                      <div key={i} className="tip">{tip}</div>
                    ))}
                  </div>
                )}
                <div className="score-stats">Attempt #{attempts}</div>
                <div className="button-row">
                  <button className="btn-accent" onClick={retry}>TRY AGAIN</button>
                  <button className="btn-secondary" onClick={backToMenu}>MENU</button>
                </div>
              </div>
            );
          })()}
        </div>

        <div className="mirror-footer">PROTOTYPE · INCLUSIVE TECHNOLOGIES GROUP · QUT</div>
      </div>
    </div>
  );
}
