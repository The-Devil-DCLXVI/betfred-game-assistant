// main.js
// Main entry point for Betfred extension

import { loadDefaultDatabaseIfNeeded, loadFromStorage, saveToStorage } from './storage.js';
import { createOptionsPanel, insertOptionsButton, toggleOptionsPanel } from './ui.js';
import { isUserLoggedIn } from './utils.js';
import { showToast } from './ui.js';
import { isGameFavoritedFromTile, getGamePathFromTile } from './utils.js';

// --- First Install Setup Modal ---
import starterDatabase from '../betfred_scan_data.json';
import exclusionPaths from '../exclusion-paths.json';

// Remove EXCLUDE_KEYWORD_MAP and EXCLUDE_TITLES

async function showFirstInstallSetup() {
  const setupComplete = await loadFromStorage('betfred_setup_complete', false);
  if (setupComplete) return;
  
  // Create professional modal
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.style.zIndex = '2147483647';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
  overlay.style.backdropFilter = 'blur(4px)';
  
  const modal = document.createElement('div');
  modal.className = 'betfred-setup-modal';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 2px solid #ffd700;
    border-radius: 20px;
    padding: 40px;
    max-width: 600px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    text-align: center;
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Add CSS styles
  const style = document.createElement('style');
  style.textContent = `
    .betfred-setup-option {
      background: linear-gradient(135deg, #2a2a4e 0%, #1e2a4a 100%);
      border: 2px solid #3a3a6e;
      border-radius: 15px;
      padding: 25px;
      margin: 15px 0;
      cursor: pointer;
      transition: all 0.3s ease;
      text-align: left;
    }
    .betfred-setup-option:hover {
      border-color: #ffd700;
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(255, 215, 0, 0.2);
    }
    .betfred-setup-option.selected {
      border-color: #ffd700;
      background: linear-gradient(135deg, #3a3a6e 0%, #2a4a6e 100%);
      box-shadow: 0 10px 30px rgba(255, 215, 0, 0.3);
    }
    .betfred-setup-option h4 {
      margin: 0 0 10px 0;
      color: #ffd700;
      font-size: 18px;
      font-weight: 600;
    }
    .betfred-setup-option p {
      margin: 0 0 15px 0;
      color: #cccccc;
      font-size: 14px;
      line-height: 1.5;
    }
    .betfred-setup-stats {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #888888;
    }
    .betfred-setup-btn {
      background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%);
      color: #1a1a2e;
      border: none;
      border-radius: 25px;
      padding: 15px 40px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      margin-top: 20px;
      box-shadow: 0 5px 15px rgba(255, 215, 0, 0.3);
    }
    .betfred-setup-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(255, 215, 0, 0.4);
    }
    .betfred-setup-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
  `;
  document.head.appendChild(style);
  
  // Calculate stats - use the same filtering logic as the game dropdown
  const rawTotalGames = Object.keys(starterDatabase).length;
  const excludedPaths = Object.values(exclusionPaths).flat();
  // Only count excluded paths that actually exist in the starter database
  const actualExcludedPaths = excludedPaths.filter(path => starterDatabase[path]);
  
  // Apply the same duplicate title filtering that the dropdown uses
  const seenTitles = new Set();
  const uniqueCompleteGames = [];
  const uniqueSlotsGames = [];
  
  // Count unique games for Complete Database
  Object.entries(starterDatabase).forEach(([path, data]) => {
    const normalizedTitle = (data.title || "").trim().toLowerCase();
    if (!seenTitles.has(normalizedTitle)) {
      seenTitles.add(normalizedTitle);
      uniqueCompleteGames.push([path, data]);
    }
  });
  
  // Count unique games for Slots Only
  seenTitles.clear();
  Object.entries(starterDatabase).forEach(([path, data]) => {
    if (!actualExcludedPaths.includes(path)) {
      const normalizedTitle = (data.title || "").trim().toLowerCase();
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle);
        uniqueSlotsGames.push([path, data]);
      }
    }
  });
  
  const totalGames = uniqueCompleteGames.length;
  const slotsOnlyGames = uniqueSlotsGames.length;
  
  modal.innerHTML = `
    <div style="margin-bottom: 30px;">
      <h2 style="margin: 0 0 10px 0; color: #ffd700; font-size: 28px; font-weight: 700;">🎰 Welcome to Betfred Game Manager</h2>
      <p style="margin: 0; color: #cccccc; font-size: 16px; line-height: 1.5;">Choose your preferred game database to get started</p>
    </div>
    
    <div id="betfred-setup-full" class="betfred-setup-option">
      <h4>🎲 Complete Database</h4>
      <p>Access to all games including slots, table games, scratchcards, and more. Perfect for players who want the full Betfred experience.</p>
      <div class="betfred-setup-stats">
        <span>📊 Total Games: ${totalGames.toLocaleString()}</span>
        <span>🎯 All Categories</span>
      </div>
    </div>
    
    <div id="betfred-setup-slots" class="betfred-setup-option">
      <h4>🎰 Slots Only</h4>
      <p>Focused on slot games only. Excludes table games, scratchcards, and other non-slot games for a streamlined experience.</p>
      <div class="betfred-setup-stats">
        <span>📊 Slot Games: ${slotsOnlyGames.toLocaleString()}</span>
        <span>🎯 Slots Only</span>
      </div>
    </div>
    
    <button id="betfred-setup-continue" class="betfred-setup-btn" disabled>Continue</button>
    
    <div style="margin-top: 20px; font-size: 12px; color: #888888;">
      💡 You can always import/export your database later in the extension settings
    </div>
  `;
  
  let selectedOption = null;
  
  // Add click handlers for options
  const fullOption = modal.querySelector('#betfred-setup-full');
  const slotsOption = modal.querySelector('#betfred-setup-slots');
  const continueBtn = modal.querySelector('#betfred-setup-continue');
  
  fullOption.addEventListener('click', () => {
    fullOption.classList.add('selected');
    slotsOption.classList.remove('selected');
    selectedOption = 'full';
    continueBtn.disabled = false;
  });
  
  slotsOption.addEventListener('click', () => {
    slotsOption.classList.add('selected');
    fullOption.classList.remove('selected');
    selectedOption = 'slots';
    continueBtn.disabled = false;
  });
  
  // Continue button handler
  continueBtn.addEventListener('click', async () => {
    if (!selectedOption) return;
    
    continueBtn.disabled = true;
    continueBtn.textContent = 'Setting up...';
    
    try {
      if (selectedOption === 'full') {
        await saveToStorage('betfred_scan_data', starterDatabase);
        await saveToStorage('betfred_setup_choice', 'full');
      } else {
        // Collect all excluded paths from exclusionPaths.json
        const excludedPaths = Object.values(exclusionPaths).flat();
        const blacklist = {};
        const ignoreList = {};
        const keywordMap = {};
        
        for (const [keyword, titles] of Object.entries(exclusionPaths)) {
          for (const path of titles) {
            keywordMap[path] = keyword;
          }
        }
        
        // Filter out excluded paths from starterDatabase
        const filtered = {};
        // Only exclude paths that actually exist in the starter database
        const actualExcludedPaths = excludedPaths.filter(path => starterDatabase[path]);
        for (const [path, data] of Object.entries(starterDatabase)) {
          if (!actualExcludedPaths.includes(path)) {
            filtered[path] = data;
          } else {
            blacklist[path] = true;
            ignoreList[path] = true;
          }
        }
        
        await saveToStorage('betfred_scan_data', filtered);
        await saveToStorage('betfred_permanently_removed', blacklist);
        await saveToStorage('betfred_silent_add_ignored', ignoreList);
        await saveToStorage('betfred_excluded_keyword_map', keywordMap);
        await saveToStorage('betfred_setup_choice', 'slots');
      }
      
      await saveToStorage('betfred_setup_complete', true);
      await saveToStorage('betfred_open_options_after_reload', true);
      
      // Show success message
      continueBtn.textContent = 'Setup Complete!';
      continueBtn.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
      
      setTimeout(() => {
        overlay.remove();
        style.remove();
        location.reload();
      }, 1000);
      
    } catch (error) {
      continueBtn.textContent = 'Error - Try Again';
      continueBtn.style.background = 'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)';
      continueBtn.disabled = false;
    }
  });
  
  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      style.remove();
    }
  });
}

