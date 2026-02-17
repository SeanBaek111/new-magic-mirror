/**
 * Skeleton drawing utilities for Magic Mirror.
 *
 * Supports two formats:
 * 1. Live MediaPipe: 33 pose landmarks + 21 hand landmarks (from useMediaPipe hook)
 * 2. Compact reference: 17 pose landmarks + 21 hand landmarks (from extracted JSON)
 *
 * All coordinates are normalized [0,1]. Direct mapping: px = x * canvasW.
 */

// ============================================================
// MediaPipe full 33-point pose connections (for live detection)
// ============================================================
export const MP_POSE_CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],    // left eye
  [0, 4], [4, 5], [5, 6], [6, 8],    // right eye
  [9, 10],                             // mouth
  // Torso
  [11, 12],                            // shoulders
  [11, 23], [12, 24], [23, 24],       // torso
  // Right arm
  [12, 14], [14, 16],
  // Left arm
  [11, 13], [13, 15],
  // Right hand (from pose)
  [16, 18], [16, 20], [16, 22], [18, 20],
  // Left hand (from pose)
  [15, 17], [15, 19], [15, 21], [17, 19],
];

// Only upper body connections (skip legs, focus on signing)
export const MP_UPPER_BODY = [
  [11, 12],          // shoulders
  [12, 14], [14, 16], // right arm
  [11, 13], [13, 15], // left arm
  [11, 23], [12, 24], [23, 24], // torso
  [16, 18], [16, 20], [18, 20], // right hand stub
  [15, 17], [15, 19], [17, 19], // left hand stub
];

// 17-point compact pose connections (for reference data ghost overlay)
export const COMPACT_POSE_CONNECTIONS = [
  [3, 5], [5, 7],     // right arm
  [4, 6], [6, 8],     // left arm
  [3, 4],             // shoulders
  [3, 15], [4, 16],   // torso
  [15, 16],           // hips
  [7, 9], [7, 11], [7, 13],   // right wrist to fingers
  [8, 10], [8, 12], [8, 14],  // left wrist to fingers
];

// Hand connections (21 landmarks, same for both formats)
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

// ============================================================
// Drawing primitives
// ============================================================

function toPixel(x, y, w, h, mirror) {
  return [mirror ? (1 - x) * w : x * w, y * h];
}

function drawLines(ctx, pts, conns, w, h, mirror, color, lw) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [a, b] of conns) {
    if (a >= pts.length || b >= pts.length) continue;
    const [x1, y1] = toPixel(pts[a][0], pts[a][1], w, h, mirror);
    const [x2, y2] = toPixel(pts[b][0], pts[b][1], w, h, mirror);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

function drawDots(ctx, pts, w, h, mirror, color, r, highlightSet) {
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = toPixel(pts[i][0], pts[i][1], w, h, mirror);
    const big = highlightSet?.has(i);
    ctx.beginPath();
    ctx.arc(px, py, big ? r * 1.5 : r, 0, Math.PI * 2);
    ctx.fillStyle = big ? "#fff" : color;
    ctx.fill();
  }
}

// ============================================================
// Public drawing functions
// ============================================================

const FACE_INDICES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const COMPACT_HEAD = new Set([0, 1, 2]);

/**
 * Draw LIVE MediaPipe detection result (33-point pose + 21-point hands).
 */
export function drawLiveSkeleton(ctx, result, w, h, mirror = true, style = {}) {
  const {
    poseColor = "#00ff88",
    handColor = "#ff6b6b",
    leftHandColor = "#6bc5ff",
    poseWidth = 3,
    handWidth = 2.5,
    dotRadius = 5,
  } = style;

  if (result.pose) {
    drawLines(ctx, result.pose, MP_UPPER_BODY, w, h, mirror, poseColor, poseWidth);
    // Draw upper body dots only (skip face mesh, legs)
    const upperIndices = [11, 12, 13, 14, 15, 16, 23, 24];
    for (const i of upperIndices) {
      if (i >= result.pose.length) continue;
      const [px, py] = toPixel(result.pose[i][0], result.pose[i][1], w, h, mirror);
      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = poseColor;
      ctx.fill();
    }
    // Draw nose bigger
    if (result.pose[0]) {
      const [px, py] = toPixel(result.pose[0][0], result.pose[0][1], w, h, mirror);
      ctx.beginPath();
      ctx.arc(px, py, dotRadius * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
  }

  if (result.rightHand) {
    drawLines(ctx, result.rightHand, HAND_CONNECTIONS, w, h, mirror, handColor, handWidth);
    drawDots(ctx, result.rightHand, w, h, mirror, handColor, 3, null);
  }

  if (result.leftHand) {
    drawLines(ctx, result.leftHand, HAND_CONNECTIONS, w, h, mirror, leftHandColor, handWidth);
    drawDots(ctx, result.leftHand, w, h, mirror, leftHandColor, 3, null);
  }
}

/**
 * Draw compact REFERENCE skeleton (17-point pose + 21-point hands).
 * Used for ghost overlay during practice.
 */
export function drawRefSkeleton(ctx, frame, w, h, mirror = false, style = {}) {
  const {
    poseColor = "#4ecdc4",
    handColor = "#ff6b6b",
    poseWidth = 3,
    handWidth = 2,
    dotRadius = 6,
  } = style;

  if (frame.pose) {
    drawLines(ctx, frame.pose, COMPACT_POSE_CONNECTIONS, w, h, mirror, poseColor, poseWidth);
    drawDots(ctx, frame.pose, w, h, mirror, poseColor, dotRadius, COMPACT_HEAD);
  }
  if (frame.rightHand) {
    drawLines(ctx, frame.rightHand, HAND_CONNECTIONS, w, h, mirror, handColor, handWidth);
    drawDots(ctx, frame.rightHand, w, h, mirror, handColor, 3, null);
  }
  if (frame.leftHand) {
    drawLines(ctx, frame.leftHand, HAND_CONNECTIONS, w, h, mirror, "#6bc5ff", handWidth);
    drawDots(ctx, frame.leftHand, w, h, mirror, "#6bc5ff", 3, null);
  }
}
