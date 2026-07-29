import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // host:true 讓同網段的手機／平板也能連進來測試手勢。
    // 注意：getUserMedia 只在 https 或 localhost 下可用，
    // 若要用區網 IP 測試，請改用 `vite --https` 或反向代理。
    host: true,
    port: 5173,
  },
  build: {
    // MediaPipe 的 wasm 與 tflite 已放在 public/mediapipe/，
    // Vite 會原樣複製，不需要（也不應該）進 bundle。
    chunkSizeWarningLimit: 1024,
  },
});