async function waitForDepositButtonAndShowSetup() {
  const depositBtn = await findDepositButton();
  if (depositBtn) {
    showFirstInstallSetup();
    return;
  }
  // Wait for deposit button to appear
  const observer = new MutationObserver(async () => {
    const btn = await findDepositButton();
    if (btn) {
      observer.disconnect();
      showFirstInstallSetup();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
// Call setup on load, but only when deposit button is present
waitForDepositButtonAndShowSetup();

// Remove the debug reset button code

// Apply Firefox-specific optimizations
import { applyFirefoxOptimizations } from './utils.js';
import { initializeSelectorDetection, findDepositButton, findFavoriteButtons, findGameTiles } from './selector-detector.js';


applyFirefoxOptimizations();
initializeSelectorDetection();

// main.js loaded

function syncFavoritesWithBetfred() {
  // Initial sync: detect current favorite state for all visible games
  async function initialSync() {
    const favorites = await loadFromStorage('betfred_favorites', {});
    const favoriteButtons = await findFavoriteButtons();
    const gameTiles = await findGameTiles();
    
    favoriteButtons.forEach(btn => {
      // Find the parent game tile
      let tileDiv = null;
      for (const tile of gameTiles) {
        if (tile.contains(btn)) {
          tileDiv = tile;
          break;
        }
      }
      if (!tileDiv) tileDiv = btn.parentElement;
      
      if (!tileDiv) return;
      const path = getGamePathFromTile(tileDiv);
      if (!path) return;
      const isCurrentlyFavorited = isGameFavoritedFromTile(tileDiv);
      if (isCurrentlyFavorited) {
        favorites[path] = true;
      } else {
        delete favorites[path];
      }
    });
    await saveToStorage('betfred_favorites', favorites);
  }

  // Run initial sync multiple times to catch games that load at different times
  setTimeout(initialSync, 1000);
  setTimeout(initialSync, 3000);
  setTimeout(initialSync, 5000);

  if (document.readyState === 'complete') {
    setTimeout(initialSync, 500);
  }

  // Silent sync function
  async function silentSync() {
    const favorites = await loadFromStorage('betfred_favorites', {});
    const favoriteButtons = await findFavoriteButtons();
    const gameTiles = await findGameTiles();
    
    favoriteButtons.forEach(btn => {
      // Find the parent game tile
      let tileDiv = null;
      for (const tile of gameTiles) {
        if (tile.contains(btn)) {
          tileDiv = tile;
          break;
        }
      }
      if (!tileDiv) tileDiv = btn.parentElement;
      
      if (!tileDiv) return;
      const path = getGamePathFromTile(tileDiv);
      if (!path) return;
      const isCurrentlyFavorited = isGameFavoritedFromTile(tileDiv);
      const isInStorage = !!favorites[path];
      if (isCurrentlyFavorited && !isInStorage) {
        favorites[path] = true;
        saveToStorage('betfred_favorites', favorites);
      }
    });
  }

  window.betfredSilentSyncInterval = setInterval(silentSync, 10000);

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(silentSync, 1000);
    }
  }, 1000);

  const silentSyncObserver = new MutationObserver(async (mutations) => {
    let shouldSync = false;
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if any favorite buttons were added
            const buttons = node.querySelectorAll && node.querySelectorAll('button');
            if (buttons.length > 0) {
              // Check if any of these buttons might be favorite buttons
              Array.from(buttons).forEach(btn => {
                const spans = btn.querySelectorAll('span');
                const hasStar = Array.from(spans).some(span => 
                  span.textContent.includes('⭐') || span.textContent.includes('☆')
                );
                if (hasStar || btn.getAttribute('data-actionable')?.includes('save')) {
                  shouldSync = true;
                }
              });
            }
          }
        });
      }
    });
    if (shouldSync) {
      setTimeout(silentSync, 500);
    }
  });
  silentSyncObserver.observe(document.body, { childList: true, subtree: true });

  // Setting up Betfred favorite sync observer...
  const observer = new MutationObserver(async (mutationsList) => {
    for (const mutation of mutationsList) {
      // Try to find the button using our selector system
      let btn = null;
      const favoriteButtons = await findFavoriteButtons();
      for (const favoriteBtn of favoriteButtons) {
        if (favoriteBtn.contains(mutation.target) || favoriteBtn === mutation.target) {
          btn = favoriteBtn;
          break;
        }
      }
      if (!btn) continue;
      
      // Find the parent game tile
      const gameTiles = await findGameTiles();
      let tileDiv = null;
      for (const tile of gameTiles) {
        if (tile.contains(btn)) {
          tileDiv = tile;
          break;
        }
      }
      if (!tileDiv) tileDiv = btn.parentElement;
      if (!tileDiv) continue;
      
      const path = getGamePathFromTile(tileDiv);
      if (!path) continue;
      let favorites = await loadFromStorage('betfred_favorites', {});
      const wasFavorited = !!favorites[path];
      setTimeout(async () => {
        const isFav = isGameFavoritedFromTile(tileDiv);
        if (isFav) {
          favorites[path] = true;
        } else {
          delete favorites[path];
        }
        await saveToStorage('betfred_favorites', favorites);
        let scanData = await loadFromStorage('betfred_scan_data', {});
        let gameTitle = scanData[path]?.title || 'Game';
        if (isFav && !wasFavorited) {
          showToast(`Added "${gameTitle}" to favorites ⭐`);
        } else if (!isFav && wasFavorited) {
          showToast(`Removed "${gameTitle}" from favorites ☆`);
        }
      }, 100);
    }
  });

  async function observeAllButtons() {
    const favoriteButtons = await findFavoriteButtons();
    favoriteButtons.forEach(btn => {
      observer.observe(btn, { attributes: true, childList: true, subtree: true });
    });
  }

  observeAllButtons();

  const domObserver = new MutationObserver(observeAllButtons);
  domObserver.observe(document.body, { childList: true, subtree: true });
}

