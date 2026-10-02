import { CONFIG } from '../config.js';
import { UPGRADES, MAX_UPGRADE, upgradeCost } from '../systems/Upgrades.js';
import { findPromo } from '../core/Promo.js';
import { TurretBadges } from './TurretBadges.js';

const BASE = import.meta.env.BASE_URL;
const COIN = `<img class="coin-icon" src="${BASE}assets/coin.png" alt="" />`;
const REPAIR_COST_PER_HP = 2;

const PROMPTS = {
  upgrade: 'Ship upgrades',
  cargo: 'Unload cargo',
  launch: 'Board ship & launch',
  armory: 'Armory · mechs, sentries, crew',
};

// HUD and panels shown while walking around the home base.
export class BaseUI {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.root = $('base-ui');
    this.prompt = $('base-prompt');
    this.coinsEl = $('base-coins');
    this.titleEl = $('base-title');
    this.panel = $('base-panel');
    this.useBtn = $('use-btn');
    this.panelOpen = null;
    this.cargo = null;

    this.panel.addEventListener('click', (e) => this._onClick(e));
    this.panel.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submitPromo();
    });
    $('base-promo-btn').addEventListener('click', () => {
      if (this.panelOpen) this.close();
      this.interact('promo');
    });
    this.useBtn.addEventListener('click', () => {
      if (this.game.mechs.piloting) this.game.mechs.exit();
      else this.interact(this.game.hangar.target);
    });
    // Holding USE counts as holding E (reviving the companion).
    this.useBtn.addEventListener('pointerdown', () => this.game.input.keys.add('KeyE'));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.useBtn.addEventListener(ev, () => this.game.input.keys.delete('KeyE'));
    window.addEventListener('keydown', (e) => {
      if (this.game.state !== 'base' || e.repeat) return;
      if (e.target instanceof HTMLInputElement) return; // typing a promo code
      if (this.game.paused) return;
      if (e.code === 'Escape' && !this.panelOpen) {
        this.game.togglePause(true);
        return;
      }
      if (e.code === 'KeyE') {
        if (this.game.mechs.piloting && !this.panelOpen) this.game.mechs.exit();
        else if (this.panelOpen) this.close();
        else this.interact(this.game.hangar.target);
      } else if (e.code === 'Escape' && this.panelOpen) {
        this.close();
      }
    });
  }

  show(cargo) {
    this.cargo = cargo;
    this.root.classList.remove('hidden');
    this.close();
    this.refresh();
    this.game.hangar.setCargoLoaded(!!cargo);
  }

  // Short message at the top of the base screen.
  toast(text) {
    let el = document.getElementById('base-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'base-toast';
      this.root.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  hide() {
    this.root.classList.add('hidden');
    this.close();
  }

  refresh() {
    const g = this.game;
    this.coinsEl.textContent = g.coins.toLocaleString('en-US');
    this.titleEl.textContent = `HOME BASE · NEXT: LEVEL ${g.waves.level}`;
    if (this._shownHint !== g.waves.level && g.waves.level === 1 && !this.cargo) {
      this._shownHint = g.waves.level;
      this.toast('Upgrade your ship at SHIP SYSTEMS, then walk to your ship to launch');
    }
  }

  // Prompt text for whatever the player is looking at.
  promptFor(target) {
    const g = this.game;
    if (target === 'cargo') return `${PROMPTS.cargo}${this.cargo ? ` (+${this.cargoTotal})` : ' (empty)'}`;
    if (target?.startsWith('bay:')) {
      const m = g.mechs.list.find((x) => x.key === target.slice(4));
      if (!m.owned) return `Buy ${m.def.name} · ${m.def.cost.toLocaleString('en-US')} coins`;
      if (m.wrecked) return `Repair ${m.def.name} · ${g.mechs.repairCost(m)} coins`;
      return `Pilot ${m.def.name}`;
    }
    if (target === 'companion') {
      const c = g.companion;
      return c.alive ? `Talk to ${CONFIG.war.companion.name}` : `Hold to revive ${CONFIG.war.companion.name} · ${Math.round(c.reviveProgress * 100)}%`;
    }
    if (target === 'launch' && g.war.active) return 'Invaders in the base! Clear them first';
    if (target === 'launch' && g.warReturn) return 'Board ship & return to orbit';
    return PROMPTS[target];
  }

  update() {
    const g = this.game;
    const target = g.hangar.target;
    let text = '';
    const key = g.isTouch ? 'TAP' : 'E';
    if (g.mechs.piloting && !this.panelOpen) {
      text = `<kbd>${g.isTouch ? 'USE' : 'E'}</kbd> Climb out`;
    } else if (!this.panelOpen && target) {
      const hold = target === 'companion' && !g.companion.alive;
      text = `<kbd>${hold ? (g.isTouch ? 'HOLD USE' : 'HOLD E') : key}</kbd> ${this.promptFor(target)}`;
    }
    if (this._lastPrompt !== text) {
      this._lastPrompt = text;
      this.prompt.innerHTML = text;
      this.useBtn.classList.toggle('hidden', !text);
    }
  }

  get cargoTotal() {
    const c = this.cargo;
    return c ? c.levelBonus + c.integrity + c.kills : 0;
  }

  interact(target) {
    if (!target || this.panelOpen) return;
    const g = this.game;
    if (target === 'companion') {
      g.companion.talk(); // reviving is a hold, handled by the companion itself
      return;
    }
    if (target.startsWith('bay:')) {
      const m = g.mechs.list.find((x) => x.key === target.slice(4));
      if (m.owned && !m.wrecked) {
        g.mechs.enter(m.key);
        return;
      }
      this.armoryFocus = m.key;
      target = 'armory';
    }
    if (target === 'launch' && g.war.active) {
      this.toast('Clear the invaders out of the base first!');
      return;
    }
    this.game.hangar.releasePointer();
    this.panelOpen = target;
    this.panel.classList.remove('hidden');
    this.render();
    this.game.audio.hit();
  }

  close() {
    this.panelOpen = null;
    this.armoryFocus = null;
    this.panel.classList.add('hidden');
  }

  render() {
    const g = this.game;
    const close = `<button class="panel-close" data-action="close" aria-label="Close">✕</button>`;
    if (this.panelOpen === 'cargo') {
      const c = this.cargo;
      if (!c) {
        this.panel.innerHTML = `${close}<div class="panel-title" style="color:var(--gold)">Cargo bay</div><div class="panel-hint">Nothing to unload. Clear a level to bring back more supplies.</div>`;
        return;
      }
      const row = (label, v) => `<div class="stat"><span>${label}</span><b>${COIN} +${v}</b></div>`;
      this.panel.innerHTML = `${close}
        <div class="panel-title" style="color:var(--gold)">Cargo bay · Level ${c.level} rewards</div>
        <div class="stats">
          ${row('Level cleared', c.levelBonus)}
          ${row(`Homeworld integrity (${c.integrity}%)`, c.integrity)}
          ${row(`Enemies destroyed (${c.killCount})`, c.kills)}
        </div>
        <div class="actions"><button class="action unload" data-action="unload">UNLOAD ${COIN} +${this.cargoTotal}</button></div>`;
      return;
    }

    if (this.panelOpen === 'upgrade') {
      const cards = UPGRADES.map((u) => {
        const lvl = g.upgrades[u.id];
        const cost = upgradeCost(u, lvl);
        const pips = Array.from({ length: MAX_UPGRADE }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        const btn = cost === null
          ? `<span class="card-cost max">MAX</span>`
          : `<span class="card-cost">${COIN} ${cost}</span>`;
        return `<button class="card upgrade-card" data-action="buy" data-id="${u.id}" ${cost === null || g.coins < cost ? 'disabled' : ''} style="--accent:${u.color}">
          <img class="card-img" src="${BASE}assets/${u.icon}" alt="" />
          <span class="card-name">${u.name}</span>
          <span class="card-desc">${u.desc}<br/><em>${u.value()}</em></span>
          <span class="pips">${pips}</span>
          ${btn}
        </button>`;
      }).join('');
      // Repair as much as the player can afford.
      const missing = Math.ceil(CONFIG.planet.hp - g.planetHp);
      const hp = Math.min(missing, Math.floor(g.coins / REPAIR_COST_PER_HP));
      const repair = missing <= 0
        ? `<button class="action repair" disabled>HOMEWORLD AT 100%</button>`
        : `<button class="action repair" data-action="repair" ${hp > 0 ? '' : 'disabled'}>REPAIR HOMEWORLD ${Math.floor(g.planetHp)}% → ${Math.min(100, Math.floor(g.planetHp) + hp)}% · ${COIN} ${hp * REPAIR_COST_PER_HP}</button>`;
      this.panel.innerHTML = `${close}
        <div class="build-summary">${COIN} <b>${g.coins}</b> · Ship systems</div>
        <div class="cards upgrade-grid">${cards}</div>
        <div class="actions">${repair}</div>`;
      return;
    }

    if (this.panelOpen === 'promo') {
      this.panel.innerHTML = `${close}
        <div class="panel-title" style="color:var(--gold)">Promo code</div>
        <form class="promo-row" autocomplete="off" onsubmit="return false">
          <input id="base-promo-input" type="text" inputmode="numeric" maxlength="16" placeholder="PROMO CODE" aria-label="Promo code" />
          <button type="submit" class="promo-apply">APPLY</button>
        </form>
        <div id="base-promo-msg" class="promo-msg"></div>`;
      setTimeout(() => document.getElementById('base-promo-input')?.focus(), 50);
      return;
    }

    if (this.panelOpen === 'armory') {
      this.panel.innerHTML = `${close}${this._armoryHtml()}`;
      return;
    }

    if (this.panelOpen === 'launch' && g.warReturn) {
      this.panel.innerHTML = `${close}
        <div class="panel-title">Return to orbit · Level ${g.waves.level}</div>
        <div class="panel-hint">The base is secure. The battle above the homeworld is still on.<br/>Homeworld integrity: <b>${Math.floor(g.planetHp)}%</b></div>
        <div class="actions"><button class="action launch" data-action="resume">RETURN TO ORBIT ▶</button></div>`;
      return;
    }

    if (this.panelOpen === 'launch') {
      const warn = this.cargo ? `<div class="panel-warn">You still have unloaded cargo (+${this.cargoTotal}) in the cargo bay.</div>` : '';
      this.panel.innerHTML = `${close}
        <div class="panel-title">Launch · Level ${g.waves.level}</div>
        <div class="panel-hint">The enemy fleet is regrouping. Your turrets stay in orbit.<br/>Homeworld integrity: <b>${Math.floor(g.planetHp)}%</b></div>
        ${warn}
        <div class="actions"><button class="action launch" data-action="launch">LAUNCH ▶</button></div>`;
    }
  }

  _armoryHtml() {
    const g = this.game;
    const mechCards = g.mechs.list.map((m) => {
      const d = m.def;
      let btn;
      if (!m.owned) btn = `<button class="action buy-mech" data-action="buy-mech" data-id="${m.key}" ${g.coins < d.cost ? 'disabled' : ''}>BUY ${COIN} ${d.cost.toLocaleString('en-US')}</button>`;
      else if (m.wrecked) btn = `<button class="action repair" data-action="repair-mech" data-id="${m.key}" ${g.coins < g.mechs.repairCost(m) ? 'disabled' : ''}>REPAIR ${COIN} ${g.mechs.repairCost(m)}</button>`;
      else btn = `<span class="card-cost max">OWNED · IN BAY</span>`;
      const focus = this.armoryFocus === m.key ? ' focus' : '';
      return `<div class="card mech-card${focus}" style="--accent:${d.color}">
        <span class="card-name">${d.name}</span>
        <span class="card-desc">${d.desc}</span>
        <span class="mech-stats"><i>ARMOR <b>${d.hp}</b></i><i>SPEED <b>${d.speed}</b></i><i>DMG <b>${d.weapon.damage}${d.weapon.splash ? ' AoE' : ''}</b></i></span>
        ${btn}
      </div>`;
    }).join('');
    const sentryCards = g.war.sentries.map((s, i) => {
      const costs = CONFIG.war.sentries.costs;
      const next = s.level < costs.length ? costs[s.level] : null;
      const btn = next === null
        ? `<span class="card-cost max">MAX LEVEL</span>`
        : `<button class="action buy-mech" data-action="sentry" data-id="${i}" ${g.coins < next ? 'disabled' : ''}>${s.level ? 'UPGRADE' : 'BUILD'} ${COIN} ${next}</button>`;
      return `<div class="card mech-card" style="--accent:#ffc94a">
        <span class="card-name">Base sentry ${i ? 'B' : 'A'} <span class="rank">${TurretBadges.chevrons(s.level, 5)}</span></span>
        <span class="card-desc">${s.level ? `Level ${s.level} · ${CONFIG.war.sentries.damage[s.level - 1]} dmg per shot` : 'Empty mount by the hangar mouth. Shoots invaders automatically.'}</span>
        ${btn}
      </div>`;
    }).join('');
    const c = g.companion;
    const crew = `<div class="card mech-card" style="--accent:#4dffa6">
        <span class="card-name">${CONFIG.war.companion.name}</span>
        <span class="card-desc">${c.alive ? 'Healthy and ready. Fights at your side when the base is attacked.' : 'Knocked out! Hold E next to them to revive for free, or pay the medics.'}</span>
        ${c.alive ? `<span class="card-cost max">ON DUTY</span>` : `<button class="action repair" data-action="revive" ${g.coins < CONFIG.war.companion.reviveCost ? 'disabled' : ''}>MEDIC ${COIN} ${CONFIG.war.companion.reviveCost}</button>`}
      </div>`;
    return `
      <div class="build-summary">${COIN} <b>${g.coins.toLocaleString('en-US')}</b> · Armory</div>
      <div class="panel-title" style="color:var(--gold)">Mechs <small>· bought mechs wait in their bays · walk up and press E to pilot</small></div>
      <div class="cards mech-grid">${mechCards}</div>
      <div class="panel-title" style="color:var(--gold)">Base defense & crew</div>
      <div class="cards mech-grid">${sentryCards}${crew}</div>`;
  }

  _submitPromo() {
    const input = document.getElementById('base-promo-input');
    const msg = document.getElementById('base-promo-msg');
    if (!input || !msg) return;
    const promo = findPromo(input.value);
    if (!promo) {
      msg.className = 'promo-msg bad';
      msg.textContent = 'Invalid promo code';
      return;
    }
    const res = this.game.applyPromo(promo);
    msg.className = `promo-msg ${res === 'ok' ? 'ok' : 'bad'}`;
    msg.textContent = res === 'ok' ? `✓ ${promo.label}` : 'Already used in this save';
  }

  _onClick(e) {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const g = this.game;
    const action = btn.dataset.action;
    // The APPLY button submits the form; the 'submit' listener handles it (Enter does too).
    if (btn.classList.contains('promo-apply')) return;
    if (action === 'close') {
      this.close();
      g.hangar.capturePointer();
      return;
    }
    if (action === 'unload' && this.cargo) {
      g.coins += this.cargoTotal;
      this.cargo = null;
      g.hangar.setCargoLoaded(false);
      g.audio.coin();
      setTimeout(() => g.audio.coin(), 120);
    } else if (action === 'buy') {
      const u = UPGRADES.find((x) => x.id === btn.dataset.id);
      const cost = upgradeCost(u, g.upgrades[u.id]);
      if (cost === null || g.coins < cost) return;
      g.coins -= cost;
      g.upgrades[u.id]++;
      g.applyShipUpgrades();
      this.toast(`${u.name} ${g.upgrades[u.id]}/${MAX_UPGRADE} installed · look at your ship`);
      g.audio.build();
    } else if (action === 'repair') {
      const missing = Math.ceil(CONFIG.planet.hp - g.planetHp);
      const hp = Math.min(missing, Math.floor(g.coins / REPAIR_COST_PER_HP));
      if (hp <= 0) return;
      g.coins -= hp * REPAIR_COST_PER_HP;
      g.planetHp = Math.min(CONFIG.planet.hp, g.planetHp + hp);
      g.audio.build();
    } else if (action === 'launch') {
      this.close();
      g.launchFromBase();
      return;
    } else if (action === 'resume') {
      this.close();
      g.resumeFromBase();
      return;
    } else if (action === 'buy-mech') {
      if (!g.mechs.buy(btn.dataset.id)) return;
      g.audio.build();
      this.toast(`${CONFIG.war.mechs[btn.dataset.id].name} delivered to its bay! Walk up and press E to pilot.`);
    } else if (action === 'repair-mech') {
      if (!g.mechs.repair(btn.dataset.id)) return;
      g.audio.build();
    } else if (action === 'sentry') {
      const s = g.war.sentries[+btn.dataset.id];
      const cost = CONFIG.war.sentries.costs[s.level];
      if (cost === undefined || g.coins < cost) return;
      g.coins -= cost;
      g.war.setSentryLevel(s, s.level + 1);
      g.audio.build();
    } else if (action === 'revive') {
      if (g.coins < CONFIG.war.companion.reviveCost || g.companion.alive) return;
      g.coins -= CONFIG.war.companion.reviveCost;
      g.companion.reviveNow(1);
    }
    g.saveProgress();
    this.refresh();
    this.render();
  }
}
