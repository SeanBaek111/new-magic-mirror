import { useRef, useState, useCallback, useEffect } from "react";
import { PoseLandmarker, HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/**
 * Hook to initialize and run MediaPipe pose + hand detection.
 *
 * Returns:
 *  - loading: boolean (model still loading)
 *  - error: string | null
 *  - detect(videoEl, timestamp): { pose, hands }
 *  - cleanup(): void
 */
export default function useMediaPipe() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const poseRef = useRef(null);
  const handRef = useRef(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm"
        );

        // Pose landmarker - 33 body landmarks
        poseRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });

        // Hand landmarker - 21 landmarks per hand
        handRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });

        setLoading(false);
      } catch (e) {
        console.error("MediaPipe init failed:", e);
        setError(e.message || "Failed to load MediaPipe models");
        setLoading(false);
      }
    })();
  }, []);

  /**
   * Run detection on a video frame.
   * @param {HTMLVideoElement} video
   * @param {number} timestamp - performance.now() or similar
   * @returns {{ pose: array|null, leftHand: array|null, rightHand: array|null }}
   */
  const detect = useCallback((video, timestamp) => {
    const result = { pose: null, leftHand: null, rightHand: null };

    if (!video || video.readyState < 2) return result;

    try {
      // Pose
      if (poseRef.current) {
        const poseResult = poseRef.current.detectForVideo(video, timestamp);
        if (poseResult.landmarks && poseResult.landmarks.length > 0) {
          // Convert to [x, y] arrays (normalized 0-1)
          result.pose = poseResult.landmarks[0].map((lm) => [lm.x, lm.y, lm.z]);
        }
      }

      // Hands
      if (handRef.current) {
        const handResult = handRef.current.detectForVideo(video, timestamp);
        if (handResult.landmarks) {
          for (let i = 0; i < handResult.landmarks.length; i++) {
            const hand = handResult.landmarks[i].map((lm) => [lm.x, lm.y, lm.z]);
            const label = handResult.handednesses[i]?.[0]?.categoryName;
            // MediaPipe reports handedness from camera's perspective
            // Since webcam is mirrored, "Left" in results = user's right hand
            if (label === "Left") {
              result.rightHand = hand;
            } else {
              result.leftHand = hand;
            }
          }
        }
      }
    } catch (e) {
      // Detection can fail on some frames, just skip
    }

    return result;
  }, []);

  const cleanup = useCallback(() => {
    if (poseRef.current) { poseRef.current.close(); poseRef.current = null; }
    if (handRef.current) { handRef.current.close(); handRef.current = null; }
  }, []);

  return { loading, error, detect, cleanup };
}
