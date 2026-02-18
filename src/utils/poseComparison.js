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
 * Feature vector per frame (60 dimensions):
 *   - 4 arm segment angles
 *   - 8 normalized upper body positions (x,y) = 16 values
 *   - 4 arm segment velocities (frame-to-frame angle change)
 *   - 15 finger joint angles per hand (when available)
 *   - 6 face features: eyebrow height, eye openness, mouth open/width
 */

// ===========================================================
// Constants
// ===========================================================

// Fixed feature vector length:
//   4 arm angles + 16 positions + 4 velocity
//   + 15 right fingers + 15 left fingers
//   + 6 face features = 60
const FIXED_VECTOR_LENGTH = 60;

// Face mesh landmark indices for feature extraction
// Used to compute eyebrow height, eye openness, mouth openness/width
const FACE_INDICES = {
  leftEyeTop: 159, leftEyeBottom: 145,
  rightEyeTop: 386, rightEyeBottom: 374,
  leftBrow: 70, rightBrow: 300,
  leftEyeCenter: 33, rightEyeCenter: 263,
  upperLip: 13, lowerLip: 14,
  mouthLeft: 61, mouthRight: 291,
  chin: 152, forehead: 10,
};

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
 * Extract 6 face features from 478-point face mesh, normalized by face height.
 * Returns [leftBrowH, rightBrowH, leftEyeOpen, rightEyeOpen, mouthOpen, mouthWidth]
 * or null if face data is unavailable.
 */
function extractFaceFeatures(face) {
  if (!face || face.length < 468) return null;
  const F = FACE_INDICES;
  // Normalize by face height (forehead to chin)
  const faceH = Math.abs(face[F.chin][1] - face[F.forehead][1]);
  if (faceH < 0.001) return null;
  // Eyebrow height relative to eye center
  const leftBrowH = (face[F.leftEyeCenter][1] - face[F.leftBrow][1]) / faceH;
  const rightBrowH = (face[F.rightEyeCenter][1] - face[F.rightBrow][1]) / faceH;
  // Eye openness (vertical gap)
  const leftEyeOpen = (face[F.leftEyeBottom][1] - face[F.leftEyeTop][1]) / faceH;
  const rightEyeOpen = (face[F.rightEyeBottom][1] - face[F.rightEyeTop][1]) / faceH;
  // Mouth openness and width
  const mouthOpen = (face[F.lowerLip][1] - face[F.upperLip][1]) / faceH;
  const mouthWidth = Math.abs(face[F.mouthRight][0] - face[F.mouthLeft][0]) / faceH;
  return [leftBrowH, rightBrowH, leftEyeOpen, rightEyeOpen, mouthOpen, mouthWidth];
}

/**
 * Build feature vector for a single frame.
 *
 * @param {Object} frame - { pose (normalized subset), rightHand, leftHand, face }
 * @param {Object|null} prevFrame - previous frame for velocity
 * @returns {Object} { armAngles, positions, velocity, rightFingers, leftFingers, faceFeatures, vector }
 */
function extractFeatures(normSubset, rightHand, leftHand, prevArmAngles, face) {
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

  // 5. Face features (6 values)
  const faceFeatures = extractFaceFeatures(face);

  // Combined feature vector (FIXED_VECTOR_LENGTH = 60 dimensions)
  // Layout: [4 arm angles, 16 positions, 4 velocity, 15 right fingers, 15 left fingers, 6 face]
  const vector = [...armAngles, ...positions, ...velocity];
  // Pad right finger slots (indices 24-38): use actual angles or zeros
  if (rightFingers) vector.push(...rightFingers);
  else for (let i = 0; i < 15; i++) vector.push(0);
  // Pad left finger slots (indices 39-53): use actual angles or zeros
  if (leftFingers) vector.push(...leftFingers);
  else for (let i = 0; i < 15; i++) vector.push(0);
  // Pad face feature slots (indices 54-59): use actual features or zeros
  if (faceFeatures) vector.push(...faceFeatures);
  else for (let i = 0; i < 6; i++) vector.push(0);

  return { armAngles, positions, velocity, rightFingers, leftFingers, faceFeatures, vector };
}

// ===========================================================
// Similarity metrics
// ===========================================================

// Feature vector component layout and importance weights.
// Only components with actual data contribute to distance,
// preventing zero-padded dimensions from inflating scores.
const COMPONENTS = [
  { start: 0,  end: 4,  weight: 2.5 }, // arm angles
  { start: 4,  end: 20, weight: 2.0 }, // positions
  { start: 20, end: 24, weight: 2.0 }, // velocity
  { start: 24, end: 39, weight: 2.5 }, // right hand fingers
  { start: 39, end: 54, weight: 2.5 }, // left hand fingers
  { start: 54, end: 60, weight: 1.0 }, // face features
];

/**
 * Component-aware weighted distance between two feature vectors.
 * Computes per-component RMS, then weighted average of active components.
 * Components where neither side has data are excluded (no zero-zero inflation).
 */
