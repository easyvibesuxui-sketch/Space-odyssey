// Progress is saved whenever the player is at the base. Storage can be unavailable
// (private mode, blocked site data), so every access is guarded.
const KEY = 'space-odyssey-save-v1';

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data.level === 'number' ? data : null;
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Ignore: the game still works, it just won't remember progress.
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
}
