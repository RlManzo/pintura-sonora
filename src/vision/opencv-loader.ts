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

export async function loadOpenCV(timeoutMs = 20000): Promise<any> {
  if (window.cv && window.cv.Mat) return window.cv;
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<any>(async (resolve, reject) => {
    const t0 = performance.now();

    try {
      // ✅ 1) Prefetch WASM como ArrayBuffer (evita problemas de MIME/streaming en iOS)
      const wasmUrl = "/vendor/opencv_js.wasm";
      const wasmResp = await fetch(wasmUrl, { cache: "no-store" });
      if (!wasmResp.ok) throw new Error(`No se pudo descargar WASM (${wasmResp.status})`);
      const wasmBinary = await wasmResp.arrayBuffer();

      // ✅ 2) Definir Module ANTES de cargar el script
      window.Module = {
        wasmBinary, // 👈 clave
        locateFile: (path: string) => `/vendor/${path}`,
        onRuntimeInitialized: () => {
          if (window.cv && window.cv.Mat) resolve(window.cv);
          else reject(new Error("OpenCV inicializó pero window.cv no está disponible"));
        },
      };

      // ✅ 3) Cargar opencv.js
      const existing = document.querySelector('script[data-opencv="1"]') as HTMLScriptElement | null;
      if (!existing) {
        const script = document.createElement("script");
        script.dataset.opencv = "1";
        script.src = "/vendor/opencv.js";
        script.async = true;

        script.onerror = () => reject(new Error("No se pudo cargar /vendor/opencv.js"));
        document.head.appendChild(script);
      }

      // ✅ 4) Timeout hard (por si queda colgado)
      while (performance.now() - t0 < timeoutMs) {
        if (window.cv && window.cv.Mat) return; // onRuntimeInitialized resolverá
        await sleep(100);
      }

      reject(new Error("OpenCV timeout: runtime no inicializó (WASM instantiation colgada)"));
    } catch (err) {
      reject(err);
    }
  });

  return loadingPromise;
}
