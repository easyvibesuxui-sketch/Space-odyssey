import { CONFIG } from '../config.js';
import { UPGRADES, MAX_UPGRADE, upgradeCost, applyUpgrades } from '../systems/Upgrades.js';

const BASE = import.meta.env.BASE_URL;
const COIN = `<img class="coin-icon" src="${BASE}assets/coin.png" alt="" />`;
const REPAIR_COST_PER_HP = 2;

const PROMPTS = {
  upgrade: 'Ship upgrades',
  cargo: 'Unload cargo',
  launch: 'Board ship & launch',
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
    this.useBtn.addEventListener('click', () => this.interact(this.game.hangar.target));
    window.addEventListener('keydown', (e) => {
      if (this.game.state !== 'base' || e.repeat) return;
      if (e.code === 'KeyE') {
        if (this.panelOpen) this.close();
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

  hide() {
    this.root.classList.add('hidden');
    this.close();
  }

  refresh() {
    const g = this.game;
    this.coinsEl.textContent = g.coins;
    this.titleEl.textContent = `HOME BASE · NEXT: LEVEL ${g.waves.level}`;
  }

  update() {
    const target = this.game.hangar.target;
    let text = '';
    if (!this.panelOpen && target) {
      const extra = target === 'cargo' && this.cargo ? ` (+${this.cargoTotal})` : target === 'cargo' ? ' (empty)' : '';
      const key = this.game.isTouch ? 'TAP' : 'E';
      text = `<kbd>${key}</kbd> ${PROMPTS[target]}${extra}`;
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
    this.game.hangar.releasePointer();
    this.panelOpen = target;
    this.panel.classList.remove('hidden');
    this.render();
    this.game.audio.hit();
  }

  close() {
    this.panelOpen = null;
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

    if (this.panelOpen === 'launch') {
      const warn = this.cargo ? `<div class="panel-warn">You still have unloaded cargo (+${this.cargoTotal}) in the cargo bay.</div>` : '';
      this.panel.innerHTML = `${close}
        <div class="panel-title">Launch · Level ${g.waves.level}</div>
        <div class="panel-hint">The enemy fleet is regrouping. Your turrets stay in orbit.<br/>Homeworld integrity: <b>${Math.floor(g.planetHp)}%</b></div>
        ${warn}
        <div class="actions"><button class="action launch" data-action="launch">LAUNCH ▶</button></div>`;
    }
  }

  _onClick(e) {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const g = this.game;
    const action = btn.dataset.action;
    if (action === 'close') {
      this.close();
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
      applyUpgrades(g.upgrades);
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
    }
    g.saveProgress();
    this.refresh();
    this.render();
  }
}
