/**
 * Video processor: extract MediaPipe landmarks from a video file.
 *
 * Produces reference data in the same compact 17-point format used by
 * the scoring engine (poseComparison.js), matching public/data/*.json.
 *
 * Usage:
 *   const refData = await processVideo(videoFile, onProgress);
 *   // refData = { word, fps, duration, poseIndices, frames: [...] }
 */

import {
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

// 33-point MediaPipe pose → 17 compact indices
// Order: nose, leftEyeOuter, rightEyeOuter, rightShoulder, leftShoulder,
//        rightElbow, leftElbow, rightWrist, leftWrist,
//        rightPinky, leftPinky, rightIndex, leftIndex,
//        rightThumb, leftThumb, rightHip, leftHip
const POSE_INDICES = [0, 2, 5, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

const TARGET_FPS = 10; // subsample to ~10 fps for ref data

/**
 * Process a video file and extract reference landmark data.
 *
 * @param {File|Blob} videoFile - MP4 video file
 * @param {function} onProgress - callback(message, percent)
 * @returns {Promise<Object>} reference data object
 */
export async function processVideo(videoFile, onProgress) {
  onProgress?.("Initialising MediaPipe...", 0);

  // 1. Init MediaPipe (separate instances for processing)
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm"
  );

  const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });

  onProgress?.("Loading video...", 10);

  // 2. Load video into a hidden element
  const videoUrl = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error("Failed to load video"));
    video.load();
  });

  const duration = video.duration;
  const frameInterval = 1 / TARGET_FPS;
  const totalFrames = Math.floor(duration * TARGET_FPS);

  onProgress?.(`Processing ${totalFrames} frames...`, 15);

  // 3. Seek through video frame by frame and extract landmarks
  const frames = [];
  let timestamp = 1; // MediaPipe needs incrementing timestamps

  for (let i = 0; i < totalFrames; i++) {
    const seekTime = i * frameInterval;

    // Seek to frame
    await new Promise((resolve) => {
      video.onseeked = resolve;
      video.currentTime = seekTime;
    });

    // Small delay to ensure frame is rendered
    await new Promise((r) => setTimeout(r, 30));

    if (video.readyState < 2) continue;

    try {
      // Detect pose
      const poseResult = poseLandmarker.detectForVideo(video, timestamp);
      timestamp += frameInterval * 1000;

      let pose = null;
      let rightHand = null;
      let leftHand = null;

      if (poseResult.landmarks && poseResult.landmarks.length > 0) {
        // Extract compact 17-point subset
        const full = poseResult.landmarks[0];
        pose = POSE_INDICES.map((idx) => [
          Math.round(full[idx].x * 10000) / 10000,
          Math.round(full[idx].y * 10000) / 10000,
        ]);
      }

      // Detect hands
      const handResult = handLandmarker.detectForVideo(video, timestamp);
      timestamp += 1; // bump to avoid duplicate timestamp

      if (handResult.landmarks) {
        for (let h = 0; h < handResult.landmarks.length; h++) {
          const hand = handResult.landmarks[h].map((lm) => [
            Math.round(lm.x * 10000) / 10000,
            Math.round(lm.y * 10000) / 10000,
          ]);
          const label = handResult.handednesses[h]?.[0]?.categoryName;
          // Video is NOT mirrored (unlike webcam), so labels are direct
          if (label === "Right") {
            rightHand = hand;
          } else {
            leftHand = hand;
          }
        }
      }

      const frame = { t: Math.round(seekTime * 1000) / 1000 };
      if (pose) frame.pose = pose;
      if (rightHand) frame.rightHand = rightHand;
      if (leftHand) frame.leftHand = leftHand;

      // Only add frames with at least pose data
      if (pose) {
        frames.push(frame);
      }
    } catch (e) {
      console.warn(`Frame ${i} detection failed:`, e);
    }

    const pct = 15 + Math.round((i / totalFrames) * 80);
    onProgress?.(`Frame ${i + 1}/${totalFrames}`, pct);
  }

  // 4. Cleanup
  poseLandmarker.close();
  handLandmarker.close();
  URL.revokeObjectURL(videoUrl);

  onProgress?.("Done!", 100);

  const actualFps = frames.length / duration;

  return {
    word: "",
    videoPath: "",
    fps: Math.round(actualFps * 10) / 10,
    duration: Math.round(duration * 100) / 100,
    poseIndices: POSE_INDICES,
    frames,
  };
}
