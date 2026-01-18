// src/vision/opencv-loader.ts
declare global {
  interface Window {
    cv: any;
  }
}

let loadingPromise: Promise<any> | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function loadOpenCV(timeoutMs = 60000): Promise<any> {
  if (window.cv && window.cv.Mat) return window.cv;
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<any>(async (resolve, reject) => {
    const t0 = performance.now();

    // cargar script
    const existing = document.querySelector('script[data-opencv="1"]') as HTMLScriptElement | null;
    if (!existing) {
      const s = document.createElement("script");
      s.dataset.opencv = "1";
      s.src = "/vendor/opencv.js";
      s.async = true;
      s.onerror = () => reject(new Error("No se pudo cargar /vendor/opencv.js"));
      document.head.appendChild(s);
    }

    // esperar a que aparezca cv (ASM build no usa wasm ni onRuntimeInitialized)
    while (performance.now() - t0 < timeoutMs) {
      if (window.cv && window.cv.Mat) {
        resolve(window.cv);
        return;
      }
      await sleep(120);
    }

    reject(new Error("OpenCV timeout: cv no estuvo disponible (opencv.js no inicializó)"));
  });

  return loadingPromise;
}
