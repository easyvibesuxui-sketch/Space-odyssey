// Player preferences (stored separately from the save game).
const KEY = 'space-odyssey-settings';

export const settings = { sensitivity: 1 };

try {
  Object.assign(settings, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
} catch {
  // Corrupt or unavailable storage: keep the defaults.
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not critical.
  }
}