function featureDistance(vecA, vecB) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const comp of COMPONENTS) {
    let sum = 0;
    let hasData = false;
    for (let i = comp.start; i < comp.end; i++) {
      const a = i < vecA.length ? vecA[i] : 0;
      const b = i < vecB.length ? vecB[i] : 0;
      if (a !== 0 || b !== 0) hasData = true;
      const diff = a - b;
      sum += diff * diff;
    }
    // Skip components where neither side has data
    if (!hasData) continue;
    const dims = comp.end - comp.start;
    weightedSum += comp.weight * Math.sqrt(sum / dims);
    totalWeight += comp.weight;
  }

  if (totalWeight < 0.01) return 0;
  return weightedSum / totalWeight;
}

/**
 * Convert distance to 0-100 score.
 * Gaussian curve with sigma=0.9 for strict falloff:
 *   distance 0   -> 100 (perfect)
 *   distance 0.3 -> ~95 (excellent)
 *   distance 0.5 -> ~86 (great)
 *   distance 0.7 -> ~73 (good)
 *   distance 0.9 -> ~58 (decent)
 *   distance 1.0 -> ~51 (mediocre)
 *   distance 1.3 -> ~34 (needs work)
 *   distance 1.5 -> ~24 (poor)
 *   distance 2.0 -> ~8  (very poor)
 */
function distToScore(dist) {
  const sigma = 0.9;
  const score = 100 * Math.exp(-dist * dist / (2 * sigma * sigma));
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
// Mirroring (left-right swap for dominant hand invariance)
// ===========================================================

/**
 * Mirror live frames for left-handed users.
 * Swaps left/right joints and inverts x-coordinates so that
 * a left-handed signer matches a right-handed reference.
 *
 * Live pose uses 33-point MediaPipe format. We swap:
 *   leftShoulder(11) <-> rightShoulder(12)
 *   leftElbow(13) <-> rightElbow(14)
 *   leftWrist(15) <-> rightWrist(16)
 *   leftHip(23) <-> rightHip(24)
 * Then invert all x-coordinates (x -> 1-x, since coords are 0-1 normalised).
 * Also swap leftHand <-> rightHand.
 */
const MIRROR_SWAP_PAIRS = [
  [11, 12], // shoulders
  [13, 14], // elbows
  [15, 16], // wrists
  [23, 24], // hips
];

function mirrorLiveFrames(frames) {
  return frames.map(frame => {
    let mirroredPose = null;
    if (frame.pose) {
      mirroredPose = frame.pose.map(([x, y]) => [1 - x, y]);
      // Swap left/right joint pairs
      for (const [l, r] of MIRROR_SWAP_PAIRS) {
        if (l < mirroredPose.length && r < mirroredPose.length) {
          const tmp = mirroredPose[l];
          mirroredPose[l] = mirroredPose[r];
          mirroredPose[r] = tmp;
        }
      }
    }
    return {
      pose: mirroredPose,
      rightHand: frame.leftHand ? frame.leftHand.map(([x, y]) => [1 - x, y]) : null,
      leftHand: frame.rightHand ? frame.rightHand.map(([x, y]) => [1 - x, y]) : null,
      face: frame.face, // face features are symmetric ratios, no mirroring needed
    };
  });
}

// ===========================================================
// Motion detection
// ===========================================================

/**
 * Compute total motion from a feature sequence.
 * Sums absolute velocity values (indices 20-23) across all frames.
 * This measures how much the arms actually moved during the sequence.
 */
function computeMotion(featureSeq) {
  let total = 0;
  for (const vec of featureSeq) {
    for (let i = 20; i < 24 && i < vec.length; i++) {
      total += Math.abs(vec[i]);
    }
  }
  return total;
}

/**
 * Apply motion penalty with hard score caps.
 * Standing still must always result in 0 stars (0-30).
 *
 * Star tiers: 0 stars (0-30), 1 star (31-60), 2 stars (61-85), 3 stars (86-100)
 *
 *   ratio < 30%  -> score capped at 15  (0 stars, barely moved)
 *   ratio 30-50% -> score capped at 30  (0 stars, not enough movement)
 *   ratio 50-70% -> score capped at 55  (1 star at best)
 *   ratio >= 70% -> no cap, normal score
 */
function applyMotionPenalty(score, liveMotion, refMotion) {
  if (refMotion < 0.01) return score;
  const ratio = liveMotion / refMotion;
  if (ratio < 0.3) return Math.min(score, 15);
  if (ratio < 0.5) return Math.min(score, 30);
  if (ratio < 0.7) return Math.min(score, 55);
  return score;
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

    const feat = extractFeatures(norm, frame.rightHand, frame.leftHand, prevAngles, frame.face);
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

    const feat = extractFeatures(norm, frame.rightHand, frame.leftHand, prevAngles, frame.face);
    features.push(feat.vector);
    prevAngles = feat.armAngles;
  }

  return features;
}

