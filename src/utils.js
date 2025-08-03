// utils.js
// Utility functions for Betfred extension

import { saveToStorage, loadFromStorage } from './storage.js';
import { findSidebar } from './selector-detector.js';
import { showToast } from './ui.js';

// Browser detection and compatibility utilities
export const BROWSER = {
  isFirefox: typeof browser !== 'undefined' && browser.runtime && typeof browser.runtime.getBrowserInfo === 'function',
  isChrome: typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getBrowserInfo !== 'function',
  isEdge: typeof chrome !== 'undefined' && chrome.runtime && navigator.userAgent.includes('Edg'),
  isSafari: typeof safari !== 'undefined' && safari.extension
};

// Browser-agnostic runtime API
export const runtimeAPI = BROWSER.isFirefox ? browser.runtime : (typeof chrome !== 'undefined' ? chrome.runtime : null);

// Firefox-specific optimizations
export const FIREFOX_OPTIMIZATIONS = {
  // Firefox has better performance with certain CSS properties
  useTransform3d: BROWSER.isFirefox,
  // Firefox benefits from explicit will-change hints
  useWillChange: BROWSER.isFirefox,
  // Firefox has different scrollbar behavior
  useCustomScrollbars: BROWSER.isFirefox,
  // Firefox has better performance with passive listeners
  usePassiveListeners: BROWSER.isFirefox
};

// Browser-agnostic storage API
export const storageAPI = BROWSER.isFirefox ? browser.storage : (typeof chrome !== 'undefined' ? chrome.storage : null);

// Firefox-specific performance hints
export function applyFirefoxOptimizations() {
  if (!BROWSER.isFirefox) return;
  
  // Add Firefox-specific CSS optimizations
  const firefoxStyles = document.createElement('style');
  firefoxStyles.textContent = `
    /* Firefox-specific optimizations */
    .betfred-panel, .betfred-popup, .betfred-modal {
      will-change: transform, opacity;
      transform: translateZ(0);
    }
    
    /* Firefox scrollbar optimizations */
    .betfred-select-dropdown {
      scrollbar-width: thin;
      scrollbar-color: #ffd700 #23244e;
    }
    
    /* Firefox animation optimizations */
    .betfred-btn, .betfred-filter-btn {
      will-change: transform;
    }
    
    /* Firefox backdrop-filter support */
    .betfred-overlay {
      backdrop-filter: blur(4px);
      -moz-backdrop-filter: blur(4px);
    }
  `;
  document.head.appendChild(firefoxStyles);
}

// Safe HTML sanitization function to prevent XSS
export function sanitizeHTML(str) {
  if (typeof str !== 'string') return '';
  
  // Create a temporary div to escape HTML
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Safe HTML template function for dynamic content
export function createSafeHTML(template, data) {
  return template.replace(/\${([^}]+)}/g, (match, key) => {
    const value = data[key];
    return sanitizeHTML(String(value || ''));
  });
}

// Provider name normalization
export const PROVIDER_MAP = {
  '1x2 Gaming': '1x2 Gaming', '1x2': '1x2 Gaming',
  '2by2 Gaming': '2by2 Gaming', '2by2': '2by2 Gaming',
  'Ainsworth': 'Ainsworth',
  'Amatic': 'Amatic',
  'Bally': 'Bally',
  'Barcrest': 'Barcrest',
  'Big Time Gaming': 'Big Time Gaming', 'BTG': 'Big Time Gaming',
  'Blueprint': 'Blueprint',
  'Booming Games': 'Booming Games', 'Booming': 'Booming Games',
  'Caleta': 'Caleta',
  'ELK Studios': 'ELK Studios', 'ELK': 'ELK Studios',
  'Endorphina': 'Endorphina',
  'Evolution': 'Evolution',
  'Eyecon': 'Eyecon',
  'Fantasma': 'Fantasma',
  'Gamevy': 'Gamevy',
  'Gaming Realms': 'Gaming Realms',
  'Hacksaw Gaming': 'Hacksaw Gaming', 'Hacksaw': 'Hacksaw Gaming', 
  'Habanero': 'Habanero',
  'High Limit Studio': 'High Limit Studio',
  'IGT': 'IGT',
  'Iron Dog': 'Iron Dog',
  'Just For The Win': 'Just For The Win', 'JFTW': 'Just For The Win',
  'Leap Gaming': 'Leap Gaming',
  'Lightning Box': 'Lightning Box',
  'Merkur': 'Merkur',
  'Microgaming': 'Microgaming',
  'NetEnt': 'NetEnt',
  'NextGen': 'NextGen',
  'Nolimit City': 'Nolimit City', 'Nolimit': 'Nolimit City',
  'Novomatic': 'Novomatic',
  'NYX': 'NYX',
  'Old Skool': 'Old Skool',
  'Pariplay': 'Pariplay',
  'Play\'n GO': 'Play\'n GO', 'Playn GO': 'Play\'n GO',
  'Pragmatic Play': 'Pragmatic Play', 'Pragmatic': 'Pragmatic Play',
  'Push Gaming': 'Push Gaming', 'Push': 'Push Gaming',
  'Quickspin': 'Quickspin',
  'Red Tiger': 'Red Tiger', 'RedTiger': 'Red Tiger',
  'Relax Gaming': 'Relax Gaming', 'Relax': 'Relax Gaming',
  'Scientific Games': 'Scientific Games', 'SG': 'Scientific Games',
  'Skillzz': 'Skillzz',
  'Skywind': 'Skywind',
  'Spadegaming': 'Spadegaming',
  'Spinomenal': 'Spinomenal',
  'Stakelogic': 'Stakelogic',
  'Thunderkick': 'Thunderkick',
  'Tom Horn': 'Tom Horn',
  'Triple Edge': 'Triple Edge',
  'Wazdan': 'Wazdan',
  'Yggdrasil': 'Yggdrasil',
  'Zeus Play': 'Zeus Play'
};

