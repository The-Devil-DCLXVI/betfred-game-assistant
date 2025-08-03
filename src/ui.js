// ui.js
// --- 404 Auto-Remove Logic ---
// Detect Betfred 404 error and auto-remove game from database
if (document.body && document.body.innerText && /Oops!\s*We're sorry but we can't seem to find the page you're looking for\./i.test(document.body.innerText)) {
  // Try to extract the game path from the URL
  const pathname = window.location.pathname;
  // Only act if this is a game page
  if (/^\/(games|casino|vegas|bingo)\/play\//.test(pathname)) {
    // Remove from betfred_scan_data
    (async () => {
      let scanData = await loadFromStorage('betfred_scan_data', {});
      if (scanData[pathname]) {
        delete scanData[pathname];
        await saveToStorage('betfred_scan_data', scanData);
        // Remove from favorites if present
        let favorites = await loadFromStorage('betfred_favorites', {});
        if (favorites[pathname]) {
          delete favorites[pathname];
          await saveToStorage('betfred_favorites', favorites);
        }
        // Remove from stats if present
        let stats = await loadFromStorage('betfred_user_stats', {});
        let statsChanged = false;
        if (stats.plays && stats.plays[pathname]) {
          delete stats.plays[pathname];
          statsChanged = true;
        }
        if (stats.lastPlayed === pathname) {
          delete stats.lastPlayed;
          statsChanged = true;
        }
        if (statsChanged) {
          await saveToStorage('betfred_user_stats', stats);
        }
      // Add to permanently removed list (ignore list) to match bulk action behavior
      let permanentlyRemoved = await loadFromStorage('betfred_permanently_removed', {});
      if (!permanentlyRemoved[pathname]) {
        permanentlyRemoved[pathname] = true;
        await saveToStorage('betfred_permanently_removed', permanentlyRemoved);
      }
        // Optionally, show a toast
        if (typeof showToast === 'function') {
          showToast('Game removed from database (404 detected).');
        }
        // After all removals, reload scanData from storage to ensure UI is in sync
        let latestScanData = await loadFromStorage('betfred_scan_data', {});
        // If options panel is open, update dropdown and dashboard in place
        const optionsPanel = document.getElementById('betfred-options-panel');
        if (optionsPanel) {
          // Update provider and game dropdowns, then dashboard
          const gameSelect = document.getElementById('betfred-game-select');
          const providerSelect = document.getElementById('betfred-provider-select');
          if (providerSelect && typeof updateProviderDropdown === 'function') {
            updateProviderDropdown(latestScanData, providerSelect);
          }
          if (gameSelect && providerSelect && typeof updateGameDropdown === 'function') {
            // If the removed game is currently selected, clear the selection
            if (gameSelect.value === pathname) {
              gameSelect.value = '';
            }
            updateGameDropdown(latestScanData, gameSelect, providerSelect);
          }
          // Remove from any global cache if present
          if (window.betfred_scan_data_cache && window.betfred_scan_data_cache[pathname]) {
            delete window.betfred_scan_data_cache[pathname];
          }
          // Update dashboard cards if function exists
          if (typeof optionsPanel.updateStatsArea === 'function') {
            optionsPanel.updateStatsArea();
          } else {
            // Try to trigger dashboard update if function is in closure
            const statsArea = document.getElementById('betfred-stats-area');
            if (statsArea) {
              statsArea.innerHTML = '';
            }
            const quickStatsArea = document.getElementById('betfred-quick-stats');
            if (quickStatsArea) {
              quickStatsArea.innerHTML = '';
            }
          }
        }
      }
    })();
  }
}
// UI-related functions for Betfred extension

import { saveToStorage, loadFromStorage, getFavorites, saveFavorites, getNeverShowAgain, setNeverShowAgain } from './storage.js';
import { isChristmasGame, isHalloweenGame, isEasterGame, isRomanceGame, isSportGame, isFishingGame, isTVAndMovie, isMegawaysGame } from './filters.js';
import { normalizeProvider, waitForElement, isUserLoggedIn, sanitizeHTML, highlightSearchTerm, autoSilentAddCurrentGame } from './utils.js';
import { removeFromIgnoreList } from './storage.js';
import { findDepositButton, findHeader } from './selector-detector.js';
import starterDatabase from '../betfred_scan_data.json';

// Debounce utility to limit how often a function runs
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Custom Dropdown Functionality
function initializeCustomDropdowns() {
  const providerContainer = document.getElementById('betfred-provider-select-container');
  const gameContainer = document.getElementById('betfred-game-select-container');
  
  // Add search state for multi-character search
  let providerSearchText = '';
  let gameSearchText = '';
  let providerSearchTimeout = null;
  let gameSearchTimeout = null;
  
  if (providerContainer) {
    const providerHeader = document.getElementById('betfred-provider-select-header');
    const providerDropdown = document.getElementById('betfred-provider-select-dropdown');
    const providerValue = document.getElementById('betfred-provider-select-value');
    const providerSelect = document.getElementById('betfred-provider-select');
    
    if (!providerHeader || !providerDropdown) return;
    
    // Make header focusable and add keyboard navigation
    providerHeader.setAttribute('tabindex', '0');
    providerHeader.setAttribute('role', 'combobox');
    providerHeader.setAttribute('aria-expanded', 'false');
    providerHeader.setAttribute('aria-haspopup', 'listbox');
    providerDropdown.setAttribute('role', 'listbox');
    
    // Remove existing event listeners by cloning and replacing
    const newProviderHeader = providerHeader.cloneNode(true);
    providerHeader.parentNode.replaceChild(newProviderHeader, providerHeader);
    
    newProviderHeader.addEventListener('click', () => {
      newProviderHeader.focus(); // Ensure focus is set
      const isOpen = providerContainer.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        openDropdown(providerContainer, providerDropdown, newProviderHeader);
      }
    });
    
    newProviderHeader.addEventListener('keydown', (e) => {
      handleDropdownKeydown(e, providerContainer, providerDropdown, newProviderHeader, providerValue, providerSelect);
    });
    
    // Add a more direct keydown listener to the container as well
    providerContainer.addEventListener('keydown', (e) => {
      if (e.target === newProviderHeader || newProviderHeader.contains(e.target)) {
        handleDropdownKeydown(e, providerContainer, providerDropdown, newProviderHeader, providerValue, providerSelect);
      }
    });
    
    // Add letter navigation to header (works when closed or open)
    newProviderHeader.addEventListener('keypress', (e) => {
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        e.preventDefault();
        
        // If dropdown is closed, open it first
        if (!providerContainer.classList.contains('open')) {
          openDropdown(providerContainer, providerDropdown, newProviderHeader);
        }
        
        // Add character to search text
        providerSearchText += e.key.toLowerCase();
        
        // Clear previous timeout
        if (providerSearchTimeout) {
          clearTimeout(providerSearchTimeout);
        }
        
        // Set timeout to clear search text after 1 second
        providerSearchTimeout = setTimeout(() => {
          providerSearchText = '';
        }, 1000);
        
        // Small delay to ensure dropdown is open before searching
        setTimeout(() => {
          const options = Array.from(providerDropdown.querySelectorAll('.betfred-select-option'));
          const matchingIndex = options.findIndex(option => {
            const text = option.textContent.toLowerCase();
            return text.startsWith(providerSearchText);
          });
          
          if (matchingIndex !== -1) {
            focusOption(options, matchingIndex);
          }
          
          // Show search text in header temporarily
          if (providerSearchText.length > 0) {
            const originalText = providerValue.textContent;
            providerValue.textContent = `Searching: ${providerSearchText}...`;
            setTimeout(() => {
              providerValue.textContent = originalText;
            }, 500);
          }
        }, 10);
      }
    });
    

    
    providerDropdown.addEventListener('click', (e) => {
      if (e.target.classList.contains('betfred-select-option')) {
        selectOption(e.target, providerValue, providerSelect);
        closeAllDropdowns();
      }
    });
    
    // Add keyboard navigation for dropdown options
    providerDropdown.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('betfred-select-option')) {
        handleOptionKeydown(e, providerContainer, providerDropdown, newProviderHeader, providerValue, providerSelect);
      }
    });
  }
  
  if (gameContainer) {
    const gameHeader = document.getElementById('betfred-game-select-header');
    const gameDropdown = document.getElementById('betfred-game-select-dropdown');
    const gameValue = document.getElementById('betfred-game-select-value');
    const gameSelect = document.getElementById('betfred-game-select');
    
    if (!gameHeader || !gameDropdown) return;
    
    // Make header focusable and add keyboard navigation
    gameHeader.setAttribute('tabindex', '0');
    gameHeader.setAttribute('role', 'combobox');
    gameHeader.setAttribute('aria-expanded', 'false');
    gameHeader.setAttribute('aria-haspopup', 'listbox');
    gameDropdown.setAttribute('role', 'listbox');
    
    // Remove existing event listeners by cloning and replacing
    const newGameHeader = gameHeader.cloneNode(true);
    gameHeader.parentNode.replaceChild(newGameHeader, gameHeader);
    
    newGameHeader.addEventListener('click', () => {
      newGameHeader.focus(); // Ensure focus is set
      const isOpen = gameContainer.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        openDropdown(gameContainer, gameDropdown, newGameHeader);
      }
    });
    
    newGameHeader.addEventListener('keydown', (e) => {
      handleDropdownKeydown(e, gameContainer, gameDropdown, newGameHeader, gameValue, gameSelect);
    });
    
    // Add a more direct keydown listener to the container as well
    gameContainer.addEventListener('keydown', (e) => {
      if (e.target === newGameHeader || newGameHeader.contains(e.target)) {
        handleDropdownKeydown(e, gameContainer, gameDropdown, newGameHeader, gameValue, gameSelect);
      }
    });
    
    // Add letter navigation to header (works when closed or open)
    newGameHeader.addEventListener('keypress', (e) => {
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        e.preventDefault();
        
        // If dropdown is closed, open it first
        if (!gameContainer.classList.contains('open')) {
          openDropdown(gameContainer, gameDropdown, newGameHeader);
        }
        
        // Add character to search text
        gameSearchText += e.key.toLowerCase();
        
        // Clear previous timeout
        if (gameSearchTimeout) {
          clearTimeout(gameSearchTimeout);
        }
        
        // Set timeout to clear search text after 1 second
        gameSearchTimeout = setTimeout(() => {
          gameSearchText = '';
        }, 1000);
        
        // Small delay to ensure dropdown is open before searching
        setTimeout(() => {
          const options = Array.from(gameDropdown.querySelectorAll('.betfred-select-option'));
          const matchingIndex = options.findIndex(option => {
            const text = option.textContent.toLowerCase();
            return text.startsWith(gameSearchText);
          });
          
          if (matchingIndex !== -1) {
            focusOption(options, matchingIndex);
          }
          
          // Show search text in header temporarily
          if (gameSearchText.length > 0) {
            const originalText = gameValue.textContent;
            gameValue.textContent = `Searching: ${gameSearchText}...`;
            setTimeout(() => {
              gameValue.textContent = originalText;
            }, 500);
          }
        }, 10);
      }
    });
    

    
    gameDropdown.addEventListener('click', (e) => {
      if (e.target.classList.contains('betfred-select-option')) {
        selectOption(e.target, gameValue, gameSelect);
        closeAllDropdowns();
      }
    });
    
    // Add keyboard navigation for dropdown options
    gameDropdown.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('betfred-select-option')) {
        handleOptionKeydown(e, gameContainer, gameDropdown, newGameHeader, gameValue, gameSelect);
      }
    });
  }
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.betfred-custom-select')) {
      closeAllDropdowns();
    }
  });
  

}

function openDropdown(container, dropdown, header) {
  container.classList.add('open');
  dropdown.style.display = 'block';
  header.setAttribute('aria-expanded', 'true');
  
  // Keep focus on the header instead of moving to first option
  header.focus();
  
  // Remove tabindex from all options initially
  dropdown.querySelectorAll('.betfred-select-option').forEach(option => {
    option.removeAttribute('tabindex');
  });
}

function selectOption(option, valueElement, selectElement) {
  const value = option.dataset.value;
  const text = option.textContent;
  valueElement.textContent = text;
  
  // Ensure "Select Provider" or "Select Game" is set to empty string
  // Check both the text and the dataset value to be safe
  if (text === 'Select Provider' || text === 'Select Game' || text.startsWith('Select Game (') || 
      value === '' || value === 'Select Provider' || value === 'Select Game') {
    selectElement.value = '';
  } else {
    selectElement.value = value;
  }
  
  selectElement.dispatchEvent(new Event('change'));
  
  // Clear search text when an option is selected
  if (typeof providerSearchText !== 'undefined') providerSearchText = '';
  if (typeof gameSearchText !== 'undefined') gameSearchText = '';
  if (typeof providerSearchTimeout !== 'undefined' && providerSearchTimeout) {
    clearTimeout(providerSearchTimeout);
    providerSearchTimeout = null;
  }
  if (typeof gameSearchTimeout !== 'undefined' && gameSearchTimeout) {
    clearTimeout(gameSearchTimeout);
    gameSearchTimeout = null;
  }
}

function handleDropdownKeydown(e, container, dropdown, header, valueElement, selectElement) {
  const options = Array.from(dropdown.querySelectorAll('.betfred-select-option'));
  const currentIndex = options.findIndex(opt => opt === document.activeElement);
  
  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault();
      const isOpen = container.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        openDropdown(container, dropdown, header);
      }
      break;
      
    case 'Escape':
      e.preventDefault();
      closeAllDropdowns();
      header.focus();
      break;
      
    case 'ArrowDown':
      e.preventDefault();
      if (!container.classList.contains('open')) {
        openDropdown(container, dropdown, header);
      } else {
        // When dropdown is open and header is focused, focus first option
        if (document.activeElement === header) {
          focusOption(options, 0);
        } else {
          const nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
          focusOption(options, nextIndex);
        }
      }
      break;
      
    case 'ArrowUp':
      e.preventDefault();
      if (!container.classList.contains('open')) {
        openDropdown(container, dropdown, header);
      } else {
        // When dropdown is open and header is focused, focus last option
        if (document.activeElement === header) {
          focusOption(options, options.length - 1);
        } else {
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
          focusOption(options, prevIndex);
        }
      }
      break;
      
    case 'Home':
      e.preventDefault();
      if (container.classList.contains('open')) {
        if (document.activeElement === header) {
          focusOption(options, 0);
        } else {
          focusOption(options, 0);
        }
      }
      break;
      
    case 'End':
      e.preventDefault();
      if (container.classList.contains('open')) {
        if (document.activeElement === header) {
          focusOption(options, options.length - 1);
        } else {
          focusOption(options, options.length - 1);
        }
      }
      break;
      
    case 'Tab':
      closeAllDropdowns();
      break;
      
    default:
      // Letter navigation
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        e.preventDefault();
        const searchLetter = e.key.toLowerCase();
        const matchingIndex = options.findIndex(option => {
          const text = option.textContent.toLowerCase();
          return text.startsWith(searchLetter);
        });
        
        if (matchingIndex !== -1) {
          focusOption(options, matchingIndex);
        }
      }
      break;
  }
}

function focusOption(options, index) {
  // Remove tabindex from all options
  options.forEach(opt => opt.removeAttribute('tabindex'));
  
  // Add tabindex to focused option
  if (options[index]) {
    options[index].setAttribute('tabindex', '0');
    options[index].focus();
  }
}

function handleOptionKeydown(e, container, dropdown, header, valueElement, selectElement) {
  const options = Array.from(dropdown.querySelectorAll('.betfred-select-option'));
  const currentIndex = options.findIndex(opt => opt === e.target);
  
  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault();
      selectOption(e.target, valueElement, selectElement);
      closeAllDropdowns();
      header.focus();
      break;
      
    case 'Escape':
      e.preventDefault();
      closeAllDropdowns();
      header.focus();
      break;
      
    case 'ArrowDown':
      e.preventDefault();
      const nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
      focusOption(options, nextIndex);
      break;
      
    case 'ArrowUp':
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
      focusOption(options, prevIndex);
      break;
      
    case 'Home':
      e.preventDefault();
      focusOption(options, 0);
      break;
      
    case 'End':
      e.preventDefault();
      focusOption(options, options.length - 1);
      break;
      
    case 'Tab':
      closeAllDropdowns();
      break;
  }
}

function closeAllDropdowns() {
  const containers = document.querySelectorAll('.betfred-custom-select');
  containers.forEach(container => {
    container.classList.remove('open');
    const dropdown = container.querySelector('.betfred-select-dropdown');
    const header = container.querySelector('.betfred-select-header');
    if (dropdown) dropdown.style.display = 'none';
    if (header) header.setAttribute('aria-expanded', 'false');
    
    // Remove tabindex from all options
    const options = dropdown?.querySelectorAll('.betfred-select-option');
    options?.forEach(opt => opt.removeAttribute('tabindex'));
  });
  
  // Clear search text when dropdowns are closed
  if (typeof providerSearchText !== 'undefined') providerSearchText = '';
  if (typeof gameSearchText !== 'undefined') gameSearchText = '';
  if (typeof providerSearchTimeout !== 'undefined' && providerSearchTimeout) {
    clearTimeout(providerSearchTimeout);
    providerSearchTimeout = null;
  }
  if (typeof gameSearchTimeout !== 'undefined' && gameSearchTimeout) {
    clearTimeout(gameSearchTimeout);
    gameSearchTimeout = null;
  }
}

// Place these at the very top of the file
async function getRandomButtonLabel() {
  // --- Check for active filter first ---
  const activeFilter = await getActiveFilter();
  const filterIcons = {
    fav: '☆',
    xmas: '🎄',
    halloween: '🎃',
    easter: '🐰',
    romance: '💕',
    megaways: '🎰',
    sport: '🏅',
    bigbass: '🐟',
    tvandmovie: '🎬',
    gameshow: '📺'
  };
  
  if (activeFilter) {
    let icon = filterIcons[activeFilter] || '';
    let filterName = '';
    
    // Handle custom filters
    if (activeFilter && activeFilter.startsWith('custom_')) {
      const customFilters = await getCustomFilters();
      const customFilter = customFilters[activeFilter];
      if (customFilter) {
        icon = customFilter.icon;
        filterName = customFilter.name;
      } else {
        filterName = 'Custom';
      }
    } else {
      // Handle built-in filters
      switch (activeFilter) {
        case 'fav': filterName = 'Favorite'; break;
        case 'xmas': filterName = 'Xmas'; break;
        case 'halloween': filterName = 'Halloween'; break;
        case 'easter': filterName = 'Easter'; break;
        case 'romance': filterName = 'Romance'; break;
        case 'megaways': filterName = 'Megaways'; break;
        case 'sport': filterName = 'Sport'; break;
        case 'bigbass': filterName = 'Fishing'; break;
        case 'tvandmovie': filterName = 'TV & Movie'; break;
        default: filterName = activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1);
      }
    }
    // If a game is selected, show themed label with game title
    const gameSelect = document.getElementById('betfred-game-select');
    if (gameSelect && gameSelect.value) {
      const selectedOption = gameSelect.options[gameSelect.selectedIndex];
      if (selectedOption && selectedOption.value) {
        let title = selectedOption.textContent.replace(/\s*\([^)]*\)$/, '').trim();
        return icon + ' ' + title + ' ' + icon;
      }
    }
    return icon + ' Random ' + filterName + ' Game ' + icon;
  }
  // --- Check for selected game ---
  const gameSelect = document.getElementById('betfred-game-select');
  if (gameSelect && gameSelect.value) {
    const selectedOption = gameSelect.options[gameSelect.selectedIndex];
    if (selectedOption && selectedOption.value) {
      // Remove any RTP or extra info from the label
      let title = selectedOption.textContent.replace(/\s*\([^)]*\)$/, '').trim();
      return '▶️ Play ' + title;
    }
  }
  // --- Check for selected provider ---
  const providerSelect = document.getElementById('betfred-provider-select');
          if (providerSelect && providerSelect.value && providerSelect.value !== '') {
    return '🎲 Random ' + providerSelect.value + ' Game 🎲';
  }
  // --- Default label ---
  return '🎲 Random Game 🎲';
}

async function updateRandomButtonLabel() {
  const labelSpan = document.getElementById('betfred-random-btn-label');
  const label = await getRandomButtonLabel();
  if (labelSpan) labelSpan.innerHTML = label;
  // Also update floating random button if it exists
  const floatingBtn = document.getElementById('betfred-floating-random-btn');
  if (floatingBtn) {
    floatingBtn.innerHTML = label;
    // Update aria-label as well
    floatingBtn.setAttribute('aria-label', `Launch ${label.toLowerCase()}`);
  }
}

export function showToast(message, isSuccess = true) {
  // Remove any existing toast
  const existingToast = document.querySelector('.betfred-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `betfred-toast ${isSuccess ? 'success' : 'error'}`;
  toast.textContent = message;
  toast.style.zIndex = '2147483647'; // Force on top of everything
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-label', message);

  document.body.appendChild(toast);

  // Add success animation class for better visual feedback
  if (isSuccess) {
    toast.classList.add('betfred-success');
  }

  // Enhanced exit animation
  setTimeout(() => {
    toast.style.animation = 'betfred-toast-slide-in 0.3s ease-in reverse';
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 2400);
}

// Function to announce changes to screen readers
export function announceToScreenReader(message) {
  const announcement = document.createElement('div');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'betfred-sr-only';
  announcement.textContent = message;
  document.body.appendChild(announcement);
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}


export async function observeHeaderForOptionsButton() {
  waitForElement('div._1h96qia').then(async () => {
    const h = await findHeader() || document.body;
    if (!h) return;
    const o = new MutationObserver(async () => { 
      if (!document.querySelector('button[data-betfred-options]')) {
        await insertOptionsButton();
      }
    });
    o.observe(h, { childList: true, subtree: true });
  });
}

export function attachFilterButtonHandlers() {
  document.querySelectorAll('.betfred-filter-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      let currentFilter = null;
      
      if (this.classList.contains('active')) {
        this.classList.remove('active');
        currentFilter = null; // No filter selected
      } else {
        document.querySelectorAll('.betfred-filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        // Determine which filter was activated
        switch (this.id) {
          case 'betfred-fav-filter-toggle': currentFilter = 'fav'; break;
          case 'betfred-xmas-toggle': currentFilter = 'xmas'; break;
                  case 'betfred-halloween-toggle': currentFilter = 'halloween'; break;
        case 'betfred-easter-toggle': currentFilter = 'easter'; break;
        case 'betfred-romance-toggle': currentFilter = 'romance'; break;
          case 'betfred-megaways-toggle': currentFilter = 'megaways'; break;
          case 'betfred-sport-toggle': currentFilter = 'sport'; break;
          case 'betfred-bigbass-toggle': currentFilter = 'bigbass'; break;
          case 'betfred-tvandmovie-toggle': currentFilter = 'tvandmovie'; break;
        }
      }
      
      // Save current filter state to storage
      await saveToStorage('betfred_last_filter', currentFilter);
      
      // Load data and update dropdowns
      const scanData = await loadFromStorage('betfred_scan_data', {});
      const gameSelect = document.getElementById('betfred-game-select');
      const providerSelect = document.getElementById('betfred-provider-select');
      if (gameSelect && providerSelect) {
        await updateGameDropdown(scanData, gameSelect, providerSelect);
        
        // Preserve search text after filter change
        const searchInput = document.getElementById('betfred-game-search');
        if (searchInput && searchInput.value.trim()) {
          // Trigger the search input event to re-apply the search
          const event = new Event('input', { bubbles: true });
          searchInput.dispatchEvent(event);
        }
      }
      updateRandomButtonLabel();
    });
  });
}

