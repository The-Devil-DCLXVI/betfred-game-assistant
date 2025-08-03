// content.js
// This file is now a module. Main entry logic has moved to main.js.
import { showToast, createOptionsPanel, showBulkKeywordPopup, insertOptionsButton, toggleOptionsPanel, populateOptionsPanel, updateGameDropdown, cleanRtp, getActiveFilter, updateRandomButtonLabel, getRandomButtonLabel, updateProviderDropdown, observeHeaderForOptionsButton, attachFilterButtonHandlers } from './ui.js';
import { normalizeProvider, waitForElement, isGameFavoritedFromTile, getGamePathFromTile } from './utils.js';
import { saveToStorage, loadFromStorage, getFavorites, saveFavorites } from './storage.js';
// Expose storage helpers for debugging and observer access
window.loadFromStorage = async (...args) => await loadFromStorage(...args);
window.saveToStorage = async (...args) => await saveToStorage(...args);
import { isChristmasGame, isHalloweenGame, isEasterGame, isRomanceGame, isSportGame, isFishingGame, tvAndMovieSlots, isTVAndMovie, isMegawaysGame } from './filters.js';

// Browser compatibility setup
if (typeof browser === "undefined") var browser = chrome;
// Betfred extension content script loaded
if (/^\/(games|casino|vegas)\/play\//.test(location.pathname)) {
  window.addEventListener("beforeunload", function () {
    // beforeunload fired
    (typeof browser !== 'undefined' ? browser : chrome).storage.local.get({ betfred_game_closed: [] }, data => {
      const arr = Array.isArray(data.betfred_game_closed) ? data.betfred_game_closed : [];
      arr.push(location.pathname);
      (typeof browser !== 'undefined' ? browser : chrome).storage.local.set({ betfred_game_closed: arr }, () => {
        // Updated betfred_game_closed array
      });
    });
  });
}

function getActiveFilter() {
  const activeBtn = document.querySelector('.betfred-filter-btn.active');
  if (!activeBtn) return null;
  switch (activeBtn.id) {
    case 'betfred-fav-filter-toggle': return 'fav';
    case 'betfred-xmas-toggle': return 'xmas';
            case 'betfred-halloween-toggle': return 'halloween';
        case 'betfred-easter-toggle': return 'easter';
        case 'betfred-romance-toggle': return 'romance';
    case 'betfred-sport-toggle': return 'sport';
    case 'betfred-bigbass-toggle': return 'bigbass';
          case 'betfred-tvandmovie-toggle': return 'tvandmovie';
    default: return null;
  }
}

function getRandomButtonLabel() {
  let label = "Random Game";
  const activeFilter = getActiveFilter();
  if (activeFilter) {
    label = "Random ";
    switch (activeFilter) {
      case 'fav': label += "Favorite "; break;
      case 'xmas': label += "Xmas "; break;
      case 'halloween': label += "Halloween "; break;
      case 'easter': label += "Easter "; break;
      case 'romance': label += "Romance "; break;
      case 'sport': label += "Sport "; break;
              case 'bigbass': label += "Fishing "; break;
              case 'tvandmovie': label += "TV & Movie "; break;
    }
    label += "Game";
  }
  return label;
}

function updateRandomButtonLabel() {
  const labelSpan = document.getElementById('betfred-random-btn-label');
  if (labelSpan) labelSpan.textContent = getRandomButtonLabel();
}

// --- Favorite Button Click Handler ---
document.body.addEventListener('click', function(e) {
  
  // Try to find the favorite button (lobby or game page)
  let btn = e.target.closest('button[data-actionable$="saveGame"], button[data-actionable^="GamePlayPage.SideBar.Save"]');
  if (!btn) {

    return;
  }
  // Find the tile or container
  let tileDiv = btn.closest('div._1q2obv') || btn.closest('div._1b33n15l') || btn.parentElement;
  if (!tileDiv) {

    return;
  }
  // Get the game path
  let path = getGamePathFromTile(tileDiv);
  
  if (!path) {
    
    return;
  }
  // Check favorite state after a short delay (to let UI update)
  setTimeout(async () => {
    const isFav = isGameFavoritedFromTile(tileDiv);

    let favorites = await loadFromStorage('betfred_favorites', {});
    const wasFav = !!favorites[path];
    let scanData = await loadFromStorage('betfred_scan_data', {});
    const gameTitle = scanData[path]?.title || 'Game';
    
    if (isFav && !wasFav) {
      favorites[path] = true;
      await saveToStorage('betfred_favorites', favorites);
      
      showToast(`Added "${gameTitle}" to favorites ⭐`);
    } else if (!isFav && wasFav) {
      delete favorites[path];
      await saveToStorage('betfred_favorites', favorites);
      
      showToast(`Removed "${gameTitle}" from favorites ☆`);
    } else {
      // No toast if state didn't change
      await saveToStorage('betfred_favorites', favorites);
      
    }
  }, 200);
});