/**
 * Compare recorded user performance against reference.
 * Tries both original and mirrored orientations, returns the better score.
 * This handles left-handed signers matching right-handed reference videos.
 *
 * @param {Array} liveFrames - recorded [{pose, rightHand, leftHand}, ...]
 * @param {Array} refFrames - reference [{pose, rightHand, leftHand}, ...]
 * @returns {{ score, pathScores, avgDistance, liveFeatureCount, refFeatureCount, mirrored }}
 */
export function compareDTW(liveFrames, refFrames) {
  const refFeats = processRefFrames(refFrames);

  // Try original orientation
  const liveFeats = processLiveFrames(liveFrames);
  // Try mirrored orientation
  const mirroredFeats = processLiveFrames(mirrorLiveFrames(liveFrames));

  console.log(`Features: live=${liveFeats.length}, mirrored=${mirroredFeats.length}, ref=${refFeats.length}`);

  const minLive = Math.max(liveFeats.length, mirroredFeats.length);
  if (minLive < 2 || refFeats.length < 2) {
    return { score: 0, pathScores: [], avgDistance: Infinity,
             liveFeatureCount: liveFeats.length, refFeatureCount: refFeats.length, mirrored: false };
  }

  const resultOriginal = liveFeats.length >= 2 ? dtw(liveFeats, refFeats) : { score: 0 };
  const resultMirrored = mirroredFeats.length >= 2 ? dtw(mirroredFeats, refFeats) : { score: 0 };

  const useMirrored = resultMirrored.score > resultOriginal.score;
  const best = useMirrored ? resultMirrored : resultOriginal;
  const bestLiveFeats = useMirrored ? mirroredFeats : liveFeats;

  // Motion penalty: penalise standing still
  const refMotion = computeMotion(refFeats);
  const liveMotion = computeMotion(bestLiveFeats);
  const motionRatio = refMotion > 0.01 ? liveMotion / refMotion : 1;
  const rawScore = best.score;
  const penalisedScore = applyMotionPenalty(rawScore, liveMotion, refMotion);
  const lowMotion = motionRatio < 0.5;

  console.log(`DTW scores: original=${resultOriginal.score}, mirrored=${resultMirrored.score}, using=${useMirrored ? 'mirrored' : 'original'}`);
  console.log(`Motion: live=${liveMotion.toFixed(2)}, ref=${refMotion.toFixed(2)}, ratio=${motionRatio.toFixed(2)}, raw=${rawScore}, final=${penalisedScore}`);

  return {
    ...best,
    score: penalisedScore,
    liveFeatureCount: liveFeats.length,
    refFeatureCount: refFeats.length,
    mirrored: useMirrored,
    lowMotion,
  };
}

/**
 * Star rating from score.
 * 0 stars: 0-30, 1 star: 31-60, 2 stars: 61-85, 3 stars: 86-100
 */
export function getStarRating(score) {
  if (score >= 70) return 3;
  if (score >= 61) return 2;
  if (score >= 31) return 1;
  return 0;
}

/**
 * Generate encouraging feedback tips based on DTW results.
 * All language is positive and supportive (designed for Endeavour Foundation participants).
 *
 * Tiers: 0 stars (0-30), 1 star (31-60), 2 stars (61-85), 3 stars (86-100)
 */
export function generateFeedback(dtwResult) {
  const tips = [];
  const { score, pathScores, lowMotion } = dtwResult;

  if (dtwResult.liveFeatureCount < 3) {
    return { tips: ["Let's make sure your upper body is nice and visible. Try stepping back a little!"] };
  }

  // If user barely moved, give a gentle nudge to try the movement
  if (lowMotion) {
    tips.push("Try moving your arms along with the video!");
    tips.push("Watch the video again and copy the arm movements.");
    return { tips };
  }

  if (score >= 86) {
    // 3 stars
    tips.push("Amazing! Perfect sign!");
  } else if (score >= 61) {
    // 2 stars
    tips.push("Great signing! Almost perfect!");
    if (pathScores && pathScores.length > 0) {
      const firstThird = pathScores.slice(0, Math.floor(pathScores.length / 3));
      const lastThird = pathScores.slice(-Math.floor(pathScores.length / 3));
      const firstAvg = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
      const lastAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;
      if (firstAvg > lastAvg + 10) {
        tips.push("Try watching the ending part once more.");
      } else if (lastAvg > firstAvg + 10) {
        tips.push("Watch the beginning part once more.");
      }
    }
  } else if (score >= 31) {
    // 1 star
    tips.push("Good try! You're getting closer.");
    tips.push("Try matching the speed and shape a little more.");
  } else {
    // 0 stars
    tips.push("Let's try again! Watch the video and copy the movements.");
  }

  return { tips };
}

/**
 * Fallback simulated score.
 */
export function simulateScore() {
  return Math.round(60 + Math.random() * 35);
}