function initializeExtension() {
  // Initializing Betfred extension UI and favorite sync...
  insertOptionsButton();
  syncFavoritesWithBetfred();
}

// After extension loads, check for the flag and open options panel if set
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await loadDefaultDatabaseIfNeeded();
    initializeExtension();
    // Check for open options flag
    const openOptions = await loadFromStorage('betfred_open_options_after_reload', false);
    if (openOptions) {
      await saveToStorage('betfred_open_options_after_reload', false);
      toggleOptionsPanel();
      const panel = document.getElementById('betfred-options-panel');
      if (panel) panel.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
  });
} else {
  (async () => {
    initializeExtension();
    // Check for open options flag
    const openOptions = await loadFromStorage('betfred_open_options_after_reload', false);
    if (openOptions) {
      await saveToStorage('betfred_open_options_after_reload', false);
      toggleOptionsPanel();
      const panel = document.getElementById('betfred-options-panel');
      if (panel) panel.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
  })();
} 

// Add cleanup function for intervals
function cleanupIntervals() {
  if (window.betfredFunFactInterval) {
    clearInterval(window.betfredFunFactInterval);
    window.betfredFunFactInterval = null;
  }
  if (window.betfredNeverPlayedInterval) {
    clearInterval(window.betfredNeverPlayedInterval);
    window.betfredNeverPlayedInterval = null;
  }
  if (window.betfredNewGamesInterval) {
    clearInterval(window.betfredNewGamesInterval);
    window.betfredNewGamesInterval = null;
  }
  if (window.betfredSilentSyncInterval) {
    clearInterval(window.betfredSilentSyncInterval);
    window.betfredSilentSyncInterval = null;
  }
  
  // Clean up smart dashboard interval
  if (typeof stopSmartDashboardUpdates === 'function') {
    stopSmartDashboardUpdates();
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanupIntervals);

// Cleanup on extension disable
if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onSuspend) {
  browser.runtime.onSuspend.addListener(cleanupIntervals);
} else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(cleanupIntervals);
}

 