// --- Silent Sync Betfred's favorite button with extension's favorites database ---
function silentSyncFavorites() {
  // Scan all favorite buttons (lobby and game page)
  document.querySelectorAll('button[data-actionable$="saveGame"], button[data-actionable^="GamePlayPage.SideBar.Save"]').forEach(async btn => {
    let tileDiv = btn.closest('div._1q2obv') || btn.closest('div._1b33n15l') || btn.parentElement;
    if (!tileDiv) {

      return;
    }
    let path = getGamePathFromTile(tileDiv);
    if (!path) {

      return;
    }
    const isFav = isGameFavoritedFromTile(tileDiv);
    let favorites = await loadFromStorage('betfred_favorites', {});
    if (isFav && !favorites[path]) {
      favorites[path] = true;
      await saveToStorage('betfred_favorites', favorites);
      
      // No toast for silent sync
    } else if (!isFav && favorites[path]) {
      delete favorites[path];
      await saveToStorage('betfred_favorites', favorites);
      
    }
  });
}

// Initial silent sync on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', silentSyncFavorites);
} else {
  silentSyncFavorites();
}
// Also run silent sync on DOM changes (SPA navigation, etc.)
const domObserver = new MutationObserver(() => silentSyncFavorites());
domObserver.observe(document.body, { childList: true, subtree: true });

// --- Sync Betfred's favorite button with extension's favorites database ---
function syncFavoritesWithBetfred() {
  // Setting up Betfred favorite sync observer...
  // Observe all favorite buttons
  const observer = new MutationObserver(async (mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        // Mutation detected
        const btn = mutation.target.closest('button._zodro0');
        if (!btn) continue;

        // Find the game path
        const tileDiv = btn.closest('div._1q2obv');
        if (!tileDiv) continue;
        const a = tileDiv.querySelector('a[href^="/games/play/"], a[href^="/casino/play/"], a[href^="/vegas/play/"]');
        const path = a ? a.getAttribute('href') : null;
        if (!path) continue;

        // Detect favorite state
        const favSpan = btn.querySelector('span');
        let isFav = false;
        if (favSpan) {
          if (favSpan.classList.contains('_1fssr0') || favSpan.classList.contains('_12bsrefl')) isFav = true;
        }
        // Favorite state updated

        // Update storage using window helpers
        let favorites = await window.loadFromStorage('betfred_favorites', {});
        if (isFav) {
          favorites[path] = true;
        } else {
          delete favorites[path];
        }
        await window.saveToStorage('betfred_favorites', favorites);
        // Favorites updated
      }
    }
  });

  // Attach observer to all favorite buttons
  function observeAllButtons() {
    // Attaching observer to favorite buttons...
    document.querySelectorAll('button._zodro0').forEach(btn => {
      const favSpan = btn.querySelector('span');
      if (favSpan) {
        observer.observe(favSpan, { attributes: true, attributeFilter: ['class'] });
        // Observer attached to favorite button
      }
    });
  }

  // Initial scan to sync all favorite button states on page load
  async function initialSyncFavorites() {
    let favorites = await window.loadFromStorage('betfred_favorites', {});
    document.querySelectorAll('button._zodro0').forEach(btn => {
      const tileDiv = btn.closest('div._1q2obv');
      if (!tileDiv) return;
      const a = tileDiv.querySelector('a[href^="/games/play/"], a[href^="/casino/play/"], a[href^="/vegas/play/"]');
      const path = a ? a.getAttribute('href') : null;
      if (!path) return;
      const favSpan = btn.querySelector('span');
      let isFav = false;
      if (favSpan) {
        if (favSpan.classList.contains('_1fssr0') || favSpan.classList.contains('_12bsrefl')) isFav = true;
      }
      if (isFav) {
        favorites[path] = true;
      } else {
        delete favorites[path];
      }
    });
    await window.saveToStorage('betfred_favorites', favorites);
    // Initial favorites sync complete
  }

  // Initial attach
  observeAllButtons();
  initialSyncFavorites();

  // Re-attach on DOM changes (e.g., SPA navigation)
  const domObserver = new MutationObserver(observeAllButtons);
  domObserver.observe(document.body, { childList: true, subtree: true });
}

// Call this after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', syncFavoritesWithBetfred);
} else {
  syncFavoritesWithBetfred();
}