/**
 * Pose comparison engine for Auslan sign language learning.
 *
 * Based on established SLR (Sign Language Recognition) methodology:
 *   - Coordinate normalization (body-proportion invariant)
 *   - Joint angle features (view-invariant)
 *   - Velocity features (captures movement dynamics)
 *   - Finger joint angles (handshape recognition)
 *   - DTW for temporal alignment
 *
 * References:
 *   - Sign Language Recognition using MediaPipe and DTW
 *   - Skeleton-based Action Recognition
 *   - Procrustes-style geometric normalization
 *
 * Feature vector per frame:
 *   - 4 arm segment angles
 *   - 8 normalized upper body positions (x,y) = 16 values
 *   - 4 arm segment velocities (frame-to-frame angle change)
 *   - 15 finger joint angles per hand (when available)
 */

// ===========================================================
// Constants
// ===========================================================

// Hand finger joint angles: 3 angles per finger × 5 fingers = 15
// Each entry: [joint_a, joint_b, joint_c] → angle at joint_b
const FINGER_ANGLE_TRIPLETS = [
  // Thumb
  [0, 1, 2], [1, 2, 3], [2, 3, 4],
  // Index
  [0, 5, 6], [5, 6, 7], [6, 7, 8],
  // Middle
  [0, 9, 10], [9, 10, 11], [10, 11, 12],
  // Ring
  [0, 13, 14], [13, 14, 15], [14, 15, 16],
  // Pinky
  [0, 17, 18], [17, 18, 19], [18, 19, 20],
];

// Upper body joints to extract (live 33-point → subset)
const LIVE_UPPER = [11, 12, 13, 14, 15, 16, 23, 24];
// Equivalent in compact 17-point ref
const REF_UPPER = [4, 3, 6, 5, 8, 7, 16, 15];

// Arm segment pairs (in subset indices after extraction)
// subset: [lShoulder=0, rShoulder=1, lElbow=2, rElbow=3, lWrist=4, rWrist=5, lHip=6, rHip=7]
const ARM_SEGMENTS = [
  [1, 3], // right shoulder → elbow
  [3, 5], // right elbow → wrist
  [0, 2], // left shoulder → elbow
  [2, 4], // left elbow → wrist
];

// ===========================================================
// Normalization
// ===========================================================

/**
 * Normalize body joints: translate to shoulder center, scale by body size.
 * Subset indices: shoulders=[0,1], hips=[6,7]
 */
function normalizeSubset(points) {
  if (!points || points.length < 8) return null;

  const cx = (points[0][0] + points[1][0]) / 2;
  const cy = (points[0][1] + points[1][1]) / 2;

  const shoulderW = Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]);
  const hipCx = (points[6][0] + points[7][0]) / 2;
  const hipCy = (points[6][1] + points[7][1]) / 2;
  const torsoH = Math.hypot(cx - hipCx, cy - hipCy);
  const scale = (shoulderW + torsoH) / 2;

  if (scale < 0.01) return null;

  return points.map(([x, y]) => [(x - cx) / scale, (y - cy) / scale]);
}

// ===========================================================
// Feature extraction
// ===========================================================

/**
 * Compute angle at point B in triangle A-B-C (in radians, 0 to π).
 */
function angleBetween(a, b, c) {
  const ba = [a[0] - b[0], a[1] - b[1]];
  const bc = [c[0] - b[0], c[1] - b[1]];
  const dot = ba[0] * bc[0] + ba[1] * bc[1];
  const magBA = Math.hypot(ba[0], ba[1]);
  const magBC = Math.hypot(bc[0], bc[1]);
  if (magBA < 1e-6 || magBC < 1e-6) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC))));
}

/**
 * Compute segment direction angle (atan2).
 */
function segAngle(points, a, b) {
  return Math.atan2(points[b][1] - points[a][1], points[b][0] - points[a][0]);
}

/**
 * Extract 15 finger joint angles from a 21-point hand.
 * Returns array of 15 angles (radians), or null.
 */
function extractFingerAngles(hand) {
  if (!hand || hand.length < 21) return null;
  return FINGER_ANGLE_TRIPLETS.map(([a, b, c]) => angleBetween(hand[a], hand[b], hand[c]));
}

