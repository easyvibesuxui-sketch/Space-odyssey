import * as THREE from 'three';

// Works both at the site root and under a sub-path (e.g. GitHub Pages /Space-odyssey/).
const BASE = import.meta.env.BASE_URL;

// Loads every asset the game needs and reports progress for the preloader.
export async function loadAssets(onProgress) {
  const manager = new THREE.LoadingManager();
  const textureLoader = new THREE.TextureLoader(manager);
  const assets = {};

  let done = 0;
  const jobs = [];
  const track = (promise) => {
    jobs.push(promise);
    promise.finally(() => {
      done++;
      onProgress(done / jobs.length);
    });
    return promise;
  };

  track(
    textureLoader.loadAsync(`${BASE}assets/coin.png`).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      assets.coin = tex;
    })
  );

  // Warm the browser cache for the menu art / preloader video so they never pop in.
  track(preloadImage(`${BASE}assets/keyart.jpg`));
  for (const t of ['laser', 'missile', 'shield']) track(preloadImage(`${BASE}assets/turret-${t}.jpg`));
  track(waitForVideo(document.getElementById('preloader-video')));

  // Give fonts a chance so the HUD doesn't flash fallback text.
  if (document.fonts?.ready) track(document.fonts.ready.catch(() => {}));

  await Promise.allSettled(jobs);
  return assets;
}

function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
}

function waitForVideo(video) {
  return new Promise((resolve) => {
    if (!video || video.readyState >= 3) return resolve();
    const finish = () => resolve();
    video.addEventListener('canplaythrough', finish, { once: true });
    video.addEventListener('error', finish, { once: true });
    // Slow connections shouldn't block the game on a decorative video.
    setTimeout(finish, 6000);
  });
}
