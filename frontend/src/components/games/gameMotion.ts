export function waitForGameMotion(milliseconds: number) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}