/**
 * Build feature vector for a single frame.
 *
 * @param {Object} frame - { pose (normalized subset), rightHand, leftHand }
 * @param {Object|null} prevFrame - previous frame for velocity
 * @returns {Object} { armAngles, positions, velocity, rightFingers, leftFingers, vector }
 */
function extractFeatures(normSubset, rightHand, leftHand, prevArmAngles) {
  // 1. Arm segment angles (4 values)
  const armAngles = ARM_SEGMENTS.map(([a, b]) => segAngle(normSubset, a, b));

  // 2. Flattened normalized positions (16 values)
  const positions = normSubset.flatMap(([x, y]) => [x, y]);

  // 3. Velocity: angle change from previous frame (4 values)
  const velocity = prevArmAngles
    ? armAngles.map((ang, i) => {
        let diff = ang - prevArmAngles[i];
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        return diff;
      })
    : [0, 0, 0, 0];

  // 4. Finger angles (15 per hand)
  const rightFingers = extractFingerAngles(rightHand);
  const leftFingers = extractFingerAngles(leftHand);

  // Combined feature vector
  const vector = [...armAngles, ...positions, ...velocity];
  if (rightFingers) vector.push(...rightFingers);
  if (leftFingers) vector.push(...leftFingers);

  return { armAngles, positions, velocity, rightFingers, leftFingers, vector };
}

// ===========================================================
// Similarity metrics
// ===========================================================

/**
 * Weighted Euclidean distance between two feature vectors.
 * Different feature types have different scales, so we weight them.
 */
function featureDistance(vecA, vecB) {
  const minLen = Math.min(vecA.length, vecB.length);
  if (minLen === 0) return 100;

  let sum = 0;
  for (let i = 0; i < minLen; i++) {
    let weight = 1;
    if (i < 4) weight = 3;          // arm angles: most important
    else if (i < 20) weight = 1;    // positions
    else if (i < 24) weight = 2;    // velocity
    else weight = 1.5;              // finger angles

    const diff = vecA[i] - vecB[i];
    sum += weight * diff * diff;
  }

  return Math.sqrt(sum / minLen);
}

/**
 * Convert distance to 0-100 score.
 * Calibrated so that:
 *   distance 0 → 100 (perfect)
 *   distance ~1.5 → ~50 (mediocre)
 *   distance ~3+ → ~0 (bad)
 */