export async function createOptionsPanel() {
  if (document.getElementById('betfred-options-panel')) return;

  // --- Create Panel Container ---
  const p = document.createElement('div');
  p.id = 'betfred-options-panel';
  p.className = 'betfred-panel';
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-modal', 'true');
  p.setAttribute('aria-label', 'Betfred Game Options');
  p.tabIndex = 0;

  // --- Header Row ---
  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.alignItems = 'center';
  headerRow.style.justifyContent = 'center';
  headerRow.style.marginBottom = '10px';
  headerRow.style.position = 'relative';

  // YouTube Link
  const ytLink = document.createElement('a');
  ytLink.href = 'https://www.youtube.com/@PUNKslots';
  ytLink.target = '_blank';
  ytLink.rel = 'noopener noreferrer';
  ytLink.title = 'Visit PUNKslots on YouTube';
  ytLink.style.display = 'inline-block';
  ytLink.style.marginRight = '6px';
        const ytImg = document.createElement('img');
      ytImg.src = (typeof browser !== 'undefined' ? browser : chrome).runtime.getURL('youtube.png');
  ytImg.alt = 'YouTube';
  ytImg.style.display = 'block';
  ytImg.style.verticalAlign = 'middle';
  ytLink.appendChild(ytImg);

  // Header Icon (Clickable for Stats)
  const headerText = document.createElement('div');
  headerText.id = 'betfred-options-header';
  headerText.style.cursor = 'pointer';
  headerText.style.userSelect = 'none';
  headerText.style.display = 'inline-block';
  headerText.title = 'Click to view Statistics';
  headerText.style.position = 'relative';
  headerText.style.transition = 'all 0.2s ease';
  
        const headerIcon = document.createElement('img');
      headerIcon.src = (typeof browser !== 'undefined' ? browser : chrome).runtime.getURL('icon16.png');
  headerIcon.alt = 'Betfred Game Options - Click for Statistics';
  headerIcon.style.display = 'block';
  headerIcon.style.verticalAlign = 'middle';
  headerIcon.style.width = '24px';
  headerIcon.style.height = '24px';
  headerIcon.style.transition = 'transform 0.2s ease';
  headerText.appendChild(headerIcon);

  // Add hover effects
  headerText.onmouseenter = () => {
    headerText.style.transform = 'scale(1.05)';
    headerText.style.filter = 'brightness(1.1)';
  };
  
  headerText.onmouseleave = () => {
    headerText.style.transform = 'scale(1)';
    headerText.style.filter = 'brightness(1)';
  };

  // PNUK Link
  const pnukLink = document.createElement('a');
  pnukLink.href = 'https://pnuk.com/';
  pnukLink.target = '_blank';
  pnukLink.rel = 'noopener noreferrer';
  pnukLink.title = 'Visit PNUK.com';
  pnukLink.style.display = 'inline-block';
  pnukLink.style.marginLeft = '6px';
        const pnukImg = document.createElement('img');
      pnukImg.src = (typeof browser !== 'undefined' ? browser : chrome).runtime.getURL('pnuk.png');
  pnukImg.alt = 'PNUK';
  pnukImg.style.display = 'block';
  pnukImg.style.verticalAlign = 'middle';
  pnukLink.appendChild(pnukImg);

  // Settings Button (top-left)
  const settingsBtn = document.createElement('button');
  settingsBtn.id = 'betfred-settings-btn';
  settingsBtn.innerHTML = '⚙️';
  settingsBtn.style.cssText = 'position:absolute;top:-2px;left:-2px;background:none;border:none;font-size:18px;cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background 0.2s;z-index:10;';
  settingsBtn.title = 'Settings';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.setAttribute('role', 'button');
  settingsBtn.setAttribute('aria-pressed', 'false');
  settingsBtn.onmouseover = () => { settingsBtn.style.background = '#222c44'; };
  settingsBtn.onmouseout = () => { settingsBtn.style.background = 'none'; };

  // Close Button (top-right)
  const headerCloseBtn = document.createElement('button');
  headerCloseBtn.id = 'betfred-options-close';
  headerCloseBtn.className = 'betfred-header-close-btn';
  headerCloseBtn.title = 'Close options panel';
  headerCloseBtn.setAttribute('aria-label', 'Close options panel');
  headerCloseBtn.setAttribute('role', 'button');
  headerCloseBtn.innerHTML = '×';

  // Create left group for settings button
  const leftGroup = document.createElement('div');
  leftGroup.style.cssText = 'display:flex;align-items:center;justify-content:flex-start;';
  leftGroup.appendChild(settingsBtn);
  
  // Create center group for main header elements
  const centerGroup = document.createElement('div');
  centerGroup.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:center;flex:1;';
  centerGroup.appendChild(ytLink);
  centerGroup.appendChild(headerText);
  centerGroup.appendChild(pnukLink);
  
  // Create right group for close button
  const rightGroup = document.createElement('div');
  rightGroup.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;';
  rightGroup.appendChild(headerCloseBtn);
  
  // Add groups to header
  headerRow.appendChild(leftGroup);
  headerRow.appendChild(centerGroup);
  headerRow.appendChild(rightGroup);
  headerRow.style.justifyContent = 'space-between';
  p.appendChild(headerRow);

  // Create Settings Panel (attached to options panel)
  const settingsPanel = document.createElement('div');
  settingsPanel.id = 'betfred-settings-panel';
  settingsPanel.className = 'betfred-panel';
  settingsPanel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);max-width:600px;width:90%;max-height:80vh;overflow-y:auto;z-index:2147483648;display:none;transition:opacity 0.3s ease-out;';
  
  const settingsHeader = document.createElement('div');
  settingsHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #ffd700;';
  
  const settingsTitle = document.createElement('h2');
  settingsTitle.className = 'betfred-section-title';
  settingsTitle.textContent = '⚙️ Settings';
  settingsTitle.style.margin = '0';
  settingsTitle.style.fontSize = '20px';
  
  const settingsCloseBtn = document.createElement('button');
  settingsCloseBtn.className = 'betfred-close-btn';
  settingsCloseBtn.innerHTML = '×';
  settingsCloseBtn.title = 'Close settings';
  
  settingsHeader.appendChild(settingsTitle);
  settingsHeader.appendChild(settingsCloseBtn);
  settingsPanel.appendChild(settingsHeader);
  
  // Add all the settings content with new block styling
  settingsPanel.innerHTML += `
    <!-- Actions Section Block -->
    <div class="betfred-section-block">
      <div class="betfred-section-title">🔧 Actions</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px;">
          <button class="betfred-btn betfred-btn--success" id="betfred-import-export-btn" title="Import or Export database" aria-label="Import or Export database" style="font-size:13px;padding:8px 12px;">
          <span class="betfred-icon">📁</span>
          <span>Import/Export</span>
        </button>

          <button class="betfred-btn betfred-btn--danger" id="betfred-bulk-actions-btn" title="Bulk remove or re-add games by keyword" aria-label="Bulk actions" style="font-size:13px;padding:8px 12px;">
          <span class="betfred-icon">⚙️</span>
          <span>Bulk Actions</span>
        </button>
        <button class="betfred-btn betfred-btn--primary" id="betfred-manual-add-btn" title="Manually add a game to the database" aria-label="Manually add game" style="font-size:13px;padding:8px 12px;">
          <span class="betfred-icon">➕</span>
          <span>Add Game</span>
        </button>
        <button class="betfred-btn betfred-btn--warning" id="betfred-custom-filter-btn" title="Create custom game filters" aria-label="Custom Filters" style="font-size:13px;padding:8px 12px;">
          <span class="betfred-icon">🎯</span>
          <span>Custom Filters</span>
        </button>
        <button class="betfred-btn betfred-btn--info" id="betfred-instructions-btn" title="View instructions and help" aria-label="Instructions and Help" style="font-size:13px;padding:8px 12px;">
          <span class="betfred-icon">📖</span>
          <span>Instructions</span>
        </button>
        <button class="betfred-btn betfred-btn--stats" id="betfred-stats-btn" title="View game statistics and analytics" aria-label="Game Statistics" style="font-size:13px;padding:8px 12px;">
          <span class="betfred-icon">📊</span>
          <span>Statistics</span>
        </button>
      </div>
    </div>
    
    <!-- Preferences Section Block -->
    <div class="betfred-section-block">
      <div class="betfred-section-title">⚙️ Preferences</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
        <label style="font-size:14px;display:flex;align-items:center;gap:8px;color:#ffffff;">
          <input type="checkbox" id="betfred-open-current-tab">
          <span>Open game in current tab</span>
        </label>
        <label style="font-size:14px;display:flex;align-items:center;gap:8px;color:#ffffff;">
          <input type="checkbox" id="betfred-display-rtp-checkbox">
          <span>Display RTP in game list</span>
        </label>
        <label style="font-size:14px;display:flex;align-items:center;gap:8px;color:#ffffff;">
          <input type="checkbox" id="betfred-hide-minstake-checkbox">
          <span>Hide staking options</span>
        </label>
        <label style="font-size:14px;display:flex;align-items:center;gap:8px;color:#ffffff;">
          <input type="checkbox" id="betfred-compact-mode">
          <span>Compact mode hide headers</span>
        </label>
        <label style="font-size:14px;display:flex;align-items:center;gap:8px;color:#ffffff;">
          <input type="checkbox" id="betfred-hide-stats-checkbox">
          <span>Hide Dashboard</span>
        </label>
      </div>
      <div style="display:flex;justify-content:center;margin-top:20px;">
        <button class="betfred-btn" id="betfred-save-settings-btn" style="font-size:14px;padding:10px 24px;">
          <span class="betfred-icon">💾</span>
          <span>Save Settings</span>
        </button>
      </div>
    </div>
  `; 
  document.body.appendChild(settingsPanel);



  // --- Panel Content (HTML) ---
  p.innerHTML += `
    <div id="betfred-options-content">
      <!-- Filter Section Block -->
      <div class="betfred-section-block">
        <div class="betfred-section-title">🧮 Filter</div>
        <div style="display:flex;gap:20px;margin-bottom:10px;">
          <div style="flex:1;">
            <input type="text" id="betfred-game-search" class="betfred-input" placeholder="🔍 Search games..." autocomplete="off" autocorrect="off" autocapitalize="none" style="margin-bottom:0;">
          </div>
          <div style="flex:1;">
            <div class="betfred-custom-select" id="betfred-game-select-container">
              <div class="betfred-select-header" id="betfred-game-select-header">
                <span class="betfred-select-value" id="betfred-game-select-value">Select Game</span>
                <span class="betfred-select-arrow">▼</span>
              </div>
              <div class="betfred-select-dropdown" id="betfred-game-select-dropdown" style="display:none;">
                <div class="betfred-select-option" data-value="">Select Game</div>
              </div>
              <select id="betfred-game-select" style="display:none;"></select>
            </div>
          </div>
        </div>
        <div style="margin-bottom:10px;">
          <div class="betfred-filter-box" style="margin-bottom:8px;">
            <button id="betfred-fav-filter-toggle" class="betfred-filter-btn" title="Show My Favorites" aria-label="Favorites Filter">⭐</button>
            <button id="betfred-xmas-toggle" class="betfred-filter-btn" title="Show Christmas Themed Slots" aria-label="Christmas Filter">🎄</button>
                    <button id="betfred-halloween-toggle" class="betfred-filter-btn" title="Show Halloween Themed Slots" aria-label="Halloween Filter">🎃</button>
        <button id="betfred-easter-toggle" class="betfred-filter-btn" title="Show Easter Themed Slots" aria-label="Easter Filter">🐰</button>
        <button id="betfred-romance-toggle" class="betfred-filter-btn" title="Show Romance Themed Slots" aria-label="Romance Filter">💕</button>
            <button id="betfred-megaways-toggle" class="betfred-filter-btn" title="Show Megaways Slots" aria-label="Megaways Filter">🎰</button>
            <button id="betfred-sport-toggle" class="betfred-filter-btn" title="Show Sport Themed Slots" aria-label="Sport Filter">🏅</button>
                          <button id="betfred-bigbass-toggle" class="betfred-filter-btn" title="Show Fishing Themed Slots" aria-label="Fishing Filter">🐟</button>
            <button id="betfred-tvandmovie-toggle" class="betfred-filter-btn" title="Show TV & Movie-Themed Slots" aria-label="TV & Movie Filter">🎬</button>
    
          </div>
        </div>
        <div style="display:flex;gap:20px;margin-bottom:10px;">
          <div style="flex:1;">
            <div class="betfred-custom-select" id="betfred-provider-select-container">
              <div class="betfred-select-header" id="betfred-provider-select-header">
                <span class="betfred-select-value" id="betfred-provider-select-value">Select Provider</span>
                <span class="betfred-select-arrow">▼</span>
              </div>
              <div class="betfred-select-dropdown" id="betfred-provider-select-dropdown" style="display:none;">
                <div class="betfred-select-option" data-value="">Select Provider</div>
              </div>
              <select id="betfred-provider-select" aria-label="Provider" style="display:none;"></select>
            </div>
          </div>
          <div style="flex:1;">
            <div id="betfred-minstake-checkboxes" class="betfred-minstake-box" style="display:flex;gap:8px;flex-wrap:nowrap;align-items:center;margin-bottom:0;">
              <label><input type="checkbox" class="betfred-minstake-checkbox" value="0.10">10p</label>
              <label><input type="checkbox" class="betfred-minstake-checkbox" value="0.20">20p</label>
              <label><input type="checkbox" class="betfred-minstake-checkbox" value="0.30">30p</label>
              <label><input type="checkbox" class="betfred-minstake-checkbox" value="0.40">40p</label>
              <label><input type="checkbox" class="betfred-minstake-checkbox" value="0.50">50p</label>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Play Section Block -->
      <div class="betfred-section-block">
        <div class="betfred-section-title">⚡ Quick Play</div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:14px;">
          <button class="betfred-btn betfred-btn--success big" id="betfred-random-btn">
              <span class="betfred-icon">🎲</span>
              <span id="betfred-random-btn-label">Random Game</span>
            </button>
          </div>
      </div>

      <!-- Dashboard Section Block -->
      <div class="betfred-section-block">
        <div class="betfred-section-title">📊 Dashboard</div>
        <div id="betfred-stats-area" style="margin-bottom:12px;"></div>
        <div id="betfred-quick-stats" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;"></div>
      </div>

      <input type="file" id="betfred-import-file" accept=".json" style="display:none">
    </div>
  `;

  // --- Add Panel to DOM ---
  document.body.appendChild(p);
  attachFilterButtonHandlers();
  
  // --- Add Custom Filter Buttons ---
  await addCustomFilterButtons();

  // --- Restore saved filter after buttons are created ---
  const lastSavedFilter = await loadFromStorage('betfred_last_filter', null);

  if (lastSavedFilter) {
    setActiveFilter(lastSavedFilter);
  }

  // --- Define elements after panel is in DOM ---
  const openCurrentTabCheckbox = document.getElementById("betfred-open-current-tab");
  const displayRtpCheckbox = document.getElementById("betfred-display-rtp-checkbox");
  const hideMinStakeCheckbox = document.getElementById("betfred-hide-minstake-checkbox");
  const compactModeCheckbox = document.getElementById("betfred-compact-mode");
  const providerSelect = document.getElementById("betfred-provider-select");
  const gameSelect = document.getElementById("betfred-game-select");
  const randomBtn = document.getElementById("betfred-random-btn");
  const minStakeBox = document.getElementById("betfred-minstake-checkboxes");
  const exportBtn = document.getElementById("betfred-export-btn");
  const importBtn = document.getElementById("betfred-import-btn");
  const importFile = document.getElementById("betfred-import-file");
  const closeBtn = document.getElementById("betfred-options-close");
  const otherToggle = document.getElementById("betfred-other-toggle");
  const otherPanel = document.getElementById("betfred-other-panel");
  document.getElementById("betfred-options-panel");
  document.getElementById("betfred-bulk-remove-row");

  // --- Ensure random button label updates on dropdown change ---
  if (providerSelect) providerSelect.addEventListener("change", updateRandomButtonLabel);
  if (gameSelect) gameSelect.addEventListener("change", updateRandomButtonLabel);

  // --- Initialize Custom Dropdowns ---
  initializeCustomDropdowns();

  const scanData = await loadFromStorage("betfred_scan_data", {});
  updateProviderDropdown(scanData, providerSelect);
  await restoreSavedSettings();
        await updateGameDropdown(scanData, gameSelect, providerSelect);
  updateRandomButtonLabel();

  // --- Always set up close button event handler ---
  if (closeBtn) {
    closeBtn.onclick = () => { 
      // Save current settings before closing
      saveCurrentSettings();
      p.style.display = 'none'; 
    };
    closeBtn.onkeydown = e => { 
      if (e.key === "Escape" || e.key === "Enter") { 
        saveCurrentSettings();
        p.style.display = 'none'; 
      } 
    };
  }

  // --- Set up settings button and modal event handlers ---
  const settingsBtnEl = document.getElementById('betfred-settings-btn');
  const settingsModalEl = document.getElementById('betfred-settings-modal');
  const settingsCloseBtnEl = settingsModalEl?.querySelector('button[title="Close settings"]');
  
  if (settingsBtnEl && settingsModalEl) {
    settingsBtnEl.onclick = () => {
      settingsModalEl.style.display = 'flex';
    };
  }
  
  if (settingsCloseBtnEl) {
    settingsCloseBtnEl.onclick = () => {
      settingsModalEl.style.display = 'none';
    };
  }
  
  if (settingsModalEl) {
    settingsModalEl.onclick = (e) => {
      if (e.target === settingsModalEl) {
        settingsModalEl.style.display = 'none';
      }
    };
  }

  // --- Set up settings panel button event handlers ---
  const importExportBtn = document.getElementById('betfred-import-export-btn');
  const bulkActionsBtn = document.getElementById('betfred-bulk-actions-btn');

  if (importExportBtn) {
    importExportBtn.onclick = () => showImportExportPopup();
  }

  if (bulkActionsBtn) {
    bulkActionsBtn.onclick = () => showBulkActionsPopup();
  }

  // --- Set up custom filter button event handler ---
  const customFilterBtn = document.getElementById('betfred-custom-filter-btn');
  if (customFilterBtn) {
    customFilterBtn.onclick = async () => {
      // Show loading state
      customFilterBtn.innerHTML = '<span class="betfred-icon">⏳</span><span>Loading...</span>';
      customFilterBtn.disabled = true;
      customFilterBtn.classList.add('betfred-loading');
      
      try {
        await showCustomFilterPanel();
      } finally {
        // Restore button state
        customFilterBtn.innerHTML = '<span class="betfred-icon">🎯</span><span>Custom Filters</span>';
        customFilterBtn.disabled = false;
        customFilterBtn.classList.remove('betfred-loading');
        customFilterBtn.classList.add('betfred-success');
        setTimeout(() => customFilterBtn.classList.remove('betfred-success'), 600);
      }
    };
  }

  // --- Set up instructions button event handler ---
  const instructionsBtn = document.getElementById('betfred-instructions-btn');
  if (instructionsBtn) {
    instructionsBtn.onclick = () => showInstructionsPanel();
  }

  // --- Set up stats button event handler ---
  const statsBtn = document.getElementById('betfred-stats-btn');
  if (statsBtn) {
    statsBtn.onclick = async () => {
      // Show loading state
      statsBtn.innerHTML = '<span class="betfred-icon">⏳</span><span>Loading...</span>';
      statsBtn.disabled = true;
      statsBtn.classList.add('betfred-loading');
      
      try {
        await showStatsPanel();
      } finally {
        // Restore button state
        statsBtn.innerHTML = '<span class="betfred-icon">📊</span><span>Statistics</span>';
        statsBtn.disabled = false;
        statsBtn.classList.remove('betfred-loading');
        statsBtn.classList.add('betfred-success');
        setTimeout(() => statsBtn.classList.remove('betfred-success'), 600);
      }
    };
  }

  // --- Set up header icon stats click handler ---
  const headerIconEl = document.getElementById('betfred-options-header');
  if (headerIconEl) {
    let clickTimeout;
    
    headerIconEl.onclick = async (e) => {
      // Prevent event bubbling to avoid triggering drag functionality
      e.stopPropagation();
      
      // Add visual feedback
      const icon = headerIconEl.querySelector('img');
      if (icon) {
        icon.style.transform = 'scale(0.9)';
        setTimeout(() => {
          icon.style.transform = 'scale(1)';
        }, 150);
      }
      
      // Show loading state on the header
      headerIconEl.style.opacity = '0.7';
      headerIconEl.style.pointerEvents = 'none';
      
      try {
        await showStatsPanel();
      } finally {
        // Restore header state
        headerIconEl.style.opacity = '1';
        headerIconEl.style.pointerEvents = 'auto';
      }
    };
  }

  // --- Set up save settings button event handler ---
  const saveSettingsBtn = document.getElementById('betfred-save-settings-btn');
  if (saveSettingsBtn) {
    saveSettingsBtn.onclick = async () => {
      await saveCurrentSettings();
      
      // Apply visual changes after saving
      const compactModeCheckbox = document.getElementById('betfred-compact-mode');
      if (compactModeCheckbox) {
        updateCompactMode();
      }
      
      // Apply min stake hiding setting
      const hideMinStakeCheckboxSave = document.getElementById('betfred-hide-minstake-checkbox');
      const minStakeBoxSave = document.getElementById('betfred-minstake-checkboxes');
      if (hideMinStakeCheckboxSave && minStakeBoxSave) {
        minStakeBoxSave.style.display = hideMinStakeCheckboxSave.checked ? 'none' : 'flex';
      }
      
      // Refresh game dropdown to apply RTP display setting
      const rtpCheckbox = document.getElementById('betfred-display-rtp-checkbox');
      if (rtpCheckbox) {
        const scanData = await loadFromStorage('betfred_scan_data', {});
        const gameSelect = document.getElementById('betfred-game-select');
        const providerSelect = document.getElementById('betfred-provider-select');
        if (gameSelect && providerSelect) {
          await updateGameDropdown(scanData, gameSelect, providerSelect);
        }
      }
      
      // Show specific toast messages for changed settings
      const openCurrentTabCheckbox = document.getElementById('betfred-open-current-tab');
      const displayRtpCheckbox = document.getElementById('betfred-display-rtp-checkbox');
      const hideMinStakeCheckbox = document.getElementById('betfred-hide-minstake-checkbox');
      
      if (openCurrentTabCheckbox) {
        showToast(openCurrentTabCheckbox.checked ? 'Games will open in current tab' : 'Games will open in new tab');
      }
      if (displayRtpCheckbox) {
        showToast(displayRtpCheckbox.checked ? 'RTP will be shown in game list' : 'RTP hidden in game list');
      }
      if (hideMinStakeCheckbox) {
        showToast(hideMinStakeCheckbox.checked ? 'Staking options hidden' : 'Staking options shown');
      }
      
      showToast('Settings saved successfully!', true);
      
      // Close settings panel and show options panel
      const optionsPanel = document.getElementById('betfred-options-panel');
      if (optionsPanel && settingsPanelEl2) {
        settingsPanelEl2.style.opacity = '0';
        setTimeout(async () => {
          settingsPanelEl2.style.display = 'none';
          optionsPanel.style.display = 'block';
          
          // Refresh dropdown after panel is shown to ensure RTP setting is applied
          const scanData = await loadFromStorage('betfred_scan_data', {});
          const gameSelect = document.getElementById('betfred-game-select');
          const providerSelect = document.getElementById('betfred-provider-select');
          if (gameSelect && providerSelect) {
            await updateGameDropdown(scanData, gameSelect, providerSelect);
          }
        }, 200);
      }
    };
  }

  // --- Set up manual add button event handler ---
  const manualAddBtnEl = document.getElementById('betfred-manual-add-btn');
  if (manualAddBtnEl) {
    manualAddBtnEl.onclick = function() {
      const modal = document.getElementById('betfred-manual-add-modal');
      if (!modal) return;
      // Populate provider dropdown
      loadFromStorage('betfred_scan_data', {}).then(scanData => {
        const providerSelect = modal.querySelector('#betfred-manual-add-provider');
        if (providerSelect) {
          const providers = Array.from(new Set(Object.values(scanData).map(d => d.provider))).sort((a, b) => a.localeCompare(b));
          while (providerSelect.firstChild) {
            providerSelect.removeChild(providerSelect.firstChild);
          }
          providers.forEach(provider => {
            const opt = document.createElement('option');
            opt.value = provider;
            opt.textContent = provider;
            providerSelect.appendChild(opt);
          });
        }
      });
      // Reset fields
      const titleInput = modal.querySelector('#betfred-manual-add-title');
      if (titleInput) titleInput.value = '';
      const locationCheckboxes = modal.querySelectorAll('.betfred-manual-add-location');
      if (locationCheckboxes) locationCheckboxes.forEach(cb => cb.checked = false);
      const minStakeInput = modal.querySelector('#betfred-manual-add-minstake');
      if (minStakeInput) minStakeInput.value = '';
      const rtpInput = modal.querySelector('#betfred-manual-add-rtp');
      if (rtpInput) rtpInput.value = '';
      const overlayPaste = modal.querySelector('#betfred-manual-add-overlay-paste');
      if (overlayPaste) {
        overlayPaste.value = '';
        overlayPaste.placeholder = 'Game Title\n\nMin Stake - 0.10\nLines - 20\nRTP - 96.5%\nGame Provider - Pragmatic Play';
        overlayPaste.style.color = '#e5eaf2'; // More faded
      }
      const providerSelect = modal.querySelector('#betfred-manual-add-provider');
      if (providerSelect) providerSelect.value = '';
            // Hide the options panel
      const optionsPanel = document.getElementById('betfred-options-panel');
      if (optionsPanel) optionsPanel.style.display = 'none';
      // Set dark theme attribute on modal if needed
      const theme = document.body.getAttribute('data-betfred-theme') || 'light';
      modal.setAttribute('data-betfred-theme', theme);
      modal.style.display = 'block';
    };
  }

  // --- Set up settings button event handler ---
  const settingsBtnEl2 = document.getElementById('betfred-settings-btn');
  const settingsPanelEl2 = document.getElementById('betfred-settings-panel');
  const settingsCloseBtnEl2 = settingsPanelEl2?.querySelector('button[title="Close settings"]');
  
  if (settingsBtnEl2 && settingsPanelEl2) {
    settingsBtnEl2.onclick = async () => {
      // Reset checkboxes to saved state before showing settings
      await resetSettingsToSavedState();
      
      // Hide the options panel and show settings in its place
      const optionsPanel = document.getElementById('betfred-options-panel');
      if (optionsPanel) {
        // Use the proper CSS centering that's already set up
        settingsPanelEl2.style.display = 'block';
        settingsPanelEl2.style.opacity = '0';
        
        // Small delay to ensure settings panel is positioned before transition
        setTimeout(() => {
          settingsPanelEl2.style.opacity = '1';
          optionsPanel.style.display = 'none';
        }, 10);
      }
    };
  }
  
  if (settingsCloseBtnEl2) {
    settingsCloseBtnEl2.onclick = async (e) => {
      // Prevent event bubbling to avoid triggering click-outside handler
      e.stopPropagation();
      
      // Reset all checkboxes to saved state before closing
      await resetSettingsToSavedState();
      
      // Smooth transition: fade out settings, then show options
      settingsPanelEl2.style.opacity = '0';
      setTimeout(() => {
        settingsPanelEl2.style.display = 'none';
        const optionsPanel = document.getElementById('betfred-options-panel');
        if (optionsPanel) {
          optionsPanel.style.display = 'block';
        }
      }, 300); // Match the transition duration
    };
  }
  
  // Close settings panel when clicking outside
  document.addEventListener('click', (e) => {
    if (settingsPanelEl2 && settingsPanelEl2.style.display === 'block') {
      // Don't close if clicking on settings panel, settings button, or any popup modal
      const isInSettingsPanel = settingsPanelEl2.contains(e.target);
      const isInSettingsBtn = document.getElementById('betfred-settings-btn')?.contains(e.target);
      const isInPopupModal = e.target.closest('.betfred-modal') || e.target.classList.contains('betfred-modal');
      const isCloseButton = e.target.closest('button[title="Close settings"]');
      
      if (!isInSettingsPanel && !isInSettingsBtn && !isInPopupModal && !isCloseButton) {
        // Reset all checkboxes to saved state before closing
        resetSettingsToSavedState().then(() => {
          // Smooth transition: fade out settings, then show options
          settingsPanelEl2.style.opacity = '0';
          setTimeout(() => {
            settingsPanelEl2.style.display = 'none';
            const optionsPanel = document.getElementById('betfred-options-panel');
            if (optionsPanel) {
              optionsPanel.style.display = 'block';
            }
          }, 300); // Match the transition duration
        });
      }
    }
  });

  // --- Set up header theme toggle button event handler ---
