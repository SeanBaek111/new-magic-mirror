import { useRef, useState, useCallback, useEffect } from "react";
import { PoseLandmarker, HandLandmarker, FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/**
 * Hook to initialize and run MediaPipe pose + hand + face detection.
 *
 * Returns:
 *  - loading: boolean (model still loading)
 *  - error: string | null
 *  - detect(videoEl, timestamp): { pose, leftHand, rightHand, face }
 *  - cleanup(): void
 */
export default function useMediaPipe() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const poseRef = useRef(null);
  const handRef = useRef(null);
  const faceRef = useRef(null);
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

        // Face landmarker - 478 face mesh landmarks
        faceRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
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
    const result = { pose: null, leftHand: null, rightHand: null, face: null };

    if (!video || video.readyState < 2) return result;

    try {
      // Pose
      if (poseRef.current) {
        const poseResult = poseRef.current.detectForVideo(video, timestamp);
        if (poseResult.landmarks && poseResult.landmarks.length > 0) {
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

      // Face mesh (478 landmarks)
      if (faceRef.current) {
        const faceResult = faceRef.current.detectForVideo(video, timestamp);
        if (faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
          result.face = faceResult.faceLandmarks[0].map((lm) => [lm.x, lm.y]);
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
    if (faceRef.current) { faceRef.current.close(); faceRef.current = null; }
  }, []);

  return { loading, error, detect, cleanup };
}
