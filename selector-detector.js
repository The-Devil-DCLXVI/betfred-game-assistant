// selector-detector.js
// Dynamic selector detection system for Betfred extension
// This makes the extension resilient to class name changes
// Works automatically in the background - no user interaction needed

import { saveToStorage, loadFromStorage } from './storage.js';

// Cache for working selectors
let selectorCache = null;

// Load cached selectors
async function loadSelectorCache() {
  if (!selectorCache) {
    selectorCache = await loadFromStorage('betfred_selector_cache', {});
  }
  return selectorCache;
}

// Save working selectors
async function saveSelectorCache() {
  if (selectorCache) {
    await saveToStorage('betfred_selector_cache', selectorCache);
  }
}

// Test if a selector works
function testSelector(selector, context = document) {
  try {
    const elements = context.querySelectorAll(selector);
    return elements.length > 0 ? Array.from(elements) : null;
  } catch (e) {
    return null;
  }
}

// Find elements by multiple strategies
async function findElementsByStrategies(strategies, context = document) {
  const cache = await loadSelectorCache();
  
  // Try cached selectors first
  for (const strategy of strategies) {
    if (cache[strategy.name]) {
      const elements = testSelector(cache[strategy.name], context);
      if (elements && elements.length > 0) {
        return { elements, selector: cache[strategy.name], strategy: strategy.name };
      }
    }
  }
  
  // Try all strategies
  for (const strategy of strategies) {
    const elements = strategy.finder(context);
    if (elements && elements.length > 0) {
      // Cache the working selector
      cache[strategy.name] = strategy.selector;
      await saveSelectorCache();
      return { elements, selector: strategy.selector, strategy: strategy.name };
    }
  }
  
  return null;
}

// Strategy definitions for different Betfred elements
const strategies = {
  // Deposit button strategies
  depositButton: [
    {
      name: 'data-actionable-deposit',
      selector: 'button[data-actionable="Header.LoggedIn.buttonDeposit"]',
      finder: (context) => testSelector('button[data-actionable="Header.LoggedIn.buttonDeposit"]', context)
    },
    {
      name: 'quick-deposit-id',
      selector: '#quick-deposit-button',
      finder: (context) => testSelector('#quick-deposit-button', context)
    },
    {
      name: 'deposit-text-content',
      selector: 'button:contains("Deposit"), button:contains("deposit")',
      finder: (context) => {
        const buttons = context.querySelectorAll('button');
        return Array.from(buttons).filter(btn => 
          btn.textContent.toLowerCase().includes('deposit')
        );
      }
    },
    {
      name: 'deposit-aria-label',
      selector: 'button[aria-label*="deposit"], button[aria-label*="Deposit"]',
      finder: (context) => testSelector('button[aria-label*="deposit"], button[aria-label*="Deposit"]', context)
    }
  ],
  
  // Favorite button strategies
  favoriteButton: [
    {
      name: 'data-actionable-savegame',
      selector: 'button[data-actionable$="saveGame"]',
      finder: (context) => testSelector('button[data-actionable$="saveGame"]', context)
    },
    {
      name: 'data-actionable-gamesave',
      selector: 'button[data-actionable^="GamePlayPage.SideBar.Save"]',
      finder: (context) => testSelector('button[data-actionable^="GamePlayPage.SideBar.Save"]', context)
    },
    {
      name: 'favorite-star-icon',
      selector: 'button:has(span:contains("⭐")), button:has(span:contains("☆"))',
      finder: (context) => {
        const buttons = context.querySelectorAll('button');
        return Array.from(buttons).filter(btn => {
          const spans = btn.querySelectorAll('span');
          return Array.from(spans).some(span => 
            span.textContent.includes('⭐') || span.textContent.includes('☆')
          );
        });
      }
    },
    {
      name: 'favorite-aria-label',
      selector: 'button[aria-label*="favorite"], button[aria-label*="save"], button[aria-label*="bookmark"]',
      finder: (context) => testSelector('button[aria-label*="favorite"], button[aria-label*="save"], button[aria-label*="bookmark"]', context)
    }
  ],
  
  // Game tile strategies
  gameTile: [
    {
      name: 'game-tile-class-1',
      selector: 'div._1q2obv',
      finder: (context) => testSelector('div._1q2obv', context)
    },
    {
      name: 'game-tile-class-2',
      selector: 'div._1b33n15l',
      finder: (context) => testSelector('div._1b33n15l', context)
    },
    {
      name: 'game-tile-has-play-link',
      selector: 'div:has(a[href^="/games/play/"])',
      finder: (context) => {
        const divs = context.querySelectorAll('div');
        return Array.from(divs).filter(div => 
          div.querySelector('a[href^="/games/play/"]')
        );
      }
    },
    {
      name: 'game-tile-has-favorite-button',
      selector: 'div:has(button[data-actionable*="save"])',
      finder: (context) => {
        const divs = context.querySelectorAll('div');
        return Array.from(divs).filter(div => 
          div.querySelector('button[data-actionable*="save"]')
        );
      }
    }
  ],
  
  // Header strategies
  header: [
    {
      name: 'header-tag',
      selector: 'header',
      finder: (context) => testSelector('header', context)
    },
    {
      name: 'header-role',
      selector: '[role="banner"]',
      finder: (context) => testSelector('[role="banner"]', context)
    },
    {
      name: 'header-aria-label',
      selector: '[aria-label*="header"], [aria-label*="Header"]',
      finder: (context) => testSelector('[aria-label*="header"], [aria-label*="Header"]', context)
    }
  ],
  
  // Sidebar strategies
  sidebar: [
    {
      name: 'sidebar-role',
      selector: 'div[role="complementary"]',
      finder: (context) => testSelector('div[role="complementary"]', context)
    },
    {
      name: 'sidebar-aria-label',
      selector: 'div[aria-label*="sidebar"]',
      finder: (context) => testSelector('div[aria-label*="sidebar"]', context)
    },
    {
      name: 'sidebar-has-game-info',
      selector: 'div:has(h1, h2, h4)',
      finder: (context) => {
        const divs = context.querySelectorAll('div');
        return Array.from(divs).filter(div => 
          div.querySelector('h1, h2, h4')
        );
      }
    }
  ]
};

