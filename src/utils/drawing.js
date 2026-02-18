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
// Face mesh connections (478-point, key regions only)
// ============================================================

// Lips outer contour
const FACE_LIPS_OUTER = [
  [61,146],[146,91],[91,181],[181,84],[84,17],[17,314],[314,405],[405,321],[321,375],[375,291],[291,61],
];
// Lips inner contour
const FACE_LIPS_INNER = [
  [78,95],[95,88],[88,178],[178,87],[87,14],[14,317],[317,402],[402,318],[318,324],[324,308],[308,78],
];
// Left eye
const FACE_LEFT_EYE = [
  [33,7],[7,163],[163,144],[144,145],[145,153],[153,154],[154,155],[155,133],[133,173],[173,157],[157,158],[158,159],[159,160],[160,161],[161,246],[246,33],
];
// Right eye
const FACE_RIGHT_EYE = [
  [362,382],[382,381],[381,380],[380,374],[374,373],[373,390],[390,249],[249,263],[263,466],[466,388],[388,387],[387,386],[386,385],[385,384],[384,398],[398,362],
];
// Left eyebrow
const FACE_LEFT_EYEBROW = [
  [46,53],[53,52],[52,65],[65,55],[55,107],[107,66],[66,105],[105,63],[63,70],
];
// Right eyebrow
const FACE_RIGHT_EYEBROW = [
  [276,283],[283,282],[282,295],[295,285],[285,336],[336,296],[296,334],[334,293],[293,300],
];
// Face oval
const FACE_OVAL = [
  [10,338],[338,297],[297,332],[332,284],[284,251],[251,389],[389,356],[356,454],[454,323],[323,361],[361,288],[288,397],[397,365],[365,379],[379,378],[378,400],[400,377],[377,152],[152,148],[148,176],[176,149],[149,150],[150,136],[136,172],[172,58],[58,132],[132,93],[93,234],[234,127],[127,162],[162,21],[21,54],[54,103],[103,67],[67,109],[109,10],
];

export const FACE_MESH_CONNECTIONS = [
  ...FACE_LIPS_OUTER, ...FACE_LIPS_INNER,
  ...FACE_LEFT_EYE, ...FACE_RIGHT_EYE,
  ...FACE_LEFT_EYEBROW, ...FACE_RIGHT_EYEBROW,
  ...FACE_OVAL,
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
    faceColor = "#c4a0f5",
    poseWidth = 3,
    handWidth = 2.5,
    faceWidth = 1.2,
    dotRadius = 5,
  } = style;

  // Face mesh (draw first so body overlays on top)
  if (result.face && result.face.length >= 468) {
    drawLines(ctx, result.face, FACE_MESH_CONNECTIONS, w, h, mirror, faceColor, faceWidth);
  }

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