const headerThemeToggleBtnEl = document.getElementById('betfred-theme-toggle');
if (headerThemeToggleBtnEl) {
  // Load saved theme and apply
  loadFromStorage('betfred_theme', 'light').then(savedTheme => {
    document.body.setAttribute('data-betfred-theme', savedTheme);
    let icon = savedTheme === 'light' ? '☀️' : '🌙';
    headerThemeToggleBtnEl.innerHTML = icon;
    headerThemeToggleBtnEl.title = savedTheme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode';
  });

  headerThemeToggleBtnEl.onclick = function() {
    let currentTheme = document.body.getAttribute('data-betfred-theme') || 'light';
    let newTheme = currentTheme === 'light' ? 'dark' : 'light';
    // Apply to body for global styles
    document.body.setAttribute('data-betfred-theme', newTheme);
    // ALSO apply to the panel itself to ensure it updates immediately
    const panel = document.getElementById('betfred-options-panel');
    if (panel) {
      panel.setAttribute('data-betfred-theme', newTheme);
    }
    saveToStorage('betfred_theme', newTheme);
    let icon = newTheme === 'light' ? '☀️' : '🌙';
    headerThemeToggleBtnEl.innerHTML = icon;
    headerThemeToggleBtnEl.title = newTheme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode';
  };
}



  // Function to save current settings
  async function saveCurrentSettings() {
    const providerSelect = document.getElementById('betfred-provider-select');
    const minStakeCheckboxes = document.querySelectorAll('.betfred-minstake-checkbox:checked');
    const activeFilter = await getActiveFilter();
    
    // Save checkbox settings
    const openCurrentTabCheckbox = document.getElementById('betfred-open-current-tab');
    const displayRtpCheckbox = document.getElementById('betfred-display-rtp-checkbox');
    const compactModeCheckbox = document.getElementById('betfred-compact-mode');
    const hideMinStakeCheckbox = document.getElementById('betfred-hide-minstake-checkbox');
    const hideStatsCheckbox = document.getElementById('betfred-hide-stats-checkbox');
    
    if (openCurrentTabCheckbox) {
      await saveToStorage('betfred_open_current_tab', openCurrentTabCheckbox.checked);
    }
    if (displayRtpCheckbox) {
      await saveToStorage('betfred_display_rtp', displayRtpCheckbox.checked);
    }
    if (compactModeCheckbox) {
      await saveToStorage('betfred_compact_mode', compactModeCheckbox.checked);
    }
    if (hideMinStakeCheckbox) {
      await saveToStorage('betfred_hide_minstake', hideMinStakeCheckbox.checked);
    }
    if (hideStatsCheckbox) {
      await saveToStorage('betfred_hide_stats', hideStatsCheckbox.checked);
    }
    
    const settings = {
      provider: providerSelect ? providerSelect.value : '',
      minStakes: Array.from(minStakeCheckboxes).map(cb => cb.value),
      filter: activeFilter || null
    };
    
    saveToStorage('betfred_last_settings', settings);
  }

  // Function to restore saved settings
  async function restoreSavedSettings() {
    const settings = await loadFromStorage('betfred_last_settings', {});
    
    // Restore provider
    const providerSelect = document.getElementById('betfred-provider-select');
    if (providerSelect && settings.provider) {
      providerSelect.value = settings.provider;
    }
    
    // Restore min stake checkboxes
    if (settings.minStakes && settings.minStakes.length > 0) {
      document.querySelectorAll('.betfred-minstake-checkbox').forEach(cb => {
        cb.checked = settings.minStakes.includes(cb.value);
      });
    }
    
    // Restore filter buttons
    if (settings.filter) {
      document.querySelectorAll('.betfred-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.id === `betfred-${settings.filter}-toggle`) {
          btn.classList.add('active');
        }
      });
    }

    // Restore last provider selection if present
    const lastProvider = await loadFromStorage('betfred_last_provider', null);
    
    if (lastProvider && providerSelect) {
      providerSelect.value = lastProvider;
      // No need to dispatch change here, updateGameDropdown will be called later
    }
  }

  // Function to reset settings checkboxes to saved state
  async function resetSettingsToSavedState() {
    // Prevent multiple simultaneous resets
    if (window.betfred_resetting_settings) {
      return;
    }
    window.betfred_resetting_settings = true;
    
    // Reset checkboxes to their saved values from storage
    const openCurrentTabCheckbox = document.getElementById('betfred-open-current-tab');
    const displayRtpCheckbox = document.getElementById('betfred-display-rtp-checkbox');
    const compactModeCheckbox = document.getElementById('betfred-compact-mode');
    const hideMinStakeCheckbox = document.getElementById('betfred-hide-minstake-checkbox');
    const minStakeBox = document.getElementById('betfred-minstake-checkboxes');
    const hideStatsCheckbox = document.getElementById('betfred-hide-stats-checkbox');
    
    if (openCurrentTabCheckbox) {
      const savedValue = await loadFromStorage('betfred_open_current_tab', false);
      openCurrentTabCheckbox.checked = !!savedValue;
    }
    
    if (displayRtpCheckbox) {
      const savedValue = await loadFromStorage('betfred_display_rtp', false);
      displayRtpCheckbox.checked = !!savedValue;
    }
    
    if (compactModeCheckbox) {
      const savedValue = await loadFromStorage('betfred_compact_mode', false);
      compactModeCheckbox.checked = !!savedValue;
    }
    
    if (hideMinStakeCheckbox && minStakeBox) {
      const savedValue = await loadFromStorage('betfred_hide_minstake', false);
      hideMinStakeCheckbox.checked = !!savedValue;
    }
    
    if (hideStatsCheckbox) {
      const savedValue = await loadFromStorage('betfred_hide_stats', false);
      hideStatsCheckbox.checked = !!savedValue;
      // Apply the saved state to the dashboard visibility
      updateStatsVisibility(!!savedValue);
    }
    
    // Clear the reset flag
    window.betfred_resetting_settings = false;
  }



  // --- Modal for Manually Adding a Game ---
  let modal = document.getElementById('betfred-manual-add-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'betfred-manual-add-modal';
    modal.className = 'betfred-modal';
    modal.style.display = 'none';
    // Set theme on creation
    modal.setAttribute('data-betfred-theme', document.body.getAttribute('data-betfred-theme') || 'light');
    modal.innerHTML = `
      <div class="betfred-modal-content">
        <div class="betfred-modal-header">
          <span class="betfred-modal-title">Manually Add Game</span>
          <button class="betfred-close-btn" id="betfred-manual-add-close" title="Close">×</button>
        </div>
        <div class="betfred-modal-body" style="margin-top:20px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;align-items:start;">
            <div style="display:flex;flex-direction:column;">
              <label>Paste Game info below</label>
              <textarea id="betfred-manual-add-overlay-paste" placeholder="Red Zone Blitz Hold & Win&#10;Min Stake - 0.10&#10;Lines - 25&#10;RTP - 95.17%&#10;Game Provider - 1x2 Gaming" autocomplete="off" autocorrect="off" autocapitalize="none"></textarea>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <div>
                <label>Game Name</label>
                <input type="text" id="betfred-manual-add-title" style="width:100%" autocomplete="off" autocorrect="off" autocapitalize="none">
              </div>
              <div>
                <label>Game Provider</label>
                <select id="betfred-manual-add-provider" style="width:100%;"></select>
              </div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:auto auto 1fr;gap:14px;margin-bottom:20px;align-items:end;">
            <div>
              <label>Min Stake</label>
              <input type="number" id="betfred-manual-add-minstake" step="0.01" min="0" style="width:80px;" autocomplete="off" autocorrect="off" autocapitalize="none">
            </div>
            <div>
              <label>RTP (%)</label>
              <input type="number" id="betfred-manual-add-rtp" step="0.01" min="0" max="100" style="width:80px;" autocomplete="off" autocorrect="off" autocapitalize="none">
            </div>
            <div>
              <label>Game URL</label>
              <input type="text" id="betfred-manual-add-url" placeholder="Paste full Betfred game URL here" style="width:100%;" autocomplete="off" autocorrect="off" autocapitalize="none">
            </div>
          </div>
        </div>
        <div class="betfred-modal-footer">
          <button class="betfred-btn betfred-btn--primary" id="betfred-manual-add-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  // Always re-attach modal event listeners
  modal.querySelector('#betfred-manual-add-close')?.addEventListener('click', () => { 
    modal.style.display = 'none'; 
    // Just close the modal - the settings panel is already behind it
  });

  modal.querySelector('#betfred-manual-add-save')?.addEventListener('click', async function() {
    const title = modal.querySelector('#betfred-manual-add-title').value.trim();
    const provider = modal.querySelector('#betfred-manual-add-provider').value;
    const minStake = modal.querySelector('#betfred-manual-add-minstake').value;
    const rtp = modal.querySelector('#betfred-manual-add-rtp').value;
    const url = modal.querySelector('#betfred-manual-add-url').value.trim();
    // Validate URL
    const allowedPatterns = [
      '/bingo/play/',
      '/vegas/play/',
      '/games/play/',
      '/casino/play/'
    ];
    let validPath = null;
    try {
      const parsed = new URL(url);
      for (const pattern of allowedPatterns) {
        const idx = parsed.pathname.indexOf(pattern);
        if (idx !== -1) {
          validPath = parsed.pathname.substring(idx);
          break;
        }
      }
    } catch (e) {
      // Not a valid URL
    }
    if (!title || !provider || !minStake || !rtp || !url || !validPath) {
      showToast('Please fill all fields and provide a valid Betfred game URL. Allowed: /bingo/play/, /vegas/play/, /games/play/, /casino/play/');
      return;
    }
    let scanData = await loadFromStorage('betfred_scan_data', {});
    const newFields = {
      title,
      provider,
      minStake: parseFloat(minStake).toFixed(2),
      rtp: parseFloat(rtp).toFixed(2),
    };
    
    if (!scanData[validPath]) {
      // New game - add it
      scanData[validPath] = { ...newFields };
      await saveToStorage('betfred_scan_data', scanData);
      showToast(`"${title}" info added!`);
    } else {
      // Game exists - check if we can update min stake only
      const existing = scanData[validPath];
      const isComplete = ['title', 'provider', 'minStake', 'rtp'].every(
        key => existing[key] && existing[key] !== 'unknown' && existing[key] !== ''
      );
      
      if (isComplete) {
        // Game has complete data - only allow min stake updates
        const newMinStake = parseFloat(minStake).toFixed(2);
        if (existing.minStake !== newMinStake) {
          scanData[validPath].minStake = newMinStake;
          await saveToStorage('betfred_scan_data', scanData);
          showToast(`"${title}" min stake updated from ${existing.minStake} to ${newMinStake}!`);
        } else {
          showToast(`"${title}" min stake unchanged (${existing.minStake})`);
        }
      } else {
        // Game has incomplete data - allow full update
        scanData[validPath] = { ...newFields };
        await saveToStorage('betfred_scan_data', scanData);
        showToast(`"${title}" info updated!`);
      }
    }
    
    // Update game dropdown immediately after adding/updating game
    const gameSelect = document.getElementById('betfred-game-select');
    const providerSelect = document.getElementById('betfred-provider-select');
    if (gameSelect && providerSelect) {
      await updateGameDropdown(scanData, gameSelect, providerSelect);
    }
    
    // Update provider dropdown as well
    if (providerSelect) {
      await updateProviderDropdown(scanData, providerSelect);
    }
    
    // Re-initialize custom dropdowns after manual add
    initializeCustomDropdowns();
    
    // Reset and reopen modal for next add
    const manualAddBtn = document.getElementById('betfred-manual-add-btn');
    if (manualAddBtn) manualAddBtn.click();
  });

  // Auto-fill fields when pasting overlay text into the overlay box
  const overlayPaste = modal.querySelector('#betfred-manual-add-overlay-paste');
  if (overlayPaste) {
    // Faded placeholder, always show user content, and demo text disappears on focus
    overlayPaste.style.color = '#e5eaf2'; // More faded
    overlayPaste.addEventListener('focus', function() {
      overlayPaste.placeholder = '';
      overlayPaste.style.color = '#222';
    });
    overlayPaste.addEventListener('blur', function() {
      if (!overlayPaste.value) {
        overlayPaste.placeholder = 'Game Title\n\nMin Stake - 0.10\nLines - 20\nRTP - 96.5%\nGame Provider - Pragmatic Play';
        overlayPaste.style.color = '#e5eaf2'; // More faded
      }
    });
    overlayPaste.addEventListener('paste', function(e) {
      const clipboardData = e.clipboardData || window.clipboardData;
      const pasted = clipboardData.getData('text');
      if (!pasted || pasted.split('\n').length < 2) return;
      // Show pasted text in box
      setTimeout(() => { overlayPaste.value = pasted; }, 0);
      // Parse overlay format
      const lines = pasted.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!lines.length) return;
      // First line is game name
      const titleInput = modal.querySelector('#betfred-manual-add-title');
      if (titleInput) titleInput.value = lines[0];
      // Look for Min Stake, RTP, Provider
      let minStake = '', rtp = '', provider = '';
      for (const line of lines) {
        if (/^(min\s*stake|stakes)\s*[-:]/i.test(line)) {
          minStake = (line.split(/[-:]/)[1] || '').replace(/[^\d.,]/g, '').replace(',', '.').trim();
          // --- AUTO-FIX LOGIC FOR MIN STAKE ---
          // If minStake is an integer >= 2, treat as pence, not pounds
          if (minStake && !minStake.includes('.') && !minStake.startsWith('0')) {
            const intVal = parseInt(minStake, 10);
            if (!isNaN(intVal) && intVal < 200) {
              // If less than 2 pounds, treat as pence
              minStake = (intVal / 100).toFixed(2);
            }
          }
        } else if (/^rtp\s*[-:]/i.test(line)) {
          rtp = (line.split(/[-:]/)[1] || '').replace(/[^\d.,]/g, '').replace(',', '.').trim();
        } else if (/^(game\s*provider|provider)\s*[-:]/i.test(line)) {
          provider = (line.split(/[-:]/)[1] || '').trim();
        }
      }
      const minStakeInput = modal.querySelector('#betfred-manual-add-minstake');
      if (minStake && minStakeInput) minStakeInput.value = minStake;
      const rtpInput = modal.querySelector('#betfred-manual-add-rtp');
      if (rtp && rtpInput) rtpInput.value = rtp;
      if (provider) {
        const providerSelect = modal.querySelector('#betfred-manual-add-provider');
        if (providerSelect) {
          let found = false;
          for (const opt of providerSelect.options) {
            if (opt.value.toLowerCase() === provider.toLowerCase()) {
              providerSelect.value = opt.value;
              found = true;
              break;
            }
          }
          if (!found) {
            // If not found, add as custom option
            const opt = document.createElement('option');
            opt.value = provider;
            opt.textContent = provider;
            providerSelect.appendChild(opt);
            providerSelect.value = provider;
          }
        }
      }
      // Do not clear the box, let user see what they pasted
      e.preventDefault();
    });
  }

  // After panel is added to DOM, set up stats area, and update logic
    (async () => {
      // --- Stats Area ---
      async function updateStatsArea() {
        const statsArea = document.getElementById('betfred-stats-area');
      const quickStatsArea = document.getElementById('betfred-quick-stats');
      if (!statsArea || !quickStatsArea) return;
      
        const stats = await loadFromStorage('betfred_user_stats', {});
        const scanData = await loadFromStorage('betfred_scan_data', {});
      const favorites = await loadFromStorage('betfred_favorites', {});
      
      // Calculate comprehensive stats
      // Count unique games (same logic as dropdown to avoid discrepancies)
      let seenTitles = new Set();
      let uniqueGames = [];
      Object.entries(scanData).forEach(([path, data]) => {
        const normalizedTitle = (data.title || "").trim().toLowerCase();
        if (!seenTitles.has(normalizedTitle)) {
          seenTitles.add(normalizedTitle);
          uniqueGames.push([path, data]);
        }
      });
      const blacklist = await loadFromStorage('betfred_permanently_removed', {});
      uniqueGames = uniqueGames.filter(([path, data]) => !blacklist[path]);
      const totalGames = uniqueGames.length;
      const totalFavorites = Object.keys(favorites).length;
      const totalPlays = stats.plays ? Object.values(stats.plays).reduce((sum, count) => sum + count, 0) : 0;
      
      // Favorite provider (by play count)
      const favoriteProviderStats = {};
      if (stats.plays) {
        Object.entries(stats.plays).forEach(([path, count]) => {
          const gameData = scanData[path];
          if (gameData && gameData.provider) {
            const provider = gameData.provider;
            favoriteProviderStats[provider] = (favoriteProviderStats[provider] || 0) + count;
          }
        });
      }
      const favoriteProvider = Object.entries(favoriteProviderStats).sort((a, b) => b[1] - a[1])[0];
      
        // Most played game
        let mostPlayed = null, mostPlayedCount = 0;
        if (stats.plays) {
          for (const [path, count] of Object.entries(stats.plays)) {
            if (count > mostPlayedCount) {
              mostPlayed = path;
              mostPlayedCount = count;
            }
          }
        }
      
      // --- Recently Played ---
      // --- New Games Card (last 10 added, cycle) ---
      // Get last 10 games added (by insertion order in scanData)
      let newGames = Object.entries(scanData).slice(-10);
      let newGamesCount = newGames.length;
      let newGamesIndex = Math.floor(Math.random() * (newGamesCount || 1));
      let newGame = newGames[newGamesIndex];
      let newGameTitle = newGame ? newGame[1].title : '—';
      let newGamePath = newGame ? newGame[0] : null;
      
      // --- Never Played ---
      let neverPlayed = uniqueGames.filter(([path]) => !stats.plays || !stats.plays[path]);
      let neverPlayedCount = neverPlayed.length;
      // We'll cycle through never played games every minute
      let neverPlayedIndex = Math.floor(Math.random() * (neverPlayedCount || 1));
      let neverPlayedGame = neverPlayed[neverPlayedIndex];
      let neverPlayedTitle = neverPlayedGame ? neverPlayedGame[1].title : '—';
      let neverPlayedPath = neverPlayedGame ? neverPlayedGame[0] : null;
      
      // --- Fun Facts ---
      let funFacts = [];
      funFacts.push(`Don't forget to back up your database regularly.`);
      // Dynamic: random button usage
      const randomBtnCount = await loadFromStorage('betfred_random_btn_count', 0);
      funFacts.push(`You've used the random game button <b>${randomBtnCount}</b> times.`);
      // Dynamic: removals
      const removedCount = await loadFromStorage('betfred_removed_count', 0);
      if (removedCount > 0) {
        funFacts.push(`You've removed <b>${removedCount}</b> games from your database keeping it tidy!`);
      }
      // Dynamic: most played game this month
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      let monthlyPlays = {};
      if (stats.playsByMonth) {
        Object.entries(stats.playsByMonth).forEach(([path, arr]) => {
          arr.forEach(({date, count}) => {
            const d = new Date(date);
            if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
              monthlyPlays[path] = (monthlyPlays[path] || 0) + count;
            }
          });
        });
      }
      let mostPlayedMonth = null, mostPlayedMonthCount = 0;
      Object.entries(monthlyPlays).forEach(([path, count]) => {
        if (count > mostPlayedMonthCount) {
          mostPlayedMonth = path;
          mostPlayedMonthCount = count;
        }
      });
      if (mostPlayedMonth && scanData[mostPlayedMonth]) {
        funFacts.push(`Your most played game this month is: <a href="${mostPlayedMonth}" class="betfred-dashboard-link">${scanData[mostPlayedMonth].title}</a>`);
      }
      // Dynamic: new games tried this month
      let newGamesThisMonth = 0;
      if (stats.firstPlayed) {
        Object.values(stats.firstPlayed).forEach(dateStr => {
          const d = new Date(dateStr);
          if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) newGamesThisMonth++;
        });
      }
      funFacts.push(`You've tried <b>${newGamesThisMonth}</b> new games this month!`);
      
      // --- Fun fact: Days since last played ---
      let lastPlayedGame = null;
      let lastPlayedDate = null;
      if (stats.lastPlayed) {
        // stats.lastPlayed: { path: date }
        let mostRecent = null;
        let mostRecentPath = null;
        Object.entries(stats.lastPlayed).forEach(([path, dateStr]) => {
          if (!mostRecent || new Date(dateStr) > new Date(mostRecent)) {
            mostRecent = dateStr;
            mostRecentPath = path;
          }
        });
        if (mostRecent && mostRecentPath && scanData[mostRecentPath]) {
          lastPlayedGame = scanData[mostRecentPath].title;
          lastPlayedDate = mostRecent;
        }
      } else if (stats.playDates && Array.isArray(stats.playDates) && stats.playDates.length > 0) {
        // Fallback: use latest date in playDates array
        let mostRecent = stats.playDates.map(d => new Date(d)).sort((a, b) => b - a)[0];
        if (mostRecent) {
          lastPlayedDate = mostRecent.toISOString();
          // Try to find the game played on that date (optional)
        }
      }
      if (lastPlayedDate) {
        const now = new Date();
        const last = new Date(lastPlayedDate);
        const diffDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));
        if (diffDays > 30 && lastPlayedGame) {
          funFacts.push(`It's been <b>${diffDays}</b> days since you played: <b>${lastPlayedGame}</b>`);
        }
      }
      // --- Custom Fun Facts ---
      // 6. Most played game of all time
      if (mostPlayed && scanData[mostPlayed]) {
        funFacts.push(`Your all-time most played game is: <a href="${mostPlayed}" class="betfred-dashboard-link">${scanData[mostPlayed].title}</a> (<b>${mostPlayedCount}</b> plays)`);
      }
      // 11. Completion percentage
      const playedGames = totalGames - neverPlayedCount;
      const completionPercent = totalGames > 0 ? ((playedGames / totalGames) * 100).toFixed(1) : '0.0';
      funFacts.push(`You've played <b>${completionPercent}%</b> of all games in your database!`);
      // 13. Longest daily play streak
      let longestStreak = 0;
      if (stats.playStreaks && stats.playStreaks.longest) {
        longestStreak = stats.playStreaks.longest;
      } else if (stats.playDates) {
        // Fallback: calculate from playDates (array of ISO date strings)
        const dates = Array.isArray(stats.playDates) ? stats.playDates.map(d => d.split('T')[0]) : [];
        const uniqueDates = Array.from(new Set(dates)).sort();
        let streak = 1, maxStreak = 1;
        for (let i = 1; i < uniqueDates.length; i++) {
          const prev = new Date(uniqueDates[i - 1]);
          const curr = new Date(uniqueDates[i]);
          if ((curr - prev) === 86400000) {
            streak++;
            if (streak > maxStreak) maxStreak = streak;
          } else {
            streak = 1;
          }
        }
        longestStreak = maxStreak;
      }
      funFacts.push(`Your longest daily play streak is <b>${longestStreak}</b> days!`);
      // 14. Diversity (unique providers played)
      let providersPlayed = new Set();
      if (stats.plays) {
        Object.keys(stats.plays).forEach(path => {
          const game = scanData[path];
          if (game && game.provider) providersPlayed.add(game.provider);
        });
      }
      funFacts.push(`You've played games from <b>${providersPlayed.size}</b> different providers!`);
      // Provider preferences
      if (favoriteProvider && totalPlays >= 3) { // Only show after 3+ plays for meaningful stats
        const percentage = Math.round((favoriteProvider[1] / totalPlays) * 100);
        funFacts.push(`Your favorite provider is <b>${favoriteProvider[0]}</b> (${percentage}% of your plays)`);
      }
      // 16. Random game suggestion
      if (uniqueGames.length > 0) {
        const randomIndex = Math.floor(Math.random() * uniqueGames.length);
        const [randPath, randData] = uniqueGames[randomIndex];
        funFacts.push(`Feeling lucky? Try: <a href="${randPath}" class="betfred-dashboard-link">${randData.title}</a>`);
      }
      
      // Seasonal facts
      if (thisMonth === 9) { // October
        const halloweenGames = uniqueGames.filter(([_, data]) => isHalloweenGame(data.title)).length;
        funFacts.push(`Spooky season! You have <b>${halloweenGames}</b> Halloween games. 🎃`);
      }
      if (thisMonth === 11) { // December
        const xmasGames = uniqueGames.filter(([_, data]) => isChristmasGame(data.title)).length;
        funFacts.push(`Festive fun! You have <b>${xmasGames}</b> Christmas games. 🎄`);
      }
      // Romance games (always show)
      const romanceGames = uniqueGames.filter(([_, data]) => isRomanceGame(data.title)).length;
      if (romanceGames > 0) {
        funFacts.push(`Love is in the air! You have <b>${romanceGames}</b> romance games. 💕`);
      }
      funFacts.push(`You've played <b>${totalGames - neverPlayedCount}</b> out of <b>${totalGames}</b> games!`);
      funFacts.push(`You have <b>${totalFavorites}</b> favorite games!`);
      funFacts.push(`You've played games from <b>${Object.keys(favoriteProviderStats).length}</b> different providers!`);
      // Most played game (make title clickable)
      if (mostPlayed && scanData[mostPlayed]) {
        funFacts.push(`Your most played game: <a href="${mostPlayed}" class="betfred-dashboard-link">${scanData[mostPlayed].title}</a>`);
      }
      if (neverPlayedCount > 0) {
        funFacts.push(`There are <b>${neverPlayedCount}</b> games you've never tried!`);
      }
      // 3. Most recently added game
      // (Removed: Most recently added game fun fact)
      // 4. Provider with most games
      if (uniqueGames.length > 0) {
        let providerCounts = {};
        uniqueGames.forEach(([path, data]) => {
          if (data.provider) providerCounts[data.provider] = (providerCounts[data.provider] || 0) + 1;
        });
        let topProvider = Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0];
        if (topProvider) {
          funFacts.push(`Provider with most games: <b>${topProvider[0]}</b> (${topProvider[1]} games)`);
        }
      }
      // 6. Game with highest RTP
      if (uniqueGames.length > 0) {
        let maxRTP = -1, maxRTPPath = null, maxRTPTitle = null;
        let minRTP = Infinity, minRTPPath = null, minRTPTitle = null;
        let maxStake = -1;
        let maxStakeGames = [];
        uniqueGames.forEach(([path, data]) => {
          let rtp = parseFloat(data.rtp);
          let stake = parseFloat(data.minStake);
          if (!isNaN(rtp)) {
            if (rtp > maxRTP) {
              maxRTP = rtp;
              maxRTPPath = path;
              maxRTPTitle = data.title;
            }
            if (rtp < minRTP) {
              minRTP = rtp;
              minRTPPath = path;
              minRTPTitle = data.title;
            }
          }
          if (!isNaN(stake)) {
            if (stake > maxStake) {
              maxStake = stake;
              maxStakeGames = [[path, data]];
            } else if (stake === maxStake) {
              maxStakeGames.push([path, data]);
            }
          }
        });
        if (maxRTPPath && maxRTPTitle) {
          funFacts.push(`Game with highest RTP: ${maxRTP}% <a href="${maxRTPPath}" class="betfred-dashboard-link">${maxRTPTitle}</a>`);
        }
        if (minRTPPath && minRTPTitle && minRTP !== Infinity) {
          funFacts.push(`Game with lowest RTP: ${minRTP}% <a href="${minRTPPath}" class="betfred-dashboard-link">${minRTPTitle}</a>`);
        }
        // Add highest min stake fun fact (rotate if more than one)
        if (maxStakeGames.length > 0 && !isNaN(maxStake)) {
          // Use a rotating index for this fun fact
          let highestStakeIndex = window.betfredHighestStakeIndex || 0;
          const [stakePath, stakeData] = maxStakeGames[highestStakeIndex % maxStakeGames.length];
          funFacts.push(`Game with the highest min stake: <a href="${stakePath}" class="betfred-dashboard-link">${stakeData.title}</a> (£${parseFloat(maxStake).toFixed(2)})`);
          // Save for next time
          window.betfredHighestStakeIndex = (highestStakeIndex + 1) % maxStakeGames.length;
        }
      }
      // Fun fact cycling logic
      let funFactIndex = 0;
      let neverPlayedCardIndex = neverPlayedIndex;
      let newGamesCardIndex = newGamesIndex;
      function renderFunFact() {
        const funFact = funFacts[funFactIndex % funFacts.length];
        // The fun fact card is the first .betfred-stat-card
        const funFactCard = quickStatsArea.querySelectorAll('.betfred-stat-card')[0];
        if (funFactCard) {
          // The fun fact content is the first div inside the card
          const funFactContent = funFactCard.querySelector('div');
          if (funFactContent) {
            funFactContent.innerHTML = funFact;
            // Re-attach click handlers for links
            funFactContent.querySelectorAll('a.betfred-dashboard-link').forEach(link => {
              link.onclick = async function(e) {
                e.preventDefault();
                const path = this.getAttribute('href');
                const openCurrentTab = await loadFromStorage('betfred_open_current_tab', true);
                if (openCurrentTab) {
                  window.location.href = path;
                } else {
                  window.open(path, '_blank');
                }
              };
            });
          }
        }
      }

      function renderNewGamesCard() {
        const newGamesCard = quickStatsArea.querySelectorAll('.betfred-stat-card')[2];
        if (newGamesCard && newGames.length > 0) {
          newGamesCardIndex = newGamesCardIndex % newGames.length;
          const [path, data] = newGames[newGamesCardIndex];
          const link = newGamesCard.querySelector('#betfred-new-game-link');
          if (link) {
            link.textContent = data.title;
            link.href = path;
            link.onclick = async function(e) {
              e.preventDefault();
              const openCurrentTab = await loadFromStorage('betfred_open_current_tab', true);
              if (openCurrentTab) {
                window.location.href = path;
              } else {
                window.open(path, '_blank');
              }
            };
          }
        }
      }

      function renderNeverPlayedCard() {
        const neverPlayedCard = quickStatsArea.querySelectorAll('.betfred-stat-card')[1];
        if (neverPlayedCard && neverPlayed.length > 0) {
          // Cycle index
          neverPlayedCardIndex = neverPlayedCardIndex % neverPlayed.length;
          const [path, data] = neverPlayed[neverPlayedCardIndex];
          const title = data.title;
          const link = neverPlayedCard.querySelector('#betfred-never-played-link');
          if (link) {
            link.textContent = title;
            link.href = path;
            link.onclick = async function(e) {
              e.preventDefault();
              const openCurrentTab = await loadFromStorage('betfred_open_current_tab', true);
              if (openCurrentTab) {
                window.location.href = path;
              } else {
                window.open(path, '_blank');
              }
            };
          }
        }
      }
      // Add more fun facts as desired
      // Initial fun fact index is random for variety
      funFactIndex = Math.floor(Math.random() * funFacts.length);
      
      // Render quick stats dashboard (existing cards)
      quickStatsArea.innerHTML = `
        <!-- Fun Fact Card -->
        <div class="betfred-stat-card">
          <div style="font-size:14px;">${funFacts[funFactIndex % funFacts.length]}</div>
        </div>
        <!-- Never Played Card -->
        <div class="betfred-stat-card">
          <div style="font-size:15px;font-weight:bold;">
            Never Played:
          </div>
          <div style="font-size:14px;">
            <a id="betfred-never-played-link" href="${neverPlayedPath || "#"}" class="betfred-dashboard-link">${neverPlayedTitle}</a>
          </div>
        </div>
        <!-- New Games Card -->
        <div class="betfred-stat-card">
          <div style="font-size:15px;font-weight:bold;">New Game:</div>
          <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${newGamePath && newGameTitle ? `<a id="betfred-new-game-link" href="${newGamePath}" class="betfred-dashboard-link betfred-dashboard-link--no-underline">${newGameTitle}</a>` : '—'}
          </div>
        </div>
      `;
      // Start smart dashboard updates (replaces multiple intervals)
      startSmartDashboardUpdates();
      // Initial render to attach handlers
      renderFunFact();
      renderNeverPlayedCard();
      renderNewGamesCard();
      
      // Apply Firefox optimizations
      optimizeForFirefox();
      // Reapply theme to options panel and stat cards after rendering
      const panel = document.getElementById('betfred-options-panel');
      if (panel) {
        const theme = document.body.getAttribute('data-betfred-theme') || 'light';
        panel.setAttribute('data-betfred-theme', theme);
        panel.querySelectorAll('.betfred-stat-card').forEach(card => {
          card.setAttribute('data-betfred-theme', theme);
        });
      }
      // Make fun fact game links clickable (open in new tab, no underline)
      quickStatsArea.querySelectorAll('.betfred-funfact-link').forEach(link => {
        link.onclick = function(e) {
          e.preventDefault();
          window.open(this.getAttribute('href'), '_blank');
        };
      });
      // Play Again button logic (if you add a play again button, implement here)
      // Never Played link logic
      // Never Played link logic handled in renderNeverPlayedCard
  
      // ... rest of function unchanged ...
      // After this, add a click handler to #betfred-most-played-title to load the game if mostPlayed is set
      // No need for manual click handler, as <a> handles navigation
      // Add a style to make .betfred-stat-card--full span all columns
      document.head.insertAdjacentHTML('beforeend', `
        <style id="betfred-most-played-full-width-style">
          #betfred-quick-stats { display: grid; grid-template-columns: 1fr 2fr; }
          .betfred-stat-card--wide { grid-column: 2 / 3 !important; }
          .betfred-stat-card--full { grid-column: 1 / -1 !important; margin-top: 8px; }
          #betfred-most-played-title { cursor: pointer; text-decoration: none !important; }
          #betfred-never-played-link, #betfred-recently-played-link { text-decoration: none !important; }
          .betfred-dashboard-link { color: #8fa2c7; text-decoration: none; opacity: 0.7; transition: color 0.2s, opacity 0.2s, text-decoration 0.2s; }
          .betfred-dashboard-link:hover { color: #1877f2; opacity: 1; text-decoration: underline; }
          .betfred-dashboard-link--no-underline, .betfred-dashboard-link--no-underline:hover, .betfred-dashboard-link--no-underline:focus { text-decoration: none !important; }
        </style>
      `);
      
      // Clear the detailed stats area since we're using cards only
      while (statsArea.firstChild) {
        statsArea.removeChild(statsArea.firstChild);
      }
    }
          await updateStatsArea();
    })();

  // --- Checkboxes ---
  if (openCurrentTabCheckbox) {
  // Ensure default is saved to storage on first use
  loadFromStorage('betfred_open_current_tab', null).then(val => {
    if (val === null) {
      saveToStorage('betfred_open_current_tab', true);
      openCurrentTabCheckbox.checked = true;
    } else {
      openCurrentTabCheckbox.checked = !!val;
    }
  });
  openCurrentTabCheckbox.onchange = function () {
    // Don't save immediately - wait for save button
    // No toast message until saved
  };
}
  if (displayRtpCheckbox) {
    loadFromStorage('betfred_display_rtp', false).then(val => {
      displayRtpCheckbox.checked = !!val;
    });
    displayRtpCheckbox.onchange = async function () {
      // Don't save immediately - wait for save button
      // No toast message until save button is clicked
    };
  }

// --- Compact Mode ---
if (compactModeCheckbox) {
  // Restore saved state from storage
  loadFromStorage('betfred_compact_mode', false).then(val => {
    compactModeCheckbox.checked = !!val;
    // Don't apply compact mode here - only set checkbox state
  });

  // Don't save immediately - wait for save button
  compactModeCheckbox.onchange = function () {
    // Don't apply compact mode immediately - wait for save
  };
}

// --- Hide Min Stake Options ---
if (hideMinStakeCheckbox && minStakeBox) {
  // Restore saved state from storage
  loadFromStorage('betfred_hide_minstake', false).then(val => {
    hideMinStakeCheckbox.checked = !!val;
    // Don't apply min stake hiding here - only set checkbox state
  });

  // Don't save immediately - wait for save button
  hideMinStakeCheckbox.onchange = function () {
    // Don't apply min stake hiding immediately - wait for save
    // No toast message until saved
  };
}

function updateCompactMode() {
  const hide = compactModeCheckbox && compactModeCheckbox.checked;
  // Hide all section headers, not just a specific list
  document.querySelectorAll('.betfred-section-title').forEach(el => {
    el.style.display = hide ? 'none' : '';
  });
}

