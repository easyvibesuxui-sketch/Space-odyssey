// Unified input for keyboard + mouse and touch.
// Exposes: move {x, y} in [-1, 1], aim {x, y} in normalized screen coords, fire, dashPressed.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.aim = { x: 0, y: 0.2 };
    this.mouseDown = false;
    this.touchFire = false;
    this.dashQueued = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    this.joy = { id: null, cx: 0, cy: 0, x: 0, y: 0 };
    this.aimTouch = { id: null, lastX: 0, lastY: 0 };

    this._bindKeyboard();
    this._bindMouse();
    if (this.isTouch) this._bindTouch();
  }

  get fire() {
    return this.mouseDown || this.touchFire || this.keys.has('Space');
  }

  consumeDash() {
    const d = this.dashQueued;
    this.dashQueued = false;
    return d;
  }

  update() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.joy.id !== null) {
      x = this.joy.x;
      y = this.joy.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!e.repeat) this.dashQueued = true;
      }
      if (e.code === 'Space') e.preventDefault();
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
      this.aim.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.aim.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _bindTouch() {
    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    const fireBtn = document.getElementById('fire-btn');
    const dashBtn = document.getElementById('dash-btn');
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

    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.touchFire = true;
      fireBtn.classList.add('active');
    }, { passive: false });
    const fireEnd = (e) => {
      e.preventDefault();
      this.touchFire = false;
      fireBtn.classList.remove('active');
    };
    fireBtn.addEventListener('touchend', fireEnd, { passive: false });
    fireBtn.addEventListener('touchcancel', fireEnd, { passive: false });

    dashBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.dashQueued = true;
      dashBtn.classList.add('active');
    }, { passive: false });
    dashBtn.addEventListener('touchend', () => dashBtn.classList.remove('active'));

    // Drag anywhere on the canvas to steer the crosshair (relative movement).
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.aimTouch.id === null) {
          this.aimTouch.id = t.identifier;
          this.aimTouch.lastX = t.clientX;
          this.aimTouch.lastY = t.clientY;
        }
      }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) this._updateJoy(t, radius, setKnob);
        if (t.identifier === this.aimTouch.id) {
          const sens = 2.4;
          this.aim.x += ((t.clientX - this.aimTouch.lastX) / window.innerWidth) * sens;
          this.aim.y -= ((t.clientY - this.aimTouch.lastY) / window.innerHeight) * sens;
          this.aim.x = Math.max(-0.95, Math.min(0.95, this.aim.x));
          this.aim.y = Math.max(-0.9, Math.min(0.95, this.aim.y));
          this.aimTouch.lastX = t.clientX;
          this.aimTouch.lastY = t.clientY;
        }
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
        if (t.identifier === this.aimTouch.id) this.aimTouch.id = null;
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
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
