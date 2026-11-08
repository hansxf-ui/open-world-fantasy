// World constants, budgets, and identity palette for Open World Fantasy.
// Every value here is pinned by the spec / implementation plan; later
// modules import from this file and must not redefine these numbers.

export const WORLD = {
  size: 400,
  half: 200,
  cityHalf: 45,
  snowZ: -120,
  seaZ: 120,
  forestX: -45,
  desertX: 45,
  shallowZ0: 110,
  shallowZ1: 130,
  shallowDepth: 1.2,
};

export const BUDGETS = {
  drawCalls: 400,
  triangles: 300000,
  particles: 300,
  dprMax: 2,
  dprMid: 1.5,
  dprMin: 1.25,
  frameMs: 20,
};

export const SYNC = {
  hz: 10,
  deadbandM: 0.15,
  deadbandDeg: 5,
  interestM: 60,
  renderCap: 40,
  staleSec: 5,
  interpRate: 10,
};

export const SPEED = {
  walk: 4,
  run: 7,
};

export const CHAT = {
  maxChars: 120,
  minGapMs: 2000,
  panelLines: 50,
};

// Third-person camera: default distance + pinch/wheel zoom limits.
export const CAMERA = { dist: 6, min: 3, max: 12 };

// DPR step-down policy: drop one step when the average frame time
// exceeds the budget, never below the floor, never step back up (v1:
// stability over recovery).
export function dprPolicy(avgFrameMs, currentDpr) {
  if (avgFrameMs <= BUDGETS.frameMs) return currentDpr;
  if (currentDpr > BUDGETS.dprMid) return BUDGETS.dprMid;
  if (currentDpr > BUDGETS.dprMin) return BUDGETS.dprMin;
  return BUDGETS.dprMin;
}

// 8 soft cozy shirt colors.
export const COLORS = [
  '#f6c9a8',
  '#a8c3a0',
  '#a8c8e0',
  '#c5b3e0',
  '#f2d98c',
  '#e8a0b0',
  '#a0d8c0',
  '#d8b898',
];
