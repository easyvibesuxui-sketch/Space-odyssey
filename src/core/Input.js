// Unified flight input for keyboard + mouse and touch.
//
// Desktop: the mouse cursor is both the crosshair and a virtual stick — the further it is from
// the ship's heading, the harder the ship turns towards it. W/S throttle, A/D roll,
// arrows pitch/yaw, Shift boost, click/Space fire.
// Touch: left stick pitch/yaw, FIRE and BOOST buttons; aiming uses aim assist.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    // Crosshair in normalized device coords (desktop only; touch aims along the nose).
    this.aim = { x: 0, y: 0.13 };
    this.mouseActive = false;
    this.mouseDown = false;

    this.touchFire = false;
    this.touchBoost = false;
    this.joy = { id: null, cx: 0, cy: 0, x: 0, y: 0 };

    // Outputs, refreshed by update().
    this.keySteer = { x: 0, y: 0 };
    this.throttle = 0;
    this.roll = 0;

    this._bindKeyboard();
    this._bindMouse();
    if (this.isTouch) this._bindTouch();
  }

  get fire() {
    return this.mouseDown || this.touchFire || this.keys.has('Space');
  }

  get boost() {
    return this.touchBoost || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  update() {
    const k = this.keys;
    let sx = 0;
    let sy = 0;
    if (k.has('ArrowLeft')) sx -= 1;
    if (k.has('ArrowRight')) sx += 1;
    if (k.has('ArrowUp')) sy += 1;
    if (k.has('ArrowDown')) sy -= 1;
    if (this.joy.id !== null) {
      sx = this.joy.x;
      sy = this.joy.y;
    }
    this.keySteer.x = sx;
    this.keySteer.y = sy;

    this.throttle = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    this.roll = (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0);
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
  }

  _bindMouse() {
    window.addEventListener('mousemove', (e) => {
      if (this.isTouch) return;
      this.mouseActive = true;
      this.aim.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.aim.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    // If the cursor leaves the window, stop steering so the ship doesn't spin forever.
    document.addEventListener('mouseleave', () => {
      this.mouseActive = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _bindTouch() {
    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    const fireBtn = document.getElementById('fire-btn');
    const boostBtn = document.getElementById('boost-btn');
    const radius = 50;

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    joystick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const rect = joystick.getBoundingClientRect();
      this.joy.id = t.identifier;
      this.joy.cx = rect.left + rect.width / 2;
      this.joy.cy = rect.top + rect.height / 2;
      this._updateJoy(t, radius, setKnob);
    }, { passive: false });

    const hold = (btn, prop) => {
      const on = (e) => {
        e.preventDefault();
        this[prop] = true;
        btn.classList.add('active');
      };
      const off = (e) => {
        e.preventDefault();
        this[prop] = false;
        btn.classList.remove('active');
      };
      btn.addEventListener('touchstart', on, { passive: false });
      btn.addEventListener('touchend', off, { passive: false });
      btn.addEventListener('touchcancel', off, { passive: false });
    };
    hold(fireBtn, 'touchFire');
    hold(boostBtn, 'touchBoost');

    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) this._updateJoy(t, radius, setKnob);
      }
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.id = null;
          this.joy.x = 0;
          this.joy.y = 0;
          setKnob(0, 0);
        }
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    this.canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  _updateJoy(t, radius, setKnob) {
    let dx = t.clientX - this.joy.cx;
    let dy = t.clientY - this.joy.cy;
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    setKnob(dx, dy);
    this.joy.x = dx / radius;
    this.joy.y = -dy / radius;
  }
}
