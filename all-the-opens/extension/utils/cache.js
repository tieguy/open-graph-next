// Cache Module
// Handles caching with TTL (Time To Live) using chrome.storage.local

const CACHE_PREFIX = 'cache_';
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Get a cached value if it exists and hasn't expired
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} Cached value or null if expired/missing
 */
export async function getCached(key) {
  const cacheKey = CACHE_PREFIX + key;

  try {
    const result = await chrome.storage.local.get(cacheKey);
    const cached = result[cacheKey];

    if (!cached) {
      return null;
    }

    // Check if expired
    if (cached.expiry && Date.now() > cached.expiry) {
      // Clean up expired entry
      await chrome.storage.local.remove(cacheKey);
      return null;
    }

    return cached.value;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

/**
 * Store a value in cache with TTL
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in milliseconds (default: 24 hours)
 */
export async function setCache(key, value, ttl = DEFAULT_TTL) {
  const cacheKey = CACHE_PREFIX + key;

  try {
    await chrome.storage.local.set({
      [cacheKey]: {
        value: value,
        expiry: Date.now() + ttl,
        cached: Date.now()
      }
    });
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

/**
 * Remove a cached value
 * @param {string} key - Cache key
 */
export async function removeCache(key) {
  const cacheKey = CACHE_PREFIX + key;
  try {
    await chrome.storage.local.remove(cacheKey);
  } catch (error) {
    console.error('Cache remove error:', error);
  }
}

/**
 * Clear all cached values
 */
export async function clearCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter(k => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await chrome.storage.local.remove(cacheKeys);
    }
  } catch (error) {
    console.error('Cache clear error:', error);
  }
}

/**
 * Get cache statistics
 * @returns {Promise<Object>} Cache stats
 */
export async function getCacheStats() {
  try {
    const all = await chrome.storage.local.get(null);
    const cacheEntries = Object.entries(all).filter(([k]) => k.startsWith(CACHE_PREFIX));

    let validCount = 0;
    let expiredCount = 0;
    const now = Date.now();

    for (const [, entry] of cacheEntries) {
      if (entry.expiry && now > entry.expiry) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      total: cacheEntries.length,
      valid: validCount,
      expired: expiredCount
    };
  } catch (error) {
    console.error('Cache stats error:', error);
    return { total: 0, valid: 0, expired: 0 };
  }
}
