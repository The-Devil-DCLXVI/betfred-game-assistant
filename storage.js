// Remove a path from the silent add ignore list
export async function removeFromIgnoreList(path) {
  let ignoreList = await loadFromStorage('betfred_silent_add_ignored', {});
  if (ignoreList[path]) {
    delete ignoreList[path];
    await saveToStorage('betfred_silent_add_ignored', ignoreList);
  }
}
// storage.js
// Storage utility functions for Betfred extension

// Use browser.storage.local if available, otherwise fallback to chrome.storage.local
const storage = (typeof browser !== 'undefined' ? browser : chrome).storage.local;

export async function saveToStorage(key, value) {
  try {
    // Validate data before saving
    if (!validateStorageData(value, key)) {
      console.error('Invalid data format for storage key:', key, 'value:', value);
      return false;
    }
    
    // Check storage quota
    const quotaOK = await checkStorageQuota();
    if (!quotaOK) {
      console.warn('Storage quota exceeded, operation may fail');
    }
    
    // Promise-based API (browser) or callback-based (chrome)
    if (storage.set.length === 1) {
      // Promise-based (browser)
      await storage.set({ [key]: value });
    } else {
      // Callback-based (chrome)
      await new Promise(r => storage.set({ [key]: value }, r));
    }
    return true;
  } catch (error) {
    console.error('Failed to save to storage:', error, 'key:', key, 'value:', value);
    return false;
  }
}

export async function loadFromStorage(key, def) {
  if (storage.get.length === 1) {
    // Promise-based (browser)
    const res = await storage.get([key]);
    return res[key] !== undefined ? res[key] : def;
  } else {
    // Callback-based (chrome)
    return await new Promise(r => storage.get([key], res => r(res[key] !== undefined ? res[key] : def)));
  }
}

export async function getFavorites() {
  return await loadFromStorage('betfred_favorites', {});
}

export async function saveFavorites(favs) {
  await saveToStorage('betfred_favorites', favs);
}

export async function getNeverShowAgain() {
  return await loadFromStorage('betfred_never_show_again', {});
}

export async function setNeverShowAgain(obj) {
  await saveToStorage('betfred_never_show_again', obj);
}

// Patch known games with missing or incorrect data
function patchKnownGames(scanData) {
  for (const key in scanData) {
    const game = scanData[key];
    if (game.title === "Fruity Booty") {
      game.provider = "Slot Factory";
    }
    if (game.title === "Stars Awakening") {
      game.provider = "Playtech";
    }
  }
}

export async function loadDefaultDatabaseIfNeeded() {
  const key = 'betfred_scan_data';
  const existing = await loadFromStorage(key, null);
  if (!existing) {
    try {
      const url = (typeof browser !== 'undefined' ? browser : chrome).runtime.getURL('betfred_scan_data.json');
      const resp = await fetch(url);
      const data = await resp.json();
      patchKnownGames(data); // Patch after loading
      await saveToStorage(key, data);
      await saveToStorage('betfred_scanned', true);
    } catch (e) { }
  } else {
    patchKnownGames(existing); // Patch if already loaded
    await saveToStorage(key, existing);
  }
}

// Add data validation function
function validateStorageData(data, type) {
  // Allow null/undefined for some keys
  if (data === null || data === undefined) {
    return ['betfred_open_options_after_reload', 'betfred_scanned', 'betfred_hide_stats', 
            'betfred_display_rtp', 'betfred_hide_minstake', 'betfred_compact_mode', 
            'betfred_open_current_tab', 'betfred_last_filter', 'betfred_last_provider',
            'betfred_min_stakes'].includes(type);
  }
  
  switch (type) {
    case 'scan_data':
      return typeof data === 'object' && !Array.isArray(data);
    case 'favorites':
      return typeof data === 'object' && !Array.isArray(data);
    case 'user_stats':
      return typeof data === 'object' && !Array.isArray(data);
    case 'permanently_removed':
      return typeof data === 'object' && !Array.isArray(data);
    case 'betfred_open_options_after_reload':
    case 'betfred_scanned':
    case 'betfred_hide_stats':
    case 'betfred_display_rtp':
    case 'betfred_hide_minstake':
    case 'betfred_compact_mode':
    case 'betfred_open_current_tab':
    case 'betfred_last_filter':
    case 'betfred_last_provider':
      return typeof data === 'boolean' || typeof data === 'string' || typeof data === 'number';
    case 'betfred_min_stakes':
      return Array.isArray(data) || typeof data === 'string' || typeof data === 'number';
    default:
      return true;
  }
}

// Add storage quota check
async function checkStorageQuota() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usagePercent = (estimate.usage / estimate.quota) * 100;
      if (usagePercent > 80) {
        console.warn('Storage usage is high:', usagePercent.toFixed(1) + '%');
        return false;
      }
    }
    return true;
  } catch (error) {
    console.warn('Could not check storage quota:', error);
    return true; // Assume OK if we can't check
  }
} 