// --- Random Button ---
if (randomBtn) {
  // Remove dice/slot icon from Random Game button
  const diceSpan = randomBtn.querySelector('.betfred-icon');
  if (diceSpan) {
    diceSpan.innerHTML = '';
  }
  randomBtn.onclick = async function () {
    // Save current settings before using random game
    saveCurrentSettings();

    // Persist current filter and provider selection
    const providerSelect = document.getElementById('betfred-provider-select');
    const currentProvider = providerSelect ? providerSelect.value : '';
    const currentFilter = await getActiveFilter();
    await saveToStorage('betfred_last_provider', currentProvider);
    await saveToStorage('betfred_last_filter', currentFilter);

    
    // Check if a specific game is selected
    const gameSelect = document.getElementById('betfred-game-select');
    if (gameSelect && gameSelect.value) {
      // Launch the selected game
      const selectedPath = gameSelect.value;
      await trackGamePageVisit(selectedPath);
      loadFromStorage('betfred_open_current_tab', false).then(openCurrentTab => {
        if (openCurrentTab) {
          const panel = document.getElementById('betfred-options-panel');
          if (panel) panel.style.display = 'none';
          if (/^\/(games|casino|vegas)\/play\//.test(location.pathname)) {
              window.location.href = selectedPath;
          } else {
            window.location.href = selectedPath;
          }
        } else {
          window.open(selectedPath, "_blank");
        }
      });
      return;
    }
    
    // Launch a random game (original logic)
    const scanData = await loadFromStorage('betfred_scan_data', {});
    const favorites = await getFavorites();
    const neverShowAgain = await getNeverShowAgain();
    const sel = providerSelect.value;
    const activeFilter = await getActiveFilter();
    const blacklist = await loadFromStorage('betfred_permanently_removed', {});
    let seenTitles = new Set();
    let uniqueGames = [];
    Object.entries(scanData).forEach(([path, data]) => {
      const normalizedTitle = (data.title || "").trim().toLowerCase();
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle);
        uniqueGames.push([path, data]);
      }
    });
    let games = uniqueGames.filter(([path, data]) =>
      !blacklist[path] &&
      (sel === "" || data.provider === sel) &&
      (
        !activeFilter ||
        (activeFilter === 'xmas' && isChristmasGame(data.title)) ||
        (activeFilter === 'halloween' && isHalloweenGame(data.title)) ||
        (activeFilter === 'easter' && isEasterGame(data.title)) ||
        (activeFilter === 'romance' && isRomanceGame(data.title)) ||
        (activeFilter === 'megaways' && isMegawaysGame(data.title)) ||
        (activeFilter === 'sport' && isSportGame(data.title)) ||
        (activeFilter === 'bigbass' && isFishingGame(data.title)) ||
        (activeFilter === 'tvandmovie' && isTVAndMovie(data.title)) ||
        (activeFilter === 'fav' && favorites[path])
      )
    );
    
    // Apply minimum stake filter
    games = await applyMinStakeFilter(games);
    
    const filtered = games.filter(([path]) => !neverShowAgain[path]);
    if (!filtered.length) return showToast("No games match the selected filters.");
    const [randomPath, randomData] = filtered[Math.floor(Math.random() * filtered.length)];
    await trackGamePageVisit(randomPath);
    loadFromStorage('betfred_open_current_tab', false).then(openCurrentTab => {
      if (openCurrentTab) {
        const panel = document.getElementById('betfred-options-panel');
        if (panel) panel.style.display = 'none';
        if (/^\/(games|casino|vegas)\/play\//.test(location.pathname)) {
            window.location.href = randomPath;
        } else {
          window.location.href = randomPath;
        }
      } else {
        window.open(randomPath, "_blank");
      }
    });
  };
}



  // --- Attach event handlers for import/export buttons ---
  if (exportBtn) {
    exportBtn.onclick = function () {
      loadFromStorage('betfred_scan_data', {}).then(scanData => {
        // Format JSON with each entry on its own line for easier editing
        let json = JSON.stringify(scanData, null, 2);
        json = '{\n' + Object.entries(scanData).map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`).join(',\n') + '\n}';
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "betfred-games-database.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Database exported!");
      });
    };
  }

  if (importBtn && importFile) {
    importBtn.onclick = function () {
      importFile.value = "";
      importFile.click();
    };
    importFile.onchange = function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (ev) {
        try {
          const data = JSON.parse(ev.target.result);
          if (typeof data === "object" && data && Object.keys(data).length) {
            saveToStorage('betfred_scan_data', data).then(() => {
              saveToStorage('betfred_scanned', true).then(() => {
                showToast("Database imported!");
                setTimeout(() => location.reload(), 700);
              });
            });
          } else {
            showToast("Invalid or empty database file.");
          }
        } catch (e) {
          showToast("Failed to import database.");
        }
      };
      reader.readAsText(file);
    };
  }

  // --- Attach event handlers for Other settings and Dark mode buttons ---
  if (otherToggle && otherPanel) {
    otherToggle.onclick = function () {
      otherPanel.style.display = otherPanel.style.display === "none" ? "block" : "none";
    };
  }

  // --- Attach event handler for provider dropdown ---
  if (providerSelect) {
    // Remove any existing event listeners to prevent duplicates
    providerSelect.removeEventListener('change', window.betfredProviderChangeHandler);
    
    // Create a single, debounced handler for provider changes
    window.betfredProviderChangeHandler = debounce(async function() {
      // Set flag to prevent search interference
      window.betfred_provider_changing = true;
      
      // Update the custom dropdown header text immediately
      const providerValue = document.getElementById('betfred-provider-select-value');
      if (providerValue) {
        const selectedOption = providerSelect.options[providerSelect.selectedIndex];
        providerValue.textContent = selectedOption ? selectedOption.textContent : 'Select Provider';
      }
      
      // Clear search input when provider changes (but don't trigger input event)
      const searchInput = document.getElementById('betfred-game-search');
      if (searchInput) {
        searchInput.value = '';
        // Don't dispatch input event to avoid race condition
      }
      
      // Clear any existing game selection when provider changes
      const gameSelect = document.getElementById('betfred-game-select');
      if (gameSelect) {
        gameSelect.value = '';
        const gameValue = document.getElementById('betfred-game-select-value');
        if (gameValue) {
          gameValue.textContent = 'Select Game';
        }
      }
      
      // Ensure provider value is properly set (empty string for "Select Provider")
      if (providerSelect.value === 'Select Provider') {
        providerSelect.value = '';
      }
      
      // Force the provider value to be empty string if it's "Select Provider"
      // This ensures the filtering logic works correctly
      if (providerSelect.value === 'Select Provider' || providerSelect.value === undefined || providerSelect.value === null) {
        providerSelect.value = '';
      }
      
      // Load data and update game dropdown
      const scanData = await loadFromStorage('betfred_scan_data', {});
      if (gameSelect) {
        await updateGameDropdown(scanData, gameSelect, providerSelect);
      }
      updateRandomButtonLabel();
      
      // Clear flag after provider change is complete
      setTimeout(() => {
        window.betfred_provider_changing = false;
      }, 100);
    }, 50); // Small delay to prevent rapid updates
    
    providerSelect.addEventListener('change', window.betfredProviderChangeHandler);
  }

 

  // --- Attach event handler for game dropdown ---
  if (gameSelect) {
    gameSelect.addEventListener('change', function() {
      updateRandomButtonLabel();
    });
  }

  // --- Attach event handlers for min stake checkboxes ---
  document.querySelectorAll('.betfred-minstake-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async function() {
      // Save the current min stake selections to storage
      const minStakeCheckboxes = Array.from(document.querySelectorAll('.betfred-minstake-checkbox:checked'));
      const minStakes = minStakeCheckboxes.map(cb => parseFloat(cb.value));
      await saveToStorage('betfred_min_stakes', minStakes);
      
      const scanData = await loadFromStorage('betfred_scan_data', {});
      const gameSelect = document.getElementById('betfred-game-select');
      const providerSelect = document.getElementById('betfred-provider-select');
      if (gameSelect && providerSelect) {
        await updateGameDropdown(scanData, gameSelect, providerSelect);
      }
      updateRandomButtonLabel();
    });
  });

  // Handle the hide stats checkbox (now in HTML)
  const statsToggleId = 'betfred-hide-stats-checkbox';

  // Apply the hide stats setting on panel open
  const statsArea = document.getElementById('betfred-stats-area');
  const statsToggleCheckbox = document.getElementById(statsToggleId);
  // Hide the entire dashboard section (title, area, etc.)
  const dashboardSection = statsArea ? statsArea.closest('.betfred-section-block') : null;
  function updateStatsVisibility(hide) {
    if (dashboardSection) dashboardSection.style.display = hide ? 'none' : '';
    // Update dashboard visibility for smart intervals
    dashboardIsVisible = !hide;
  }
  if (statsToggleCheckbox) {
    loadFromStorage('betfred_hide_stats', false).then(val => {
      statsToggleCheckbox.checked = !!val;
      updateStatsVisibility(!!val);
    });
    statsToggleCheckbox.onchange = function () {
      const hide = statsToggleCheckbox.checked;
      updateStatsVisibility(hide);
      // Don't save immediately - wait for save button
    };
  }

  // Restore last filter and provider selection if present
  const lastProvider = await loadFromStorage('betfred_last_provider', null);
  const lastFilter = await loadFromStorage('betfred_last_filter', null);
  if (lastProvider && providerSelect) {
    providerSelect.value = lastProvider;
    providerSelect.dispatchEvent(new Event('change'));
  }
  if (lastFilter) {
    setActiveFilter(lastFilter); // You may need to implement setActiveFilter if not present
  }

  // After the options panel is created, restore the last filter if it exists
  const savedFilter = await loadFromStorage('betfred_last_filter', null);
  if (savedFilter) {
    // Wait a bit for the panel to be fully created, then restore the filter
    setTimeout(() => {
      setActiveFilter(savedFilter);
    }, 100);
  }
  
  // Restore minimum stake selections
  const savedMinStakes = await loadFromStorage('betfred_min_stakes', []);
  document.querySelectorAll('.betfred-minstake-checkbox').forEach(checkbox => {
    const value = parseFloat(checkbox.value);
    checkbox.checked = savedMinStakes.includes(value);
  });
  
  // Update game dropdown after restoring min stake selections
  const initialScanData = await loadFromStorage('betfred_scan_data', {});
  if (gameSelect && providerSelect) {
    await updateGameDropdown(initialScanData, gameSelect, providerSelect);
  }
  
  // Listen for database updates from silent add functionality
  window.addEventListener('betfred-db-updated', async () => {
    const scanData = await loadFromStorage('betfred_scan_data', {});
    const gameSelect = document.getElementById('betfred-game-select');
    const providerSelect = document.getElementById('betfred-provider-select');
    if (gameSelect && providerSelect) {
      await updateGameDropdown(scanData, gameSelect, providerSelect);
    }
    if (providerSelect) {
      await updateProviderDropdown(scanData, providerSelect);
    }
    // Re-initialize custom dropdowns after database updates
    initializeCustomDropdowns();
  });
}


export async function updateGameDropdown(scanData = {}, gameSelect, providerSelect) {
  if (!gameSelect || !providerSelect) return;
  
  // Cache scan data for button label function
  window.betfred_scan_data_cache = scanData;
  
  // --- Min Stake Filter ---
  const minStakeCheckboxes = Array.from(document.querySelectorAll('.betfred-minstake-checkbox:checked'));
  let minStakes = minStakeCheckboxes.map(cb => parseFloat(cb.value));
  let maxAllowedStake = minStakes.length ? Math.max(...minStakes) : null;

  // --- Load Data ---
  const favorites = await getFavorites();
  const blacklist = await loadFromStorage('betfred_permanently_removed', {});
  let seenTitles = new Set();
  let uniqueGames = [];
  Object.entries(scanData).forEach(([path, data]) => {
    const normalizedTitle = (data.title || "").trim().toLowerCase();
    if (!seenTitles.has(normalizedTitle)) {
      seenTitles.add(normalizedTitle);
      uniqueGames.push([path, data]);
    }
  });

  // --- Get Other Filters ---
  let sel = providerSelect.value;
  const activeFilter = await getActiveFilter();
  const customFilters = await getCustomFilters();
  
  // Ensure "Select Provider" is treated as empty string (show all games)
  // Check for any variation of "Select Provider" or empty/null values
  if (sel === 'Select Provider' || sel === undefined || sel === null || sel === '' || sel === 'select provider' || sel === 'SELECT PROVIDER') {
    sel = '';
  }

  // --- Main Filtering ---
  let games = uniqueGames.filter(([path, data]) => {
    // --- Blacklist ---
    if (blacklist[path]) return false;

    // --- Provider filter ---
    if (sel !== "") {
      // Apply the same normalization logic as in updateProviderDropdown
      let normalizedProvider = data.provider ? data.provider.trim() : '';
      if (normalizedProvider.toLowerCase().includes('yggdrasil') || normalizedProvider.toLowerCase() === 'yggdrasi') {
        normalizedProvider = 'Yggdrasil';
      }
      if (normalizedProvider.toLowerCase().includes('bullet proof')) {
        normalizedProvider = 'BulletProof';
      }
      if (normalizedProvider.toLowerCase() === 'elk') {
        normalizedProvider = 'ELK Studios';
      }
      if (normalizedProvider.toLowerCase() === 'redtiger') {
        normalizedProvider = 'Red Tiger';
      }
      
      if (normalizedProvider !== sel) return false;
    }

    // --- Theme/favorite filter ---
    let passes =
      !activeFilter ||
      (activeFilter === 'xmas' && isChristmasGame(data.title)) ||
      (activeFilter === 'halloween' && isHalloweenGame(data.title)) ||
      (activeFilter === 'easter' && isEasterGame(data.title)) ||
      (activeFilter === 'romance' && isRomanceGame(data.title)) ||
      (activeFilter === 'megaways' && isMegawaysGame(data.title)) ||
      (activeFilter === 'sport' && isSportGame(data.title)) ||
      (activeFilter === 'bigbass' && isFishingGame(data.title)) ||
      (activeFilter === 'tvandmovie' && isTVAndMovie(data.title)) ||
      (activeFilter === 'fav' && favorites[path]) ||
      (activeFilter && activeFilter.startsWith('custom_') && isCustomFilterGame(data.title, activeFilter, customFilters, path));

    if (!passes) return false;

    // --- Min stake filter ---
    if (maxAllowedStake !== null) {
      let minStakeStr = (data.minStake || '').replace(/[^\d.,]/g, '').replace(',', '.');
      let minStake = parseFloat(minStakeStr);
      if (isNaN(minStake)) return false;
      return minStake <= maxAllowedStake;
    }

    // --- If no min stake filter, include the game ---
    return true;
  });

  // --- Sort Alphabetically ---
  games.sort((a, b) => (a[1].title || "").localeCompare(b[1].title || ""));

  // --- Render Dropdown ---
  gameSelect.style.display = "none"; // Hide the native select
  while (gameSelect.firstChild) {
    gameSelect.removeChild(gameSelect.firstChild);
  }
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = games.length ? `Select a game (${games.length})` : "No games found";
  gameSelect.appendChild(defOpt);
  
  // Update custom dropdown header text immediately with final count
  const gameValue = document.getElementById('betfred-game-select-value');
  if (gameValue) {
    gameValue.textContent = games.length ? `Select Game (${games.length})` : "No games found";
  }

  const displayRtp = await loadFromStorage('betfred_display_rtp', false);
  
  games.forEach(([path, data]) => {
    const opt = document.createElement("option");
          opt.value = path;
      const starIcon = favorites[path] ? '⭐ ' : '';
      if (displayRtp && data.rtp) {
        opt.innerHTML = `${starIcon}${data.title} ${cleanRtp(data.rtp)}`;
      } else {
        opt.innerHTML = `${starIcon}${data.title}`;
      }
    if (favorites[path]) {
      opt.className = "betfred-favorite-option";
    }
    gameSelect.appendChild(opt);
  });
  
  // Update custom dropdown
  const gameDropdown = document.getElementById('betfred-game-select-dropdown');
  if (gameDropdown) {
    gameDropdown.innerHTML = '';
    
    // Add default "Select Game" option
    const defaultOption = document.createElement('div');
    defaultOption.className = 'betfred-select-option';
    defaultOption.dataset.value = '';
    defaultOption.textContent = games.length ? `Select Game (${games.length})` : "No games found";
    gameDropdown.appendChild(defaultOption);
    
    // Add game options
    games.forEach(([path, data]) => {
      const option = document.createElement('div');
      option.className = 'betfred-select-option';
      option.dataset.value = path;
      if (favorites[path]) {
        option.classList.add('betfred-favorite-option');
      }
      
      const starIcon = favorites[path] ? '⭐ ' : '';
      if (displayRtp && data.rtp) {
        option.innerHTML = `${starIcon}${data.title} ${cleanRtp(data.rtp)}`;
      } else {
        option.innerHTML = `${starIcon}${data.title}`;
      }
      gameDropdown.appendChild(option);
    });
    
    // Re-attach event listeners to the newly created options
    gameDropdown.querySelectorAll('.betfred-select-option').forEach(option => {
      option.addEventListener('click', (e) => {
        if (e.target.classList.contains('betfred-select-option')) {
          selectOption(e.target, gameValue, gameSelect);
          closeAllDropdowns();
        }
      });
      
      // Re-attach keyboard navigation
      option.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('betfred-select-option')) {
          const gameContainer = document.getElementById('betfred-game-select-container');
          const gameHeader = document.getElementById('betfred-game-select-header');
          handleOptionKeydown(e, gameContainer, gameDropdown, gameHeader, gameValue, gameSelect);
        }
      });
    });
  }

  // --- Fuzzy Search Functionality ---
  const searchInput = document.getElementById('betfred-game-search');
  if (searchInput) {
    // Store original games for search
    window.betfred_all_games = games;
    
    // Flag to prevent search updates during provider changes
    if (!window.betfred_provider_changing) {
      window.betfred_provider_changing = false;
    }
    
    searchInput.addEventListener('input', debounce(function() {
      // Skip search updates if provider change is in progress
      if (window.betfred_provider_changing) {
        return;
      }
      
      const searchTerm = this.value.toLowerCase().trim();
      
      if (!searchTerm) {
          // Show all games when search is empty
          if (gameDropdown) {
            gameDropdown.innerHTML = '';
            
            // Add default "Select Game" option
            const defaultOption = document.createElement('div');
            defaultOption.className = 'betfred-select-option';
            defaultOption.dataset.value = '';
            defaultOption.textContent = games.length ? `Select Game (${games.length})` : "No games found";
            gameDropdown.appendChild(defaultOption);
            
            games.forEach(([path, data]) => {
              const option = document.createElement('div');
              option.className = 'betfred-select-option';
              option.dataset.value = path;
              if (favorites[path]) {
                option.classList.add('betfred-favorite-option');
              }
              
              const starIcon = favorites[path] ? '⭐ ' : '';
              if (displayRtp && data.rtp) {
                option.innerHTML = `${starIcon}${data.title} ${cleanRtp(data.rtp)}`;
              } else {
                option.innerHTML = `${starIcon}${data.title}`;
              }
              gameDropdown.appendChild(option);
            });
            
            // Re-attach click event listeners to new options
            gameDropdown.querySelectorAll('.betfred-select-option').forEach(option => {
              option.addEventListener('click', (e) => {
                if (e.target.classList.contains('betfred-select-option')) {
                  selectOption(e.target, gameValue, gameSelect);
                  closeAllDropdowns();
                }
              });
              
              // Re-attach keyboard navigation
              option.addEventListener('keydown', (e) => {
                if (e.target.classList.contains('betfred-select-option')) {
                  const gameContainer = document.getElementById('betfred-game-select-container');
                  const gameHeader = document.getElementById('betfred-game-select-header');
                  handleOptionKeydown(e, gameContainer, gameDropdown, gameHeader, gameValue, gameSelect);
                }
                        });
        });
      }
      // Update header text when search is cleared
      if (gameValue) {
        gameValue.textContent = games.length ? `Select Game (${games.length})` : "No games found";
      }
      return;
    }
      
      // Fuzzy search with highlighting
      const searchResults = games.filter(([path, data]) => {
        const title = data.title.toLowerCase();
        const provider = (data.provider || '').toLowerCase();
        
        // Check if search term appears in title or provider
        return title.includes(searchTerm) || provider.includes(searchTerm);
      });
      
      // Update custom dropdown with search results
      if (gameDropdown) {
        gameDropdown.innerHTML = '';
        searchResults.forEach(([path, data]) => {
          const option = document.createElement('div');
          option.className = 'betfred-select-option';
          option.dataset.value = path;
          if (favorites[path]) {
            option.classList.add('betfred-favorite-option');
          }
          
          const starIcon = favorites[path] ? '⭐ ' : '';
          if (displayRtp && data.rtp) {
            option.innerHTML = `${starIcon}${data.title} ${cleanRtp(data.rtp)}`;
          } else {
            option.innerHTML = `${starIcon}${data.title}`;
          }
          gameDropdown.appendChild(option);
        });
        
        // Re-attach click event listeners to new options
        gameDropdown.querySelectorAll('.betfred-select-option').forEach(option => {
          option.addEventListener('click', (e) => {
            if (e.target.classList.contains('betfred-select-option')) {
              selectOption(e.target, gameValue, gameSelect);
              closeAllDropdowns();
            }
          });
          
          // Re-attach keyboard navigation
          option.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('betfred-select-option')) {
              const gameContainer = document.getElementById('betfred-game-select-container');
              const gameHeader = document.getElementById('betfred-game-select-header');
              handleOptionKeydown(e, gameContainer, gameDropdown, gameHeader, gameValue, gameSelect);
            }
          });
        });
      }
      
      // Update header text with search results count
      if (gameValue) {
        gameValue.textContent = searchResults.length ? `Select Game (${searchResults.length})` : "No games found";
      }
    }, 150));
    
    // Clear search when provider changes - integrate this into the main provider change handler
    // The search clearing is now handled in the main provider change handler
  }
  // --- Ensure random button label is always up to date ---
  updateRandomButtonLabel();
  // --- Re-attach event listeners for dropdowns in case they were replaced ---
  // Note: Provider change handler is now managed centrally to prevent duplicates
  if (gameSelect) {
    gameSelect.removeEventListener('change', updateRandomButtonLabel);
    gameSelect.addEventListener('change', updateRandomButtonLabel);
  }
}

export async function showBulkKeywordPopup(mode) {
  const REMOVE_KEYWORDS = [
    'Jackpot King',
    'Live',
    'LuckyTap',
    'Other',
    'Rapid Fire Jackpot',
    'Roulette',
    'Scratchcard',
    'Table Games'
  ];
  const KEYWORDS = REMOVE_KEYWORDS;
  const scanData = await loadFromStorage('betfred_scan_data', {});
  let blacklist = await loadFromStorage('betfred_permanently_removed', {});


  

  // Overlay & popup
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.style.zIndex = 2147483647;
  const popup = document.createElement('div');
  popup.className = 'betfred-popup';
  popup.style.maxWidth = '500px';
  popup.style.margin = '40px auto';
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Step 0: Choose action
  function renderActionChoice() {
          popup.innerHTML = `
      <div class="betfred-modal-content">
        <div class="betfred-modal-header">
          <span class="betfred-modal-title">Bulk Remove or Re-Add by Keyword</span>
          <button class="betfred-close-btn" id="close-bulk-keyword" title="Close">×</button>
        </div>
        <div class="betfred-modal-body">
          <div style="color:#cccccc;font-size:16px;margin-top:20px;margin-bottom:20px;text-align:center;font-weight:500;">What would you like to do?</div>
          <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;">
            <button id="bulk-remove" class="betfred-btn">Remove</button>
            <button id="bulk-readd" class="betfred-btn">Re-Add</button>
          </div>
        </div>
      </div>
    `;
    popup.querySelector('#bulk-remove').onclick = () => renderStep1('remove');
    popup.querySelector('#bulk-readd').onclick = () => renderStep1('readd');
    popup.querySelector('#close-bulk-keyword').onclick = (e) => {
      e.stopPropagation(); // Prevent event bubbling
      overlay.remove();
    };
  }

  // Step 1: Select keywords
  function renderStep1(mode) {
    while (popup.firstChild) {
      popup.removeChild(popup.firstChild);
    }
    
    // Create modal content structure
    const modalContent = document.createElement('div');
    modalContent.className = 'betfred-modal-content';
    
    const header = document.createElement('div');
    header.className = 'betfred-modal-header';
    
    const title = document.createElement('span');
    title.className = 'betfred-modal-title';
    title.textContent = `${mode === 'remove' ? 'Remove' : 'Re-Add'} Games by Keyword`;
    
    const closeBtn = document.createElement('button');
    closeBtn.id = 'close-bulk-keyword-step1';
    closeBtn.className = 'betfred-close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.title = 'Close';
    closeBtn.onclick = (e) => {
      e.stopPropagation(); // Prevent event bubbling
      overlay.remove();
    };
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    modalContent.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'betfred-modal-body';
    modalContent.appendChild(body);
    
    popup.appendChild(modalContent);
    
    const optionsContainer = document.createElement('div');
    optionsContainer.style.cssText = 'background:linear-gradient(135deg, rgba(30,34,60,0.3) 0%, rgba(22,33,62,0.3) 100%);border:1px solid rgba(255,215,0,0.3);border-radius:12px;padding:16px;margin-top:20px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);';
    
    const everyGameItem = document.createElement('div');
    everyGameItem.style.cssText = 'display:flex;align-items:center;margin-bottom:8px;padding:8px 12px;background:linear-gradient(135deg, rgba(30,34,60,0.5) 0%, rgba(22,33,62,0.5) 100%);border:1px solid rgba(255,215,0,0.2);border-radius:8px;transition:all 0.2s ease;';
    
    const everyGameCheckbox = document.createElement('input');
    everyGameCheckbox.type = 'checkbox';
    everyGameCheckbox.id = 'betfred-every-game';
    everyGameCheckbox.style.cssText = 'margin-right:12px;transform:scale(1.2);accent-color:#ffd700;';
    
    const everyGameLabel = document.createElement('label');
    everyGameLabel.style.cssText = 'color:#ffffff;font-weight:500;cursor:pointer;flex:1;';
    const strongSpan = document.createElement('strong');
    strongSpan.style.color = '#ffd700';
    strongSpan.textContent = 'Every Game';
    everyGameLabel.appendChild(strongSpan);
    everyGameLabel.appendChild(document.createTextNode(' - Show all games in database'));
    
    everyGameItem.appendChild(everyGameCheckbox);
    everyGameItem.appendChild(everyGameLabel);
    optionsContainer.appendChild(everyGameItem);
    
    const divider = document.createElement('hr');
    divider.style.cssText = 'margin:16px 0;border:none;border-top:1px solid rgba(255,215,0,0.3);height:1px;';
    optionsContainer.appendChild(divider);
    
    KEYWORDS.forEach(word => {
      const optionItem = document.createElement('div');
      optionItem.style.cssText = 'display:flex;align-items:center;margin-bottom:8px;padding:8px 12px;background:linear-gradient(135deg, rgba(30,34,60,0.5) 0%, rgba(22,33,62,0.5) 100%);border:1px solid rgba(255,215,0,0.2);border-radius:8px;transition:all 0.2s ease;';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'betfred-keyword-checkbox';
      checkbox.value = word;
      checkbox.style.cssText = 'margin-right:12px;transform:scale(1.2);accent-color:#ffd700;';
      
      const label = document.createElement('label');
      label.style.cssText = 'color:#ffffff;font-weight:500;cursor:pointer;flex:1;';
      label.textContent = word;
      
      optionItem.appendChild(checkbox);
      optionItem.appendChild(label);
      optionsContainer.appendChild(optionItem);
    });
    
    body.appendChild(optionsContainer);
    
    const descDiv = document.createElement('div');
    descDiv.style.cssText = 'color:#888888;font-size:14px;margin-bottom:20px;text-align:left;line-height:1.4;';
    descDiv.textContent = `Any game with a selected word in its title will be ${mode === 'remove' ? 'removed' : 're-added'}.`;
    body.appendChild(descDiv);
    
    const buttonDiv = document.createElement('div');
    buttonDiv.style.cssText = 'display:flex;justify-content:center;gap:12px;margin-top:20px;';
    
    const nextBtn = document.createElement('button');
    nextBtn.id = 'betfred-keyword-next';
    nextBtn.className = 'betfred-btn';
    nextBtn.textContent = 'Next';
    
    const backBtn = document.createElement('button');
    backBtn.id = 'betfred-keyword-back';
    backBtn.className = 'betfred-btn';
    backBtn.textContent = 'Back';
    
    buttonDiv.appendChild(backBtn);
    buttonDiv.appendChild(nextBtn);
    body.appendChild(buttonDiv);
    
    // Handle "Every Game" checkbox
    const keywordCheckboxes = popup.querySelectorAll('.betfred-keyword-checkbox');
    
    everyGameCheckbox.onchange = function() {
      keywordCheckboxes.forEach(cb => {
        cb.checked = false;
        cb.disabled = this.checked;
      });
    };
    
    keywordCheckboxes.forEach(cb => {
      cb.onchange = function() {
        if (this.checked) {
          everyGameCheckbox.checked = false;
          keywordCheckboxes.forEach(otherCb => {
            if (otherCb !== this) otherCb.disabled = false;
          });
        }
      };
    });
    
    popup.querySelector('#betfred-keyword-back').onclick = () => renderActionChoice();
    popup.querySelector('#betfred-keyword-next').onclick = () => {
      const everyGame = everyGameCheckbox.checked;
      const selected = Array.from(popup.querySelectorAll('.betfred-keyword-checkbox:checked')).map(cb => cb.value.toLowerCase());
      
      if (!everyGame && !selected.length) {
        showToast('No option selected.');
        return;
      }
      renderStep2(mode, selected, everyGame);
    };
  }

  function renderStep2(mode, selectedKeywords, everyGame = false) {
    let matches = [];
    
    if (everyGame) {
      // Show all games in database (unchecked by default)
      matches = Object.entries(mode === 're-add' || mode === 'readd' ? starterDatabase : scanData).filter(([path, data]) => {
        // Exclude Adventures of Captain Blackjack from bulk remove/re-add
        if ((data.title || '').trim().toLowerCase() === 'adventures of captain blackjack') return false;
        if (mode === 'remove' || mode === 'bulk-remove') {
          return !blacklist[path]; // Show all non-blacklisted games
        } else if (mode === 're-add' || mode === 'readd') {
          const normalizedPath = path.trim();
          const result = blacklist[normalizedPath] === true || blacklist[normalizedPath] === 'true';
          if (result) {
    
          }
          return result;
        } else {
          // fallback, just in case
          return false;
        }
      });

    } else {
      // Original keyword-based filtering
      matches = Object.entries(mode === 're-add' || mode === 'readd' ? starterDatabase : scanData).filter(([path, data]) => {
        // Exclude Adventures of Captain Blackjack from bulk remove/re-add
        if ((data.title || '').trim().toLowerCase() === 'adventures of captain blackjack') return false;
        const title = (data.title || '').toLowerCase();
        if (mode === 'remove') {
          return !blacklist[path] && selectedKeywords.some(word => {
            if (word === 'other') {
              return (/(?:\b|_)(slingo)(?:\b|_)/i).test(data.title || '')
                || title.includes('virtual')
                || title === 'plinball'
                || title === 'keno deluxe'
                || title === 'keno'
                || title === 'towers';
            }
            if (word === 'baccarat' && title.includes('baccarat')) return true;
            // Live logic - match "Live" but not "alive", "believe", etc.
            if (word === 'live') {
              const titleLower = (data.title || '').toLowerCase();
              const hasLive = titleLower.includes(' live ') || 
                             titleLower.startsWith('live ') || 
                             titleLower.endsWith(' live') || 
                             titleLower === 'live';
              const hasExcluded = titleLower.includes('alive') || 
                                 titleLower.includes('lives') || 
                                 titleLower.includes('lived') || 
                                 titleLower.includes('living');
              return hasLive && !hasExcluded;
            }
            if (word === 'table games') {
              return title.includes('blackjack')
                // Table Games special case for specific games from Other
                || title === '3 card brag'
                || title === 'baccarat'
                || title === 'banca francesa'
                || title === 'cards of athena: double double bonus'
                || title === 'caribbean stud poker'
                || title === 'hi-lo'
                || title === 'hi lo gambler'
                || title === 'jacks or better classic'
                || title === 'perfect pairs 3 box high stakes'
                || title === 'perfect pairs 5 box high stakes'
                || title === 'retro solitaire'
                || title === 'vegas solitaire';
            }
            return title.includes(word)
              // Rapid Fire logic
              || (word === 'rapid fire jackpot' && title.includes('rapid fire'))
              || (word === 'rapid fire' && title.includes('rapid fire jackpot'))
              // Jackpot King logic (includes JK and JPK)
              || (
                (['jackpot king', 'jk', 'jpk'].includes(word)) &&
                (
                  title.includes('jackpot king') ||
                  title.includes('jk') ||
                  title.includes('jpk')
                )
              )
              // Scratchcard special case for 'Cards of Ra Jacks or Better', 'Lucky Day: Cheltenham Champions', 'Scratch Card', and any title containing 'scratcher', 'scratch', or 'pull tab'
              || (word === 'scratchcard' && (
                title === 'cards of ra jacks or better' ||
                title === 'lucky day: cheltenham champions' ||
                title === 'scratch card' ||
                title.includes('scratcher') ||
                title.includes('scratch') ||
                title.includes('pull tab')
              ));
          });
        } else { // re-add
          return blacklist[path] && selectedKeywords.some(word => {
            if (word === 'other') {
              return (/(?:\b|_)(slingo)(?:\b|_)/i).test(data.title || '')
                || title.includes('virtual')
                || title === 'plinball'
                || title === 'keno deluxe'
                || title === 'keno'
                || title === 'towers';
            }
            if (word === 'baccarat' && title.includes('baccarat')) return true;
            // Live logic - match "Live" but not "alive", "believe", etc.
            if (word === 'live') {
              const titleLower = (data.title || '').toLowerCase();
              const hasLive = titleLower.includes(' live ') || 
                             titleLower.startsWith('live ') || 
                             titleLower.endsWith(' live') || 
                             titleLower === 'live';
              const hasExcluded = titleLower.includes('alive') || 
                                 titleLower.includes('lives') || 
                                 titleLower.includes('lived') || 
                                 titleLower.includes('living');
              return hasLive && !hasExcluded;
            }
            if (word === 'table games') {
              return title.includes('blackjack')
                // Table Games special case for specific games from Other
                || title === '3 card brag'
                || title === 'baccarat'
                || title === 'banca francesa'
                || title === 'cards of athena: double double bonus'
                || title === 'caribbean stud poker'
                || title === 'hi-lo'
                || title === 'hi lo gambler'
                || title === 'jacks or better classic'
                || title === 'perfect pairs 3 box high stakes'
                || title === 'perfect pairs 5 box high stakes'
                || title === 'retro solitaire'
                || title === 'vegas solitaire';
            }
            return title.includes(word)
              || (word === 'rapid fire jackpot' && title.includes('rapid fire'))
              || (word === 'rapid fire' && title.includes('rapid fire jackpot'))
              || (
                (['jackpot king', 'jk', 'jpk'].includes(word)) &&
                (
                  title.includes('jackpot king') ||
                  title.includes('jk') ||
                  title.includes('jpk')
                )
              )
              // Scratchcard special case for 'Cards of Ra Jacks or Better' and any title containing 'pull tab'
              || (word === 'scratchcard' && (
                title === 'cards of ra jacks or better' ||
                title.includes('pull tab')
              ));
          });
        }
      });
    }
    
    matches.sort((a, b) =>
      (a[1].title || '').localeCompare(b[1].title || '', undefined, { sensitivity: 'base' })
    );
    
    while (popup.firstChild) {
      popup.removeChild(popup.firstChild);
    }
    
    // Create container with close button
    const container = document.createElement('div');
    container.style.position = 'relative';
    
    const closeBtn = document.createElement('button');
    closeBtn.id = 'close-bulk-keyword-step2';
    closeBtn.className = 'betfred-close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => overlay.remove();
    container.appendChild(closeBtn);
    
    const h3 = document.createElement('h3');
    h3.className = 'betfred-bulk-popup-header';
    h3.style.paddingRight = '50px';
    h3.textContent = `${mode === 'remove' ? 'Remove' : 'Re-Add'} Games`;
    container.appendChild(h3);
    
    popup.appendChild(container);
    
    if (everyGame) {
      const searchDiv = document.createElement('div');
      searchDiv.style.marginBottom = '16px';
      
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.id = 'betfred-game-search';
      searchInput.placeholder = 'Search games...';
      searchInput.className = 'betfred-input';
      searchInput.style.marginBottom = '0';
      searchInput.autocomplete = 'off';
      searchInput.autocorrect = 'off';
      searchInput.autocapitalize = 'none';
      
      searchDiv.appendChild(searchInput);
      popup.appendChild(searchDiv);
    }
    
    const gameListDiv = document.createElement('div');
    gameListDiv.style.cssText = 'max-height:300px;overflow:auto;margin-bottom:16px;border:1px solid rgba(255,215,0,0.2);border-radius:8px;padding:12px;background:linear-gradient(135deg, rgba(30,34,60,0.3) 0%, rgba(22,33,62,0.3) 100%);';
    gameListDiv.id = 'betfred-keyword-game-list';
    
    // --- Select All/Deselect All and Selected Count ---
    if (matches.length) {
      const controlsDiv = document.createElement('div');
      controlsDiv.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,215,0,0.2);';

      // Select All Checkbox
      const selectAllLabel = document.createElement('label');
      selectAllLabel.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;color:#ffd700;font-weight:600;';
      const selectAllCheckbox = document.createElement('input');
      selectAllCheckbox.type = 'checkbox';
      selectAllCheckbox.id = 'betfred-select-all-checkbox';
      selectAllCheckbox.style.transform = 'scale(1.2)';
      selectAllCheckbox.style.accentColor = '#ffd700';
      selectAllLabel.appendChild(selectAllCheckbox);
      selectAllLabel.appendChild(document.createTextNode('Select All'));
      controlsDiv.appendChild(selectAllLabel);

      // Selected Count
      const selectedCountSpan = document.createElement('span');
      selectedCountSpan.id = 'betfred-selected-count';
      selectedCountSpan.style.color = '#cccccc';
      selectedCountSpan.style.fontWeight = '500';
      selectedCountSpan.textContent = '0 selected';
      controlsDiv.appendChild(selectedCountSpan);

      popup.appendChild(controlsDiv);

      // --- Game List (with Document Fragment for performance) ---
      const fragment = document.createDocumentFragment();
      matches.forEach(([path, data]) => {
        const gameItem = document.createElement('div');
        gameItem.className = 'betfred-game-item betfred-select-option';
        gameItem.setAttribute('data-title', (data.title || '').toLowerCase());
        gameItem.setAttribute('data-path', path);
        gameItem.style.cssText = 'padding:12px 14px;cursor:pointer;color:#ffd700;font-size:14px;transition:background 0.2s;border-bottom:1px solid rgba(255,215,0,0.2);';
        gameItem.textContent = data.title || '';
        
        // Add click handler for selection
        gameItem.addEventListener('click', function() {
          this.classList.toggle('selected');
          updateSelectedCount();
        });
        
        fragment.appendChild(gameItem);
      });
      gameListDiv.appendChild(fragment);

      // --- Selection Logic ---
      function updateSelectedCount() {
        const selected = popup.querySelectorAll('.betfred-game-item.selected');
        selectedCountSpan.textContent = `${selected.length} selected`;
      }
      
      selectAllCheckbox.addEventListener('change', e => {
        const allItems = popup.querySelectorAll('.betfred-game-item');
        allItems.forEach(item => {
          if (selectAllCheckbox.checked) {
            item.classList.add('selected');
          } else {
            item.classList.remove('selected');
          }
        });
        updateSelectedCount();
      });
    }
    
    popup.appendChild(gameListDiv);
    
    const descDiv = document.createElement('div');
    descDiv.className = 'betfred-bulk-description';
    if (everyGame) {
      descDiv.textContent = `Select games you want to ${mode === 'remove' ? 'remove' : 're-add'}.`;
    } else {
      descDiv.textContent = 'Untick any game you want to keep.';
    }
    popup.appendChild(descDiv);
    
    const buttonDiv = document.createElement('div');
    buttonDiv.className = 'betfred-bulk-button-container';
    
    const backBtn = document.createElement('button');
    backBtn.id = 'betfred-keyword-back';
    backBtn.className = 'betfred-btn';
    backBtn.textContent = 'Back';
    
    const applyBtn = document.createElement('button');
    applyBtn.id = 'betfred-keyword-apply';
    applyBtn.className = 'betfred-btn';
    applyBtn.textContent = 'Apply';
    
    buttonDiv.appendChild(backBtn);
    buttonDiv.appendChild(applyBtn);
    popup.appendChild(buttonDiv);
    
    // Add search functionality for "Every Game" mode
    if (everyGame) {
      const searchBox = popup.querySelector('#betfred-game-search');
      const gameItems = popup.querySelectorAll('.betfred-game-item');
      
      searchBox.oninput = function() {
        const searchTerm = this.value.toLowerCase();
        gameItems.forEach(item => {
          const title = item.getAttribute('data-title');
          item.style.display = title.includes(searchTerm) ? 'block' : 'none';
        });
      };
    }
    
    popup.querySelector('#betfred-keyword-back').onclick = () => renderStep1(mode);
    popup.querySelector('#betfred-keyword-apply').onclick = async function () {
      const selected = Array.from(popup.querySelectorAll('.betfred-game-item.selected'));
      if (!selected.length) {
        showToast('No games selected.');
        return;
      }
      let updatedBlacklist = await loadFromStorage('betfred_permanently_removed', {});
      let changedCount = 0;
      if (mode === 'remove') {
        for (const item of selected) {
          const path = item.getAttribute('data-path');
          if (!updatedBlacklist[path]) {
            updatedBlacklist[path] = true;
            changedCount++;
            // Also add to silent add ignore list
            let ignoreList = await loadFromStorage('betfred_silent_add_ignored', {});
            ignoreList[path] = true;
            await saveToStorage('betfred_silent_add_ignored', ignoreList);
          }
        }
      } else { // re-add
        for (const item of selected) {
          const path = item.getAttribute('data-path');
          if (updatedBlacklist[path]) {
            delete updatedBlacklist[path];
            changedCount++;
          }
          // Also remove from ignore list if present
          if (typeof removeFromIgnoreList === 'function') {
            await removeFromIgnoreList(path);
          }
        }
      }
      await saveToStorage('betfred_permanently_removed', updatedBlacklist);
      if (mode === 'remove' && changedCount > 0) {
        let removedCount = await loadFromStorage('betfred_removed_count', 0);
        await saveToStorage('betfred_removed_count', removedCount + changedCount);
      }
      
      // Update game dropdown immediately after changes
      const scanData = await loadFromStorage('betfred_scan_data', {});
      const gameSelect = document.getElementById('betfred-game-select');
      const providerSelect = document.getElementById('betfred-provider-select');
      if (gameSelect && providerSelect) {
        await updateGameDropdown(scanData, gameSelect, providerSelect);
      }
      
      // Update provider dropdown as well
      if (providerSelect) {
        await updateProviderDropdown(scanData, providerSelect);
      }
      
      // Re-initialize custom dropdowns after bulk actions
      initializeCustomDropdowns();
      
      overlay.remove();
      showToast(`${changedCount} game(s) ${mode === 'remove' ? 'removed' : 're-added'}.`);
    };
  }

  if (!mode) renderActionChoice();
  else renderStep1(mode);


}

export async function insertOptionsButton() {
  // Only show options button when user is logged in (deposit button is visible)
  const depositBtn = await findDepositButton();
  
  // If no deposit button, user is not logged in - hide options button
  if (!depositBtn) {
    const existingBtn = document.querySelector('button[data-betfred-options]');
    if (existingBtn) {
      existingBtn.remove();
    }
    // Also hide stats button
    const existingStatsBtn = document.querySelector('button[data-betfred-stats]');
    if (existingStatsBtn) {
      existingStatsBtn.remove();
    }
    return;
  }
  
  // Check if button already exists and is in the right place
  const existingBtn = document.querySelector('button[data-betfred-options]');
  if (existingBtn) {
    // Check if it's already positioned correctly (before deposit button)
    if (existingBtn.nextSibling === depositBtn) {
      // Button is already in the correct position, don't move it
      return;
    }
  }
  
  // Remove any existing button
  if (existingBtn) existingBtn.remove();
  
  if (depositBtn && depositBtn.parentNode) {
    // Insert BEFORE the deposit button
    const btn = document.createElement('button');
    btn.setAttribute('data-betfred-options', 'true');
    btn.type = 'button'; 
    btn.textContent = 'Options';
    btn.className = 'betfred-options-btn';
    btn.setAttribute('aria-label', 'Open Betfred Game Options');
    btn.tabIndex = 0;
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Show loading state with enhanced visual feedback
      btn.textContent = 'Loading...';
      btn.disabled = true;
      btn.classList.add('betfred-loading');
      
      try {
        await toggleOptionsPanel();
      } finally {
        // Restore button state with smooth transition
        btn.textContent = 'Options';
        btn.disabled = false;
        btn.classList.remove('betfred-loading');
        btn.classList.add('betfred-success');
        setTimeout(() => btn.classList.remove('betfred-success'), 600);
      }
    };
    btn.onkeydown = e => { 
      if (e.key === "Enter" || e.key === " ") { 
        e.preventDefault(); 
        btn.click(); 
      } 
    };
    
    depositBtn.parentNode.insertBefore(btn, depositBtn);
  } else {
    // Wait a bit and try again
    setTimeout(async () => {
      // Check again if button already exists to prevent duplicates
      if (document.querySelector('button[data-betfred-options]')) {
        return;
      }
      
      const retryDepositBtn = await findDepositButton();
      
      if (retryDepositBtn && retryDepositBtn.parentNode) {
        const btn = document.createElement('button');
        btn.setAttribute('data-betfred-options', 'true');
        btn.type = 'button'; 
        btn.textContent = 'Options';
        btn.className = 'betfred-options-btn';
        btn.setAttribute('aria-label', 'Open Betfred Game Options');
        btn.tabIndex = 0;
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Show loading state with enhanced visual feedback
          btn.textContent = 'Loading...';
          btn.disabled = true;
          btn.classList.add('betfred-loading');
          
          try {
            await toggleOptionsPanel();
          } finally {
            // Restore button state with smooth transition
            btn.textContent = 'Options';
            btn.disabled = false;
            btn.classList.remove('betfred-loading');
            btn.classList.add('betfred-success');
            setTimeout(() => btn.classList.remove('betfred-success'), 600);
          }
        };
        btn.onkeydown = e => { 
          if (e.key === "Enter" || e.key === " ") { 
            e.preventDefault(); 
            btn.click(); 
          } 
        };
        
        retryDepositBtn.parentNode.insertBefore(btn, retryDepositBtn);
      } else {
        // Last resort: try to find the container div
        const container = document.querySelector('div._1h96qia');
        if (container) {
          const btn = document.createElement('button');
          btn.setAttribute('data-betfred-options', 'true');
          btn.type = 'button'; 
          btn.textContent = 'Options';
          btn.className = 'betfred-options-btn';
          btn.setAttribute('aria-label', 'Open Betfred Game Options');
          btn.tabIndex = 0;
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleOptionsPanel();
          };
          btn.onkeydown = e => { 
            if (e.key === "Enter" || e.key === " ") { 
              e.preventDefault(); 
              btn.click(); 
            } 
          };
          
          container.insertBefore(btn, container.firstChild);
        } else {
          // Final fallback: insert at top of body
          const btn = document.createElement('button');
          btn.setAttribute('data-betfred-options', 'true');
          btn.type = 'button'; 
          btn.textContent = 'Options';
          btn.className = 'betfred-options-btn';
          btn.setAttribute('aria-label', 'Open Betfred Game Options');
          btn.tabIndex = 0;
          btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Show loading state
            btn.textContent = 'Loading...';
            btn.disabled = true;
            btn.style.opacity = '0.7';
            
            try {
              await toggleOptionsPanel();
            } finally {
              // Restore button state
              btn.textContent = 'Options';
              btn.disabled = false;
              btn.style.opacity = '1';
            }
          };
          btn.onkeydown = e => { 
            if (e.key === "Enter" || e.key === " ") { 
              e.preventDefault(); 
              btn.click(); 
            } 
          };
          
          document.body.insertBefore(btn, document.body.firstChild);
        }
      }
    }, 50);
  }
}

export async function toggleOptionsPanel() {
  document.querySelectorAll('.betfred-overlay').forEach(o => o.remove());
  let p = document.getElementById('betfred-options-panel');
  if (!p) {
    createOptionsPanel();
    p = document.getElementById('betfred-options-panel');
  }
  if (p) {
    const newDisplay = (p.style.display === "block" ? "none" : "block");
    
    if (newDisplay === "block") {
      // Show panel with smooth animation
      p.style.display = "block";
      p.style.opacity = "0";
      // Force a reflow to ensure the animation triggers
      p.offsetHeight;
      // Smooth fade in
      p.style.transition = "opacity 0.3s ease-out";
      p.style.opacity = "1";
    } else {
      // Hide panel
      p.style.transition = "opacity 0.2s ease-out";
      p.style.opacity = "0";
      setTimeout(() => {
        if (p.style.opacity === "0") {
          p.style.display = "none";
          p.style.transition = "";
        }
      }, 200);
    }
    
    // Update floating button label when panel opens
    if (newDisplay === "block") {
      const floatingBtn = document.getElementById('betfred-floating-random-btn');
      if (floatingBtn && typeof getRandomButtonLabel === 'function') {
        setTimeout(async () => {
          try {
            const label = await getRandomButtonLabel();
            floatingBtn.innerHTML = label;
            floatingBtn.setAttribute('aria-label', `Launch ${label.toLowerCase()}`);
          } catch (error) {
            floatingBtn.innerHTML = '🎲 Random Game 🎲';
            floatingBtn.setAttribute('aria-label', 'Launch random game');
          }
        }, 100);
      }
    }
    
    // Save current filter state when panel closes
    if (newDisplay === "none") {
      const currentFilter = await getActiveFilter();
      if (currentFilter) {
        saveToStorage('betfred_last_filter', currentFilter);
      }
    }
  }
}

export async function getActiveFilter() {
  // First check if there are active filter buttons in the DOM
  const activeBtn = document.querySelector('.betfred-filter-btn.active');
  if (activeBtn) {
    switch (activeBtn.id) {
      case 'betfred-fav-filter-toggle': return 'fav';
      case 'betfred-xmas-toggle': return 'xmas';
      case 'betfred-halloween-toggle': return 'halloween';
      case 'betfred-easter-toggle': return 'easter';
      case 'betfred-romance-toggle': return 'romance';
      case 'betfred-megaways-toggle': return 'megaways';
      case 'betfred-sport-toggle': return 'sport';
      case 'betfred-bigbass-toggle': return 'bigbass';
      case 'betfred-tvandmovie-toggle': return 'tvandmovie';
      default: 
        // Check if it's a custom filter button
        if (activeBtn.id.startsWith('betfred-custom_') && activeBtn.id.endsWith('-toggle')) {
          const filterId = activeBtn.id.replace('betfred-', '').replace('-toggle', '');
          return filterId;
        }
        return null;
    }
  }
  
  // If no active buttons in DOM, try to get from storage
  try {
    const filter = await loadFromStorage('betfred_last_filter', null);
    return filter;
  } catch (error) {
    return null;
  }
}

export function cleanRtp(rtp) {
  if (!rtp) return '';
  if (typeof rtp === 'number') return `<span style="color: rgba(255, 215, 0, 0.7);">&nbsp;(${rtp.toFixed(2)}%)</span>`;
  if (typeof rtp === 'string') {
  const match = rtp.match(/(\d{1,3}(?:\.\d{1,2})?)%/);
    if (match) return `<span style="color: rgba(255, 215, 0, 0.7);">&nbsp;(${match[1]}%)</span>`;
    // If it's a string but doesn't contain %, treat as number
    const num = parseFloat(rtp);
    if (!isNaN(num)) return `<span style="color: rgba(255, 215, 0, 0.7);">&nbsp;(${num.toFixed(2)}%)</span>`;
  }
  return '';
}

export function updateProviderDropdown(scanData = {}, providerSelect) {
  if (!providerSelect) return;
  
  // Clean up provider names and remove duplicates
  const providerMap = new Map();
  Object.values(scanData).forEach((d) => {
    if (d.provider) {
      const cleanProvider = d.provider.trim();
      // Handle common variations
      let normalizedProvider = cleanProvider;
      if (cleanProvider.toLowerCase().includes('yggdrasil') || cleanProvider.toLowerCase() === 'yggdrasi') {
        normalizedProvider = 'Yggdrasil';
      }
      if (cleanProvider.toLowerCase().includes('bullet proof')) {
        normalizedProvider = 'BulletProof';
      }
      if (cleanProvider.toLowerCase() === 'elk') {
        normalizedProvider = 'ELK Studios';
      }
      if (cleanProvider.toLowerCase() === 'redtiger') {
        normalizedProvider = 'Red Tiger';
      }
      // Add more normalizations as needed
      
      if (!providerMap.has(normalizedProvider)) {
        providerMap.set(normalizedProvider, cleanProvider);
      }
    }
  });
  
  const providers = Array.from(providerMap.keys()).sort((a, b) => a.localeCompare(b));
  
  // Update hidden select element
  while (providerSelect.firstChild) {
    providerSelect.removeChild(providerSelect.firstChild);
  }
  
  // Add default option
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = "Select Provider";
  providerSelect.appendChild(defOpt);
  
  providers.forEach(provider => {
    const opt = document.createElement("option");
    opt.value = provider;
    opt.textContent = provider;
    providerSelect.appendChild(opt);
  });
  
  // Update custom dropdown
  const providerDropdown = document.getElementById('betfred-provider-select-dropdown');
  if (providerDropdown) {
    providerDropdown.innerHTML = '';
    
    // Add default option
    const defaultOption = document.createElement('div');
    defaultOption.className = 'betfred-select-option';
    defaultOption.dataset.value = '';
    defaultOption.textContent = 'Select Provider';
    providerDropdown.appendChild(defaultOption);
    
    providers.forEach(provider => {
      const option = document.createElement('div');
      option.className = 'betfred-select-option';
      option.dataset.value = provider;
      option.textContent = provider;
      providerDropdown.appendChild(option);
    });
    
    // Re-attach event listeners to the newly created options
    providerDropdown.querySelectorAll('.betfred-select-option').forEach(option => {
      option.addEventListener('click', (e) => {
        if (e.target.classList.contains('betfred-select-option')) {
          const providerValue = document.getElementById('betfred-provider-select-value');
          const providerSelect = document.getElementById('betfred-provider-select');
          selectOption(e.target, providerValue, providerSelect);
          closeAllDropdowns();
        }
      });
      
      // Re-attach keyboard navigation
      option.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('betfred-select-option')) {
          const providerContainer = document.getElementById('betfred-provider-select-container');
          const providerHeader = document.getElementById('betfred-provider-select-header');
          const providerValue = document.getElementById('betfred-provider-select-value');
          const providerSelect = document.getElementById('betfred-provider-select');
          handleOptionKeydown(e, providerContainer, providerDropdown, providerHeader, providerValue, providerSelect);
        }
      });
    });
  }
  
  // Set default selection to "Select Provider" if no value is currently set
  if (!providerSelect.value || providerSelect.value === 'Select Provider') {
    providerSelect.value = '';
    const providerValue = document.getElementById('betfred-provider-select-value');
    if (providerValue) {
      providerValue.textContent = 'Select Provider';
    }
  }
}

// --- SPA URL Change Watcher (simplified since deposit button is always in same place) ---
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    autoAddGameOnPageLoad();
  }
}, 500);

// --- Robust SPA Navigation Watcher (backup) ---
function robustOptionsButtonWatcher() {
  let header = document.querySelector('header');
  if (!header || !header.parentNode) return;
  const parent = header.parentNode;
  const observer = new MutationObserver(() => {
    let newHeader = document.querySelector('header');
    if (newHeader && !document.querySelector('button[data-betfred-options]')) {
      insertOptionsButton();
      observeHeaderForOptionsButton();
    }
  });
  observer.observe(parent, { childList: true, subtree: false });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', robustOptionsButtonWatcher);
} else {
  robustOptionsButtonWatcher();
}

// --- Login State Watcher ---
let lastLoggedIn = isUserLoggedIn();
setInterval(() => {
  const nowLoggedIn = isUserLoggedIn();
  if (nowLoggedIn !== lastLoggedIn) {
    lastLoggedIn = nowLoggedIn;
    if (nowLoggedIn) {
      setTimeout(() => {
        insertOptionsButton();
        createOptionsPanel();
      }, 300);
    } else {
      // Remove options button and panel if present
      const btn = document.querySelector('button[data-betfred-options]');
      if (btn) btn.remove();
      const panel = document.getElementById('betfred-options-panel');
      if (panel) panel.remove();
    }
  }
}, 2000);

// Ensure the Options button is always present, even after SPA navigation or DOM changes
function ensureOptionsButton() {
  if (!document.querySelector('button[data-betfred-options]')) {
    insertOptionsButton();
  }
}

const optionsButtonObserver = new MutationObserver(() => {
  ensureOptionsButton();
});
optionsButtonObserver.observe(document.body, { childList: true, subtree: true });

// Also call once on script load
ensureOptionsButton();



async function incrementGamePlayCount(gamePath) {
  const stats = await loadFromStorage('betfred_user_stats', { plays: {} });
  // Ensure plays object exists
  if (!stats.plays) stats.plays = {};
  stats.plays[gamePath] = (stats.plays[gamePath] || 0) + 1;
  stats.lastPlayed = gamePath;
  // Track first play date
  if (!stats.firstPlayed) stats.firstPlayed = {};
  if (!stats.firstPlayed[gamePath]) stats.firstPlayed[gamePath] = new Date().toISOString();
  // Track monthly plays
  if (!stats.playsByMonth) stats.playsByMonth = {};
  if (!stats.playsByMonth[gamePath]) stats.playsByMonth[gamePath] = [];
  const now = new Date();
  stats.playsByMonth[gamePath].push({ date: now.toISOString(), count: 1 });
  await saveToStorage('betfred_user_stats', stats);
}

// Track game page visits and only count as "played" after 1 minute
async function trackGamePageVisit(gamePath) {
  const stats = await loadFromStorage('betfred_user_stats', { gameVisits: {} });
  if (!stats.gameVisits) stats.gameVisits = {};
  
  // Record the visit time
  stats.gameVisits[gamePath] = new Date().toISOString();
  await saveToStorage('betfred_user_stats', stats);
  
  // Start play time tracking
  startPlayTimeTracking(gamePath);
  
  // Set a timer to increment play count after 1 minute
  setTimeout(async () => {
    const currentStats = await loadFromStorage('betfred_user_stats', { gameVisits: {} });
    const visitTime = currentStats.gameVisits && currentStats.gameVisits[gamePath];
    
    // Only increment if the visit time matches (user hasn't navigated away)
    if (visitTime && visitTime === stats.gameVisits[gamePath]) {
      await incrementGamePlayCount(gamePath);
    }
  }, 60000); // 1 minute = 60,000 milliseconds
}

// Enhanced play time tracking
function startPlayTimeTracking(gamePath) {
  const startTime = Date.now();
  
  // Store the start time for this session
  if (!window.betfredPlayTimeSessions) {
    window.betfredPlayTimeSessions = {};
  }
  window.betfredPlayTimeSessions[gamePath] = startTime;
  
  // Set up interval to update play time every 30 seconds
  const intervalId = setInterval(async () => {
    const currentTime = Date.now();
    const sessionStart = window.betfredPlayTimeSessions[gamePath];
    
    if (sessionStart) {
      const sessionDuration = (currentTime - sessionStart) / 60000; // Convert to minutes
      
      // Update play time in storage
      const stats = await loadFromStorage('betfred_user_stats', {});
      if (!stats.playTime) stats.playTime = {};
      if (!stats.playTime[gamePath]) stats.playTime[gamePath] = 0;
      
      stats.playTime[gamePath] += 0.5; // Add 30 seconds (0.5 minutes)
      await saveToStorage('betfred_user_stats', stats);
      
      // Update session start time
      window.betfredPlayTimeSessions[gamePath] = currentTime;
    } else {
      // Session ended, clear interval
      clearInterval(intervalId);
    }
  }, 30000); // Update every 30 seconds
  
  // Store interval ID for cleanup
  if (!window.betfredPlayTimeIntervals) {
    window.betfredPlayTimeIntervals = {};
  }
  window.betfredPlayTimeIntervals[gamePath] = intervalId;
  
  // Clean up when user navigates away
  window.addEventListener('beforeunload', () => {
    if (window.betfredPlayTimeIntervals[gamePath]) {
      clearInterval(window.betfredPlayTimeIntervals[gamePath]);
      delete window.betfredPlayTimeIntervals[gamePath];
    }
    if (window.betfredPlayTimeSessions[gamePath]) {
      delete window.betfredPlayTimeSessions[gamePath];
    }
  });
}

// Helper function to apply minimum stake filter
async function applyMinStakeFilter(games) {
  // Try to get min stake filter from DOM first (if options panel is open)
  let minStakes = [];
  const minStakeCheckboxes = Array.from(document.querySelectorAll('.betfred-minstake-checkbox:checked'));
  if (minStakeCheckboxes.length > 0) {
    minStakes = minStakeCheckboxes.map(cb => parseFloat(cb.value));
  } else {
    // If options panel is closed, try to get from storage
    const savedMinStakes = await loadFromStorage('betfred_min_stakes', []);
    minStakes = savedMinStakes;
  }
  
  let maxAllowedStake = minStakes.length ? Math.max(...minStakes) : null;
  
  if (maxAllowedStake === null) return games;
  
  return games.filter(([path, data]) => {
    let minStakeStr = (data.minStake || '').replace(/[^\d.,]/g, '').replace(',', '.');
    let minStake = parseFloat(minStakeStr);
    if (isNaN(minStake)) return false;
    return minStake <= maxAllowedStake;
  });
}

export function showImportExportPopup() {
  // Create and show the popup for import/export
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.style.zIndex = 2147483647;
  const popup = document.createElement('div');
  popup.className = 'betfred-popup';
  popup.style.maxWidth = '500px';
  popup.style.margin = '40px auto';
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

      popup.innerHTML = `
      <div class="betfred-modal-content">
        <div class="betfred-modal-header">
          <span class="betfred-modal-title">Import/Export Database</span>
          <button class="betfred-close-btn" id="close-import-export" title="Close">×</button>
        </div>
        <div class="betfred-modal-body">
          <div style="margin-top:20px;margin-bottom:18px;">
            <p style="margin-bottom:10px;">Export your current game database to a JSON file. You can edit this file manually and re-import it.</p>
            <button id="export-db-with-dialog" class="betfred-btn">Export Database</button>
          </div>
          <hr style="margin:18px 0;border:none;border-top:1px solid #ccc;">
          <div style="margin-bottom:18px;">
            <p style="margin-bottom:10px;">Import a game database from a JSON file. This will overwrite your current data.</p>
            <button id="import-db-with-dialog" class="betfred-btn">Import Database</button>
          </div>
          <hr style="margin:18px 0;border:none;border-top:1px solid #ccc;">
          <div style="margin-bottom:18px;">
            <p style="margin-bottom:10px;">Export a simplified list of game titles and providers.</p>
            <button id="export-game-list" class="betfred-btn">Export Game List</button>
          </div>
        </div>
      </div>
    `;

  popup.querySelector('#export-db-with-dialog').onclick = async () => {
    await exportDatabaseWithSaveDialog();
  };

  popup.querySelector('#import-db-with-dialog').onclick = () => {
    const importFile = document.getElementById('betfred-import-file');
    if (importFile) {
      importFile.value = "";
      importFile.click();
    }
    overlay.remove();
  };

  popup.querySelector('#export-game-list').onclick = async () => {
    overlay.remove();
    showExportGameListOptions();
  };

  popup.querySelector('#close-import-export').onclick = (e) => {
    e.stopPropagation(); // Prevent event bubbling
    overlay.remove();
  };


}

export function showBulkActionsPopup() {
  // Show popup to choose bulk action
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.style.zIndex = 2147483647;
  const popup = document.createElement('div');
  popup.className = 'betfred-popup';
  popup.style.maxWidth = '500px';
  popup.style.margin = '40px auto';
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

      popup.innerHTML = `
      <div class="betfred-modal-content">
        <div class="betfred-modal-header">
          <span class="betfred-modal-title">Bulk Actions</span>
          <button class="betfred-close-btn" id="close-bulk-actions" title="Close">×</button>
        </div>
        <div class="betfred-modal-body">
          <div style="margin-top:20px;margin-bottom:18px;">What would you like to do?</div>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button id="bulk-remove-games" class="betfred-btn">Remove Games by Keyword</button>
            <button id="bulk-readd-games" class="betfred-btn">Re-Add Games by Keyword</button>
          </div>
        </div>
      </div>
    `;

  popup.querySelector('#bulk-remove-games').onclick = () => {
    overlay.remove();
    showBulkKeywordPopup('remove');
  };

  popup.querySelector('#bulk-readd-games').onclick = () => {
    overlay.remove();
    showBulkKeywordPopup('readd');
  };

  popup.querySelector('#close-bulk-actions').onclick = (e) => {
    e.stopPropagation(); // Prevent event bubbling
    overlay.remove();
  };


}

export async function showCustomFilterPanel() {
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.id = 'betfred-custom-filter-overlay';
  
  const customFilters = await getCustomFilters();
  const filterCount = Object.keys(customFilters).length;
  
  overlay.innerHTML = `
    <div class="betfred-modal">
      <button class="betfred-close-btn" onclick="this.closest('.betfred-overlay').remove()">×</button>
      
      <h3 class="betfred-modal-title">🎯 Custom Game Filters</h3>
      
      <div style="margin-bottom: 20px;">
        <p style="color: #cccccc; margin-bottom: 16px;">
          Create your own game filters to find specific types of games you love!
        </p>
        <div style="background: linear-gradient(135deg, rgba(30,34,60,0.3) 0%, rgba(22,33,62,0.3) 100%); border: 1px solid rgba(255,215,0,0.3); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
          <p style="color: #ffd700; font-weight: 600; margin: 0 0 8px 0;">📊 Current Status</p>
          <p style="color: #cccccc; margin: 0; font-size: 14px;">
            You have <strong style="color: #ffd700;">${filterCount}</strong> of <strong style="color: #ffd700;">${MAX_CUSTOM_FILTERS}</strong> custom filters
          </p>
        </div>
      </div>
      
      ${filterCount < MAX_CUSTOM_FILTERS ? `
        <button id="betfred-create-filter-btn" class="betfred-btn" style="margin-bottom: 20px;">
          ➕ Create New Filter
        </button>
      ` : `
        <div style="background: linear-gradient(135deg, rgba(220,53,69,0.1) 0%, rgba(253,126,20,0.1) 100%); border: 1px solid rgba(220,53,69,0.3); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
          <p style="color: #dc3545; font-weight: 600; margin: 0;">⚠️ Maximum Filters Reached</p>
          <p style="color: #cccccc; margin: 8px 0 0 0; font-size: 14px;">
            You've reached the maximum of ${MAX_CUSTOM_FILTERS} custom filters. Delete one to create a new one.
          </p>
        </div>
      `}
      
      <div id="betfred-custom-filters-list">
        ${Object.keys(customFilters).length === 0 ? `
          <div style="text-align: center; color: #888888; font-style: italic; padding: 20px;">
            No custom filters yet. Create your first one!
          </div>
        ` : Object.values(customFilters).map(filter => `
          <div class="betfred-custom-filter-item" data-filter-id="${filter.id}">
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: linear-gradient(135deg, rgba(30,34,60,0.5) 0%, rgba(22,33,62,0.5) 100%); border: 1px solid rgba(255,215,0,0.3); border-radius: 10px; margin-bottom: 8px;">
              <span style="font-size: 24px;">${filter.icon}</span>
              <div style="flex: 1;">
                <p style="color: #ffffff; font-weight: 600; margin: 0 0 4px 0;">${filter.name}</p>
                <p style="color: #cccccc; font-size: 12px; margin: 0;">
                  ${filter.keywords && filter.keywords.length > 0 ? `Keywords: ${filter.keywords.join(', ')}` : ''}
                  ${filter.keywords && filter.keywords.length > 0 && filter.selectedGames && filter.selectedGames.length > 0 ? ' + ' : ''}
                  ${filter.selectedGames && filter.selectedGames.length > 0 ? `${filter.selectedGames.length} selected games` : ''}
                  ${(!filter.keywords || filter.keywords.length === 0) && (!filter.selectedGames || filter.selectedGames.length === 0) ? 'No criteria set' : ''}
                </p>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="betfred-header-icon-btn edit-filter-btn" data-filter-id="${filter.id}" title="Edit Filter">✏️</button>
                <button class="betfred-header-icon-btn delete-filter-btn" data-filter-id="${filter.id}" title="Delete Filter">🗑️</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Add event listeners
  const createBtn = document.getElementById('betfred-create-filter-btn');
  if (createBtn) {
    createBtn.addEventListener('click', showCustomFilterCreationModal);
  }
  
  // Add event listeners for edit and delete buttons
  const editButtons = document.querySelectorAll('.edit-filter-btn');
  editButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filterId = btn.getAttribute('data-filter-id');
      editCustomFilter(filterId);
    });
  });
  
  const deleteButtons = document.querySelectorAll('.delete-filter-btn');
  deleteButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filterId = btn.getAttribute('data-filter-id');
      deleteCustomFilterConfirm(filterId);
    });
  });
}

async function showCustomFilterCreationModal(editingFilterId = null) {
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.id = 'betfred-custom-filter-creation-overlay';
  
  let editingFilter = null;
  if (editingFilterId) {
    const customFilters = await getCustomFilters();
    editingFilter = customFilters[editingFilterId];
  }
  
  const isEditing = !!editingFilter;
  const title = isEditing ? 'Edit Custom Filter' : 'Create Custom Filter';
  
  overlay.innerHTML = `
    <div class="betfred-modal">
      <button class="betfred-close-btn" onclick="this.closest('.betfred-overlay').remove()">×</button>
      
      <h3 class="betfred-modal-title">🎯 ${title}</h3>
      
      <form id="betfred-custom-filter-form">
        <div style="margin-bottom: 16px;">
          <label for="betfred-filter-name" style="color: #ffd700; font-weight: 600; display: block; margin-bottom: 8px;">
            Filter Name
          </label>
          <input 
            type="text" 
            id="betfred-filter-name" 
            class="betfred-input" 
            placeholder="e.g., Dragon Slots, Space Games"
            value="${editingFilter ? editingFilter.name : ''}"
            required
          >
        </div>
        
        <div id="betfred-games-section" style="margin-bottom: 20px;">
          <label style="color: #ffd700; font-weight: 600; display: block; margin-bottom: 8px;">
            Additional Specific Games (Optional)
          </label>
          <div class="betfred-custom-select" id="betfred-games-select-container">
            <div class="betfred-select-header" id="betfred-games-select-header">
              <span class="betfred-select-value" id="betfred-games-select-value">Select games to add...</span>
              <span class="betfred-select-arrow">▼</span>
            </div>
            <div class="betfred-select-dropdown" id="betfred-games-select-dropdown" style="display:none;">
              <input 
                type="text" 
                id="betfred-games-search" 
                class="betfred-input" 
                placeholder="Search games..." 
                style="margin-bottom: 8px;"
              >
              <div id="betfred-games-list" style="max-height: 300px; overflow-y: auto;">
                <!-- Games will be populated here -->
              </div>
            </div>
          </div>
          <div id="betfred-selected-games" style="margin-top: 8px;">
            <!-- Selected games will be shown here -->
          </div>
          <p style="color: #cccccc; font-size: 12px; margin: 8px 0 0 0;">
            Search and select additional games to include in this filter (optional).
          </p>
        </div>
        
        <div id="betfred-keywords-section" style="margin-bottom: 20px;">
          <label for="betfred-filter-keywords" style="color: #ffd700; font-weight: 600; display: block; margin-bottom: 8px;">
            Keywords (comma-separated)
          </label>
          <input 
            type="text" 
            id="betfred-filter-keywords" 
            class="betfred-input" 
            placeholder="e.g., dragon, fire, wyvern, scales"
            value="${editingFilter ? (editingFilter.keywords || []).join(', ') : ''}"
          >
          <p style="color: #cccccc; font-size: 12px; margin: 8px 0 0 0;">
            Enter keywords that appear in game titles. Separate with commas.
          </p>
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="color: #ffd700; font-weight: 600; display: block; margin-bottom: 8px;">
            Choose an Icon
          </label>
          <div id="betfred-icon-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
            ${CUSTOM_FILTER_ICONS.map(icon => `
              <button 
                type="button" 
                class="betfred-icon-option ${editingFilter && editingFilter.icon === icon ? 'selected' : ''}" 
                data-icon="${icon}"
                style="
                  width: 40px; height: 40px; font-size: 20px; border: 2px solid #3a3a6e; 
                  border-radius: 8px; background: #23244e; color: #ffd700; cursor: pointer;
                  transition: all 0.2s ease; display: flex; align-items: center; justify-content: center;
                "
              >
                ${icon}
              </button>
            `).join('')}
          </div>
        </div>
        
        <div id="betfred-filter-preview" style="
          background: linear-gradient(135deg, rgba(30,34,60,0.3) 0%, rgba(22,33,62,0.3) 100%); 
          border: 1px solid rgba(255,215,0,0.3); border-radius: 12px; padding: 16px; margin-bottom: 20px;
          cursor: pointer; transition: all 0.2s ease;
        ">
          <p style="color: #ffd700; font-weight: 600; margin: 0 0 8px 0;">📊 Live Preview (Click to view games)</p>
          <p style="color: #cccccc; margin: 0; font-size: 14px;" id="betfred-preview-text">
            ${editingFilter ? `This filter currently matches <strong style="color: #ffd700;">${await getCustomFilterGameCount(window.betfredScanData || {}, editingFilter.id, {[editingFilter.id]: editingFilter})}</strong> games` : 'Enter filter details to see preview'}
          </p>
        </div>
        
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button type="button" class="betfred-btn" onclick="this.closest('.betfred-overlay').remove()" style="background: linear-gradient(135deg, #6c757d 0%, #495057 100%);">
            Cancel
          </button>
          <button type="submit" class="betfred-btn">
            ${isEditing ? 'Update Filter' : 'Create Filter'}
          </button>
        </div>
      </form>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Add event listeners
  const form = document.getElementById('betfred-custom-filter-form');
  const iconGrid = document.getElementById('betfred-icon-grid');
  const nameInput = document.getElementById('betfred-filter-name');
  const keywordsInput = document.getElementById('betfred-filter-keywords');
  
  // Icon selection
  iconGrid.addEventListener('click', (e) => {
    if (e.target.classList.contains('betfred-icon-option')) {
      // Remove previous selection
      iconGrid.querySelectorAll('.betfred-icon-option').forEach(btn => {
        btn.classList.remove('selected');
        btn.style.borderColor = '#3a3a6e';
        btn.style.background = '#23244e';
      });
      
      // Select new icon
      e.target.classList.add('selected');
      e.target.style.borderColor = '#ffd700';
      e.target.style.background = '#1a1a2e';
      
      updateFilterPreview();
    }
  });
  
  // Live preview updates
  nameInput.addEventListener('input', updateFilterPreview);
  keywordsInput.addEventListener('input', updateFilterPreview);
  
  // Populate games list on load
  populateGamesList();
  
  // Add dropdown functionality for games selector
  const gamesSelectHeader = document.getElementById('betfred-games-select-header');
  const gamesSelectDropdown = document.getElementById('betfred-games-select-dropdown');
  
  if (gamesSelectHeader && gamesSelectDropdown) {
    gamesSelectHeader.addEventListener('click', () => {
      const isOpen = gamesSelectDropdown.style.display !== 'none';
      if (isOpen) {
        gamesSelectDropdown.style.display = 'none';
        gamesSelectHeader.parentElement.classList.remove('open');
      } else {
        gamesSelectDropdown.style.display = 'block';
        gamesSelectHeader.parentElement.classList.add('open');
        // Focus search input when opened
        const searchInput = document.getElementById('betfred-games-search');
        if (searchInput) {
          setTimeout(() => searchInput.focus(), 100);
        }
      }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!gamesSelectHeader.contains(e.target) && !gamesSelectDropdown.contains(e.target)) {
        gamesSelectDropdown.style.display = 'none';
        gamesSelectHeader.parentElement.classList.remove('open');
      }
    });
  }
  
  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const selectedIcon = iconGrid.querySelector('.betfred-icon-option.selected');
    if (!selectedIcon) {
      showToast('Please select an icon', false);
      return;
    }
    
    const keywords = keywordsInput.value.trim();
    const selectedGames = Array.from(document.querySelectorAll('.game-option.selected'))
      .map(option => option.dataset.path);
    
    if (!nameInput.value.trim()) {
      showToast('Please enter a filter name', false);
      return;
    }
    
    if (!keywords && selectedGames.length === 0) {
      showToast('Please enter keywords or select at least one game', false);
      return;
    }
    
    const filterData = {
      name: nameInput.value.trim(),
      icon: selectedIcon.dataset.icon,
      keywords: keywords,
      selectedGames: selectedGames
    };
    
    try {
      if (isEditing) {
        await updateCustomFilter(editingFilterId, filterData);
        showToast('Filter updated successfully!');
      } else {
        await addCustomFilter(filterData);
        showToast('Custom filter created successfully!');
      }
      
      overlay.remove();
      
      // Refresh the main custom filter panel if it's open
      const mainPanel = document.getElementById('betfred-custom-filter-overlay');
      if (mainPanel) {
        mainPanel.remove();
        showCustomFilterPanel();
      }
      
      // Refresh filter buttons
      await refreshCustomFilterButtons();
      
    } catch (error) {
      showToast(error.message, false);
    }
  });
  
  // Initialize preview
  updateFilterPreview();
  
  // Initialize preview
  updateFilterPreview();
  
  // Add hover effect and click handler for preview box
  const previewBox = document.getElementById('betfred-filter-preview');
  if (previewBox) {
    previewBox.addEventListener('mouseenter', () => {
      previewBox.style.borderColor = 'rgba(255,215,0,0.6)';
      previewBox.style.transform = 'translateY(-1px)';
    });
    
    previewBox.addEventListener('mouseleave', () => {
      previewBox.style.borderColor = 'rgba(255,215,0,0.3)';
      previewBox.style.transform = 'translateY(0)';
    });
    
    previewBox.addEventListener('click', showFilterPreviewModal);
  }
}

async function showFilterPreviewModal() {
  const nameInput = document.getElementById('betfred-filter-name');
  const keywordsInput = document.getElementById('betfred-filter-keywords');
  
  if (!nameInput || !keywordsInput) return;
  
  const name = nameInput.value.trim();
  const keywords = keywordsInput.value.trim();
  const selectedGames = Array.from(document.querySelectorAll('.game-option.selected'))
    .map(option => option.dataset.path);
  
  if (!name) {
    showToast('Please enter a filter name first', false);
    return;
  }
  
  if (!keywords && selectedGames.length === 0) {
    showToast('Please enter keywords or select games first', false);
    return;
  }
  
  // Get scan data
  let scanData = window.betfred_scan_data_cache || {};
  if (Object.keys(scanData).length === 0) {
    scanData = await loadFromStorage('betfred_scan_data', {});
  }
  
  // Create temporary filter for preview
  const tempFilter = {
    id: 'preview',
    name: name,
    keywords: keywords.split(',').map(k => k.trim()).filter(k => k),
    selectedGames: selectedGames,
    icon: '🎯',
    enabled: true
  };
  
  // Find all matching games
  const matchingGames = [];
  Object.entries(scanData).forEach(([path, data]) => {
    if (isCustomFilterGame(data.title, 'preview', {preview: tempFilter}, path)) {
      matchingGames.push({
        path: path,
        title: data.title,
        provider: data.provider,
        matchedBy: []
      });
    }
  });
  
  // Determine why each game matches
  matchingGames.forEach(game => {
    const titleLower = game.title.toLowerCase();
    
    // Check keywords
    if (tempFilter.keywords && tempFilter.keywords.length > 0) {
      tempFilter.keywords.forEach(keyword => {
        if (titleLower.includes(keyword.toLowerCase())) {
          game.matchedBy.push(`Keyword: "${keyword}"`);
        }
      });
    }
    
    // Check selected games
    if (tempFilter.selectedGames && tempFilter.selectedGames.includes(game.path)) {
      game.matchedBy.push('Manually selected');
    }
  });
  
  // Create modal
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.innerHTML = `
    <div class="betfred-modal" style="max-width: 800px; max-height: 80vh;">
      <button class="betfred-close-btn">×</button>
      
      <h3 class="betfred-modal-title">🎯 Filter Preview: ${name}</h3>
      
      <div style="margin-bottom: 20px;">
        <p style="color: #cccccc; margin-bottom: 16px;">
          These are the games that will be included in your filter. You can remove any games you don't want.
        </p>
        <div style="background: linear-gradient(135deg, rgba(30,34,60,0.3) 0%, rgba(22,33,62,0.3) 100%); border: 1px solid rgba(255,215,0,0.3); border-radius: 12px; padding: 16px;">
          <p style="color: #ffd700; font-weight: 600; margin: 0 0 8px 0;">📊 Filter Criteria</p>
          <p style="color: #cccccc; margin: 0; font-size: 14px;">
            ${tempFilter.keywords && tempFilter.keywords.length > 0 ? `Keywords: <strong style="color: #ffd700;">${tempFilter.keywords.join(', ')}</strong>` : ''}
            ${tempFilter.keywords && tempFilter.keywords.length > 0 && tempFilter.selectedGames && tempFilter.selectedGames.length > 0 ? '<br>' : ''}
            ${tempFilter.selectedGames && tempFilter.selectedGames.length > 0 ? `Selected Games: <strong style="color: #ffd700;">${tempFilter.selectedGames.length}</strong> games` : ''}
          </p>
        </div>
      </div>
      
      <div style="background: linear-gradient(135deg, rgba(30,34,60,0.3) 0%, rgba(22,33,62,0.3) 100%); border: 1px solid rgba(255,215,0,0.3); border-radius: 12px; padding: 16px; max-height: 400px; overflow-y: auto;">
        <p style="color: #ffd700; font-weight: 600; margin: 0 0 12px 0;">🎮 Matching Games (${matchingGames.length})</p>
        ${matchingGames.length === 0 ? `
          <p style="color: #888888; font-style: italic; text-align: center; padding: 20px;">
            No games match your current criteria. Try adjusting your keywords or selecting more games.
          </p>
        ` : matchingGames.map(game => `
          <div class="preview-game-item" data-path="${game.path}" style="
            display: flex; justify-content: space-between; align-items: center; 
            padding: 8px 12px; margin-bottom: 4px; 
            background: linear-gradient(135deg, rgba(30,34,60,0.5) 0%, rgba(22,33,62,0.5) 100%); 
            border: 1px solid rgba(255,215,0,0.2); border-radius: 8px;
            transition: all 0.2s ease;
          ">
            <div style="flex: 1;">
              <p style="color: #ffffff; font-weight: 600; margin: 0 0 2px 0; font-size: 14px;">${game.title}</p>
              <p style="color: #888888; font-size: 12px; margin: 0 0 2px 0;">${game.provider}</p>
              <p style="color: #ffd700; font-size: 11px; margin: 0;">${game.matchedBy.join(', ')}</p>
            </div>
            <button class="remove-preview-game-btn" data-path="${game.path}" style="
              background: linear-gradient(135deg, #dc3545 0%, #fd7e14 100%); 
              border: none; border-radius: 6px; color: white; 
              padding: 4px 8px; font-size: 12px; cursor: pointer;
              transition: all 0.2s ease;
            ">Remove</button>
          </div>
        `).join('')}
      </div>
      
      <div style="display: flex; gap: 12px; justify-content: center; margin-top: 20px;">
        <button class="betfred-btn close-preview-btn" style="background: linear-gradient(135deg, #6c757d 0%, #495057 100%);">
          Close
        </button>
        <button class="betfred-btn save-preview-btn" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); display: none;">
          Save Changes
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Track removed games for this preview session
  let removedGames = new Set();
  
  // Add event listeners for remove buttons
  const removeButtons = overlay.querySelectorAll('.remove-preview-game-btn');
  removeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gamePath = btn.getAttribute('data-path');
      removedGames.add(gamePath);
      
      console.log('Game removed:', gamePath);
      console.log('Total removed games:', removedGames.size);
      
      // Remove the game item from the modal
      const gameItem = btn.closest('.preview-game-item');
      if (gameItem) {
        gameItem.style.opacity = '0.5';
        gameItem.style.transform = 'translateX(-10px)';
        setTimeout(() => {
          gameItem.remove();
          updatePreviewGameCount();
          
          // Show save button if games have been removed
          const saveBtn = overlay.querySelector('.save-preview-btn');
          console.log('Save button in timeout:', saveBtn);
          console.log('Removed games size:', removedGames.size);
          if (saveBtn && removedGames.size > 0) {
            saveBtn.style.display = 'inline-block';
            console.log('Save button should now be visible');
          }
        }, 200);
        
        // Also show save button immediately (in case the timeout has issues)
        const saveBtnImmediate = overlay.querySelector('.save-preview-btn');
        if (saveBtnImmediate && removedGames.size > 0) {
          saveBtnImmediate.style.display = 'inline-block';
          console.log('Save button shown immediately');
        }
      }
    });
    
    // Add hover effects
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.05)';
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
    });
  });
  
  // Add hover effects for game items
  const gameItems = overlay.querySelectorAll('.preview-game-item');
  gameItems.forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.borderColor = 'rgba(255,215,0,0.4)';
      item.style.transform = 'translateX(2px)';
    });
    
    item.addEventListener('mouseleave', () => {
      item.style.borderColor = 'rgba(255,215,0,0.2)';
      item.style.transform = 'translateX(0)';
    });
  });
  
  // Add event listeners for close and save buttons
  const closeBtn = overlay.querySelector('.close-preview-btn');
  const saveBtn = overlay.querySelector('.save-preview-btn');
  const modalCloseBtn = overlay.querySelector('.betfred-close-btn');
  
  closeBtn.addEventListener('click', () => {
    // Clear excluded games when closing without saving
    window.betfredExcludedGames = new Set();
    overlay.remove();
  });
  
  modalCloseBtn.addEventListener('click', () => {
    // Clear excluded games when closing without saving
    window.betfredExcludedGames = new Set();
    overlay.remove();
  });
  
  saveBtn.addEventListener('click', () => {
    // Apply all the removals
    removedGames.forEach(gamePath => {
      removeGameFromPreview(gamePath);
    });
    
    showToast('Changes saved successfully!');
    overlay.remove();
  });
  
  // Debug: Log the save button to see if it exists
  console.log('Save button found:', saveBtn);
  console.log('Save button display style:', saveBtn ? saveBtn.style.display : 'not found');
}

function removeGameFromPreview(gamePath) {
  // Remove from selected games if it was manually selected
  const gameOption = document.querySelector(`.game-option[data-path="${gamePath}"]`);
  if (gameOption && gameOption.classList.contains('selected')) {
    gameOption.classList.remove('selected');
    removeSelectedGame(gamePath);
  }
  
  // Add to excluded games list (for keyword matches)
  if (!window.betfredExcludedGames) {
    window.betfredExcludedGames = new Set();
  }
  window.betfredExcludedGames.add(gamePath);
  
  // Update the preview
  updateFilterPreview();
}

function updatePreviewGameCount() {
  const countElement = document.querySelector('.betfred-modal p');
  if (countElement && countElement.textContent.includes('Matching Games')) {
    const remainingGames = document.querySelectorAll('.preview-game-item').length;
    countElement.textContent = `🎮 Matching Games (${remainingGames})`;
  }
}

async function populateGamesList() {
  const gamesList = document.getElementById('betfred-games-list');
  if (!gamesList) return;
  
  // Get scan data
  let scanData = window.betfred_scan_data_cache || {};
  if (Object.keys(scanData).length === 0) {
    scanData = await loadFromStorage('betfred_scan_data', {});
  }
  
  // Get current editing filter for pre-selection
  const editingFilterId = document.querySelector('.betfred-overlay').dataset.editingFilterId;
  let editingFilter = null;
  if (editingFilterId) {
    const customFilters = await getCustomFilters();
    editingFilter = customFilters[editingFilterId];
  }
  
  // Create game options
  const games = Object.entries(scanData)
    .map(([path, data]) => ({ path, title: data.title, provider: data.provider }))
    .sort((a, b) => a.title.localeCompare(b.title));
  
  gamesList.innerHTML = games.map(game => `
    <div class="betfred-select-option game-option" data-path="${game.path}" data-title="${game.title}" data-provider="${game.provider}" style="display: flex; justify-content: space-between; align-items: center;">
      <span style="flex: 1; font-size: 14px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${game.title}</span>
      <span style="color: #888888; font-size: 12px; margin-left: 12px; flex-shrink: 0;">${game.provider}</span>
    </div>
  `).join('');
  
  // Add click handlers for game selection
  gamesList.querySelectorAll('.game-option').forEach(option => {
    option.addEventListener('click', () => {
      const path = option.dataset.path;
      const title = option.dataset.title;
      
      // Toggle selection
      if (option.classList.contains('selected')) {
        option.classList.remove('selected');
        removeSelectedGame(path);
      } else {
        option.classList.add('selected');
        addSelectedGame(path, title);
      }
      
      updateFilterPreview();
    });
    
    // Pre-select if editing
    if (editingFilter && editingFilter.selectedGames && editingFilter.selectedGames.includes(option.dataset.path)) {
      option.classList.add('selected');
    }
  });
  
  // Add search functionality
  const searchInput = document.getElementById('betfred-games-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      gamesList.querySelectorAll('.game-option').forEach(option => {
        const title = option.dataset.title.toLowerCase();
        const provider = option.dataset.provider.toLowerCase();
        const matches = title.includes(searchTerm) || provider.includes(searchTerm);
        option.style.display = matches ? 'flex' : 'none';
      });
    });
  }
  
  // Initialize selected games display
  updateSelectedGamesDisplay();
}

function addSelectedGame(path, title) {
  const selectedGamesContainer = document.getElementById('betfred-selected-games');
  if (!selectedGamesContainer) return;
  
  // Check if already added
  if (selectedGamesContainer.querySelector(`[data-path="${path}"]`)) return;
  
  const gameTag = document.createElement('div');
  gameTag.className = 'selected-game-tag';
  gameTag.dataset.path = path;
  gameTag.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px; 
    background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%); 
    color: #1a1a2e; padding: 4px 8px; border-radius: 12px; 
    font-size: 12px; font-weight: 600; margin: 2px; cursor: pointer;
    transition: all 0.2s ease;
  `;
  
  gameTag.innerHTML = `
    <span>${title}</span>
    <span class="remove-game-btn" style="cursor: pointer; font-weight: bold; padding: 0 2px; border-radius: 2px; transition: background 0.2s;">×</span>
  `;
  
  // Add click handler for the remove button
  const removeBtn = gameTag.querySelector('.remove-game-btn');
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent event bubbling
    removeSelectedGame(path);
  });
  
  // Add hover effect for the remove button
  removeBtn.addEventListener('mouseenter', () => {
    removeBtn.style.background = 'rgba(220, 53, 69, 0.2)';
  });
  
  removeBtn.addEventListener('mouseleave', () => {
    removeBtn.style.background = 'transparent';
  });
  
  selectedGamesContainer.appendChild(gameTag);
}

function removeSelectedGame(path) {
  // Remove from selected games display
  const selectedGamesContainer = document.getElementById('betfred-selected-games');
  if (selectedGamesContainer) {
    const gameTag = selectedGamesContainer.querySelector(`[data-path="${path}"]`);
    if (gameTag) {
      gameTag.remove();
    }
  }
  
  // Remove selection from dropdown
  const gameOption = document.querySelector(`.game-option[data-path="${path}"]`);
  if (gameOption) {
    gameOption.classList.remove('selected');
  }
}

function updateSelectedGamesDisplay() {
  const selectedGamesContainer = document.getElementById('betfred-selected-games');
  if (!selectedGamesContainer) return;
  
  // Clear existing display
  selectedGamesContainer.innerHTML = '';
  
  // Get currently selected games
  const selectedOptions = document.querySelectorAll('.game-option.selected');
  selectedOptions.forEach(option => {
    addSelectedGame(option.dataset.path, option.dataset.title);
  });
}

async function updateFilterPreview() {
  const nameInput = document.getElementById('betfred-filter-name');
  const keywordsInput = document.getElementById('betfred-filter-keywords');
  const previewText = document.getElementById('betfred-preview-text');
  
  if (!nameInput || !previewText) return;
  
  const name = nameInput.value.trim();
  
  if (!name) {
    previewText.innerHTML = 'Enter filter name to see preview';
    return;
  }
  
  // Get scan data from storage or cache
  let scanData = window.betfred_scan_data_cache || {};
  if (Object.keys(scanData).length === 0) {
    scanData = await loadFromStorage('betfred_scan_data', {});
  }
  
  const keywords = keywordsInput?.value?.trim() || '';
  const selectedGames = Array.from(document.querySelectorAll('.game-option.selected'))
    .map(option => option.dataset.path);
  
  // Create temporary filter for preview
  const tempFilter = {
    id: 'preview',
    name: name,
    keywords: keywords.split(',').map(k => k.trim()).filter(k => k),
    selectedGames: selectedGames,
    icon: '🎯',
    enabled: true
  };
  
  const gameCount = getCustomFilterGameCount(scanData, 'preview', {preview: tempFilter});
  
  let details = [];
  if (keywords) {
    details.push(`Keywords: <strong style="color: #ffd700;">${tempFilter.keywords.join(', ')}</strong>`);
  }
  if (selectedGames.length > 0) {
    details.push(`Selected: <strong style="color: #ffd700;">${selectedGames.length}</strong> games`);
  }
  
  const detailsText = details.length > 0 ? details.join('<br>') : 'No criteria set';
  
  previewText.innerHTML = `
    Filter: <strong style="color: #ffd700;">${name}</strong><br>
    ${detailsText}<br>
    Total Matches: <strong style="color: #ffd700;">${gameCount}</strong> games
  `;
}

async function editCustomFilter(filterId) {
  await showCustomFilterCreationModal(filterId);
}

async function deleteCustomFilterConfirm(filterId) {
  const customFilters = await getCustomFilters();
  const filter = customFilters[filterId];
  
  if (!filter) return;
  
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.innerHTML = `
    <div class="betfred-confirm-box">
      <h4 style="color: #ffd700; margin-bottom: 16px;">🗑️ Delete Custom Filter</h4>
      <p style="color: #cccccc; margin-bottom: 20px;">
        Are you sure you want to delete the filter "<strong style="color: #ffffff;">${filter.name}</strong>"?
      </p>
      <p style="color: #888888; font-size: 14px; margin-bottom: 20px;">
        This action cannot be undone.
      </p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button class="betfred-btn cancel-delete-btn" style="background: linear-gradient(135deg, #6c757d 0%, #495057 100%);">
          Cancel
        </button>
        <button class="betfred-btn confirm-delete-btn" data-filter-id="${filterId}" style="background: linear-gradient(135deg, #dc3545 0%, #fd7e14 100%);">
          Delete Filter
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Add event listeners
  const cancelBtn = overlay.querySelector('.cancel-delete-btn');
  const confirmBtn = overlay.querySelector('.confirm-delete-btn');
  
  cancelBtn.addEventListener('click', () => {
    overlay.remove();
  });
  
  confirmBtn.addEventListener('click', async () => {
    const filterIdToDelete = confirmBtn.getAttribute('data-filter-id');
    await deleteCustomFilterAction(filterIdToDelete);
    overlay.remove(); // Close the confirmation dialog
  });
}

async function deleteCustomFilterAction(filterId) {
  try {
    await deleteCustomFilter(filterId);
    showToast('Custom filter deleted successfully!');
    
    // Close confirmation dialog
    const overlay = document.querySelector('.betfred-overlay');
    if (overlay) overlay.remove();
    
    // Close the main custom filter panel if it's open
    const mainPanel = document.getElementById('betfred-custom-filter-overlay');
    if (mainPanel) {
      mainPanel.remove();
    }
    
    // Refresh filter buttons
    await refreshCustomFilterButtons();
    
  } catch (error) {
    showToast(error.message, false);
  }
}

async function addCustomFilterButtons() {
  const filterBox = document.querySelector('.betfred-filter-box');
  if (!filterBox) return;
  
  const customFilters = await getCustomFilters();
  
  // Remove any existing custom filter buttons
  const existingCustomButtons = filterBox.querySelectorAll('[data-custom-filter]');
  existingCustomButtons.forEach(btn => btn.remove());
  
  // Add new custom filter buttons
  Object.values(customFilters).forEach(filter => {
    if (filter.enabled) {
      const button = document.createElement('button');
      button.id = `betfred-${filter.id}-toggle`;
      button.className = 'betfred-filter-btn';
      button.setAttribute('data-custom-filter', filter.id);
      button.title = `Show ${filter.name}`;
      button.setAttribute('aria-label', `${filter.name} Filter`);
      button.textContent = filter.icon;
      
      // Add click handler with toggle functionality
      button.addEventListener('click', () => {
        const currentActiveFilter = document.querySelector('.betfred-filter-btn.active');
        if (currentActiveFilter && currentActiveFilter.id === button.id) {
          // If clicking the same filter, deselect it
          setActiveFilter(null);
        } else {
          // Otherwise, select this filter
          setActiveFilter(filter.id);
        }
      });
      
      filterBox.appendChild(button);
    }
  });
}

async function refreshCustomFilterButtons() {
  await addCustomFilterButtons();
}

export function showInstructionsPanel() {
  // Create and show the instructions panel
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.style.zIndex = 2147483647;
  const popup = document.createElement('div');
  popup.className = 'betfred-popup betfred-instructions-popup';
  popup.style.maxWidth = '700px';
  popup.style.maxHeight = '80vh';
  popup.style.overflowY = 'auto';
  popup.style.margin = '40px auto';
  // Hide scrollbar
  popup.style.scrollbarWidth = 'none';
  popup.style.msOverflowStyle = 'none';
  popup.style.webkitScrollbar = 'none';
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Add CSS to hide scrollbars on all elements in the instructions panel
  const style = document.createElement('style');
  style.textContent = `
    .betfred-instructions-popup * {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    .betfred-instructions-popup *::-webkit-scrollbar {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  popup.innerHTML = `
    <div class="betfred-modal-content" style="scrollbar-width: none; -ms-overflow-style: none;">
      <div class="betfred-modal-header">
        <span class="betfred-modal-title">📖 Instructions & Help</span>
        <button class="betfred-close-btn" id="close-instructions" title="Close">×</button>
      </div>
      <div class="betfred-modal-body" style="scrollbar-width: none; -ms-overflow-style: none;">
        <div style="margin-top:20px; scrollbar-width: none; -ms-overflow-style: none;">
          <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-bottom:24px;">
            <button class="betfred-btn betfred-btn--info" id="show-user-guide" style="font-size:14px;padding:10px 16px;">
              <span class="betfred-icon">🎮</span>
              <span>User Guide</span>
            </button>
            <button class="betfred-btn betfred-btn--primary" id="show-troubleshooting" style="font-size:14px;padding:10px 16px;">
              <span class="betfred-icon">🔧</span>
              <span>Troubleshooting</span>
            </button>
            <button class="betfred-btn betfred-btn--success" id="show-features" style="font-size:14px;padding:10px 16px;">
              <span class="betfred-icon">✨</span>
              <span>Features</span>
            </button>
            <button class="betfred-btn betfred-btn--danger" id="show-advanced" style="font-size:14px;padding:10px 16px;">
              <span class="betfred-icon">⚙️</span>
              <span>Advanced</span>
            </button>
          </div>
          
          <div id="instructions-content" style="text-align:left;line-height:1.6; scrollbar-width: none; -ms-overflow-style: none;">
            <h3 style="color:#ffd700;margin-bottom:16px;">🎮 User Guide</h3>
            <div style="margin-bottom:16px;">
              <h4 style="color:#ffd700;margin-bottom:8px;">Getting Started</h4>
              <p>1. <strong>Install the extension</strong> (if you haven't already)</p>
              <p>2. <strong>Go to Betfred's website</strong> and log in</p>
              <p>3. <strong>Look for the "Options" button</strong> near the deposit button</p>
              <p>4. <strong>Click it</strong> to open the extension panel</p>
            </div>
            
            <div style="margin-bottom:16px;">
              <h4 style="color:#ffd700;margin-bottom:8px;">Main Features</h4>
              <p>• <strong>Random Game</strong> - Click to launch a random game</p>
              <p>• <strong>Favorites</strong> - See and manage your favorite games</p>
              <p>• <strong>Filters</strong> - Filter games by theme (Christmas, Halloween, etc.)</p>
              <p>• <strong>Database</strong> - View all games in your database</p>
              <p>• <strong>Settings</strong> - Customize the extension</p>
              <p>• <strong>Statistics</strong> - Click the header icon to view your gaming stats</p>
            </div>
            
            <div style="margin-bottom:16px;">
              <h4 style="color:#ffd700;margin-bottom:8px;">Game Filters</h4>
              <p>Use the filter buttons to find specific types of games:</p>
              <p>⭐ <strong>Favorites</strong> - Your saved games</p>
              <p>🎄 <strong>Christmas</strong> - Christmas-themed slots</p>
              <p>🎃 <strong>Halloween</strong> - Halloween-themed slots</p>
              <p>🐰 <strong>Easter</strong> - Easter-themed slots</p>
              <p>🎰 <strong>Megaways</strong> - Megaways slots</p>
              <p>🏅 <strong>Sport</strong> - Sports-themed games</p>
              <p>🐟 <strong>Fishing</strong> - Fishing and marine-themed slots</p>
              <p>🎬 <strong>TV & Movies</strong> - TV, movie, and game show-themed games</p>
            </div>
            
            <div style="margin-bottom:16px;">
              <h4 style="color:#ffd700;margin-bottom:8px;">Statistics Dashboard</h4>
              <p>Track your gaming activity with detailed analytics:</p>
              <p>📊 <strong>Click the header icon</strong> - Opens your statistics panel</p>
              <p>🏆 <strong>Most Played Games</strong> - See your top games by play count</p>
              <p>⏱️ <strong>Play Time Analysis</strong> - Track time spent on each game</p>
              <p>🎮 <strong>Provider Breakdown</strong> - See which providers you play most</p>
              <p>🕒 <strong>Recent Activity</strong> - View your latest gaming sessions</p>
              <p>🏅 <strong>Achievements</strong> - Monitor your gaming milestones</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Content for different sections
  const content = {
    userGuide: `
      <h3 style="color:#ffd700;margin-bottom:16px;">🎮 User Guide</h3>
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">Getting Started</h4>
        <p>1. <strong>Install the extension</strong> (if you haven't already)</p>
        <p>2. <strong>Go to Betfred's website</strong> and log in</p>
        <p>3. <strong>Look for the "Options" button</strong> near the deposit button</p>
        <p>4. <strong>Click it</strong> to open the extension panel</p>
      </div>
      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">Main Features</h4>
        <p>• <strong>Random Game</strong> - Click to launch a random game</p>
        <p>• <strong>Favorites</strong> - See and manage your favorite games</p>
        <p>• <strong>Filters</strong> - Filter games by theme (Christmas, Halloween, etc.)</p>
        <p>• <strong>Database</strong> - View all games in your database</p>
        <p>• <strong>Settings</strong> - Customize the extension</p>
        <p>• <strong>Statistics</strong> - Click the header icon to view your gaming stats</p>
      </div>
      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">Game Filters</h4>
        <p>Use the filter buttons to find specific types of games:</p>
        <p>⭐ <strong>Favorites</strong> - Your saved games</p>
        <p>🎄 <strong>Christmas</strong> - Christmas-themed slots</p>
        <p>🎃 <strong>Halloween</strong> - Halloween-themed slots</p>
        <p>🐰 <strong>Easter</strong> - Easter-themed slots</p>
        <p>💕 <strong>Romance</strong> - Romance-themed slots</p>
        <p>🎰 <strong>Megaways</strong> - Megaways slots</p>
        <p>🏅 <strong>Sport</strong> - Sports-themed games</p>
        <p>🐟 <strong>Fishing</strong> - Fishing and marine-themed slots</p>
        <p>🎬 <strong>TV & Movies</strong> - TV, movie, and game show-themed games</p>
      </div>
      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">🎯 Custom Filters (NEW!)</h4>
        <p>Create your own personalized game filters:</p>
        <p>• <strong>Create custom filters</strong> - Combine keywords and specific game selections</p>
        <p>• <strong>Searchable game selection</strong> - Easily find and select specific games</p>
        <p>• <strong>Live preview</strong> - See exactly which games will be included</p>
        <p>• <strong>Remove unwanted games</strong> - Exclude games you don't want in your filter</p>
        <p>• <strong>Save or discard changes</strong> - Choose to save exclusions or close without saving</p>
        <p>• <strong>Professional interface</strong> - Beautiful, intuitive design with smooth animations</p>
        
        <p style="margin-top:12px;"><strong>How to Create Custom Filters:</strong></p>
        <p>1. <strong>Open Settings</strong> - Click the ⚙️ button in the extension panel</p>
        <p>2. <strong>Click "Custom Filters"</strong> - In the Actions section</p>
        <p>3. <strong>Click "Create New Filter"</strong> - Start building your filter</p>
        <p>4. <strong>Add filter name</strong> - Give your filter a memorable name</p>
        <p>5. <strong>Select specific games</strong> - Use the searchable dropdown to pick games</p>
        <p>6. <strong>Add keywords</strong> - Enter comma-separated keywords for automatic detection</p>
        <p>7. <strong>Choose an icon</strong> - Pick from 15 unique icons to represent your filter</p>
        <p>8. <strong>Preview and refine</strong> - Click the preview box to see all matching games</p>
        <p>9. <strong>Remove unwanted games</strong> - Click "Remove" on games you don't want</p>
        <p>10. <strong>Save your filter</strong> - Click "Save Changes" to finalize your filter</p>
        
        <p style="margin-top:12px;"><strong>Managing Custom Filters:</strong></p>
        <p>• <strong>Edit filters</strong> - Click the ✏️ button to modify existing filters</p>
        <p>• <strong>Delete filters</strong> - Click the 🗑️ button to remove filters</p>
        <p>• <strong>Use filters</strong> - Your custom filters appear alongside the built-in filters</p>
        <p>• <strong>Maximum 3 filters</strong> - Create up to 3 custom filters at once</p>
      </div>
      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">Statistics Dashboard</h4>
        <p>Track your gaming activity with detailed analytics:</p>
        <p>📊 <strong>Click the header icon</strong> - Opens your statistics panel</p>
        <p>🏆 <strong>Most Played Games</strong> - See your top games by play count</p>
        <p>⏱️ <strong>Play Time Analysis</strong> - Track time spent on each game</p>
        <p>🎮 <strong>Provider Breakdown</strong> - See which providers you play most</p>
        <p>🕒 <strong>Recent Activity</strong> - View your latest gaming sessions</p>
        <p>🏅 <strong>Achievements</strong> - Monitor your gaming milestones</p>
      </div>
    `,
    
    troubleshooting: `
      <h3 style="color:#ffd700;margin-bottom:16px;">🔧 Troubleshooting</h3>
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">The Extension Isn't Working?</h4>
        <p><strong>Step 1: Refresh the page</strong></p>
        <p>• Press F5 or click the refresh button</p>
        <p>• This usually fixes everything</p>
        
        <p><strong>Step 2: Check if it's working</strong></p>
        <p>• Press F12 to open browser console</p>
        <p>• Look for any error messages</p>
        <p>• Check if the extension is loading properly</p>
        
        <p><strong>Step 3: Reset if needed</strong></p>
        <p>• Try refreshing the page</p>
        <p>• Clear browser cache and cookies</p>
        <p>• Reinstall the extension if needed</p>
      </div>
      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">Common Issues</h4>
        <p><strong>"Options button not showing"</strong></p>
        <p>• Make sure you're logged into Betfred</p>
        <p>• Try refreshing the page</p>
        <p>• Check if you're on the main Betfred website</p>
        
        <p><strong>"Extension not responding"</strong></p>
        <p>• Refresh the page</p>
        <p>• Try the reset command above</p>
        <p>• Make sure you're logged in</p>
        
        <p><strong>"Games not loading"</strong></p>
        <p>• Wait a few seconds for the page to load completely</p>
        <p>• Try refreshing the page</p>
        <p>• Check your internet connection</p>
      </div>
    `,
    
    features: `
      <h3 style="color:#ffd700;margin-bottom:16px;">✨ Features</h3>
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">🎮 What This Extension Does</h4>
        <p>The Betfred extension helps you manage your favorite games and find new ones on Betfred's website. It adds helpful features like:</p>
        <p>• <strong>Game Database</strong> - Keep track of all your games</p>
        <p>• <strong>Favorites Sync</strong> - Automatically sync with Betfred's favorites</p>
        <p>• <strong>Random Game</strong> - Find new games to try</p>
        <p>• <strong>Game Filters</strong> - Filter by Christmas, Halloween, Megaways, etc.</p>
        <p>• <strong>Custom Filters</strong> - Create your own personalized game filters</p>
        <p>• <strong>Game Stats</strong> - Track which games you've played</p>
      </div>
      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">🔧 Automatic Compatibility</h4>
        <p><strong>Good news!</strong> The extension now automatically adapts when Betfred changes their website.</p>
        <p><strong>What This Means For You:</strong></p>
        <p>✅ <strong>No manual updates needed</strong> - The extension fixes itself</p>
        <p>✅ <strong>Always works</strong> - Even after Betfred changes their site</p>
        <p>✅ <strong>Invisible</strong> - You won't notice any difference</p>
        <p>✅ <strong>Fast</strong> - Remembers what works for next time</p>
      </div>
      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">💡 Tips</h4>
        <p>• <strong>Always log in</strong> to Betfred before using the extension</p>
        <p>• <strong>Refresh the page</strong> if something seems wrong</p>
        <p>• <strong>Use the filters</strong> to find new games you might like</p>
        <p>• <strong>Try the random game</strong> feature to discover new slots</p>
        <p>• <strong>Check the console</strong> (F12) if you need help</p>
      </div>
    `,
    
    advanced: `
      <h3 style="color:#ffd700;margin-bottom:16px;">⚙️ Advanced</h3>

      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">Settings</h4>
        <p><strong>Open game in current tab</strong> - Games open in the same tab instead of new ones</p>
        <p><strong>Display RTP in game list</strong> - Shows RTP percentages in the game dropdown</p>
        <p><strong>Hide staking options</strong> - Removes staking checkboxes from the interface</p>
        <p><strong>Compact mode hide headers</strong> - Reduces the size of section headers</p>
        <p><strong>Hide Dashboard</strong> - Hides the statistics dashboard</p>
      </div>
      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">Database Management</h4>
        <p><strong>Import/Export</strong> - Backup and restore your game database</p>
        <p><strong>Bulk Actions</strong> - Remove or re-add multiple games by keyword</p>
        <p><strong>Manual Add</strong> - Manually add games to your database</p>
        <p><strong>Auto-sync</strong> - Automatically syncs with Betfred's favorites</p>
      </div>
      
      <div style="margin-bottom:16px;">
        <h4 style="color:#ffd700;margin-bottom:8px;">Custom Filter Management</h4>
        <p><strong>Create Custom Filters</strong> - Combine keywords and specific game selections</p>
        <p><strong>Live Preview</strong> - See exactly which games will be included</p>
        <p><strong>Interactive Refinement</strong> - Remove unwanted games before saving</p>
        <p><strong>Smart Save System</strong> - Choose to save changes or discard them</p>
        <p><strong>Filter Management</strong> - Edit, delete, and organize up to 3 custom filters</p>
      </div>
    `
  };

  // Event handlers for content buttons
  popup.querySelector('#show-user-guide').onclick = () => {
    popup.querySelector('#instructions-content').innerHTML = content.userGuide;
  };

  popup.querySelector('#show-troubleshooting').onclick = () => {
    popup.querySelector('#instructions-content').innerHTML = content.troubleshooting;
  };

  popup.querySelector('#show-features').onclick = () => {
    popup.querySelector('#instructions-content').innerHTML = content.features;
  };

  popup.querySelector('#show-advanced').onclick = () => {
    popup.querySelector('#instructions-content').innerHTML = content.advanced;
  };

  popup.querySelector('#close-instructions').onclick = (e) => {
    e.stopPropagation();
    overlay.remove();
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  };


}




async function exportDatabaseWithSaveDialog() {
  const scanData = await loadFromStorage('betfred_scan_data', {});
  
  
  if (Object.keys(scanData).length === 0) {
    showToast("No games in database to export!", false);
    return;
  }
  
  let json = JSON.stringify(scanData, null, 2);
  json = '{\n' + Object.entries(scanData).map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`).join(',\n') + '\n}';
  const blob = new Blob([json], { type: "application/json" });

  // Feature detect showSaveFilePicker
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'betfred-games-database.json',
        types: [{
          description: 'JSON Files',
          accept: { 'application/json': ['.json'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      showToast("Database exported!");
    } catch (err) {
      // Handle user cancellation or errors
      if (err.name !== 'AbortError') {
        showToast("Failed to export database: " + err.message);
      }
    }
  } else {
    // Fallback for browsers like Firefox
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "betfred-games-database.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Database exported!");
    } catch (err) {
      showToast("Failed to export database: " + err.message);
    }
  }
}

async function exportGameList(providerFilter = null) {
  try {
    const scanData = await loadFromStorage('betfred_scan_data', {});
    const favorites = await getFavorites();
    const blacklist = await loadFromStorage('betfred_permanently_removed', {});

    let seenTitles = new Set();
    let uniqueGames = [];
    Object.entries(scanData).forEach(([path, data]) => {
      if (!blacklist[path]) {
        // Apply provider filter if specified
        if (providerFilter && data.provider !== providerFilter) {
          return;
        }
        const normalizedTitle = (data.title || "").trim().toLowerCase();
        if (!seenTitles.has(normalizedTitle)) {
          seenTitles.add(normalizedTitle);
          uniqueGames.push({
            title: data.title,
            provider: data.provider,
            favorite: !!favorites[path]
          });
        }
      }
    });

    uniqueGames.sort((a, b) => a.title.localeCompare(b.title));

    // Check if we have any games to export
    if (uniqueGames.length === 0) {
      const message = providerFilter 
        ? `No games found for provider: ${providerFilter}`
        : "No games found to export";
      showToast(message, false);
      return;
    }

    // Create text content instead of CSV
    const textContent = uniqueGames.map(g => g.title).join('\n');
    const blob = new Blob([textContent], { type: "text/plain" });

  const suggestedFileName = providerFilter 
    ? `betfred_game_list_${providerFilter.replace(/[^a-zA-Z0-9]/g, '_')}.txt`
    : 'betfred_game_list.txt';

  // Feature detect showSaveFilePicker
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedFileName,
        types: [{
          description: 'Text Files',
          accept: { 'text/plain': ['.txt'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      
      const message = providerFilter 
        ? `Game list exported for ${providerFilter}!`
        : "Game list exported!";
      showToast(message);
    } catch (err) {
      // Handle user cancellation - this is normal behavior, not an error
      if (err.name === 'AbortError') {
        return; // Don't show any error message for cancellation
      }
      
      // Handle actual errors
      const errorMessage = err.message || err.toString() || 'Unknown error occurred';
      showToast("Failed to export game list: " + errorMessage);
    }
  } else {
    // Fallback for browsers like Firefox
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      const message = providerFilter 
        ? `Game list exported for ${providerFilter}!`
        : "Game list exported!";
      showToast(message);
    } catch (err) {
      // Handle user cancellation - this is normal behavior, not an error
      if (err.name === 'AbortError') {
        return; // Don't show any error message for cancellation
      }
      
      // Handle actual errors
      const errorMessage = err.message || err.toString() || 'Unknown error occurred';
      showToast("Failed to export game list: " + errorMessage);
    }
  }
  } catch (err) {
    // Handle user cancellation - this is normal behavior, not an error
    if (err.name === 'AbortError') {
      return; // Don't show any error message for cancellation
    }
    
    // Handle actual errors
    const errorMessage = err.message || err.toString() || 'Unknown error occurred';
    showToast("Failed to export game list: " + errorMessage, false);
  }
}

export function showExportGameListOptions() {
  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.style.zIndex = 2147483647;
  const popup = document.createElement('div');
  popup.className = 'betfred-popup';
  popup.style.maxWidth = '500px';
  popup.style.margin = '40px auto';
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Get provider list with counts
  const getProviderListWithCounts = async () => {
    const scanData = await loadFromStorage('betfred_scan_data', {});
    const blacklist = await loadFromStorage('betfred_permanently_removed', {});
    
    const providerMap = new Map();
    const providerCounts = new Map();
    
    Object.entries(scanData).forEach(([path, d]) => {
      if (d.provider && !blacklist[path]) {
        const cleanProvider = d.provider.trim();
        // Handle common variations
        let normalizedProvider = cleanProvider;
        if (cleanProvider.toLowerCase().includes('yggdrasil') || cleanProvider.toLowerCase() === 'yggdrasi') {
          normalizedProvider = 'Yggdrasil';
        }
        if (cleanProvider.toLowerCase().includes('bullet proof')) {
          normalizedProvider = 'BulletProof';
        }
        if (cleanProvider.toLowerCase() === 'elk') {
          normalizedProvider = 'ELK Studios';
        }
        if (cleanProvider.toLowerCase() === 'redtiger') {
          normalizedProvider = 'Red Tiger';
        }
        
        if (!providerMap.has(normalizedProvider)) {
          providerMap.set(normalizedProvider, cleanProvider);
          providerCounts.set(normalizedProvider, 0);
        }
        providerCounts.set(normalizedProvider, providerCounts.get(normalizedProvider) + 1);
      }
    });
    
    return Array.from(providerMap.keys())
      .sort((a, b) => a.localeCompare(b))
      .map(provider => ({
        name: provider,
        count: providerCounts.get(provider)
      }));
  };

  getProviderListWithCounts().then(providers => {
    popup.innerHTML = `
      <div class="betfred-modal-content">
        <div class="betfred-modal-header">
          <span class="betfred-modal-title">Export Game List</span>
          <button class="betfred-close-btn" id="close-export-options" title="Close">×</button>
        </div>
        <div class="betfred-modal-body">
          <div style="margin-bottom:18px;">
            <p style="margin-bottom:15px;color:#cccccc;">Choose what to export:</p>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <button id="export-all-games" class="betfred-btn">Export All Games</button>
              <button id="export-by-provider" class="betfred-btn">By Provider</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Add click handler for export all games
    popup.querySelector('#export-all-games').onclick = async () => {
      overlay.remove();
      await exportGameList();
    };

    // Add click handler for export by provider
    popup.querySelector('#export-by-provider').onclick = () => {
      showProviderSelectionPanel(overlay, providers);
    };

    // Add close handler
    popup.querySelector('#close-export-options').onclick = () => {
      overlay.remove();
    };
  });
}

// Function to show provider selection panel
function showProviderSelectionPanel(overlay, providers) {
  const popup = overlay.querySelector('.betfred-popup');
  
  popup.innerHTML = `
    <div class="betfred-modal-content">
      <div class="betfred-modal-header">
        <span class="betfred-modal-title">Select Provider</span>
        <button class="betfred-close-btn" id="close-provider-selection" title="Close">×</button>
      </div>
      <div class="betfred-modal-body">
        <div style="margin-bottom:18px;">
          <p style="margin-bottom:15px;color:#cccccc;">Choose a provider to export games from:</p>
          <div class="betfred-provider-selection-list" style="display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto;">
            ${providers.map(provider => `
              <button class="betfred-provider-export-btn" data-provider="${provider.name}" style="
                background: linear-gradient(135deg, rgba(30,34,60,0.92) 60%, #23244e 100%);
                border: 2px solid rgba(255,215,0,0.55);
                color: #ffd700;
                font-size: 16px;
                border-radius: 10px;
                padding: 12px 16px;
                box-shadow: 0 2px 8px 0 rgba(0,0,0,0.13);
                opacity: 0.85;
                transition: all 0.2s;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;
                font-weight: 600;
                text-align: left;
              ">
                <span>${provider.name}</span>
                <span style="color: #cccccc; font-size: 14px;">${provider.count} games</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  // Add click handlers for provider buttons
  popup.querySelectorAll('.betfred-provider-export-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const provider = btn.getAttribute('data-provider');
      await exportGameList(provider);
      // Don't close the panel - let user choose when to close
    });
    
    // Add hover effects
    btn.addEventListener('mouseover', () => {
      btn.style.background = 'linear-gradient(135deg, #ffd700 0%, #ffe066 100%)';
      btn.style.color = '#23244e';
      btn.style.borderColor = '#ffe066';
      btn.style.opacity = '1';
    });
    
    btn.addEventListener('mouseout', () => {
      btn.style.background = 'linear-gradient(135deg, rgba(30,34,60,0.92) 60%, #23244e 100%)';
      btn.style.color = '#ffd700';
      btn.style.borderColor = 'rgba(255,215,0,0.55)';
      btn.style.opacity = '0.85';
    });
  });

  // Add close handler
     popup.querySelector('#close-provider-selection').onclick = () => {
     overlay.remove();
   };
 }



window.addEventListener('message', async function(event) {
  if (event.data && event.data.type === 'betfred-update-stats') {
    // Call the function that updates the game list/favorite icons
    const scanData = await loadFromStorage('betfred_scan_data', {});
    const gameSelect = document.getElementById('betfred-game-select');
    const providerSelect = document.getElementById('betfred-provider-select');
    if (gameSelect && providerSelect) {
      await updateGameDropdown(scanData, gameSelect, providerSelect);
    }
  }
});

function autoAddGameOnPageLoad() {
  if (/^\/(games|vegas|casino)\/play\/[^/]+$/.test(window.location.pathname)) {
    // Track the game page visit for the 1-minute timer
    trackGamePageVisit(window.location.pathname);
    
    let tries = 0;
    const maxTries = 30; // Try for up to 15 seconds
    const interval = setInterval(() => {
      if (document.querySelector('div._1b33n15l')) {
        clearInterval(interval);
        autoSilentAddCurrentGame();
      } else if (++tries > maxTries) {
        clearInterval(interval);
      }
    }, 500);
  }
}

autoAddGameOnPageLoad();

// Remove any previous style block for the dashboard grid
const styleId = 'betfred-most-played-full-width-style';
const prevStyle = document.getElementById(styleId);
if (prevStyle) prevStyle.remove();
document.head.insertAdjacentHTML('beforeend', `
  <style id="${styleId}">
    #betfred-quick-stats { display: grid; grid-template-columns: 1fr 2fr; gap: 12px; }
    .betfred-stat-card--wide { grid-column: 2 / 3 !important; }
    .betfred-stat-card--full { grid-column: 1 / -1 !important; margin-top: 8px; }
    #betfred-most-played-title { cursor: pointer; text-decoration: none !important; }
    #betfred-never-played-link, #betfred-recently-played-link { text-decoration: none !important; }
  </style>
`);

// After theme toggle button logic, add:
const observer = new MutationObserver(() => {
  const modal = document.getElementById('betfred-manual-add-modal');
  if (modal && modal.style.display === 'block') {
    modal.setAttribute('data-betfred-theme', document.body.getAttribute('data-betfred-theme') || 'light');
  }
});
observer.observe(document.body, { attributes: true, attributeFilter: ['data-betfred-theme'] });

// --- Random Button Usage Tracking ---
const randomBtn = document.getElementById('betfred-random-btn');
if (randomBtn) {
  randomBtn.addEventListener('click', async () => {
    let count = await loadFromStorage('betfred_random_btn_count', 0);
    await saveToStorage('betfred_random_btn_count', count + 1);
  });
}

// --- Game Removal Tracking ---
// In your bulk remove logic, after a game is removed:
// let removedCount = await loadFromStorage('betfred_removed_count', 0);
// await saveToStorage('betfred_removed_count', removedCount + 1);
// (Add this in the appropriate place in your bulk remove handler)

// --- First Play Date and Monthly Plays Tracking ---
// In your play count increment logic (e.g., incrementGamePlayCount):
// let stats = await loadFromStorage('betfred_user_stats', {});
// if (!stats.firstPlayed) stats.firstPlayed = {};
// if (!stats.firstPlayed[gamePath]) stats.firstPlayed[gamePath] = new Date().toISOString();
// if (!stats.playsByMonth) stats.playsByMonth = {};
// if (!stats.playsByMonth[gamePath]) stats.playsByMonth[gamePath] = [];
// const now = new Date();
// stats.playsByMonth[gamePath].push({ date: now.toISOString(), count: 1 });
// await saveToStorage('betfred_user_stats', stats);

// --- Fun Fact Logic Update ---
// (Insert the fun fact logic from the previous message here, after loading the new stats)

const EXCLUDE_TITLES = [
  "101 Roulette","10p Roulette","20p Roulette","20p Roulette Christmas","3 Card Brag","Age of the Gods Roulette","Age of the Gods Scratch","Ahmun Ra 3x Scratcher","All Bets Blackjack","Anaconda Wild Scratch","Baccarrat","Balloon Bash LuckyTap","Banca Francesa","Bangu Bang LuckyTap","Battle for Booty LuckyTap","Betfred 3D Roulette High Stakes","Betfred 3D Roulette Low Stakes","Betfred Flippin Rich LuckyTap","Betfred Gone Fishing LuckyTap","Betfred Prize Putt LuckyTap","Betfred To The 9s LuckyTap","Betfred Winning Kick LuckyTap","Big Kick LuckyTap","Blackjack","Blackjack","Blackjack 3 Hand High Stakes","Blackjack 3 Hand Low Stakes","Blackjack Cashback","Blackjack Hi Lo 3 Hand Low Stakes","Blackjack Perfect Pairs 21+3 3 box","Blackjack Surrender","Blackjack Switch","Blitz Scratch","Bobby George Sporting Legends scratch","Bonus Bolts High Voltage LuckyTap","Book of Giza Gold Scratcher","Break the Bounty LuckyTap","Brian Lara: Sporting Legends Scratch","Cards of Athena: Double Double Bonus","Cards of Ra Jacks or Better","Caribbean Stud Poker","Cash Collect Roulette","Cash Collect Scratch","Coconut Climb LuckyTap","Cupid's Arrow LuckyTap","Deal Or No Deal What's In Your Box? Scratchcard","Diamond Bet Roulette","Dragon Jackpot Roulette","Dunk Buddy LuckyTap","Eggcellent Wins LuckyTap","Empire Treasures Scratch","European Football Roulette","European Platinum Roulette","European Roulette High Stakes","European Roulette Low Stakes","Fire Blaze™ Scratch","Fire Company 5 Scratch","Fishin' Frenzy Scratchcard","Flash Pays Blastoff LuckyTap","Flash Pays Gold Scratcher","Flash Pays Magician LuckyTap","Flippin' Lucky LuckyTap","Football Scratch PowerPlay Jackpot","Frankie Dettoris Jackpot Roulette","Free Chip Blackjack","Fu Bao Bang LuckyTap","Fu Bao Meow LuckyTap","Ghost Pepper Scratcher","Gold Bust LuckyTap","Gold Rush Cash Collect Scratch","Halloween Fortune Scratch","Hi Lo Blackjack 3 Hand","Hi Lo Blackjack 5 Box High Stakes","Hold Your Horses LuckyTap","Honoluloot Smash LuckyTap","Hot Gems Xtreme Scratch Card","Jacks or Better Classic","Jars of Power LuckyTap","Jaxpot 7's Scratcher","King Kong Cash Scratchcard JPK","Land O' Loot LuckyTap","Lil Demon LuckyTap","Lit Christmas LuckyTap","Lucky Day: Cheltenham Champions","Lucky Lucky Blackjack","Mega Fire Blaze Roulette","On the Hook LuckyTap","Penny Roulette","Perfect Blackjack","Perfect Pairs 3 Box High Stakes","Perfect Pairs 5 Box High Stakes","Piggies and the Bank LuckyTap","Piggy Payouts Bank Buster LuckyTap","Pool Pong LuckyTap","Pop a Shot 2 LuckyTap","Pop A Shot LuckyTap","Premium Blackjack Single Hand","Premium European Roulette","Premium French Roulette","Prize Punch LuckyTap","Pure Puck LuckyTap","Quantum Blackjack Plus: Instant Play","Quantum Roulette Instant Play","Rainbow Blackjack","Retro Solitaire","Rocky Scratchcard","Roulette","Santa Pays LuckyTap","Scratch Go World Cup","Skee Ball LuckyTap","Slick Riches LuckyTap","Spin Till You Win Roulette","Spread Bet Roulette","Super Pinata LuckyTap","Super Prize Punch LuckyTap","Super Roulette","Super Surprise Box LuckyTap","Ted Big Money Scratchcard","Test Your Strength LuckyTap","The Golden Grand Scratcher","The Nifty Fifty LuckyTap","The Walking Dead Scratch","Ultimate Hoops LuckyTap","Vegas Blackjack","Vegas Blackjack!","Vegas Solitaire","Virtual Dog Racing","Virtual! Cycling","Virtual! Speedway","Wealthy Pig LuckyTap","Wild Lava Scratch","Winner Workshop Wonderland LuckyTap","Xtreme Fire Blaze™ Roulette"
];

// Patch autoSilentAddCurrentGame to blacklist excluded games if user chose Just Slots
const origAutoSilentAddCurrentGame = window.autoSilentAddCurrentGame;
window.autoSilentAddCurrentGame = async function() {
  const setupChoice = await loadFromStorage('betfred_setup_choice', 'full');
  const justSlots = setupChoice === 'slots';
  // Get current game title from starter database using path
  const path = window.location.pathname;
  const gameTitle = starterDatabase[path]?.title;
  if (justSlots && gameTitle && EXCLUDE_TITLES.some(ex => gameTitle.toLowerCase() === ex.toLowerCase())) {
    // Blacklist this game
    let blacklist = await loadFromStorage('betfred_permanently_removed', {});
    blacklist[path] = true;
    await saveToStorage('betfred_permanently_removed', blacklist);
    return; // Do not add to database
  }
  // Otherwise, call original
  return origAutoSilentAddCurrentGame.apply(this, arguments);
};

// --- Floating Random Game Button on Game Page ---
async function insertFloatingRandomButton() {
  // Always show floating button (like options button)
  // Find the Options button
  const optionsBtn = document.querySelector('button[data-betfred-options]');
  if (!optionsBtn) return;
  
  // Check if floating button already exists
  let btn = document.getElementById('betfred-floating-random-btn');
  if (btn) {
    // Button already exists, just update its label and ensure it's in the right position
    const updateFloatingButtonLabelFromStorage = async () => {
      try {
        // Get the last saved provider and filter from storage
        const lastProvider = await loadFromStorage('betfred_last_provider', '');
        const lastFilter = await loadFromStorage('betfred_last_filter', null);
        
        let label = '🎲 Random Game 🎲';
        
        // Check for active filter first
        if (lastFilter) {
                  const filterIcons = {
          fav: '☆', xmas: '🎄', halloween: '🎃', easter: '🐰', romance: '💕',
          megaways: '🎰', sport: '🏅', bigbass: '🐟', tvandmovie: '🎬'
        };
        const filterNames = {
          fav: 'Favorite', xmas: 'Xmas', halloween: 'Halloween', easter: 'Easter', romance: 'Romance',
          megaways: 'Megaways', sport: 'Sport', bigbass: 'Fishing', 
          tvandmovie: 'TV & Movie'
        };
          const icon = filterIcons[lastFilter] || '';
          const filterName = filterNames[lastFilter] || lastFilter;
          label = icon + ' Random ' + filterName + ' Game ' + icon;
        }
        // Check for selected provider
        else if (lastProvider && lastProvider !== '') {
          label = '🎲 Random ' + lastProvider + ' Game 🎲';
        }
        
        btn.innerHTML = label;
        btn.setAttribute('aria-label', `Launch ${label.toLowerCase()}`);
      } catch (error) {
        btn.innerHTML = '🎲 Random Game 🎲';
        btn.setAttribute('aria-label', 'Launch random game');
      }
    };
    
    updateFloatingButtonLabelFromStorage();
    
    // Ensure button is in the right position without removing it
    if (btn.nextSibling !== optionsBtn) {
      // Move the button to the correct position
      optionsBtn.parentNode.insertBefore(btn, optionsBtn);
    }
    
    return;
  }
  // Create the floating random button
  btn = document.createElement('button');
  btn.id = 'betfred-floating-random-btn';
  btn.className = 'betfred-btn betfred-btn--success';
  btn.style.marginRight = '8px';
  btn.style.height = '36px';
  btn.style.lineHeight = '36px';
  btn.setAttribute('role', 'button');
  btn.setAttribute('title', 'Click to launch a random game');
  
  // Pre-load storage values to set correct label immediately and prevent flicker
  const getInitialLabel = () => {
    // Try to get values from storage synchronously if possible
    try {
      // Use localStorage as fallback for immediate access
      const lastProvider = localStorage.getItem('betfred_last_provider') || '';
      const lastFilter = localStorage.getItem('betfred_last_filter') || null;
      
      let label = '🎲 Random Game 🎲';
      
      // Check for active filter first
      if (lastFilter && lastFilter !== 'null') {
        const filterIcons = {
          fav: '☆', xmas: '🎄', halloween: '🎃', easter: '🐰',
          megaways: '🎰', sport: '🏅', bigbass: '🐟', tvandmovie: '🎬'
        };
        const filterNames = {
          fav: 'Favorite', xmas: 'Xmas', halloween: 'Halloween', easter: 'Easter', romance: 'Romance',
          megaways: 'Megaways', sport: 'Sport', bigbass: 'Fishing', 
          tvandmovie: 'TV & Movie'
        };
        const icon = filterIcons[lastFilter] || '';
        const filterName = filterNames[lastFilter] || lastFilter;
        label = icon + ' Random ' + filterName + ' Game ' + icon;
      }
      // Check for selected provider
      else if (lastProvider && lastProvider !== '') {
        label = '🎲 Random ' + lastProvider + ' Game 🎲';
      }
      
      return label;
    } catch (error) {
      return '🎲 Random Game 🎲';
    }
  };
  
  // Set the correct label immediately to prevent flicker
  const initialLabel = getInitialLabel();
  btn.innerHTML = initialLabel;
  btn.setAttribute('aria-label', `Launch ${initialLabel.toLowerCase()}`);
  
  // Use independent label generation that doesn't rely on DOM elements
  const updateFloatingButtonLabelFromStorage = async () => {
    try {
      // Get the last saved provider and filter from storage
      const lastProvider = await loadFromStorage('betfred_last_provider', '');
      const lastFilter = await loadFromStorage('betfred_last_filter', null);
      
      let label = '🎲 Random Game 🎲';
      
      // Check for active filter first
      if (lastFilter) {
        const filterIcons = {
          fav: '☆', xmas: '🎄', halloween: '🎃', easter: '🐰', romance: '💕',
          megaways: '🎰', sport: '🏅', bigbass: '🐟', tvandmovie: '🎬'
        };
        const filterNames = {
          fav: 'Favorite', xmas: 'Xmas', halloween: 'Halloween', easter: 'Easter', romance: 'Romance',
          megaways: 'Megaways', sport: 'Sport', bigbass: 'Fishing', 
          tvandmovie: 'TV & Movie'
        };
        const icon = filterIcons[lastFilter] || '';
        const filterName = filterNames[lastFilter] || lastFilter;
        label = icon + ' Random ' + filterName + ' Game ' + icon;
      }
      // Check for selected provider
      else if (lastProvider && lastProvider !== '') {
        label = '🎲 Random ' + lastProvider + ' Game 🎲';
      }
      
      // Only update if the label has changed
      if (btn.innerHTML !== label) {
        btn.innerHTML = label;
        btn.setAttribute('aria-label', `Launch ${label.toLowerCase()}`);
      }
    } catch (error) {
      // Only update if different from current
      if (btn.innerHTML !== '🎲 Random Game 🎲') {
        btn.innerHTML = '🎲 Random Game 🎲';
        btn.setAttribute('aria-label', 'Launch random game');
      }
    }
  };
  
  // Update the floating button label immediately (will only change if different)
  updateFloatingButtonLabelFromStorage();
  
  // Give the floating button its own click handler
  btn.onclick = async function() {
    // Get current selections from storage instead of DOM elements
    const currentProvider = await loadFromStorage('betfred_last_provider', '');
    const currentFilter = await loadFromStorage('betfred_last_filter', null);
    
    // Launch a random game using storage values
    const scanData = await loadFromStorage('betfred_scan_data', {});
    const favorites = await getFavorites();
    const neverShowAgain = await getNeverShowAgain();
    const blacklist = await loadFromStorage('betfred_permanently_removed', {});
    
    let seenTitles = new Set();
    let uniqueGames = [];
    Object.entries(scanData).forEach(([path, data]) => {
      const normalizedTitle = (data.title || "").trim().toLowerCase();
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle);
        uniqueGames.push([path, data]);
      }
    });
    
    // Filter games based on storage values
    let games = uniqueGames.filter(([path, data]) => {
      // Check blacklist
      if (blacklist[path]) return false;
      
      // Check provider filter
      if (currentProvider && currentProvider !== '' && data.provider !== currentProvider) {
        return false;
      }
      
      // Check theme filter
      if (currentFilter) {
        switch (currentFilter) {
          case 'xmas': return isChristmasGame(data.title);
                  case 'halloween': return isHalloweenGame(data.title);
        case 'easter': return isEasterGame(data.title);
        case 'romance': return isRomanceGame(data.title);
          case 'megaways': return isMegawaysGame(data.title);
          case 'sport': return isSportGame(data.title);
          case 'bigbass': return isFishingGame(data.title);
                case 'tvandmovie': return isTVAndMovie(data.title);
          case 'fav': return favorites[path];
          default: return true;
        }
      }
      
      return true;
    });
    
    // Apply minimum stake filter
    games = await applyMinStakeFilter(games);
    
    const filtered = games.filter(([path]) => !neverShowAgain[path]);
    if (!filtered.length) return showToast("No games match the selected filters.");
    const [randomPath, randomData] = filtered[Math.floor(Math.random() * filtered.length)];
    await trackGamePageVisit(randomPath);
    loadFromStorage('betfred_open_current_tab', false).then(openCurrentTab => {
      if (openCurrentTab) {
        const panel = document.getElementById('betfred-options-panel');
        if (panel) panel.style.display = 'none';
        if (/^\/(games|casino|vegas)\/play\//.test(location.pathname)) {
            window.location.href = randomPath;
        } else {
          window.location.href = randomPath;
        }
      } else {
        window.open(randomPath, "_blank");
      }
    });
  };
  // Insert before Options button
  optionsBtn.parentNode.insertBefore(btn, optionsBtn);

}

// Call this on page load - button is now persistent so only need to call once
insertFloatingRandomButton();

// Patch insertOptionsButton to call insertFloatingRandomButton after inserting the options button
const origInsertOptionsButton = insertOptionsButton;
insertOptionsButton = async function() {
  await origInsertOptionsButton.apply(this, arguments);
  if (typeof insertFloatingRandomButton === 'function') {
    insertFloatingRandomButton();
  }
  // Restore filter state when options panel is created
  const lastSavedFilter = await loadFromStorage('betfred_last_filter', null);
  if (lastSavedFilter) {
    setTimeout(() => {
      setActiveFilter(lastSavedFilter);
    }, 100);
  }
};

// SPA navigation - only call if button doesn't exist (shouldn't happen now that it's persistent)
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    autoAddGameOnPageLoad();
    // Only call if button doesn't exist (shouldn't happen with persistent button)
    if (typeof insertFloatingRandomButton === 'function' && !document.getElementById('betfred-floating-random-btn')) {
      insertFloatingRandomButton();
    }
  }
}, 500);

function setActiveFilter(filter) {
  // Remove active class from all filter buttons first
  document.querySelectorAll('.betfred-filter-btn').forEach(b => b.classList.remove('active'));
  
  // If filter is null, just clear the active state and return
  if (!filter) {
    chrome.storage.local.set({ 'betfred_last_filter': null });
    // Update game dropdown to show all games
    const gameSelect = document.getElementById('betfred-game-select');
    const providerSelect = document.getElementById('betfred-provider-select');
    if (gameSelect && providerSelect) {
      updateGameDropdown(window.betfred_scan_data_cache || {}, gameSelect, providerSelect);
    }
    // Update random button label after filter change
    setTimeout(() => {
      updateRandomButtonLabel();
    }, 100);
    return;
  }
  
  // Map filter keys to button ids
  const filterIdMap = {
    fav: 'betfred-fav-filter-toggle',
    xmas: 'betfred-xmas-toggle',
    halloween: 'betfred-halloween-toggle',
    easter: 'betfred-easter-toggle',
    romance: 'betfred-romance-toggle',
    megaways: 'betfred-megaways-toggle',
    sport: 'betfred-sport-toggle',
    bigbass: 'betfred-bigbass-toggle',
    tvandmovie: 'betfred-tvandmovie-toggle'
  };
  
  // Handle custom filters
  if (filter && filter.startsWith('custom_')) {
    const customBtnId = `betfred-${filter}-toggle`;
    const customBtn = document.getElementById(customBtnId);
    if (customBtn) {
      customBtn.classList.add('active');
      // Save the active filter
      chrome.storage.local.set({ 'betfred_last_filter': filter });
      // Update game dropdown
      const gameSelect = document.getElementById('betfred-game-select');
      const providerSelect = document.getElementById('betfred-provider-select');
      if (gameSelect && providerSelect) {
        updateGameDropdown(window.betfred_scan_data_cache || {}, gameSelect, providerSelect);
      }
    }
  } else {
    // Handle built-in filters
    const btnId = filterIdMap[filter];
    if (btnId) {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.classList.add('active');
        // Trigger the click to ensure any associated logic runs
        btn.click();
      }
    }
  }
  
  // Update random button label after filter change
  setTimeout(() => {
    updateRandomButtonLabel();
  }, 100);
}

// Smart Dashboard Interval Management
let dashboardInterval = null;
let dashboardLastActivity = Date.now();
let dashboardIsVisible = true;
let dashboardUpdateCounter = 0;

// Track dashboard visibility
function updateDashboardVisibility() {
  const statsArea = document.getElementById('betfred-stats-area');
  const quickStats = document.getElementById('betfred-quick-stats');
  dashboardIsVisible = !!(statsArea && quickStats && 
    (statsArea.style.display !== 'none' && quickStats.style.display !== 'none'));
}

// Track user activity
function updateDashboardActivity() {
  dashboardLastActivity = Date.now();
}

// Performance monitoring for dashboard updates
let dashboardPerformanceStats = {
  totalUpdates: 0,
  skippedUpdates: 0,
  lastUpdateTime: 0,
  averageUpdateTime: 0
};

// Enhanced smart dashboard update function with performance tracking
function smartDashboardUpdate() {
  const startTime = performance.now();
  
  // Skip if dashboard is hidden
  if (!dashboardIsVisible) {
    dashboardPerformanceStats.skippedUpdates++;
    return;
  }
  
  // Skip if user has been inactive for more than 5 minutes
  const inactiveTime = Date.now() - dashboardLastActivity;
  if (inactiveTime > 5 * 60 * 1000) {
    dashboardPerformanceStats.skippedUpdates++;
    return;
  }
  
  // Increment counter for cycling
  dashboardUpdateCounter++;
  dashboardPerformanceStats.totalUpdates++;
  
  // Update different sections on different cycles
  if (dashboardUpdateCounter % 2 === 0) {
    // Update fun facts every 2 cycles (60 seconds)
    if (typeof renderFunFact === 'function') {
      funFactIndex = (funFactIndex + 1) % funFacts.length;
      renderFunFact();
    }
  }
  
  if (dashboardUpdateCounter % 3 === 0) {
    // Update never played every 3 cycles (90 seconds)
    if (typeof renderNeverPlayedCard === 'function' && neverPlayed.length > 0) {
      neverPlayedCardIndex = (neverPlayedCardIndex + 1) % neverPlayed.length;
      renderNeverPlayedCard();
    }
  }
  
  if (dashboardUpdateCounter % 4 === 0) {
    // Update new games every 4 cycles (120 seconds)
    if (typeof renderNewGamesCard === 'function' && newGames.length > 0) {
      newGamesCardIndex = (newGamesCardIndex + 1) % newGames.length;
      renderNewGamesCard();
    }
  }
  
  // Track performance
  const updateTime = performance.now() - startTime;
  dashboardPerformanceStats.lastUpdateTime = updateTime;
  dashboardPerformanceStats.averageUpdateTime = 
    (dashboardPerformanceStats.averageUpdateTime * (dashboardPerformanceStats.totalUpdates - 1) + updateTime) / 
    dashboardPerformanceStats.totalUpdates;
  

  
  // Track Firefox-specific performance
  trackFirefoxPerformance();
}

// Start smart dashboard updates
function startSmartDashboardUpdates() {
  // Clear any existing intervals
  if (dashboardInterval) {
    clearInterval(dashboardInterval);
  }
  
  // Start single smart interval (30 seconds)
  dashboardInterval = setInterval(smartDashboardUpdate, 30000);
  
  // Track user activity (Firefox-optimized)
  const eventOptions = { passive: true };
  document.addEventListener('mousemove', updateDashboardActivity, eventOptions);
  document.addEventListener('click', updateDashboardActivity, eventOptions);
  document.addEventListener('keydown', updateDashboardActivity, eventOptions);
  
  // Track dashboard visibility changes
  const observer = new MutationObserver(updateDashboardVisibility);
  const statsArea = document.getElementById('betfred-stats-area');
  const quickStats = document.getElementById('betfred-quick-stats');
  
  if (statsArea) observer.observe(statsArea, { attributes: true, attributeFilter: ['style'] });
  if (quickStats) observer.observe(quickStats, { attributes: true, attributeFilter: ['style'] });
}

// Stop smart dashboard updates
function stopSmartDashboardUpdates() {
  if (dashboardInterval) {
    clearInterval(dashboardInterval);
    dashboardInterval = null;
  }
  
  // Remove event listeners
  document.removeEventListener('mousemove', updateDashboardActivity);
  document.removeEventListener('click', updateDashboardActivity);
  document.removeEventListener('keydown', updateDashboardActivity);
}

// Firefox-specific performance monitoring
let firefoxPerformanceStats = {
  isFirefox: typeof browser !== 'undefined' && browser.runtime && typeof browser.runtime.getBrowserInfo === 'function',
  renderTime: 0,
  memoryUsage: 0,
  updateCount: 0
};

// Firefox performance optimization
function optimizeForFirefox() {
  if (!firefoxPerformanceStats.isFirefox) return;
  
  // Firefox benefits from explicit performance hints
  const elements = document.querySelectorAll('.betfred-panel, .betfred-popup, .betfred-modal');
  elements.forEach(el => {
    el.style.willChange = 'transform, opacity';
    el.style.transform = 'translateZ(0)';
  });
  
  // Firefox scrollbar optimization
  const dropdowns = document.querySelectorAll('.betfred-select-dropdown');
  dropdowns.forEach(dropdown => {
    dropdown.style.scrollbarWidth = 'thin';
    dropdown.style.scrollbarColor = '#ffd700 #23244e';
  });
  

}

// Enhanced performance tracking for Firefox
function trackFirefoxPerformance() {
  if (!firefoxPerformanceStats.isFirefox) return;
  
  firefoxPerformanceStats.updateCount++;
  
  // Track memory usage if available
  if (performance.memory) {
    firefoxPerformanceStats.memoryUsage = performance.memory.usedJSHeapSize;
  }
  

}

// Add stats icon to options panel (called from createOptionsPanel)
export function createStatsButton() {
  const btn = document.createElement('button');
  btn.setAttribute('data-betfred-stats', 'true');
  btn.type = 'button'; 
  btn.innerHTML = '📊';
  btn.className = 'betfred-stats-btn';
  btn.setAttribute('aria-label', 'View Game Statistics');
  btn.tabIndex = 0;
  btn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Show loading state
    btn.innerHTML = '⏳';
    btn.disabled = true;
    btn.classList.add('betfred-loading');
    
    try {
      await showStatsPanel();
    } finally {
      // Restore button state
      btn.innerHTML = '📊';
      btn.disabled = false;
      btn.classList.remove('betfred-loading');
      btn.classList.add('betfred-success');
      setTimeout(() => btn.classList.remove('betfred-success'), 600);
    }
  };
  btn.onkeydown = e => { 
    if (e.key === "Enter" || e.key === " ") { 
      e.preventDefault(); 
      btn.click(); 
    } 
  };
  
  return btn;
}

// Comprehensive stats panel
export async function showStatsPanel() {
  if (document.getElementById('betfred-stats-panel')) return;

  const overlay = document.createElement('div');
  overlay.className = 'betfred-overlay';
  overlay.style.zIndex = 2147483647;

  const panel = document.createElement('div');
  panel.id = 'betfred-stats-panel';
  panel.className = 'betfred-panel betfred-stats-panel';
  panel.style.maxWidth = '900px';
  panel.style.maxHeight = '80vh';
  panel.style.overflowY = 'auto';

  // Load all data
  const scanData = await loadFromStorage('betfred_scan_data', {});
  const stats = await loadFromStorage('betfred_user_stats', {});
  const favorites = await loadFromStorage('betfred_favorites', {});

  panel.innerHTML = `
    <div class="betfred-modal-content">
      <div class="betfred-modal-header">
        <span class="betfred-modal-title">📊 Game Statistics Dashboard</span>
        <button class="betfred-close-btn" id="close-stats-panel" title="Close">×</button>
      </div>
      
      <div class="betfred-modal-body">
        <div class="betfred-stats-grid">
          <!-- Overview Stats -->
          <div class="betfred-stat-section">
            <h3>🎯 Overview</h3>
            <div class="betfred-stat-cards">
              <div class="betfred-stat-card">
                <div class="stat-number">${(() => {
                  // Use the same unique game counting logic as the main dashboard
                  const seenTitles = new Set();
                  const uniqueGames = [];
                  Object.entries(scanData).forEach(([path, data]) => {
                    const normalizedTitle = (data.title || "").trim().toLowerCase();
                    if (!seenTitles.has(normalizedTitle)) {
                      seenTitles.add(normalizedTitle);
                      uniqueGames.push([path, data]);
                    }
                  });
                  return uniqueGames.length;
                })()}</div>
                <div class="stat-label">Total Games</div>
              </div>
              <div class="betfred-stat-card">
                <div class="stat-number">${Object.keys(favorites).length}</div>
                <div class="stat-label">Favorites</div>
              </div>
              <div class="betfred-stat-card">
                <div class="stat-number">${stats.plays ? Object.keys(stats.plays).length : 0}</div>
                <div class="stat-label">Games Played</div>
              </div>
              <div class="betfred-stat-card">
                <div class="stat-number">${stats.plays ? Object.values(stats.plays).reduce((sum, count) => sum + count, 0) : 0}</div>
                <div class="stat-label">Total Plays</div>
              </div>
            </div>
          </div>

          <!-- Most Played Games -->
          <div class="betfred-stat-section">
            <h3>🏆 Most Played Games</h3>
            <div class="betfred-game-stats">
              ${await generateMostPlayedGames(stats, scanData)}
            </div>
          </div>

          <!-- Play Time Tracking -->
          <div class="betfred-stat-section">
            <h3>⏱️ Play Time Analysis</h3>
            <div class="betfred-time-stats">
              ${await generatePlayTimeStats(stats, scanData)}
            </div>
          </div>

          <!-- Provider Statistics -->
          <div class="betfred-stat-section">
            <h3>🎮 Provider Breakdown</h3>
            <div class="betfred-provider-stats">
              ${await generateProviderStats(stats, scanData)}
            </div>
          </div>

          <!-- Recent Activity -->
          <div class="betfred-stat-section">
            <h3>🕒 Recent Activity</h3>
            <div class="betfred-recent-stats">
              ${await generateRecentActivity(stats, scanData)}
            </div>
          </div>

          <!-- Achievement Stats -->
          <div class="betfred-stat-section">
            <h3>🏅 Achievements</h3>
            <div class="betfred-achievement-stats">
              ${await generateAchievementStats(stats, scanData)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Close button handler
  const closeBtn = document.getElementById('close-stats-panel');
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    overlay.remove();
  };

  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  };


}

// Generate most played games section
async function generateMostPlayedGames(stats, scanData) {
  if (!stats.plays || Object.keys(stats.plays).length === 0) {
    return '<p class="no-data">No games played yet. Start playing to see your stats!</p>';
  }

  const sortedGames = Object.entries(stats.plays)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10);

  return `
    <div class="betfred-game-list">
      ${sortedGames.map(([path, count], index) => {
        const gameData = scanData[path];
        const gameTitle = gameData ? gameData.title : 'Unknown Game';
        const provider = gameData ? gameData.provider : 'Unknown';
        const rtp = gameData ? gameData.rtp : '';
        
        return `
          <div class="betfred-game-stat-item">
            <div class="game-rank">#${index + 1}</div>
            <div class="game-info">
              <div class="game-title">${gameTitle}</div>
              <div class="game-details">${provider}${rtp ? ` • ${rtp}% RTP` : ''}</div>
            </div>
            <div class="game-stats">
              <div class="play-count">${count} plays</div>
              ${stats.playTime && stats.playTime[path] ? 
                `<div class="play-time">${formatPlayTime(stats.playTime[path])}</div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Generate play time statistics
async function generatePlayTimeStats(stats, scanData) {
  if (!stats.playTime || Object.keys(stats.playTime).length === 0) {
    return '<p class="no-data">Play time tracking not available yet.</p>';
  }

  const totalPlayTime = Object.values(stats.playTime).reduce((sum, time) => sum + time, 0);
  const avgPlayTime = totalPlayTime / Object.keys(stats.playTime).length;
  
  const longestSession = Object.entries(stats.playTime)
    .sort(([,a], [,b]) => b - a)[0];
  
  const mostTimeSpent = longestSession ? {
    path: longestSession[0],
    time: longestSession[1],
    gameData: scanData[longestSession[0]]
  } : null;

  return `
    <div class="betfred-time-overview">
      <div class="time-stat-card">
        <div class="stat-number">${formatPlayTime(totalPlayTime)}</div>
        <div class="stat-label">Total Play Time</div>
      </div>
      <div class="time-stat-card">
        <div class="stat-number">${formatPlayTime(avgPlayTime)}</div>
        <div class="stat-label">Average Session</div>
      </div>
      <div class="time-stat-card">
        <div class="stat-number">${Object.keys(stats.playTime).length}</div>
        <div class="stat-label">Games Tracked</div>
      </div>
    </div>
    ${mostTimeSpent ? `
      <div class="betfred-longest-session">
        <h4>Longest Session</h4>
        <div class="longest-game">
          <div class="game-title">${mostTimeSpent.gameData ? mostTimeSpent.gameData.title : 'Unknown Game'}</div>
          <div class="session-time">${formatPlayTime(mostTimeSpent.time)}</div>
        </div>
      </div>
    ` : ''}
  `;
}

// Generate provider statistics
async function generateProviderStats(stats, scanData) {
  const providerStats = {};
  
  if (stats.plays) {
    Object.entries(stats.plays).forEach(([path, count]) => {
      const gameData = scanData[path];
      if (gameData && gameData.provider) {
        if (!providerStats[gameData.provider]) {
          providerStats[gameData.provider] = { plays: 0, games: 0, playTime: 0 };
        }
        providerStats[gameData.provider].plays += count;
        providerStats[gameData.provider].games += 1;
        
        if (stats.playTime && stats.playTime[path]) {
          providerStats[gameData.provider].playTime += stats.playTime[path];
        }
      }
    });
  }

  const sortedProviders = Object.entries(providerStats)
    .sort(([,a], [,b]) => b.plays - a.plays)
    .slice(0, 10);

  if (sortedProviders.length === 0) {
    return '<p class="no-data">No provider data available yet.</p>';
  }

  return `
    <div class="betfred-provider-list">
      ${sortedProviders.map(([provider, data]) => `
        <div class="betfred-provider-stat-item">
          <div class="provider-name">${provider}</div>
          <div class="provider-stats">
            <div class="provider-play-count">${data.plays} plays</div>
            <div class="provider-game-count">${data.games} games</div>
            ${data.playTime > 0 ? `<div class="provider-play-time">${formatPlayTime(data.playTime)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Generate recent activity
async function generateRecentActivity(stats, scanData) {
  const recentPlays = [];
  
  if (stats.lastPlayed) {
    const sortedPlays = Object.entries(stats.lastPlayed)
      .sort(([,a], [,b]) => new Date(b) - new Date(a))
      .slice(0, 5);
    
    for (const [path, dateStr] of sortedPlays) {
      const gameData = scanData[path];
      if (gameData) {
        recentPlays.push({
          title: gameData.title,
          provider: gameData.provider,
          date: new Date(dateStr),
          path: path
        });
      }
    }
  }

  if (recentPlays.length === 0) {
    return '<p class="no-data">No recent activity to show.</p>';
  }

  return `
    <div class="betfred-recent-list">
      ${recentPlays.map(play => `
        <div class="betfred-recent-item">
          <div class="recent-game-info">
            <div class="recent-game-title">${play.title}</div>
            <div class="recent-game-provider">${play.provider}</div>
          </div>
          <div class="recent-game-date">${formatRelativeTime(play.date)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// Generate achievement statistics
async function generateAchievementStats(stats, scanData) {
  const achievements = [];
  
  // Load favorites data
  const favorites = await loadFromStorage('betfred_favorites', {});
  
  // Total games milestone - only count games added after initial setup
  const setupComplete = await loadFromStorage('betfred_setup_complete', false);
  let manuallyAddedGames = 0;
  
  if (setupComplete) {
    // Count games that were added after the initial setup
    // We'll use a simpler approach: count games that have been played (indicating user interaction)
    const playedGames = stats.plays ? Object.keys(stats.plays).length : 0;
    const totalUniqueGames = Object.keys(scanData).length;
    
    // For now, let's use a more meaningful metric: games you've actually played
    manuallyAddedGames = playedGames;
  }
  
  if (manuallyAddedGames >= 100) achievements.push({ icon: '🎯', title: 'Game Collector', desc: 'Played 100+ different games' });
  else if (manuallyAddedGames >= 50) achievements.push({ icon: '🎮', title: 'Game Enthusiast', desc: 'Played 50+ different games' });
  else if (manuallyAddedGames >= 10) achievements.push({ icon: '🎲', title: 'Game Explorer', desc: 'Played 10+ different games' });

  // Play count milestones
  const totalPlays = stats.plays ? Object.values(stats.plays).reduce((sum, count) => sum + count, 0) : 0;
  if (totalPlays >= 100) achievements.push({ icon: '🏆', title: 'Veteran Player', desc: 'Played 100+ games' });
  else if (totalPlays >= 50) achievements.push({ icon: '🎪', title: 'Regular Player', desc: 'Played 50+ games' });
  else if (totalPlays >= 10) achievements.push({ icon: '🎭', title: 'Active Player', desc: 'Played 10+ games' });

  // Provider diversity
  const providersPlayed = new Set();
  if (stats.plays) {
    Object.keys(stats.plays).forEach(path => {
      const game = scanData[path];
      if (game && game.provider) providersPlayed.add(game.provider);
    });
  }
  if (providersPlayed.size >= 10) achievements.push({ icon: '🌍', title: 'Provider Explorer', desc: 'Played games from 10+ providers' });
  else if (providersPlayed.size >= 5) achievements.push({ icon: '🎨', title: 'Variety Seeker', desc: 'Played games from 5+ providers' });

  // Favorites milestone
  const favoriteCount = Object.keys(favorites).length;
  if (favoriteCount >= 20) achievements.push({ icon: '⭐', title: 'Super Fan', desc: 'Added 20+ favorites' });
  else if (favoriteCount >= 10) achievements.push({ icon: '💫', title: 'Fan', desc: 'Added 10+ favorites' });
  else if (favoriteCount >= 5) achievements.push({ icon: '✨', title: 'Admirer', desc: 'Added 5+ favorites' });

  if (achievements.length === 0) {
    return '<p class="no-data">Keep playing to unlock achievements!</p>';
  }

  return `
    <div class="betfred-achievement-list">
      ${achievements.map(achievement => `
        <div class="betfred-achievement-item">
          <div class="achievement-icon">${achievement.icon}</div>
          <div class="achievement-info">
            <div class="achievement-title">${achievement.title}</div>
            <div class="achievement-desc">${achievement.desc}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Utility function to format play time
function formatPlayTime(minutes) {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  } else {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return `${days}d ${hours}h`;
  }
}

// Utility function to format relative time
function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ========================
// CUSTOM FILTER SYSTEM
// ========================

// Custom filter storage and management
const CUSTOM_FILTER_STORAGE_KEY = 'betfredCustomFilters';
const MAX_CUSTOM_FILTERS = 3;

// Available icons for custom filters (unique from existing filters)
const CUSTOM_FILTER_ICONS = [
  '🐉', '🔮', '🏰', '🚀', '🎪', '🏖️', '🌊', '🌙', '☀️', '🎨', 
  '🎵', '💎', '🎭', '🏔️', '🌈'
];

// Get custom filters from storage
async function getCustomFilters() {
  try {
    const stored = await chrome.storage.local.get(CUSTOM_FILTER_STORAGE_KEY);
    return stored[CUSTOM_FILTER_STORAGE_KEY] || {};
  } catch (error) {
    console.error('Error getting custom filters:', error);
    return {};
  }
}

// Save custom filters to storage
async function saveCustomFilters(filters) {
  try {
    await chrome.storage.local.set({ [CUSTOM_FILTER_STORAGE_KEY]: filters });
  } catch (error) {
    console.error('Error saving custom filters:', error);
  }
}

// Add a new custom filter
async function addCustomFilter(filterData) {
  const filters = await getCustomFilters();
  const filterCount = Object.keys(filters).length;
  
  if (filterCount >= MAX_CUSTOM_FILTERS) {
    throw new Error(`Maximum of ${MAX_CUSTOM_FILTERS} custom filters allowed`);
  }
  
  const filterId = `custom_${Date.now()}`;
  const newFilter = {
    id: filterId,
    name: filterData.name,
    icon: filterData.icon,
    createdAt: new Date().toISOString(),
    enabled: true,
    keywords: filterData.keywords ? filterData.keywords.split(',').map(k => k.trim()).filter(k => k) : [],
    selectedGames: filterData.selectedGames || []
  };
  
  filters[filterId] = newFilter;
  await saveCustomFilters(filters);
  return newFilter;
}

// Update an existing custom filter
async function updateCustomFilter(filterId, filterData) {
  const filters = await getCustomFilters();
  
  if (!filters[filterId]) {
    throw new Error('Filter not found');
  }
  
  filters[filterId] = {
    ...filters[filterId],
    name: filterData.name,
    icon: filterData.icon,
    updatedAt: new Date().toISOString(),
    keywords: filterData.keywords ? filterData.keywords.split(',').map(k => k.trim()).filter(k => k) : [],
    selectedGames: filterData.selectedGames || []
  };
  
  await saveCustomFilters(filters);
  return filters[filterId];
}

// Delete a custom filter
async function deleteCustomFilter(filterId) {
  const filters = await getCustomFilters();
  
  if (!filters[filterId]) {
    throw new Error('Filter not found');
  }
  
  delete filters[filterId];
  await saveCustomFilters(filters);
}

// Toggle custom filter enabled state
async function toggleCustomFilter(filterId) {
  const filters = await getCustomFilters();
  
  if (!filters[filterId]) {
    throw new Error('Filter not found');
  }
  
  filters[filterId].enabled = !filters[filterId].enabled;
  await saveCustomFilters(filters);
  return filters[filterId];
}

// Check if a game matches a custom filter
function isCustomFilterGame(title, filterId, customFilters, gamePath = null) {
  const filter = customFilters[filterId];
  if (!filter || !filter.enabled) return false;
  
  // Check if this game is excluded
  if (window.betfredExcludedGames && window.betfredExcludedGames.has(gamePath)) {
    return false;
  }
  
  let matches = false;
  
  // Check keywords (if any)
  if (filter.keywords && filter.keywords.length > 0) {
    const titleLower = title.toLowerCase();
    matches = filter.keywords.some(keyword => 
      titleLower.includes(keyword.toLowerCase())
    );
  }
  
  // Check specific games (if any)
  if (filter.selectedGames && filter.selectedGames.length > 0) {
    matches = matches || filter.selectedGames.includes(gamePath);
  }
  
  return matches;
}

// Get count of games matching a custom filter
function getCustomFilterGameCount(scanData, filterId, customFilters) {
  if (!scanData || !customFilters[filterId]) return 0;
  
  return Object.entries(scanData).filter(([path, game]) => 
    isCustomFilterGame(game.title, filterId, customFilters, path)
  ).length;
}