// Main functions for finding elements
export async function findDepositButton() {
  const result = await findElementsByStrategies(strategies.depositButton);
  return result ? result.elements[0] : null;
}

export async function findFavoriteButtons() {
  const result = await findElementsByStrategies(strategies.favoriteButton);
  return result ? result.elements : [];
}

export async function findGameTiles() {
  const result = await findElementsByStrategies(strategies.gameTile);
  return result ? result.elements : [];
}

export async function findHeader() {
  const result = await findElementsByStrategies(strategies.header);
  return result ? result.elements[0] : null;
}

export async function findSidebar() {
  const result = await findElementsByStrategies(strategies.sidebar);
  return result ? result.elements[0] : null;
}

// Utility function to find elements within a specific context
export async function findElementsInContext(elementType, context) {
  if (!strategies[elementType]) {
    console.warn(`Unknown element type: ${elementType}`);
    return [];
  }
  
  const result = await findElementsByStrategies(strategies[elementType], context);
  return result ? result.elements : [];
}

// Clear selector cache (useful for testing or when selectors are known to be broken)
export async function clearSelectorCache() {
  selectorCache = {};
  await saveToStorage('betfred_selector_cache', {});
}

// Get current working selectors (for debugging)
export async function getWorkingSelectors() {
  return await loadSelectorCache();
}

// Test all selectors and return status
export async function testAllSelectors() {
  const results = {};
  const cache = await loadSelectorCache();
  
  for (const [elementType, strategyList] of Object.entries(strategies)) {
    results[elementType] = {};
    for (const strategy of strategyList) {
      const elements = strategy.finder(document);
      const isWorking = elements && elements.length > 0;
      const cachedSelector = cache[strategy.name];
      
      results[elementType][strategy.name] = {
        working: isWorking,
        count: elements ? elements.length : 0,
        cached: cachedSelector,
        current: strategy.selector
      };
    }
  }
  
  return results;
}

// Auto-detect and update selectors when they break
export async function autoDetectSelectors() {
  // Test each element type silently
  for (const [elementType, strategyList] of Object.entries(strategies)) {
    const result = await findElementsByStrategies(strategyList);
    if (result) {
      // Success - selector found and cached
    } else {
      // Could not find elements - this is normal if page is still loading
    }
  }
}

// Initialize selector detection
export async function initializeSelectorDetection() {
  await loadSelectorCache();
  
  // Run auto-detection on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoDetectSelectors);
  } else {
    autoDetectSelectors();
  }
  
  // Re-run detection when URL changes (new page)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(autoDetectSelectors, 1000);
    }
  }, 1000);
}

// Simple user-friendly troubleshooting function
export async function checkExtensionHealth() {
  const results = await testAllSelectors();
  const issues = [];
  
  for (const [elementType, strategies] of Object.entries(results)) {
    const workingStrategies = Object.values(strategies).filter(s => s.working);
    if (workingStrategies.length === 0) {
      issues.push(`${elementType} not found`);
    }
  }
  
  if (issues.length === 0) {
    return { status: 'healthy', message: 'Extension is working correctly' };
  } else {
    return { 
      status: 'issues', 
      message: `Some elements not found: ${issues.join(', ')}`,
      issues 
    };
  }
} 