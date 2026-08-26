// An emulation of Safari's "Advanced Tracking and Fingerprinting Protection",
// which is ON BY DEFAULT in iOS/macOS Safari Private Browsing since Safari 17.0.
//
// Injected into a Playwright WebKit context before page scripts run, so the demo
// can be tested against the behaviour that breaks it. This is a *model* of the
// documented behaviour, not Safari itself:
//
//   - AudioBuffer.getChannelData(): each sample multiplied by 1 ± 0.001 of random
//     noise (webkit.org/blog/15697, WebCore applyNoise(), magnitude 0.001).
//     Safari 17.5 switched the distribution from uniform to normal and made the
//     noise consistent within one buffer; either way the value moves per session.
//   - 2D canvas readback: per-pixel noise on painted pixels, seeded by a hash salt
//     that is unique per session and per origin (CanvasNoiseInjection.cpp).
//   - screen.width / screen.height: fixed to innerWidth / innerHeight.
//
// Not modelled: WebGL readPixels noise (the demo does not read WebGL pixels) and
// screenX/screenY/outerWidth/outerHeight (unused).
module.exports = `
(() => {
  const MAGNITUDE = 0.001;
  const origGetChannelData = AudioBuffer.prototype.getChannelData;
  AudioBuffer.prototype.getChannelData = function (...args) {
    const data = origGetChannelData.apply(this, args);
    const noised = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      noised[i] = data[i] * (1 + MAGNITUDE * (2 * Math.random() - 1));
    }
    return noised;
  };

  const salt = Math.floor(Math.random() * 2 ** 32);
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    const ctx = this.getContext('2d');
    if (ctx) {
      const img = ctx.getImageData(0, 0, this.width, this.height);
      for (let i = 0; i < img.data.length; i += 4) {
        if (!img.data[i + 3]) continue; // only painted pixels
        const offset = ((salt + i) % 3) - 1;
        img.data[i] = Math.max(0, Math.min(255, img.data[i] + offset));
      }
      ctx.putImageData(img, 0, 0);
    }
    return origToDataURL.apply(this, args);
  };

  Object.defineProperty(screen, 'width', { get: () => window.innerWidth });
  Object.defineProperty(screen, 'height', { get: () => window.innerHeight });
})();
`;
