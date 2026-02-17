/**
 * MediaPipe integration for real-time pose + hand detection.
 * Uses @mediapipe/tasks-vision PoseLandmarker & HandLandmarker.
 */
import { PoseLandmarker, HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe";
const MODEL_CDN = "https://storage.googleapis.com/mediapipe-models";

let poseLandmarker = null;
let handLandmarker = null;
let initialized = false;

/**
 * Initialize MediaPipe models. Call once on app start.
 */
export async function initMediaPipe(onProgress) {
  if (initialized) return;

  onProgress?.("Loading MediaPipe WASM...");
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

  onProgress?.("Loading pose model...");
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `${MODEL_CDN}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  onProgress?.("Loading hand model...");
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `${MODEL_CDN}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });

  initialized = true;
  onProgress?.("Ready");
}

/**
 * Detect pose + hands from a video frame.
 * Returns { pose, leftHand, rightHand } with normalized [x,y] arrays.
 *
 * @param {HTMLVideoElement} video
 * @param {number} timestamp - performance.now() in ms
 */
export function detect(video, timestamp) {
  const result = { pose: null, leftHand: null, rightHand: null };
  if (!initialized || !video.videoWidth) return result;

  // Pose detection (33 landmarks)
  const poseResult = poseLandmarker.detectForVideo(video, timestamp);
  if (poseResult.landmarks?.length > 0) {
    result.pose = poseResult.landmarks[0].map((p) => [p.x, p.y, p.z]);
  }

  // Hand detection (21 landmarks per hand)
  const handResult = handLandmarker.detectForVideo(video, timestamp);
  if (handResult.landmarks?.length > 0) {
    for (let i = 0; i < handResult.landmarks.length; i++) {
      const hand = handResult.landmarks[i].map((p) => [p.x, p.y, p.z]);
      const label = handResult.handedness[i]?.[0]?.categoryName;
      // MediaPipe labels are from camera's perspective, mirror for user
      if (label === "Right") result.leftHand = hand;
      else result.rightHand = hand;
    }
  }

  return result;
}

export function isReady() {
  return initialized;
}