function distToScore(dist) {
  // Sigmoid-ish mapping
  const score = 100 * Math.exp(-dist * dist / 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ===========================================================
// DTW (Dynamic Time Warping)
// ===========================================================

/**
 * Run DTW on two feature sequences.
 *
 * @param {Array} seqA - [featureVec, featureVec, ...]
 * @param {Array} seqB - [featureVec, featureVec, ...]
 * @returns {{ score: number, pathScores: number[], avgDistance: number }}
 */
function dtw(seqA, seqB) {
  const n = seqA.length;
  const m = seqB.length;
  if (n === 0 || m === 0) return { score: 0, pathScores: [], avgDistance: Infinity };

  // Distance matrix
  const distMatrix = [];
  for (let i = 0; i < n; i++) {
    distMatrix[i] = [];
    for (let j = 0; j < m; j++) {
      distMatrix[i][j] = featureDistance(seqA[i], seqB[j]);
    }
  }

  // Cumulative cost matrix
  const cost = Array.from({ length: n }, () => new Float32Array(m));
  cost[0][0] = distMatrix[0][0];
  for (let j = 1; j < m; j++) cost[0][j] = cost[0][j - 1] + distMatrix[0][j];
  for (let i = 1; i < n; i++) cost[i][0] = cost[i - 1][0] + distMatrix[i][0];
  for (let i = 1; i < n; i++) {
    for (let j = 1; j < m; j++) {
      cost[i][j] = distMatrix[i][j] + Math.min(cost[i - 1][j], cost[i][j - 1], cost[i - 1][j - 1]);
    }
  }

  // Backtrace
  const path = [];
  let i = n - 1, j = m - 1;
  path.push([i, j]);
  while (i > 0 || j > 0) {
    if (i === 0) j--;
    else if (j === 0) i--;
    else {
      const d = cost[i - 1][j - 1], u = cost[i - 1][j], l = cost[i][j - 1];
      if (d <= u && d <= l) { i--; j--; }
      else if (u <= l) i--;
      else j--;
    }
    path.push([i, j]);
  }
  path.reverse();

  // Scores along path
  const pathDists = path.map(([pi, pj]) => distMatrix[pi][pj]);
  const avgDist = pathDists.reduce((a, b) => a + b, 0) / pathDists.length;
  const pathScores = pathDists.map(d => distToScore(d));
  const avgScore = pathScores.reduce((a, b) => a + b, 0) / pathScores.length;

  return { score: Math.round(avgScore), pathScores, avgDistance: avgDist };
}

// ===========================================================
// Public API
// ===========================================================

/**
 * Process recorded live frames into feature sequences.
 */
function processLiveFrames(frames) {
  const features = [];
  let prevAngles = null;

  for (const frame of frames) {
    if (!frame.pose || frame.pose.length < 25) continue;

    const subset = LIVE_UPPER.map(i => [frame.pose[i][0], frame.pose[i][1]]);
    const norm = normalizeSubset(subset);
    if (!norm) continue;

    const feat = extractFeatures(norm, frame.rightHand, frame.leftHand, prevAngles);
    features.push(feat.vector);
    prevAngles = feat.armAngles;
  }

  return features;
}

/**
 * Process reference frames into feature sequences.
 */
function processRefFrames(frames) {
  const features = [];
  let prevAngles = null;

  for (const frame of frames) {
    if (!frame.pose || frame.pose.length < 17) continue;

    const subset = REF_UPPER.map(i => [frame.pose[i][0], frame.pose[i][1]]);
    const norm = normalizeSubset(subset);
    if (!norm) continue;

    const feat = extractFeatures(norm, frame.rightHand, frame.leftHand, prevAngles);
    features.push(feat.vector);
    prevAngles = feat.armAngles;
  }

  return features;
}

/**
 * Compare recorded user performance against reference.
 *
 * @param {Array} liveFrames - recorded [{pose, rightHand, leftHand}, ...]
 * @param {Array} refFrames - reference [{pose, rightHand, leftHand}, ...]
 * @returns {{ score, pathScores, avgDistance, liveFeatureCount, refFeatureCount }}
 */
export function compareDTW(liveFrames, refFrames) {
  const liveFeats = processLiveFrames(liveFrames);
  const refFeats = processRefFrames(refFrames);

  console.log(`Features: live=${liveFeats.length}, ref=${refFeats.length}`);

  if (liveFeats.length < 2 || refFeats.length < 2) {
    return { score: 0, pathScores: [], avgDistance: Infinity,
             liveFeatureCount: liveFeats.length, refFeatureCount: refFeats.length };
  }

  const result = dtw(liveFeats, refFeats);
  return {
    ...result,
    liveFeatureCount: liveFeats.length,
    refFeatureCount: refFeats.length,
  };
}

/**
 * Generate feedback tips based on DTW results.
 */
export function generateFeedback(dtwResult) {
  const tips = [];
  const { score, pathScores } = dtwResult;

  if (dtwResult.liveFeatureCount < 3) {
    return { tips: ["Could not track your pose clearly. Make sure your upper body is visible and well-lit."] };
  }

  if (score >= 80) {
    tips.push("Great signing! The movement closely matches the reference.");
  } else if (score >= 60) {
    // Find which parts were weakest
    if (pathScores.length > 0) {
      const firstThird = pathScores.slice(0, Math.floor(pathScores.length / 3));
      const lastThird = pathScores.slice(-Math.floor(pathScores.length / 3));
      const firstAvg = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
      const lastAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;

      if (firstAvg < lastAvg - 10) {
        tips.push("The start of your sign needs more practice.");
      } else if (lastAvg < firstAvg - 10) {
        tips.push("Focus on finishing the sign clearly.");
      }
    }
    tips.push("Try to match the arm positions and speed more closely.");
  } else {
    tips.push("Watch the demonstration again and focus on the arm movements.");
    tips.push("Make sure you're signing at a similar speed to the video.");
  }

  return { tips };
}

/**
 * Fallback simulated score.
 */
export function simulateScore() {
  return Math.round(60 + Math.random() * 35);
}
