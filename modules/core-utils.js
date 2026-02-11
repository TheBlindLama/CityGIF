(function (global) {
    function isGif(url) {
        if (!url) return false;
        const lower = String(url).toLowerCase();
        return (
            lower.endsWith('.gif') ||
            lower.includes('.gif?') ||
            lower.includes('giphy.com/media/') ||
            lower.includes('/storage/v1/object/public/gifs/') ||
            lower.includes('/storage/v1/object/gifs/')
        );
    }

    function normalizeSupabaseGifUrl(url, supabaseUrl) {
        if (!url) return null;
        if (!supabaseUrl) return String(url).trim() || null;

        let normalized = String(url).trim();
        if (!normalized) return null;

        if (normalized.startsWith('/storage/v1/object/gifs/')) {
            return `${supabaseUrl}${normalized.replace('/storage/v1/object/gifs/', '/storage/v1/object/public/gifs/')}`;
        }
        if (normalized.startsWith('/storage/v1/object/public/gifs/')) {
            return `${supabaseUrl}${normalized}`;
        }
        if (normalized.startsWith(`${supabaseUrl}/storage/v1/object/gifs/`)) {
            return normalized.replace('/storage/v1/object/gifs/', '/storage/v1/object/public/gifs/');
        }

        return normalized;
    }

    function extractSupabaseGifPath(url, supabaseUrl) {
        const normalized = normalizeSupabaseGifUrl(url, supabaseUrl);
        if (!normalized) return null;
        const clean = String(normalized).split('#')[0].split('?')[0];

        const publicPrefix = `${supabaseUrl}/storage/v1/object/public/gifs/`;
        const privatePrefix = `${supabaseUrl}/storage/v1/object/gifs/`;
        if (clean.startsWith(publicPrefix)) {
            return clean.slice(publicPrefix.length);
        }
        if (clean.startsWith(privatePrefix)) {
            return clean.slice(privatePrefix.length);
        }
        if (clean.startsWith('/storage/v1/object/public/gifs/')) {
            return clean.replace('/storage/v1/object/public/gifs/', '');
        }
        if (clean.startsWith('/storage/v1/object/gifs/')) {
            return clean.replace('/storage/v1/object/gifs/', '');
        }
        return null;
    }

    function sanitizeUsername(raw) {
        if (!raw) return null;
        let name = String(raw).trim();
        if (!name) return null;
        if (name.endsWith(':')) name = name.slice(0, -1).trim();
        return name || null;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeRoomName(raw) {
        const text = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!text) return null;
        if (text.length > 40) return null;
        return text;
    }

    function normalizePin(raw) {
        const pin = String(raw || '').trim();
        return /^\d{4}$/.test(pin) ? pin : null;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    const EXT_STORAGE_KEYS = {
        user: 'habbo_ext_user',
        pin: 'habbo_ext_pin',
        room: 'habbo_ext_room'
    };

    function hasExtensionStorage() {
        return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
    }

    function readLegacyLocalStorageValue(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function removeLegacyLocalStorageKey(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            // no-op
        }
    }

    function getExtensionStorage(keys) {
        if (!hasExtensionStorage()) return Promise.resolve({});
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => {
                resolve(result || {});
            });
        });
    }

    function setExtensionStorage(values) {
        if (!hasExtensionStorage()) return;
        chrome.storage.local.set(values);
    }

    function removeExtensionStorage(keys) {
        if (!hasExtensionStorage()) return;
        chrome.storage.local.remove(keys);
    }

    global.CityGifCoreUtils = Object.freeze({
        isGif,
        normalizeSupabaseGifUrl,
        extractSupabaseGifPath,
        sanitizeUsername,
        escapeHtml,
        normalizeRoomName,
        normalizePin,
        sleep,
        EXT_STORAGE_KEYS,
        hasExtensionStorage,
        readLegacyLocalStorageValue,
        removeLegacyLocalStorageKey,
        getExtensionStorage,
        setExtensionStorage,
        removeExtensionStorage
    });
})(window);
