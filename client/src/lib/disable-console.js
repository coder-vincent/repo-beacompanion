// Disable noisy console logging in production builds but keep it in development
// Vite exposes `import.meta.env.DEV` / `PROD`; fallback to NODE_ENV for safety.
const isProd =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.PROD) ||
  (typeof globalThis !== "undefined" &&
    globalThis.process &&
    globalThis.process.env &&
    globalThis.process.env.NODE_ENV === "production");

if (isProd) {
  console.log = () => {};
}
