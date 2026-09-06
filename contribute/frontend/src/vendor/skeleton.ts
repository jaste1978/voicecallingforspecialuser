// GENERATED — do not edit. Source of truth: frontend/src/lib/sign/skeleton.ts
// Refresh with: node contribute/scripts/sync-sign-core.mjs
// Bones and draw groups for the 2D line figure.

import { B, F } from './poseFormat'
import type { BodyPointName, FacePointName } from './poseFormat'

export type Bone = [number, number]

const b = (a: BodyPointName, c: BodyPointName): Bone => [B[a], B[c]]

/** Arms — the loudest strokes in the figure, drawn thickest. */
export const ARM_BONES: Bone[] = [
  b('shoulderL', 'elbowL'), b('elbowL', 'wristL'),
  b('shoulderR', 'elbowR'), b('elbowR', 'wristR'),
]

/** Torso outline, drawn as one rounded path shoulderL → hipL → hipR → shoulderR. */
export const TORSO_PATH: number[] = [
  B.shoulderL, B.hipL, B.hipR, B.shoulderR,
]

export const SHOULDER_BONE: Bone = b('shoulderL', 'shoulderR')

/**
 * MediaPipe hand topology: palm arch plus five finger chains. Drawn in the
 * accent colour — handshape carries most of a sign's meaning, so it should
 * be the first thing the eye lands on.
 */
export const HAND_BONES: Bone[] = [
  // palm arch across the knuckles
  [0, 1], [1, 5], [5, 9], [9, 13], [13, 17], [17, 0],
  // thumb
  [1, 2], [2, 3], [3, 4],
  // index
  [5, 6], [6, 7], [7, 8],
  // middle
  [9, 10], [10, 11], [11, 12],
  // ring
  [13, 14], [14, 15], [15, 16],
  // pinky
  [17, 18], [18, 19], [19, 20],
]

/** Fingertips get a dot — they are what a reader tracks. */
export const FINGERTIPS = [4, 8, 12, 16, 20]

const f = (...names: FacePointName[]) => names.map((n) => F[n])

/** Landmark-mode face polylines (studio verification view). */
export const FACE_STROKES: number[][] = [
  f('browL0', 'browL1', 'browL2', 'browL3', 'browL4'),
  f('browR0', 'browR1', 'browR2', 'browR3', 'browR4'),
  f('eyeLout', 'eyeLup', 'eyeLin', 'eyeLdn', 'eyeLout'),
  f('eyeRout', 'eyeRup', 'eyeRin', 'eyeRdn', 'eyeRout'),
  f('mouthR', 'lipTopOut', 'mouthL', 'lipBotOut', 'mouthR'),
]
