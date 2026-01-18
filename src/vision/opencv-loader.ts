// src/vision/opencv-loader.ts
declare global {
  interface Window {
    cv: any;
    Module: any;
  }
}

let loadingPromise: Promise<any> | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Loader robusto para iOS:
 * - Prefetch WASM como ArrayBuffer
 * - lo pasa como Uint8Array (más compatible)
 * - timeout largo (compilar WASM grande puede tardar)
 */
export async function loadOpenCV(timeoutMs = 90000): Promise<any> {
  if (window.cv && window.cv.Mat) return window.cv;
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<any>(async (resolve, reject) => {
    const t0 = performance.now();

    try {
      // 1) Prefetch WASM
      const wasmUrl = "/vendor/opencv_js.wasm";
      const wasmResp = await fetch(wasmUrl, { cache: "no-store" });
      if (!wasmResp.ok) throw new Error(`No se pudo descargar WASM (${wasmResp.status})`);

      const wasmBuffer = await wasmResp.arrayBuffer();

      // ✅ sanity check: si es demasiado chico, suele ser HTML/redirect aunque sea 200
      const bytes = wasmBuffer.byteLength;
      if (bytes < 2_000_000) {
        throw new Error(`WASM demasiado chico (${(bytes / 1024).toFixed(0)} KB). ¿No es el archivo real?`);
      }

      // 2) Definir Module ANTES de cargar opencv.js
      const wasmBinary = new Uint8Array(wasmBuffer);

      window.Module = {
        wasmBinary, // 👈 clave
        locateFile: (path: string) => `/vendor/${path}`,
        onRuntimeInitialized: () => {
          if (window.cv && window.cv.Mat) resolve(window.cv);
          else reject(new Error("OpenCV inicializó pero window.cv no está disponible"));
        },
      };

      // 3) Cargar opencv.js (una sola vez)
      const existing = document.querySelector('script[data-opencv="1"]') as HTMLScriptElement | null;
      if (!existing) {
        const script = document.createElement("script");
        script.dataset.opencv = "1";
        script.src = "/vendor/opencv.js";
        script.async = true;
        script.onerror = () => reject(new Error("No se pudo cargar /vendor/opencv.js"));
        document.head.appendChild(script);
      }

      // 4) Esperar inicialización (timeout)
      while (performance.now() - t0 < timeoutMs) {
        if (window.cv && window.cv.Mat) return; // onRuntimeInitialized resolverá
        await sleep(120);
      }

      reject(new Error("OpenCV timeout: runtime no inicializó (WASM instantiation colgada)"));
    } catch (err) {
      reject(err);
    }
  });

  return loadingPromise;
}
