import { visibleHeightAtDepth, normalizedToWorld, normalizedSpanToWorld } from '../src/core/ScreenSpace';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${label}`);
  if (!cond) failures++;
}
function approxEqual(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

// --- visibleHeightAtDepth: known-angle sanity check (FOV 90deg, distance 1 -> height 2) ---
const h90 = visibleHeightAtDepth({ fovDegrees: 90, aspect: 1, cameraZ: 1 }, 0);
check(`FOV=90deg, distance=1 -> visible height = 2 (got ${h90.toFixed(4)})`, approxEqual(h90, 2));

// --- matches this app's actual camera setup (fov=45, cameraZ=4, depth=0) ---
const appCam = { fovDegrees: 45, aspect: 16 / 9, cameraZ: 4 };
const hApp = visibleHeightAtDepth(appCam, 0);
const expected = 2 * 4 * Math.tan((45 * Math.PI) / 180 / 2);
check(`app camera visible height matches manual formula (got ${hApp.toFixed(4)}, expected ${expected.toFixed(4)})`, approxEqual(hApp, expected));
check('app camera visible height is a sane few-units value (~3.3), not the old magic *4 range', hApp > 3 && hApp < 3.5);

// --- center maps to origin regardless of depth ---
for (const depth of [0, -1, 2]) {
  const p = normalizedToWorld(0.5, 0.5, depth, appCam);
  check(`(0.5,0.5) at depth=${depth} maps to world origin`, approxEqual(p.x, 0) && approxEqual(p.y, 0));
}

// --- corners map to the expected extremes ---
const visH = visibleHeightAtDepth(appCam, 0);
const visW = visH * appCam.aspect;
const topLeft = normalizedToWorld(0, 0, 0, appCam);
check('top-left (0,0) -> (-halfWidth, +halfHeight)', approxEqual(topLeft.x, -visW / 2) && approxEqual(topLeft.y, visH / 2));
const bottomRight = normalizedToWorld(1, 1, 0, appCam);
check('bottom-right (1,1) -> (+halfWidth, -halfHeight)', approxEqual(bottomRight.x, visW / 2) && approxEqual(bottomRight.y, -visH / 2));

// --- span conversion: full-width span should equal visibleWidth ---
const fullWidthSpan = normalizedSpanToWorld(0, 0.5, 1, 0.5, 0, appCam);
check(`full-width normalized span (0->1) converts to visibleWidth (got ${fullWidthSpan.toFixed(4)}, expected ${visW.toFixed(4)})`, approxEqual(fullWidthSpan, visW));

// --- a hand occupying a small fraction of frame should get a proportionally small span ---
// e.g. wrist-to-fingertip spanning 10% of frame height should be ~10% of visibleHeight
const smallSpan = normalizedSpanToWorld(0.5, 0.45, 0.5, 0.55, 0, appCam); // 0.10 of normalized height
check(
  `10% of frame height converts to ~10% of visibleHeight (got ${smallSpan.toFixed(4)}, expected ~${(visH * 0.1).toFixed(4)})`,
  approxEqual(smallSpan, visH * 0.1, 1e-4)
);

// --- farther depth (camera farther from the point) should yield a LARGER visible height (wider frustum slice) ---
const nearH = visibleHeightAtDepth(appCam, 0);
const farH = visibleHeightAtDepth(appCam, -2); // point pushed away from camera
check('a depth farther from the camera has a larger visible-height slice', farH > nearH);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
