// src/vision/autolock.ts
export type LockResult = {
  locked: boolean;
  paintX: number; // 0..1
  paintY: number; // 0..1
  inliers: number;
  goodMatches: number;
};

type RefCache = {
  refW: number;
  refH: number;
  refGray: any;
  refKeypoints: any;
  refDesc: any;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function applyHomographyToPoint(H: number[], x: number, y: number) {
  // H es array length 9, row-major
  const a = H[0], b = H[1], c = H[2];
  const d = H[3], e = H[4], f = H[5];
  const g = H[6], h = H[7], i = H[8];

  const w = g * x + h * y + i;
  if (Math.abs(w) < 1e-9) return { x: NaN, y: NaN };
  return { x: (a * x + b * y + c) / w, y: (d * x + e * y + f) / w };
}

function mat3x3ToArray(cv: any, Hmat: any): number[] {
  // Hmat es cv.Mat 3x3 CV_64F o CV_32F
  const out: number[] = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = Hmat.doubleAt ? Hmat.doubleAt(r, c) : Hmat.floatAt(r, c);
    }
  }
  // normalizar para que H[8]=1 si se puede
  const s = out[8];
  if (Math.abs(s) > 1e-12) {
    for (let k = 0; k < 9; k++) out[k] /= s;
  }
  return out;
}

export class AutoLock {
  private cv: any;
  private refUrl: string;

  private ref: RefCache | null = null;

  private orb: any;
  private bf: any;

  private frameW = 320; // ancho de análisis (performance)
  private frameH = 240;

  private lastRunMs = 0;
  private intervalMs = 200; // 5 fps de visión

  // Umbrales
  private minGoodMatches = 18;
  private minInliers = 14;

  // estado lock
  private lockedUntilMs = 0;
  private lockHoldMs = 800; // si pierde 1-2 frames, mantiene lock un rato
  private lastH_frame_to_ref: number[] | null = null;

  constructor(params: { cv: any; referenceUrl: string }) {
    this.cv = params.cv;
    this.refUrl = params.referenceUrl;

    this.orb = this.cv.ORB_create(900); // más keypoints = más robusto, más costo
    this.bf = new this.cv.BFMatcher(this.cv.NORM_HAMMING, false);
  }

  setVisionRate(ms: number) {
    this.intervalMs = Math.max(80, ms);
  }

  setAnalysisSize(w: number) {
    this.frameW = Math.max(160, Math.floor(w));
    this.frameH = Math.max(120, Math.floor((w * 3) / 4));
  }

  async init(): Promise<void> {
    if (this.ref) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = this.refUrl;
    await img.decode();

    const cv = this.cv;

    // Pasar imagen a canvas y luego a Mat
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);

    const imageData = g.getImageData(0, 0, c.width, c.height);
    const refRGBA = cv.matFromImageData(imageData);
    const refGray = new cv.Mat();
    cv.cvtColor(refRGBA, refGray, cv.COLOR_RGBA2GRAY);

    const refKeypoints = new cv.KeyPointVector();
    const refDesc = new cv.Mat();
    this.orb.detectAndCompute(refGray, new cv.Mat(), refKeypoints, refDesc);

    refRGBA.delete();