export function normalizeProvider(name) {
  if (!name) return 'Unknown';
  const normalized = PROVIDER_MAP[name.trim()];
  return normalized || name.trim();
}

export function waitForElement(sel, t = 5000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(sel);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(sel);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${sel} not found after ${t}ms`));
    }, t);
  });
}

// Robust favorite detection for both lobby and game page
export function isGameFavoritedFromTile(tileDiv) {
  if (!tileDiv) return false;
  // Try both lobby and game page selectors
  // Lobby: button[data-actionable$="saveGame"] > span
  // Game page: button[data-actionable^="GamePlayPage.SideBar.Save"] > span
  let favBtn = tileDiv.querySelector('button[data-actionable$="saveGame"]')
    || tileDiv.querySelector('button[data-actionable^="GamePlayPage.SideBar.Save"]');
  if (!favBtn) return false;
  let favIcon = favBtn.querySelector('span[data-actionable$="saveGame"]')
    || favBtn.querySelector('span[data-actionable^="GamePlayPage.SideBar.Save"]');
  if (!favIcon) return false;
  
  // ROBUST DETECTION: Check background image instead of class names
  const styles = window.getComputedStyle(favIcon);
  const backgroundImage = styles.backgroundImage;
  
  // Empty star: event-default.png
  // Filled star: event-active.png
  if (backgroundImage.includes('event-default.png')) {
    return false; // Not favorited
  } else if (backgroundImage.includes('event-active.png')) {
    return true; // Favorited
  }
  
  // Fallback: Check for any background image (filled stars have images, empty might not)
  return backgroundImage !== 'none' && backgroundImage !== '';
}

// Utility to extract the game path from a tile or game page
export function getGamePathFromTile(tileDiv) {
  if (!tileDiv) return null;
  // Lobby: look for <a href="/games/play/SLUG">
  let playLink = tileDiv.querySelector('a[href^="/games/play/"]');
  if (playLink) return playLink.getAttribute('href');
  // Game page: use location.pathname if matches /games/play/SLUG
  if (/^\/games\/play\//.test(window.location.pathname)) {
    return window.location.pathname;
  }
  // Fallback: try to find a button with data-actionable containing the slug
  let favBtn = tileDiv.querySelector('button[data-actionable$="saveGame"]')
    || tileDiv.querySelector('button[data-actionable^="GamePlayPage.SideBar.Save"]');
  if (favBtn) {
    let data = favBtn.getAttribute('data-actionable');
    let match = data && data.match(/(?:GameTile|Save)\.([^.]+)\.?/);
    if (match && match[1]) {
      return `/games/play/${match[1]}`;
    }
  }
  return null;
}

export function isUserLoggedIn() {
  return !document.querySelector('a[href*="login"]') && 
         !document.querySelector('a[href*="signin"]') &&
         document.querySelector('header') !== null;
}

export function idle(cb) { if (window.requestIdleCallback) requestIdleCallback(cb, { timeout: 100 }); else setTimeout(cb, 0); } 

// Fuzzy search term highlighter for dropdowns
export function highlightSearchTerm(text, term) {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text;
  return (
    text.substring(0, idx) +
    '<mark style="background: #ffe066; color: inherit; padding: 0 2px; border-radius: 2px;">' +
    text.substring(idx, idx + term.length) +
    '</mark>' +
    text.substring(idx + term.length)
  );
} 

// --- Silent Add Game to Database ---
export async function silentAddGameToDatabase({ title, provider, minStake, rtp, path }) {
  if (!title || !path) return;
  let scanData = await loadFromStorage('betfred_scan_data', {});
  let ignoreList = await loadFromStorage('betfred_silent_add_ignored', {});
  let blacklist = await loadFromStorage('betfred_permanently_removed', {});
  if (ignoreList[path] || blacklist[path]) return;
  const newFields = { title, provider, minStake, rtp };
  let added = 0, updated = 0;
  if (!scanData[path]) {
    scanData[path] = { ...newFields };
    added++;
  } else {
    // If all fields are present and non-empty, skip updating
    const existing = scanData[path];
    const isComplete = ['title', 'provider', 'minStake', 'rtp'].every(
      key => existing[key] && existing[key] !== 'unknown' && existing[key] !== ''
    );
    if (isComplete) {
      // Do not update if already complete
      return;
    }
    // Otherwise, update missing/incomplete fields
    let changed = false;
    for (const key of Object.keys(newFields)) {
      const oldVal = scanData[path][key];
      const newVal = newFields[key];
      if (oldVal !== newVal && newVal && newVal !== 'unknown' && newVal !== '') {
        scanData[path][key] = newVal;
        changed = true;
      }
    }
    if (changed) updated++;
  }
  await saveToStorage('betfred_scan_data', scanData);
  await saveToStorage('betfred_silent_add_ignored', ignoreList);
  if (typeof showToast === 'function') {
    if (added) showToast(`${title} added to database!`);
    // else if (updated) showToast(`${title} details updated!`); // Do not show toast for details updated
  }
  if (added || updated) window.dispatchEvent(new Event('betfred-db-updated'));
}

// --- Silent Add Game to Database from Current Page ---
export async function silentAddGameToDatabaseFromCurrentPage({ title, provider, minStake, rtp }) {
  // Extract slug from current path
  const match = window.location.pathname.match(/\/play\/([^/]+)/);
  const slug = match ? match[1] : null;
  let scanData = await loadFromStorage('betfred_scan_data', {});
  // Find any existing key with the same slug
  let existingPath = slug ? Object.keys(scanData).find(key => key.endsWith(`/play/${slug}`)) : null;
  let pathToUse = existingPath || window.location.pathname;
  await silentAddGameToDatabase({ title, provider, minStake, rtp, path: pathToUse });
}

// --- Parse Game Details from HTML Block ---
export function parseGameDetailsFromHTML(html) {
  // Accepts a string of HTML and extracts title, minStake, rtp, provider
  const div = document.createElement('div');
  div.innerHTML = html;
  let title = div.querySelector('h4, ._r3n3vf')?.textContent?.trim() || '';
  let minStake = '';
  let rtp = '';
  let provider = '';
  // Find all <li> elements
  const lis = Array.from(div.querySelectorAll('li'));
  for (const li of lis) {
    const txt = li.textContent;
    if (/min\s*stake|stakes/i.test(txt)) {
      minStake = txt.replace(/[^\d.,]/g, '').replace(',', '.');
    } else if (/rtp/i.test(txt)) {
      rtp = txt.match(/\d{2,4}(\.\d{1,2})?/)?.[0] || '';
    } else if (/game provider|provider/i.test(txt)) {
      provider = txt.replace(/^.*?provider\s*-\s*/i, '').trim();
    }
  }
  return { title, minStake, rtp, provider };
} 

// --- Auto Silent Add Current Game ---
export async function autoSilentAddCurrentGame() {
  // First check if we already have complete data for this game
  let scanData = await loadFromStorage('betfred_scan_data', {});
  let ignoreList = await loadFromStorage('betfred_silent_add_ignored', {});
  const currentPath = window.location.pathname;
  
  // Check if this game is already in the ignore list (learned to skip)
  if (ignoreList[currentPath]) {
    return;
  }
  
  // Check if we already have complete data for this path
  if (scanData[currentPath]) {
    const existing = scanData[currentPath];
    const isComplete = ['title', 'provider', 'minStake', 'rtp'].every(
      key => existing[key] && existing[key] !== 'unknown' && existing[key] !== ''
    );
    if (isComplete) {
      // Game already has complete data, add to ignore list so we never check again
      ignoreList[currentPath] = true;
      await saveToStorage('betfred_silent_add_ignored', ignoreList);
      return;
    }
  }
  
  // Class-agnostic extraction for future-proofing
  // Try to find the sidebar, but fallback to document if not found
  let sidebar = await findSidebar();
  if (!sidebar) sidebar = document.body;
  // Title: first heading in sidebar or page
  let title = '';
  let titleEl = sidebar.querySelector('h1, h2, h4');
  if (!titleEl) titleEl = document.querySelector('h1, h2, h4');
  if (titleEl) {
    title = titleEl.textContent.trim();
  }
  // Details: search all <li> elements for keywords
  let minStake = '', rtp = '', provider = '';
  const allLis = Array.from(document.querySelectorAll('li'));
  allLis.forEach(li => {
    const txt = li.textContent;
    if (/min\s*stake/i.test(txt) && !minStake) {
      minStake = txt.replace(/[^\d.,]/g, '').replace(',', '.');
    } else if (/rtp/i.test(txt) && !rtp) {
      rtp = txt.match(/\d{2,4}(\.\d{1,2})?/)?.[0] || '';
    } else if (/game provider|provider/i.test(txt) && !provider) {
      provider = txt.replace(/^.*?provider\s*-\s*/i, '').trim();
    }
  });
  if (!title || !provider || !minStake || !rtp) {
    if (typeof showToast === 'function') showToast('Could not extract all game details.', false);
    return;
  }
  await silentAddGameToDatabaseFromCurrentPage({ title, provider, minStake, rtp });
}