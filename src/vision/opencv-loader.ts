// src/vision/opencv-loader.ts
declare global {
  interface Window {
    cv: any;
    Module: any;
  }
}

let loadingPromise: Promise<any> | null = null;

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function loadOpenCV(timeoutMs = 15000): Promise<any> {
  if (window.cv && window.cv.Mat) return window.cv;
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<any>((resolve, reject) => {
    const t0 = performance.now();

    // Si un SW viejo cacheó algo raro, este log ayuda (lo mostramos desde main)
    window.Module = {
      locateFile: (path: string) => `/vendor/${path}`,
      onRuntimeInitialized: () => resolve(window.cv),
    };

    // Evitar que cargue dos veces
    const existing = document.querySelector('script[data-opencv="1"]') as HTMLScriptElement | null;
    if (existing) return;

    const script = document.createElement("script");
    script.dataset.opencv = "1";
    script.src = "/vendor/opencv.js";
    script.async = true;

    script.onerror = () => {
      reject(new Error("No se pudo cargar /vendor/opencv.js (error de red)"));
    };

    document.head.appendChild(script);

    // Timeout hard (iPhone a veces queda colgado)
    (async () => {
      while (performance.now() - t0 < timeoutMs) {
        if (window.cv && window.cv.Mat) return; // onRuntimeInitialized resolverá
        await wait(100);
      }
      reject(new Error("OpenCV timeout: no se inicializó (WASM no cargó o quedó colgado)"));
    })().catch(reject);
  });

  return loadingPromise;
}
