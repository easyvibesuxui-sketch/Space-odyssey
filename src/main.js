import { loadAssets } from './core/Assets.js';
import { Audio } from './core/Audio.js';
import { Game } from './Game.js';
import { loadSave } from './core/Save.js';
import { CREDITS } from './core/Models.js';

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);

const fill = document.getElementById('loader-fill');
const pct = document.getElementById('loader-pct');
const launchBtn = document.getElementById('launch-btn');
const preloader = document.getElementById('preloader');

// Smooth the visible progress so the bar never jumps straight to 100%.
let target = 0;
let shown = 0;
function animateBar() {
  shown += (target - shown) * 0.12;
  if (target - shown < 0.002) shown = target;
  fill.style.width = `${(shown * 100).toFixed(1)}%`;
  pct.textContent = `${Math.round(shown * 100)}%`;
  if (shown < 1) requestAnimationFrame(animateBar);
}
requestAnimationFrame(animateBar);

const audio = new Audio();

const PROMO_CODES = {
  1010: { id: '1010', coins: 10_000_000, label: '10,000,000 coins unlocked' },
};

// Credits for third-party 3D models (CC-BY requires attribution).
document.getElementById('credits-list').innerHTML = CREDITS.map(
  (c) => `<div class="credit"><b>${c.what}</b> · “${c.title}” by ${c.author} · ${c.license}<br/><a href="${c.url}" target="_blank" rel="noopener">${c.url}</a></div>`
).join('');
document.getElementById('credits-btn').addEventListener('click', () => document.getElementById('credits').classList.remove('hidden'));
document.getElementById('credits-close').addEventListener('click', () => document.getElementById('credits').classList.add('hidden'));

async function boot() {
  const minTime = new Promise((r) => setTimeout(r, 1200));
  const assets = await loadAssets((p) => (target = p * 0.9));
  const game = new Game(document.getElementById('game'), assets, audio);
  await minTime;
  target = 1;

  const save = loadSave();
  const continueBtn = document.getElementById('continue-btn');

  // Promo codes. Applied when the player starts (new game) or continues.
  let promo = null;
  const promoMsg = document.getElementById('promo-msg');
  document.getElementById('promo-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = document.getElementById('promo-input').value.trim().toUpperCase();
    promo = PROMO_CODES[code] ?? null;
    promoMsg.className = promo ? 'ok' : 'bad';
    promoMsg.textContent = promo ? `✓ ${promo.label}` : 'Invalid promo code';
    if (promo) audio.unlock();
  });

  const begin = (fromSave) => {
    audio.unlock();
    if (isTouch && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    preloader.classList.add('fade');
    setTimeout(() => {
      preloader.remove();
    }, 900);
    game.start(fromSave, { promo });
  };

  launchBtn.disabled = false;
  launchBtn.textContent = save ? 'NEW GAME' : isTouch ? 'TAP TO START' : 'START';
  launchBtn.addEventListener('click', () => begin(null), { once: true });
  if (save) {
    continueBtn.textContent = `CONTINUE · LEVEL ${save.level}`;
    continueBtn.classList.remove('hidden');
    continueBtn.addEventListener('click', () => begin(save), { once: true });
  }
}

boot().catch((err) => {
  console.error(err);
  launchBtn.textContent = 'FAILED TO LOAD';
});
