// src/vision/opencv-loader.ts
declare global {
  interface Window {
    cv: any;
    Module: any;
  }
}

let loadingPromise: Promise<any> | null = null;

export function loadOpenCV(): Promise<any> {
  if (window.cv && window.cv.Mat) return Promise.resolve(window.cv);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    // IMPORTANT: decirle a OpenCV dónde está el wasm
    window.Module = {
      locateFile: (path: string) => `/vendor/${path}`,
      onRuntimeInitialized: () => {
        try {
          resolve(window.cv);
        } catch (e) {
          reject(e);
        }
      },
    };

    const script = document.createElement("script");
    script.src = "/vendor/opencv.js";
    script.async = true;
    script.onload = () => {
      // el resolve ocurre en onRuntimeInitialized
    };
    script.onerror = () => reject(new Error("No se pudo cargar /vendor/opencv.js"));
    document.head.appendChild(script);
  });

  return loadingPromise;
}