    this.ref = {
      refW: c.width,
      refH: c.height,
      refGray,
      refKeypoints,
      refDesc,
    };
  }

  /**
   * Procesa (cada intervalMs) un frame del video y devuelve mapping al punto de la pintura (0..1).
   * El “scanner” es el centro del frame.
   */
  process(videoEl: HTMLVideoElement): LockResult {
    const now = performance.now();
    const cv = this.cv;

    // Mantener lock si estamos dentro del hold
    const stillLocked = this.lastH_frame_to_ref && now < this.lockedUntilMs;

    if (now - this.lastRunMs < this.intervalMs) {
      if (stillLocked) {
        // proyectar centro con última H
        return this.projectCenter(stillLocked, videoEl);
      }
      return { locked: false, paintX: 0, paintY: 0, inliers: 0, goodMatches: 0 };
    }
    this.lastRunMs = now;

    if (!this.ref) {
      return { locked: false, paintX: 0, paintY: 0, inliers: 0, goodMatches: 0 };
    }

    // 1) Capturar frame reducido
    const vw = videoEl.videoWidth || 0;
    const vh = videoEl.videoHeight || 0;
    if (!vw || !vh) {
      return { locked: false, paintX: 0, paintY: 0, inliers: 0, goodMatches: 0 };
    }

    // Canvas de análisis (reusar para evitar GC)
    const canvas = (this as any)._cvs || document.createElement("canvas");
    (this as any)._cvs = canvas;
    canvas.width = this.frameW;
    canvas.height = this.frameH;

    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const frameRGBA = cv.matFromImageData(frameData);
    const frameGray = new cv.Mat();
    cv.cvtColor(frameRGBA, frameGray, cv.COLOR_RGBA2GRAY);

    const frameKeypoints = new cv.KeyPointVector();
    const frameDesc = new cv.Mat();
    this.orb.detectAndCompute(frameGray, new cv.Mat(), frameKeypoints, frameDesc);

    frameRGBA.delete();
    frameGray.delete();

    // Si no hay descriptores, no hay lock
    if (frameDesc.rows === 0 || this.ref.refDesc.rows === 0) {
      frameKeypoints.delete();
      frameDesc.delete();
      return { locked: false, paintX: 0, paintY: 0, inliers: 0, goodMatches: 0 };
    }

    // 2) Matching KNN + ratio test
    const knn = new cv.DMatchVectorVector();
    this.bf.knnMatch(this.ref.refDesc, frameDesc, knn, 2);

    const good: any[] = [];
    for (let i = 0; i < knn.size(); i++) {
      const m = knn.get(i).get(0);
      const n = knn.get(i).get(1);
      if (m.distance < 0.75 * n.distance) good.push(m);
    }

    const goodMatches = good.length;

    // cleanup parcial
    knn.delete();

    if (goodMatches < this.minGoodMatches) {
      frameKeypoints.delete();
      frameDesc.delete();
      return { locked: false, paintX: 0, paintY: 0, inliers: 0, goodMatches };
    }

    // 3) Construir puntos src(ref) y dst(frame)
    const srcPts = new cv.Mat(goodMatches, 1, cv.CV_32FC2);
    const dstPts = new cv.Mat(goodMatches, 1, cv.CV_32FC2);

    for (let i = 0; i < goodMatches; i++) {
      const dm = good[i];
      const kpRef = this.ref.refKeypoints.get(dm.queryIdx);
      const kpFr = frameKeypoints.get(dm.trainIdx);

      // src: referencia en pixeles
      srcPts.data32F[i * 2] = kpRef.pt.x;
      srcPts.data32F[i * 2 + 1] = kpRef.pt.y;

      // dst: frame en pixeles (del canvas de análisis)
      dstPts.data32F[i * 2] = kpFr.pt.x;
      dstPts.data32F[i * 2 + 1] = kpFr.pt.y;
    }

    const mask = new cv.Mat();
    const H_ref_to_frame = cv.findHomography(srcPts, dstPts, cv.RANSAC, 3.0, mask);

    srcPts.delete();
    dstPts.delete();

    // Contar inliers
    let inliers = 0;
    for (let i = 0; i < mask.rows; i++) {
      if (mask.ucharPtr(i, 0)[0]) inliers++;
    }
    mask.delete();

    frameKeypoints.delete();
    frameDesc.delete();

    if (!H_ref_to_frame || H_ref_to_frame.rows === 0) {
      if (H_ref_to_frame) H_ref_to_frame.delete?.();
      return { locked: false, paintX: 0, paintY: 0, inliers: 0, goodMatches };
    }

    if (inliers < this.minInliers) {
      H_ref_to_frame.delete();
      return { locked: false, paintX: 0, paintY: 0, inliers, goodMatches };
    }

    // 4) Invertir: H_frame_to_ref
    const H_frame_to_ref = new cv.Mat();
    cv.invert(H_ref_to_frame, H_frame_to_ref);
    H_ref_to_frame.delete();

    const H = mat3x3ToArray(cv, H_frame_to_ref);
    H_frame_to_ref.delete();

    // Guardar lock
    this.lastH_frame_to_ref = H;
    this.lockedUntilMs = now + this.lockHoldMs;

    // Proyectar centro del frame de análisis a coords de ref pixeles
    const cx = canvas.width * 0.5;
    const cy = canvas.height * 0.5;
    const pRef = applyHomographyToPoint(H, cx, cy);

    const paintX = clamp01(pRef.x / this.ref.refW);
    const paintY = clamp01(pRef.y / this.ref.refH);

    return { locked: true, paintX, paintY, inliers, goodMatches };
  }

  private projectCenter(locked: boolean, videoEl: HTMLVideoElement): LockResult {
    if (!locked || !this.ref || !this.lastH_frame_to_ref) {
      return { locked: false, paintX: 0, paintY: 0, inliers: 0, goodMatches: 0 };
    }
    // usamos el último canvas de análisis
    const canvas = (this as any)._cvs as HTMLCanvasElement | undefined;
    if (!canvas) return { locked: false, paintX: 0, paintY: 0, inliers: 0, goodMatches: 0 };

    const cx = canvas.width * 0.5;
    const cy = canvas.height * 0.5;
    const pRef = applyHomographyToPoint(this.lastH_frame_to_ref, cx, cy);

    const paintX = clamp01(pRef.x / this.ref.refW);
    const paintY = clamp01(pRef.y / this.ref.refH);

    return { locked: true, paintX, paintY, inliers: 0, goodMatches: 0 };
  }
}
