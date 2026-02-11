/**
 * Content Script for HabboCity Emoji/GIF Extension
 * Handles DOM injection, message interception, and parsing.
 */

(function () {
    // --- UTILS ---
    /**
     * DÃƒÂ©termine si une URL est un GIF
     */
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

    function normalizeSupabaseGifUrl(url) {
        if (!url) return null;
        let normalized = String(url).trim();
        if (!normalized) return null;

        if (normalized.startsWith('/storage/v1/object/gifs/')) {
            return `${SUPABASE_URL}${normalized.replace('/storage/v1/object/gifs/', '/storage/v1/object/public/gifs/')}`;
        }
        if (normalized.startsWith('/storage/v1/object/public/gifs/')) {
            return `${SUPABASE_URL}${normalized}`;
        }
        if (normalized.startsWith(`${SUPABASE_URL}/storage/v1/object/gifs/`)) {
            return normalized.replace('/storage/v1/object/gifs/', '/storage/v1/object/public/gifs/');
        }

        return normalized;
    }

    function extractSupabaseGifPath(url) {
        const normalized = normalizeSupabaseGifUrl(url);
        if (!normalized) return null;
        const clean = String(normalized).split('#')[0].split('?')[0];

        const publicPrefix = `${SUPABASE_URL}/storage/v1/object/public/gifs/`;
        const privatePrefix = `${SUPABASE_URL}/storage/v1/object/gifs/`;
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
        } catch (e) { }
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

    async function getUserRecord(username) {
        if (!username) return null;
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/users?username=ilike.${encodeURIComponent(username)}&select=username&limit=1`, {
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Accept": "application/json"
                }
            });
            if (!response.ok) return null;
            const rows = await response.json();
            return rows && rows[0] ? rows[0] : null;
        } catch (e) {
            return null;
        }
    }

    async function verifyUserPin(username, pin) {
        if (!username || !pin) return false;
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_user_pin`, {
                method: 'POST',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    p_username: username,
                    p_pin: pin
                })
            });
            if (!response.ok) return false;
            const data = await response.json();
            return data === true;
        } catch (e) {
            return false;
        }
    }

    function buildSupabaseAuthHeaders(extraHeaders = {}) {
        const headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            ...extraHeaders
        };
        if (currentUser) headers["x-habbo-user"] = currentUser;
        const pin = getPin();
        if (pin) headers["x-user-pin"] = pin;
        return headers;
    }

    async function requestPinInPluginUI({
        title = 'Security Check',
        description = 'Enter your 4-digit PIN.',
        confirm = false,
        confirmLabel = 'Confirm PIN'
    } = {}) {
        return new Promise((resolve) => {
            let isClosed = false;
            const safeTitle = escapeHtml(title);
            const safeDescription = escapeHtml(description);
            const safeConfirmLabel = escapeHtml(confirmLabel);
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.65);
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
            `;

            const modal = document.createElement('div');
            modal.style.cssText = `
                width: 100%;
                max-width: 360px;
                background: #111827;
                border: 1px solid rgba(74,144,226,0.45);
                border-radius: 10px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.45);
                padding: 16px;
                color: white;
                font-family: system-ui, sans-serif;
            `;
            modal.tabIndex = 0;
            modal.innerHTML = `
                <div style="font-size:16px;font-weight:700;margin-bottom:6px;">${safeTitle}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:12px;">${safeDescription}</div>
                <div id="ext-pin-step" style="font-size:11px;color:rgba(255,255,255,0.8);margin-bottom:8px;">Enter PIN</div>
                <div id="ext-pin-display" style="height:42px;display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:12px;border:1px solid rgba(74,144,226,0.45);border-radius:8px;background:#0b1220;"></div>
                <div id="ext-pin-pad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
                    <button type="button" data-pin-digit="1" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">1</button>
                    <button type="button" data-pin-digit="2" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">2</button>
                    <button type="button" data-pin-digit="3" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">3</button>
                    <button type="button" data-pin-digit="4" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">4</button>
                    <button type="button" data-pin-digit="5" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">5</button>
                    <button type="button" data-pin-digit="6" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">6</button>
                    <button type="button" data-pin-digit="7" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">7</button>
                    <button type="button" data-pin-digit="8" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">8</button>
                    <button type="button" data-pin-digit="9" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">9</button>
                    <button type="button" id="ext-pin-clear" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">Clear</button>
                    <button type="button" data-pin-digit="0" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">0</button>
                    <button type="button" id="ext-pin-back" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">⌫</button>
                </div>
                <div id="ext-pin-error" style="min-height:16px;font-size:11px;color:#f87171;margin-bottom:10px;"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
                    <button id="ext-pin-cancel" type="button" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:white;cursor:pointer;">Cancel</button>
                </div>
            `;

            const swallowKeysWhileOpen = (e) => {
                if (isClosed) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close(null);
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
            };
            document.addEventListener('keydown', swallowKeysWhileOpen, true);
            document.addEventListener('keypress', swallowKeysWhileOpen, true);
            document.addEventListener('keyup', swallowKeysWhileOpen, true);

            const close = (value = null) => {
                if (isClosed) return;
                isClosed = true;
                document.removeEventListener('keydown', swallowKeysWhileOpen, true);
                document.removeEventListener('keypress', swallowKeysWhileOpen, true);
                document.removeEventListener('keyup', swallowKeysWhileOpen, true);
                overlay.remove();
                resolve(value);
            };

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            try {
                if (document.activeElement && typeof document.activeElement.blur === 'function') {
                    document.activeElement.blur();
                }
            } catch (e) { }

            const stepEl = modal.querySelector('#ext-pin-step');
            const displayEl = modal.querySelector('#ext-pin-display');
            const err = modal.querySelector('#ext-pin-error');
            const cancelBtn = modal.querySelector('#ext-pin-cancel');
            const clearBtn = modal.querySelector('#ext-pin-clear');
            const backBtn = modal.querySelector('#ext-pin-back');
            const digitButtons = modal.querySelectorAll('[data-pin-digit]');

            let phase = confirm ? 'first' : 'single';
            let firstPin = '';
            let currentPin = '';

            const renderDisplay = () => {
                const dots = [];
                for (let i = 0; i < 4; i += 1) {
                    const filled = i < currentPin.length;
                    dots.push(`<span style="width:10px;height:10px;border-radius:50%;display:inline-block;background:${filled ? '#4a90e2' : 'rgba(255,255,255,0.25)'};"></span>`);
                }
                displayEl.innerHTML = dots.join('');
            };

            const renderStep = () => {
                if (phase === 'first') {
                    stepEl.textContent = 'Enter your 4-digit PIN';
                } else if (phase === 'confirm') {
                    stepEl.textContent = safeConfirmLabel;
                } else {
                    stepEl.textContent = 'Enter your 4-digit PIN';
                }
            };

            const advanceIfComplete = () => {
                if (currentPin.length !== 4) return;

                if (phase === 'single') {
                    close(currentPin);
                    return;
                }

                if (phase === 'first') {
                    firstPin = currentPin;
                    currentPin = '';
                    phase = 'confirm';
                    err.textContent = '';
                    renderStep();
                    renderDisplay();
                    return;
                }

                if (phase === 'confirm') {
                    if (currentPin !== firstPin) {
                        err.textContent = 'PIN confirmation does not match.';
                        currentPin = '';
                        renderDisplay();
                        return;
                    }
                    close(firstPin);
                }
            };

            const appendDigit = (digit) => {
                if (!/^\d$/.test(digit) || currentPin.length >= 4) return;
                currentPin += digit;
                err.textContent = '';
                renderDisplay();
                advanceIfComplete();
            };

            cancelBtn.onclick = () => close(null);
            clearBtn.onclick = () => {
                currentPin = '';
                err.textContent = '';
                renderDisplay();
            };
            backBtn.onclick = () => {
                currentPin = currentPin.slice(0, -1);
                err.textContent = '';
                renderDisplay();
            };

            digitButtons.forEach((btn) => {
                btn.onclick = () => appendDigit(btn.getAttribute('data-pin-digit'));
            });

            overlay.onclick = (e) => {
                if (e.target === overlay) close(null);
            };
            modal.onkeydown = (e) => {
                // Defensive duplicate: global capture listener also blocks keys.
                e.preventDefault();
                e.stopPropagation();
            };

            renderStep();
            renderDisplay();
            setTimeout(() => modal.focus(), 0);
        });
    }

    async function ensurePinReadyForCurrentUser(options = {}) {
        const interactive = !!options.interactive;
        if (!currentUser) return false;

        let userRecord = await getUserRecord(currentUser);
        if (!userRecord) {
            if (!interactive) return false;
            const newPin = await requestPinInPluginUI({
                title: `Register ${currentUser}`,
                description: 'First login detected. Create your private 4-digit PIN.',
                confirm: true
            });
            if (!newPin) return false;

            const createResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_user`, {
                method: 'POST',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    p_username: currentUser,
                    p_pin: newPin,
                    p_room: currentRoom || 'Lobby'
                })
            });

            if (!createResp.ok) {
                const err = await createResp.text();
                console.error("[HabboCityEmoji] Failed to create user:", err);
                alert("Could not create your plugin account.");
                return false;
            }

            const registered = await createResp.json();
            if (registered !== true) {
                alert("Could not create your plugin account.");
                return false;
            }

            savePin(newPin);
            return true;
        }

        if (userRecord.username && userRecord.username !== currentUser) {
            currentUser = userRecord.username;
            persistUserIdentity(currentUser);
        }

        if (cachedPin) {
            const cachedOk = await verifyUserPin(currentUser, cachedPin);
            if (cachedOk) return true;
            clearPin();
        }

        if (!interactive) return false;

        const pin = await requestPinInPluginUI({
            title: `Welcome ${currentUser}`,
            description: 'Enter your 4-digit PIN to continue.'
        });
        if (!pin) return false;
        const ok = await verifyUserPin(currentUser, pin);
        if (!ok) {
            alert("Invalid PIN.");
            return false;
        }

        savePin(pin);
        return true;
    }

    console.log("%c[HabboCityEmoji] Extension Script Initialized", "color: #00ff00; font-weight: bold; font-size: 14px;");
    console.log("[HabboCityEmoji] Current URL: " + window.location.href);
    console.log("HabboCity Emoji Extension loaded.");

    let chatInput = null;
    let emojiPanel = null;
    let radioPanel = null;
    let currentUser = null;
    let roomParticipants = {}; // { roomName: [users] }
    let isAdmin = false;
    let currentPlayingVideoId = null;
    let lastSyncData = null; // { videoId, startTime, dj }
    let currentRoomData = null; // Full object from DB
    let ytWindow = null;
    let supabaseClient = null;
    let cityRadioChannel = null;
    let currentRoom = 'Lobby';
    let cachedPin = null;
    let roomPresenceHeartbeat = null;
    let identityNotice = '';
    let ytMessageListenerBound = false;
    let ytStatePollInterval = null;
    let ytPlayerState = -1;
    let ytLastKnownTime = 0;
    let ytLastKnownTimeUpdatedAt = 0;
    let currentVideoTitle = '';
    let videoTitleById = {};
    let djPlaybackStartTimeMs = 0;
    let djLastObservedPlayerTime = null;
    let djLastObservedAtMs = 0;
    let djLastSeekBroadcastAtMs = 0;
    let djLastStateBroadcastAtMs = 0;
    let lastSyncDataUpdatedAt = 0;
    const ROOM_ACTIVE_PRESENCE_WINDOW_MS = 2 * 60 * 1000;
    const ROOM_STALE_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
    const ROOM_EMPTY_PRUNE_GRACE_MS = 20 * 1000;
    const ROOM_PRUNE_INTERVAL_MS = 30 * 1000;
    const ROOM_PRUNE_COOLDOWN_MS = 60 * 1000;
    const ROOM_PRUNE_BATCH_SIZE = 100;
    const LISTENER_SYNC_DRIFT_THRESHOLD_SECONDS = 1;
    let lastRoomPruneAttemptAtMs = 0;

    async function bootstrapExtensionStorage() {
        const stored = await getExtensionStorage([
            EXT_STORAGE_KEYS.user,
            EXT_STORAGE_KEYS.pin,
            EXT_STORAGE_KEYS.room
        ]);

        const legacyUser = readLegacyLocalStorageValue(EXT_STORAGE_KEYS.user);
        const legacyPin = readLegacyLocalStorageValue(EXT_STORAGE_KEYS.pin);
        const legacyRoom = readLegacyLocalStorageValue(EXT_STORAGE_KEYS.room);

        const mergedUser = sanitizeUsername(stored[EXT_STORAGE_KEYS.user] || legacyUser);
        const mergedPin = normalizePin(stored[EXT_STORAGE_KEYS.pin] || legacyPin);
        const mergedRoom = normalizeRoomName(stored[EXT_STORAGE_KEYS.room] || legacyRoom) || 'Lobby';

        const updates = {};
        if (mergedUser) {
            currentUser = mergedUser;
            updates[EXT_STORAGE_KEYS.user] = mergedUser;
        }
        if (mergedPin) {
            cachedPin = mergedPin;
            updates[EXT_STORAGE_KEYS.pin] = mergedPin;
        }
        currentRoom = mergedRoom;
        updates[EXT_STORAGE_KEYS.room] = mergedRoom;

        setExtensionStorage(updates);
        removeLegacyLocalStorageKey(EXT_STORAGE_KEYS.user);
        removeLegacyLocalStorageKey(EXT_STORAGE_KEYS.pin);
        removeLegacyLocalStorageKey(EXT_STORAGE_KEYS.room);
    }

    function persistUserIdentity(username) {
        if (!username) return;
        setExtensionStorage({ [EXT_STORAGE_KEYS.user]: username });
    }

    function persistCurrentRoom(roomName) {
        if (!roomName) return;
        setExtensionStorage({ [EXT_STORAGE_KEYS.room]: roomName });
    }

    function savePin(pin) {
        const normalized = normalizePin(pin);
        if (!normalized) return;
        cachedPin = normalized;
        setExtensionStorage({ [EXT_STORAGE_KEYS.pin]: normalized });
    }

    function clearPin() {
        cachedPin = null;
        removeExtensionStorage([EXT_STORAGE_KEYS.pin]);
    }

    function getPin() {
        return cachedPin || '';
    }

    // --- IDENTITY EXTRACTION ---

    function detectPlayerUsernameFromNitro() {
        // Preferred path: user opened their own avatar menu.
        // We only trust `.menu-header` if the same menu contains "Changer de nom".
        const ownMenuMarker = Array.from(document.querySelectorAll('.menu-item.list-item'))
            .find((el) => (el.textContent || '').trim().toLowerCase() === 'changer de nom');
        if (ownMenuMarker) {
            const menuRoot = ownMenuMarker.closest(
                '.menu, .dropdown-menu, .context-menu, [class*="menu"], [class*="dropdown"]'
            ) || ownMenuMarker.parentElement;

            const headerNode = menuRoot?.querySelector('.menu-header')
                || document.querySelector('.menu-header');
            const ownName = sanitizeUsername(headerNode?.textContent || headerNode?.innerText || '');
            if (ownName && ownName.length >= 2 && ownName.length <= 24) {
                return ownName;
            }
        }

        const selectors = [
            '.nitro-profile-info .username',
            '.nitro-profile-info [class*="name"]',
            '.header-profile [class*="name"]',
            '.user-profile [class*="name"]',
            '[class*="nitro"][class*="profile"] [class*="user"]',
            '[class*="nitro"][class*="profile"] [class*="name"]'
        ];

        for (const selector of selectors) {
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
                const name = sanitizeUsername(node.textContent || node.innerText || '');
                if (name && name.length >= 2 && name.length <= 24) {
                    return name;
                }
            }
        }

        // Fallback: detect from a recent "own message" bubble if Nitro marks it.
        const ownBubbleName = document.querySelector(
            '.nitro-chat-bubble.own .name, .nitro-chat-bubble.is-own .name, .chat-bubble.own .name, .chat-bubble.is-own .name'
        );
        return sanitizeUsername(ownBubbleName?.textContent || ownBubbleName?.innerText || '');
    }

    function setCurrentUserIdentity(username) {
        const clean = sanitizeUsername(username);
        if (!clean) return false;
        currentUser = clean;
        persistUserIdentity(clean);
        updateButtonState();
        return true;
    }

    async function refreshAdminAndPresence() {
        if (!currentUser) return;
        isAdmin = await checkAdminStatus(currentUser);
        const pinReady = await ensurePinReadyForCurrentUser({ interactive: false });
        if (pinReady) {
            upsertCurrentUserRoomPresence(currentRoom).catch(() => { });
        }
        if (emojiPanel) refreshPanel();
    }

    async function loginWithDetectedUsername(username) {
        if (!setCurrentUserIdentity(username)) {
            alert('Could not detect your Nitro username.');
            return false;
        }

        const pinReady = await ensurePinReadyForCurrentUser({ interactive: true });
        if (!pinReady) return false;

        await refreshAdminAndPresence();
        identityNotice = `Welcome ${currentUser}`;
        alert(identityNotice);
        return true;
    }

    /**
     * Loads identity from storage.
     */
    function loadIdentity() {
        let saved = sanitizeUsername(currentUser);
        if (saved) {
            setCurrentUserIdentity(saved);
            console.log(`[HabboCityEmoji] IdentitÃƒÂ© restaurÃƒÂ©e : ${currentUser}`);
            refreshAdminAndPresence().catch(() => { });
            return;
        }

        const detected = detectPlayerUsernameFromNitro();
        if (detected) {
            setCurrentUserIdentity(detected);
            refreshAdminAndPresence().catch(() => { });
        }
    }

    /**
     * Updates the main emoji button appearance based on login status.
     */
    function updateButtonState() {
        const btn = document.querySelector('.emoji-ext-button');
        if (btn) {
            if (currentUser) {
                btn.classList.add('logged-in');
                btn.title = `ConnectÃƒÂ© en tant que ${currentUser}`;
            } else {
                btn.classList.remove('logged-in');
                btn.title = 'Emoji & GIFs (Non connectÃƒÂ©)';
            }
        }
    }

    // --- DOM DETECTION & INJECTION ---

    /**
     * Finds the Nitro chat input element.
     * Nitro usually uses a textarea or input in the bottom bar.
     */
    function findChatInput() {
        // Broad search for Nitro chat inputs
        const selectors = [
            '.nitro-chat-input-container input',
            '.nitro-chat-input-container textarea',
            'textarea[placeholder*="Chuchoter"]',
            'textarea[placeholder*="Dire"]',
            'input[placeholder*="Chuchoter"]',
            'input[placeholder*="dire"]',
            '.chat-input input',
            '#chat-input',
            '.nitro-chat-input'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
                console.log(`[HabboCityEmoji] Input found via: ${selector}`);
                return el;
            }
        }

        // Final fallback: any visible textarea or input that looks like a chat bar
        const inputs = document.querySelectorAll('input, textarea');
        for (const input of inputs) {
            if (input.placeholder && (input.placeholder.toLowerCase().includes('dire') || input.placeholder.toLowerCase().includes('chuchot'))) {
                console.log(`[HabboCityEmoji] Input found via placeholder heuristic`);
                return input;
            }
        }

        return null;
    }

    /**
     * Injects the Emoji button into the Nitro UI.
     */
    function injectEmojiButton() {
        if (document.querySelector('.emoji-ext-button')) return;

        chatInput = findChatInput();
        if (!chatInput) return;

        const container = chatInput.parentElement;
        if (!container) return;

        // --- BUTTONS ---
        const btn = document.createElement('div');
        btn.className = 'emoji-ext-button';
        btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM12 11C13.66 11 15 9.66 15 8C15 6.34 13.66 5 12 5C10.34 5 9 6.34 9 8C9 9.66 10.34 11 12 11ZM12 13C9.33 13 4 14.34 4 17V19H20V17C20 14.34 14.67 13 12 13Z"/></svg>`;
        btn.title = 'Emoji & GIFs';

        const radioBtn = document.createElement('div');
        radioBtn.className = 'radio-ext-button';
        radioBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20,6H4V4H20V6M20,8H4C2.9,8 2,8.9 2,10V18C2,19.1 2.9,20 4,20H20C21.1,20 22,19.1 22,18V10C22,8.9 21.1,8 20,8M7,12C8.11,12 9,12.89 9,14C9,15.11 8.11,16 7,16C5.89,16 5,15.11 5,14C5,12.89 5.89,12 7,12M17,17V16H11V17H17M17,15V14H11V15H17M17,13V12H11V13H17Z"/></svg>`;
        radioBtn.title = 'DJ Rooms';

        // --- PANELS (Singleton) ---
        if (!emojiPanel) {
            emojiPanel = document.createElement('div');
            emojiPanel.className = 'emoji-ext-panel';
            document.body.appendChild(emojiPanel);
            refreshPanel();
        }
        if (!radioPanel) {
            radioPanel = document.createElement('div');
            radioPanel.className = 'radio-ext-panel';
            document.body.appendChild(radioPanel);
            refreshRadioPanel();
        }

        btn.onclick = (e) => {
            e.stopPropagation();
            const isActive = emojiPanel.classList.toggle('active');
            btn.classList.toggle('active', isActive);
            if (isActive) {
                radioPanel.classList.remove('active');
                radioBtn.classList.remove('active');
                syncEmojis().then(() => refreshPanel());
            }
        };

        radioBtn.onclick = (e) => {
            e.stopPropagation();
            const isActive = radioPanel.classList.toggle('active');
            radioBtn.classList.toggle('active', isActive);
            if (isActive) {
                emojiPanel.classList.remove('active');
                btn.classList.remove('active');
                refreshRadioPanel();
            }
        };

        // UI Fixes in container
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.appendChild(btn);
        container.appendChild(radioBtn);

        setupInputInterception(chatInput);
    }

    let currentTab = 'gifs';

    /**
     * Re-renders the panel content (emojis + admin form if applicable)
     */
    function refreshPanel() {
        if (!emojiPanel) return;
        emojiPanel.innerHTML = '';

        // Header (v0 Style)
        const header = document.createElement('div');
        header.className = 'radio-v0-header';
        header.innerHTML = `
            <div class="radio-v0-header-title">
                <div class="radio-v0-header-icon" style="background:hsla(var(--secondary), 0.2); color:hsl(var(--secondary));">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                </div>
                <div class="radio-v0-header-text">
                    <h2>Expressions</h2>
                    <p>Emojis & GIFs</p>
                </div>
            </div>
            <div class="radio-v0-close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </div>
        `;
        header.querySelector('.radio-v0-close').onclick = () => {
            emojiPanel.classList.remove('active');
            document.querySelector('.emoji-ext-button')?.classList.remove('active');
        };
        emojiPanel.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'radio-v0-body';
        emojiPanel.appendChild(body);

        // Tabs
        const tabs = document.createElement('div');
        tabs.className = 'radio-v0-tabs';
        const tabList = [
            { id: 'gifs', label: 'GIFs' },
            { id: 'emojis', label: 'Emojis' },
            { id: 'add', label: 'Add' },
            { id: 'identity', label: 'User' }
        ];

        tabList.forEach(t => {
            const tabEl = document.createElement('div');
            tabEl.className = `radio-v0-tab ${currentTab === t.id ? 'active' : ''}`;
            tabEl.innerText = t.label;
            tabEl.onclick = (e) => {
                e.stopPropagation();
                currentTab = t.id;
                refreshPanel();
            };
            tabs.appendChild(tabEl);
        });
        body.appendChild(tabs);

        // Content Area (Search + Grid)
        if (currentTab === 'gifs' || currentTab === 'emojis') {
            // Search Bar
            const searchBox = document.createElement('div');
            searchBox.className = 'emoji-v0-search-container';
            searchBox.innerHTML = `
                <svg class="emoji-v0-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input type="text" class="emoji-v0-search-input" placeholder="Search ${currentTab}...">
            `;
            searchBox.querySelector('input').addEventListener('input', (e) => {
                // Filter logic could go here
                const term = e.target.value.toLowerCase();
                const items = body.querySelectorAll(currentTab === 'gifs' ? '.gif-v0-item' : '.emoji-v0-item');
                items.forEach(item => {
                    const title = item.getAttribute('title')?.toLowerCase() || '';
                    item.style.display = title.includes(term) ? 'flex' : 'none';
                    if (currentTab === 'gifs') {
                        item.style.display = title.includes(term) ? 'block' : 'none';
                    }
                });
            });
            body.appendChild(searchBox);
        }

        if (currentTab === 'add') {
            renderAddTab(body);
        } else if (currentTab === 'identity') {
            renderIdentityTab(body);
        } else if (currentTab === 'emojis') {
            renderRealEmojiList(body);
        } else {
            renderEmojiList(body); // GIFs
        }
    }

    function renderIdentityTab() {
        const div = document.createElement('div');
        div.style.padding = '10px';
        div.style.textAlign = 'center';
        div.onclick = (e) => e.stopPropagation();

        if (currentUser) {
            const nameInfo = document.createElement('div');
            nameInfo.style.fontSize = '14px';
            nameInfo.style.marginBottom = '10px';
            nameInfo.textContent = 'Connected: ';
            const b = document.createElement('b');
            b.textContent = currentUser;
            nameInfo.appendChild(b);

            const statusInfo = document.createElement('div');
            statusInfo.style.fontSize = '11px';
            statusInfo.style.color = 'rgba(255,255,255,0.5)';
            statusInfo.style.marginBottom = '15px';
            statusInfo.textContent = 'Role: ';
            const statusSpan = document.createElement('span');
            if (isAdmin) {
                statusSpan.style.color = '#4a90e2';
                statusSpan.textContent = 'Admin';
            } else {
                statusSpan.textContent = 'User';
            }
            statusInfo.appendChild(statusSpan);

            if (identityNotice) {
                const msg = document.createElement('div');
                msg.style.cssText = 'font-size:12px;color:#86efac;margin-bottom:10px;';
                msg.textContent = identityNotice;
                div.appendChild(msg);
            }

            const relogBtn = document.createElement('button');
            relogBtn.style.cssText = 'background:#4a90e2; color:white; border:none; padding:8px 15px; border-radius:4px; cursor:pointer; margin-right:8px;';
            relogBtn.textContent = 'Re-login';
            relogBtn.onclick = async () => {
                const ok = await ensurePinReadyForCurrentUser({ interactive: true });
                if (!ok) return;
                await refreshAdminAndPresence();
                identityNotice = `Welcome ${currentUser}`;
                refreshPanel();
            };

            const logoutBtn = document.createElement('button');
            logoutBtn.id = 'ext-logout-btn';
            logoutBtn.style.cssText = 'background:#d9534f; color:white; border:none; padding:8px 15px; border-radius:4px; cursor:pointer;';
            logoutBtn.textContent = 'Logout';
            logoutBtn.onclick = async () => {
                await leaveRoom({ skipPanelRefresh: true }).catch(() => { });
                removeExtensionStorage([EXT_STORAGE_KEYS.user, EXT_STORAGE_KEYS.pin]);
                removeLegacyLocalStorageKey(EXT_STORAGE_KEYS.user);
                removeLegacyLocalStorageKey(EXT_STORAGE_KEYS.pin);
                currentUser = null;
                cachedPin = null;
                isAdmin = false;
                identityNotice = '';
                currentTab = 'gifs';
                updateButtonState();
                refreshPanel();
            };

            div.appendChild(nameInfo);
            div.appendChild(statusInfo);
            div.appendChild(relogBtn);
            div.appendChild(logoutBtn);
            emojiPanel.appendChild(div);
        } else {
            const detected = detectPlayerUsernameFromNitro();

            const info = document.createElement('div');
            info.style.fontSize = '13px';
            info.style.marginBottom = '15px';
            info.textContent = detected
                ? `Nitro username detected: ${detected}`
                : 'Click your avatar, open your own profile menu, then retry detection.';

            const loginBtn = document.createElement('button');
            loginBtn.id = 'ext-login-btn';
            loginBtn.style.cssText = 'background:#4a90e2; color:white; border:none; padding:10px 20px; border-radius:6px; font-weight:bold; cursor:pointer;';
            loginBtn.textContent = detected ? `Connect as ${detected}` : 'Detect username';
            loginBtn.onclick = async () => {
                const name = detected || detectPlayerUsernameFromNitro();
                if (!name) {
                    alert('Could not detect your Nitro username.');
                    return;
                }
                const ok = await loginWithDetectedUsername(name);
                if (ok) refreshPanel();
            };

            const note = document.createElement('div');
            note.style.cssText = 'font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 15px;';
            note.textContent = 'PIN stays inside the plugin and is never sent to chat.';

            div.appendChild(info);
            div.appendChild(loginBtn);
            div.appendChild(note);
            emojiPanel.appendChild(div);
        }
    }

    function renderEmojiList(container) {
        const list = document.createElement('div');
        list.className = 'gif-v0-grid'; // Use the new GIF Grid class

        Object.keys(EMOJI_MAPPING).forEach(key => {
            const url = EMOJI_MAPPING[key];
            const isTargetGif = typeof url === 'object' ? isGif(url.url) : isGif(url);

            if ((currentTab === 'gifs' && isTargetGif) || (currentTab === 'emojis' && !isTargetGif)) {
                const imgSource = isTargetGif ? (url.url || url) : url;
                if (!imgSource || imgSource === 'null') return;

                const item = document.createElement('div');
                item.className = isTargetGif ? 'gif-v0-item' : 'emoji-v0-item';
                item.title = isTargetGif ? `${key}` : key;

                const img = document.createElement('img');
                img.src = imgSource;
                img.className = isTargetGif ? 'gif-v0-img' : 'emoji-v0-img';

                item.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    if (isTargetGif) {
                        // GIFs: just insert the code, will be replaced after sending
                        insertEmojiCode(key);
                    } else {
                        // Twemojis: insert code AND transform immediately
                        insertEmojiWithPreview(key);
                    }
                };

                item.appendChild(img);
                list.appendChild(item);
            }
        });

        if (list.childNodes.length === 0) {
            const empty = document.createElement('p');
            empty.style.textAlign = 'center';
            empty.style.color = 'hsl(var(--muted-foreground))';
            empty.style.padding = '2rem';
            empty.innerText = 'No GIFs found...';
            list.appendChild(empty);
        }

        container.appendChild(list);
    }

    function renderRealEmojiList(container) {
        const list = document.createElement('div');
        list.className = 'emoji-v0-grid'; // New Emoji Grid

        Object.keys(BYPASS_EMOJI_MAPPING).forEach(emoji => {
            const item = document.createElement('div');
            item.className = 'emoji-v0-item';
            item.title = emoji;

            const url = getTwemojiUrl(emoji);
            if (url) {
                const img = document.createElement('img');
                img.src = url;
                img.className = 'emoji-v0-img';
                img.onerror = () => { item.innerText = emoji; };
                item.appendChild(img);
            } else {
                item.innerText = emoji;
            }

            item.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();

                // For Twemojis from the emoji tab, insert the alias code and transform immediately
                const alias = BYPASS_EMOJI_MAPPING[emoji];
                if (alias) {
                    insertEmojiWithPreview(alias);
                } else {
                    insertEmojiCode(emoji);
                }
            };
            list.appendChild(item);
        });
        container.appendChild(list);
    }
    async function renderAddTab(container) {
        if (!currentUser) {
            renderIdentityTab(container);
            return;
        }

        const pinReady = await ensurePinReadyForCurrentUser({ interactive: true });
        if (!pinReady) {
            const info = document.createElement('div');
            info.style.cssText = 'padding:12px; color:hsl(var(--muted-foreground)); font-size:12px;';
            info.innerText = 'PIN required to access Add tab.';
            container.appendChild(info);
            return;
        }

        const form = document.createElement('div');
        form.className = 'emoji-ext-admin-form v2';
        form.innerHTML = `
            <div class="emoji-ext-add-section">
                <div class="emoji-ext-section-header">
                    <h3>Add GIF</h3>
                    ${currentUser.toLowerCase() === 'adham' ? '<span id="ext-reset-pin" class="ext-reset-btn">Reset PIN</span>' : ''}
                </div>
                <div class="emoji-ext-field-group">
                    <input type="text" id="ext-new-code" placeholder="Alias (e.g. :dance:)" class="radio-v0-input">
                </div>
                <div class="emoji-ext-type-toggle">
                    <div class="emoji-ext-type-btn active" data-type="link">URL</div>
                    <div class="emoji-ext-type-btn" data-type="file">File</div>
                </div>
                <div id="ext-url-input-area">
                    <input type="text" id="ext-new-url" placeholder="https://..." class="radio-v0-input">
                </div>
                <div id="ext-file-input-area" style="display: none;">
                    <div class="ext-file-dropzone" id="ext-dropzone">
                        <p id="ext-file-name">Click to choose GIF/image</p>
                        <input type="file" id="ext-file-input" accept="image/gif,image/png,image/jpeg,video/gif" style="display: none;">
                    </div>
                </div>
                <button id="ext-add-btn" class="radio-v0-btn-primary">Upload</button>
                <div id="ext-upload-status" class="ext-status-msg"></div>
            </div>

            <div class="emoji-ext-gallery-section">
                <div class="emoji-ext-section-header">
                    <h3>GIF Gallery</h3>
                </div>
                <div class="emoji-v0-search-container ext-gallery-search">
                    <svg class="emoji-v0-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input type="text" id="ext-gallery-search-input" class="emoji-v0-search-input" placeholder="Search by :code: or uploader">
                </div>
                <div id="ext-gallery-list" class="emoji-ext-gallery-grid"></div>
            </div>
        `;

        form.onclick = (e) => e.stopPropagation();
        container.appendChild(form);

        const btnType = form.querySelectorAll('.emoji-ext-type-btn');
        const urlArea = form.querySelector('#ext-url-input-area');
        const fileArea = form.querySelector('#ext-file-input-area');
        const fileInput = form.querySelector('#ext-file-input');
        const dropzone = form.querySelector('#ext-dropzone');
        const fileNameDisplay = form.querySelector('#ext-file-name');
        const addBtn = form.querySelector('#ext-add-btn');
        const statusMsg = form.querySelector('#ext-upload-status');
        const codeInput = form.querySelector('#ext-new-code');
        const urlInput = form.querySelector('#ext-new-url');
        const resetPin = form.querySelector('#ext-reset-pin');
        const galleryList = form.querySelector('#ext-gallery-list');
        const gallerySearchInput = form.querySelector('#ext-gallery-search-input');

        let uploadMode = 'link';

        btnType.forEach(btn => {
            btn.onclick = () => {
                btnType.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                uploadMode = btn.dataset.type;
                if (uploadMode === 'link') {
                    urlArea.style.display = 'block';
                    fileArea.style.display = 'none';
                } else {
                    urlArea.style.display = 'none';
                    fileArea.style.display = 'block';
                }
            };
        });

        dropzone.onclick = () => fileInput.click();
        fileInput.onchange = () => {
            if (fileInput.files.length > 0) {
                fileNameDisplay.innerText = fileInput.files[0].name;
                fileNameDisplay.style.color = 'hsl(var(--primary))';
            }
        };

        if (resetPin) {
            resetPin.onclick = () => {
                if (confirm('Reset admin PIN?')) {
                    clearPin();
                    refreshPanel();
                }
            };
        }

        const allGifsRaw = Object.keys(EMOJI_MAPPING)
            .map(code => {
                const data = EMOJI_MAPPING[code];
                const url = typeof data === 'object' ? data.url : data;
                const user = (typeof data === 'object' ? data.user : 'System') || 'System';
                return { code, url, user };
            })
            .filter(item => item.url && isGif(item.url));
        const allGifs = allGifsRaw.filter((item, index, arr) => {
            const normalizedUrl = String(item.url).trim().toLowerCase();
            return arr.findIndex(other => String(other.url).trim().toLowerCase() === normalizedUrl) === index;
        });
        const myGifs = allGifs.filter(item => item.user.toLowerCase() === (currentUser || '').toLowerCase());
        const canAddGif = isAdmin || myGifs.length < 5;

        const renderGallery = (query = '') => {
            const q = query.trim().toLowerCase();
            const sourceList = isAdmin ? allGifs : myGifs;
            const filtered = sourceList.filter(item =>
                item.code.toLowerCase().includes(q) || item.user.toLowerCase().includes(q)
            );

            galleryList.innerHTML = '';
            if (filtered.length === 0) {
                galleryList.innerHTML = '<p class="ext-empty-msg">No GIF found.</p>';
                return;
            }

            filtered.forEach(item => {
                const card = document.createElement('div');
                card.className = 'ext-gallery-item';
                card.title = `${item.code} - ${item.user}`;
                card.setAttribute('role', 'button');
                card.setAttribute('tabindex', '0');

                const thumb = document.createElement('span');
                thumb.className = 'ext-gallery-thumb';
                const thumbImg = document.createElement('img');
                thumbImg.src = item.url;
                thumbImg.alt = item.code;
                thumb.appendChild(thumbImg);

                const meta = document.createElement('span');
                meta.className = 'ext-gallery-meta';
                const codeEl = document.createElement('span');
                codeEl.className = 'ext-gallery-code';
                codeEl.textContent = item.code;
                const userEl = document.createElement('span');
                userEl.className = 'ext-gallery-user';
                userEl.textContent = item.user;
                meta.appendChild(codeEl);
                meta.appendChild(userEl);

                const delBtn = document.createElement('button');
                delBtn.className = 'ext-del-btn';
                delBtn.type = 'button';
                delBtn.title = 'Delete GIF';
                delBtn.setAttribute('aria-label', `Delete ${item.code}`);
                delBtn.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M8 6V4h8v2"></path>
                        <path d="M19 6l-1 14H6L5 6"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                    </svg>
                `;

                card.appendChild(thumb);
                card.appendChild(meta);
                card.appendChild(delBtn);

                card.onclick = (e) => {
                    e.stopPropagation();
                    insertEmojiCode(item.code);
                };
                card.onkeydown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        insertEmojiCode(item.code);
                    }
                };

                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!confirm(`Delete ${item.code} from client + server?`)) return;

                    const ok = await deleteEmojiFromSupabase(item.code, item.url);
                    if (!ok) {
                        alert('Delete failed (check permissions/PIN).');
                        return;
                    }

                    await syncEmojis();
                    refreshPanel();
                };
                galleryList.appendChild(card);
            });
        };

        gallerySearchInput.addEventListener('input', () => {
            renderGallery(gallerySearchInput.value);
        });
        renderGallery('');

        addBtn.onclick = async () => {
            const code = codeInput.value.trim();
            const url = urlInput.value.trim();
            const file = fileInput.files[0];

            if (!canAddGif) {
                alert('Non-admin users can add up to 5 GIFs.');
                return;
            }

            if (!code || !/^:[a-zA-Z0-9_\-]+:$/.test(code)) {
                alert('Invalid Alias. Must be :code: format.');
                return;
            }

            if (uploadMode === 'link' && !url.startsWith('https://')) {
                alert('URL must start with https://');
                return;
            }

            if (uploadMode === 'file' && !file) {
                alert('Please choose a file first.');
                return;
            }

            statusMsg.innerText = 'Processing...';
            statusMsg.style.display = 'block';
            addBtn.disabled = true;

            const finalUrl = uploadMode === 'file'
                ? await uploadToSupabaseStorage(file)
                : await uploadFromUrlToSupabaseStorage(url);

            if (finalUrl) {
                if (await saveEmojiToSupabase(code, finalUrl)) {
                    await syncEmojis();
                    currentTab = isGif(finalUrl) ? 'gifs' : 'emojis';
                    refreshPanel();
                } else {
                    statusMsg.innerText = 'Error (Already exists?)';
                    addBtn.disabled = false;
                }
            } else {
                statusMsg.innerText = 'Upload failed.';
                addBtn.disabled = false;
            }
        };

        if (!canAddGif) {
            addBtn.disabled = true;
            statusMsg.style.display = 'block';
            statusMsg.innerText = 'Limit reached: 5 GIFs max for non-admin users.';
        }
    }

    /**
     * Uploads a file to Supabase Storage
     */
    async function uploadToSupabaseStorage(file) {
        try {
            if (!file) return null;

            const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const fileName = `${Date.now()}_${safeFileName}`;
            const filePath = `uploads/${fileName}`;

            const response = await fetch(`${SUPABASE_URL}/storage/v1/object/gifs/${filePath}`, {
                method: 'POST',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": file.type || 'application/octet-stream'
                },
                body: file
            });

            if (response.ok) {
                return normalizeSupabaseGifUrl(`${SUPABASE_URL}/storage/v1/object/public/gifs/${filePath}`);
            }

            const err = await response.text();
            console.error("[HabboCityEmoji] Storage Error:", err);
            return null;
        } catch (e) {
            console.error("[HabboCityEmoji] Upload Exception:", e);
            return null;
        }
    }

    /**
     * Downloads a remote GIF URL and re-uploads it to the Supabase gifs bucket.
     */
    async function uploadFromUrlToSupabaseStorage(sourceUrl) {
        try {
            if (!sourceUrl) return null;

            const response = await fetch(sourceUrl);
            if (!response.ok) {
                console.error("[HabboCityEmoji] Source URL fetch failed:", response.status, sourceUrl);
                return null;
            }

            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (!contentType.includes('gif')) {
                console.error("[HabboCityEmoji] Source URL is not GIF:", contentType, sourceUrl);
                return null;
            }

            const blob = await response.blob();
            const fileName = `uploads/${Date.now()}_remote.gif`;
            const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/gifs/${fileName}`, {
                method: 'POST',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "image/gif"
                },
                body: blob
            });

            if (!uploadResponse.ok) {
                const err = await uploadResponse.text();
                console.error("[HabboCityEmoji] Remote upload failed:", err);
                return null;
            }

            return normalizeSupabaseGifUrl(`${SUPABASE_URL}/storage/v1/object/public/gifs/${fileName}`);
        } catch (e) {
            console.error("[HabboCityEmoji] URL upload exception:", e);
            return null;
        }
    }

    async function deleteFromSupabaseStorage(url) {
        const path = extractSupabaseGifPath(url);
        if (!path) return true; // External GIF URL, nothing to delete in our bucket.
        const encodedPath = path
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');

        try {
            const response = await fetch(`${SUPABASE_URL}/storage/v1/object/gifs/${encodedPath}`, {
                method: 'DELETE',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`
                }
            });

            if (response.ok || response.status === 404) return true;
            const err = await response.text();
            // Supabase Storage can return 400 with a JSON payload saying not_found.
            // This means object is already deleted (often by DB trigger), so treat as success.
            if (response.status === 400) {
                try {
                    const parsed = JSON.parse(err || '{}');
                    const isNotFound = String(parsed?.error || '').toLowerCase() === 'not_found'
                        || String(parsed?.statusCode || '') === '404'
                        || String(parsed?.message || '').toLowerCase().includes('not found');
                    if (isNotFound) return true;
                } catch (e) { }
            }
            console.error(`[HabboCityEmoji] Storage delete error (${response.status}):`, err);
            return false;
        } catch (e) {
            console.error("[HabboCityEmoji] Storage delete exception:", e);
            return false;
        }
    }

    /**
     * Supprime un emoji de Supabase et du Storage
     */
    async function deleteEmojiFromSupabase(code, url = null) {
        try {
            const pinReady = await ensurePinReadyForCurrentUser({ interactive: true });
            if (!pinReady) return false;
            console.log(`[HabboCityEmoji] Tentative de suppression de : ${code}`);
            const response = await fetch(`${SUPABASE_URL}/rest/v1/emojis?code=eq.${encodeURIComponent(code)}`, {
                method: 'DELETE',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "x-habbo-user": currentUser || '',
                    "x-user-pin": getPin()
                }
            });
            if (!response.ok) {
                const err = await response.text();
                console.error(`[HabboCityEmoji] Erreur suppression (${response.status}):`, err);
                const lowerErr = String(err || '').toLowerCase();
                if (lowerErr.includes('direct deletion from storage tables is not allowed')) {
                    alert('DB trigger misconfiguration detected. Disable SQL trigger delete on storage.objects in Supabase, then retry.');
                }
            }

            // Keep storage in sync client-side as an immediate fallback.
            // Server-side trigger also handles this for dashboard/server deletes.
            const storageOk = await deleteFromSupabaseStorage(url);

            return response.ok && storageOk;
        } catch (e) {
            console.error("[HabboCityEmoji] Exception suppression :", e);
            return false;
        }
    }

    /**
     * Envoie un nouvel emoji ÃƒÂ  Supabase
     */
    async function saveEmojiToSupabase(code, url) {
        try {
            const pinReady = await ensurePinReadyForCurrentUser({ interactive: true });
            if (!pinReady) return false;
            const normalizedUrl = normalizeSupabaseGifUrl(url);
            console.log(`[HabboCityEmoji] Enregistrement de ${code}...`);
            const response = await fetch(`${SUPABASE_URL}/rest/v1/emojis`, {
                method: 'POST',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                    "x-habbo-user": currentUser || '',
                    "x-user-pin": getPin()
                },
                body: JSON.stringify({ code, url: normalizedUrl, created_by: currentUser })
            });
            if (!response.ok) {
                const err = await response.text();
                console.error(`[HabboCityEmoji] Erreur enregistrement (${response.status}):`, err);
            }
            return response.ok;
        } catch (e) {
            console.error("[HabboCityEmoji] Exception enregistrement :", e);
            return false;
        }
    }

    // --- MESSAGE INTERCEPTION ---

    /**
     * Hooks into the input to replace emoji codes with placeholders before sending.
     */
    function setupInputInterception(el) {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const originalValue = el.value;
                let newValue = originalValue;

                // 1. Replace Unicode emojis with text aliases (e.g. :smile:)
                Object.keys(BYPASS_EMOJI_MAPPING).forEach(emoji => {
                    const alias = BYPASS_EMOJI_MAPPING[emoji];
                    newValue = newValue.split(emoji).join(alias);
                });

                if (newValue !== originalValue) {
                    el.value = newValue;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });
    }

    // --- DOM PARSING (RECEIVING MESSAGES) ---

    /**
     * Inserts emoji code into chat input
     */
    function insertEmojiCode(code) {
        if (!chatInput) return;

        const currentValue = chatInput.value || '';
        chatInput.value = currentValue + code + ' ';
        chatInput.focus();

        // Trigger input event to notify any listeners
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /**
     * Inserts emoji code and immediately transforms it to Twemoji image in the input
     */
    function insertEmojiWithPreview(code) {
        // Keep payload as :code: because Nitro can block raw Unicode emojis.
        insertEmojiCode(code);
    }

    /**
     * Sets up the chat observer to detect and replace emoji codes
     */
    function setupChatObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                            parseNodeForPlaceholders(node);
                        }
                    });
                } else if (mutation.type === 'characterData' && mutation.target?.nodeType === Node.TEXT_NODE) {
                    parseNodeForPlaceholders(mutation.target);
                }
            });
        });

        // Start observing the whole body to find the chat container dynamically
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });

        // Also parse existing content
        parseNodeForPlaceholders(document.body);
    }

    function isNodeInsideNitroChatBubble(node) {
        if (!node) return false;
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (!el || typeof el.closest !== 'function') return false;
        return !!el.closest('.nitro-chat-bubble, .chat-bubble, .bubble-container, [class*="chat-bubble"], [class*="message-bubble"]');
    }

    /**
     * Recursively searches for placeholders in text nodes and replaces them.
     */
    function parseNodeForPlaceholders(node) {
        const nodesToReplace = [];

        if (node.nodeType === Node.TEXT_NODE) {
            const parentTag = node.parentElement?.tagName;
            if (parentTag && ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT'].includes(parentTag)) {
                return;
            }

            if (!isNodeInsideNitroChatBubble(node)) return;

            const text = node.nodeValue || '';
            if (text.includes(':')) {
                nodesToReplace.push(node);
            }
        } else {
            // We look for elements that might contain chat text
            // Nitro chat bubbles often have specific classes, but we can search broadly
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
            let textNode;

            while (textNode = walker.nextNode()) {
                const parentTag = textNode.parentElement?.tagName;
                if (parentTag && ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT'].includes(parentTag)) {
                    continue;
                }
                if (!isNodeInsideNitroChatBubble(textNode)) {
                    continue;
                }

                const text = textNode.nodeValue || '';
                if (text.includes(':')) {
                    nodesToReplace.push(textNode);
                }
            }
        }

        nodesToReplace.forEach(node => {
            const content = node.nodeValue;

            // Regex to find :code: patterns - Case Insensitive
            const codeRegex = /:[a-zA-Z_0-9\-]+:/g;

            let matches = [];
            let match;

            const currentEmojiMapping = window.EMOJI_MAPPING || {};
            const currentReverseMapping = window.REVERSE_BYPASS_MAPPING || {};


            while ((match = codeRegex.exec(content)) !== null) {
                const code = match[0].toLowerCase(); // Normalize for lookup

                // Check if it's a GIF
                if (currentEmojiMapping[code]) {
                    matches.push({ index: match.index, length: match[0].length, type: 'gif', value: code, url: currentEmojiMapping[code] });
                }
                // Check if it's a Unicode emoji alias
                else if (currentReverseMapping[code]) {
                    matches.push({ index: match.index, length: match[0].length, type: 'unicode', value: currentReverseMapping[code] });
                } else {
                }
            }

            // Sort matches by index to parse linearly
            matches.sort((a, b) => a.index - b.index);

            if (matches.length === 0) {
                return;
            }


            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            matches.forEach(m => {
                // Add text before match
                fragment.appendChild(document.createTextNode(content.substring(lastIndex, m.index)));

                if (m.type === 'gif') {
                    const data = currentEmojiMapping[m.value];
                    const url = data ? data.url : null;
                    if (url) {
                        const img = document.createElement('img');
                        img.src = url;
                        img.className = 'emoji-ext-img';
                        img.title = `${m.value} (AjoutÃƒÂ© par ${data.user})`;
                        img.onerror = () => {
                            console.error(`[HabboCityEmoji] Ã¢ÂÅ’ GIF LOAD ERROR: ${url}`);
                            img.style.border = "1px solid red";
                            img.style.minWidth = "20px";
                            img.style.minHeight = "20px";
                            img.style.background = "rgba(255,0,0,0.1)";
                        };
                        fragment.appendChild(img);
                    } else {
                        fragment.appendChild(document.createTextNode(m.value));
                    }
                } else if (m.type === 'unicode') {
                    // Render Unicode emojis as Twemoji images (BYPASS)
                    const url = (window.getTwemojiUrl || getTwemojiUrl)(m.value);
                    if (url) {
                        const img = document.createElement('img');
                        img.src = url;
                        img.className = 'emoji-ext-unicode-img';
                        img.title = (window.BYPASS_EMOJI_MAPPING || BYPASS_EMOJI_MAPPING)[m.value] || m.value;
                        img.onerror = () => {
                            console.error(`[HabboCityEmoji] Ã¢ÂÅ’ Twemoji LOAD ERROR: ${url}`);
                            // Fallback to text if image fails to load (rare)
                            const span = document.createElement('span');
                            span.innerText = m.value;
                            img.replaceWith(span);
                        };
                        fragment.appendChild(img);
                    } else {
                        fragment.appendChild(document.createTextNode(m.value));
                    }
                }

                lastIndex = m.index + m.length;
            });

            // Add remaining text
            fragment.appendChild(document.createTextNode(content.substring(lastIndex)));

            if (node.parentNode) {
                node.parentNode.replaceChild(fragment, node);
            }
        });
    }

    // --- YOUTUBE PLAYER & MUSIC TAB ---

    async function upsertCurrentUserRoomPresence(roomName = currentRoom) {
        if (!currentUser) return false;
        if (!getPin()) return false;

        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(currentUser)}`, {
                method: 'PATCH',
                headers: buildSupabaseAuthHeaders({
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                }),
                body: JSON.stringify({
                    current_room: roomName || 'Lobby',
                    last_seen: new Date().toISOString()
                })
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    async function removeCurrentUserRoomPresence(options = {}) {
        const keepalive = !!options.keepalive;
        if (!currentUser) return false;
        if (!getPin()) return false;
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(currentUser)}`, {
                method: 'PATCH',
                keepalive,
                headers: buildSupabaseAuthHeaders({
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                }),
                body: JSON.stringify({
                    current_room: 'Lobby',
                    last_seen: new Date().toISOString()
                })
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    async function fetchRoomPresenceCountMap() {
        const map = {};
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/users_room_presence_counts?select=room_name,total_count,admin_count,user_count`, {
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Accept": "application/json"
                }
            });
            if (!response.ok) return map;

            const rows = await response.json();
            rows.forEach(row => {
                map[row.room_name] = {
                    total: Number(row.total_count) || 0,
                    admins: Number(row.admin_count) || 0,
                    users: Number(row.user_count) || 0
                };
            });
        } catch (e) {
            console.warn("[HabboCityEmoji] Failed to fetch room presence counts:", e);
        }
        return map;
    }

    function pickOldestUserFromPresenceState(state, excludeUser = null, allowedUsers = null) {
        const normalizedExclude = String(excludeUser || '').trim().toLowerCase();
        const allowedSet = Array.isArray(allowedUsers) && allowedUsers.length
            ? new Set(
                allowedUsers
                    .map(user => String(user || '').trim().toLowerCase())
                    .filter(Boolean)
            )
            : null;

        const candidates = [];
        Object.entries(state || {}).forEach(([username, metas]) => {
            const normalizedUsername = String(username || '').trim().toLowerCase();
            if (!normalizedUsername) return;
            if (normalizedExclude && normalizedUsername === normalizedExclude) return;
            if (allowedSet && !allowedSet.has(normalizedUsername)) return;

            const metaArray = Array.isArray(metas) ? metas : [];
            const validTimes = metaArray
                .map(meta => new Date(meta?.online_at || 0).getTime())
                .filter(Number.isFinite);
            const onlineAt = validTimes.length ? Math.min(...validTimes) : Number.MAX_SAFE_INTEGER;

            candidates.push({
                username: String(username).trim(),
                onlineAt
            });
        });

        candidates.sort((a, b) => a.onlineAt - b.onlineAt || a.username.localeCompare(b.username));
        return candidates[0]?.username || null;
    }

    function sameUser(a, b) {
        if (!a || !b) return false;
        return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    }

    function includesUser(users, user) {
        if (!Array.isArray(users) || !user) return false;
        return users.some(name => sameUser(name, user));
    }

    async function ensureRoomDjAssigned(roomName, roomData = null, presenceState = null, activeUsers = null) {
        const normalizedRoom = normalizeRoomName(roomName);
        if (!normalizedRoom || normalizedRoom === 'Lobby') return null;
        if (!currentUser || !getPin()) return null;

        const users = Array.isArray(activeUsers) ? activeUsers.filter(Boolean) : await fetchActiveUsersInRoom(normalizedRoom);
        if (!users.length) return null;

        const currentDj = roomData?.current_dj || null;
        if (currentDj && includesUser(users, currentDj)) {
            return currentDj;
        }

        const nextDj = pickOldestUserFromPresenceState(presenceState || {}, null, users) || users[0];
        if (!nextDj) return null;

        const updated = await patchRadioRoomByName(normalizedRoom, {
            current_dj: nextDj,
            last_activity: new Date().toISOString()
        });
        if (!updated) return null;

        if (roomData) roomData.current_dj = nextDj;
        return nextDj;
    }

    async function fetchActiveUsersInRoom(roomName) {
        if (!roomName || roomName === 'Lobby') return [];
        try {
            const cutoff = new Date(Date.now() - ROOM_ACTIVE_PRESENCE_WINDOW_MS).toISOString();
            const resp = await fetch(
                `${SUPABASE_URL}/rest/v1/users?current_room=eq.${encodeURIComponent(roomName)}&last_seen=gt.${cutoff}&select=username,created_at&order=created_at.asc`,
                {
                    headers: {
                        "apikey": SUPABASE_KEY,
                        "Authorization": `Bearer ${SUPABASE_KEY}`,
                        "Accept": "application/json"
                    }
                }
            );
            if (!resp.ok) return [];
            const rows = await resp.json();
            return (rows || []).map(row => row.username).filter(Boolean);
        } catch (e) {
            console.warn("[HabboCityEmoji] Failed to fetch active room users:", e);
            return [];
        }
    }

    async function pruneInactiveRooms(options = {}) {
        const force = !!options.force;
        if (!currentUser || !getPin()) return 0;
        const now = Date.now();
        if (!force && now - lastRoomPruneAttemptAtMs < ROOM_PRUNE_COOLDOWN_MS) {
            return 0;
        }
        lastRoomPruneAttemptAtMs = now;

        try {
            const response = await fetch(
                `${SUPABASE_URL}/rest/v1/radio_rooms?select=name,last_activity&order=last_activity.asc&limit=${ROOM_PRUNE_BATCH_SIZE}`,
                {
                    headers: {
                        "apikey": SUPABASE_KEY,
                        "Authorization": `Bearer ${SUPABASE_KEY}`,
                        "Accept": "application/json"
                    }
                }
            );
            if (!response.ok) return 0;

            const rows = await response.json();
            const presenceCounts = await fetchRoomPresenceCountMap();
            const candidates = Array.isArray(rows) ? rows : [];
            let deletedCount = 0;
            for (const row of candidates) {
                const roomName = normalizeRoomName(row?.name);
                if (!roomName || roomName === 'Lobby' || roomName === currentRoom) continue;
                const activeCount = Number(presenceCounts[roomName]?.total) || 0;
                if (activeCount > 0) continue;

                const lastActivityMs = new Date(row?.last_activity || 0).getTime();
                const isRecent = Number.isFinite(lastActivityMs) && (now - lastActivityMs < ROOM_EMPTY_PRUNE_GRACE_MS);
                if (!force && isRecent) continue;

                const deleted = await deleteRadioRoomByName(roomName);
                if (deleted) deletedCount += 1;
            }
            return deletedCount;
        } catch (e) {
            return 0;
        }
    }

    /**
     * Initializes Supabase Realtime with Room support
     */
    function initSupabaseRealtime() {
        if (!supabaseClient) {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        }

        if (cityRadioChannel) {
            cityRadioChannel.unsubscribe();
        }
        if (roomPresenceHeartbeat) {
            clearInterval(roomPresenceHeartbeat);
            roomPresenceHeartbeat = null;
        }

        try {
            const channelName = `city_radio:${currentRoom}`;
            console.log(`[HabboCityEmoji] Joining Room: ${channelName}`);

            cityRadioChannel = supabaseClient.channel(channelName, {
                config: {
                    broadcast: { self: true },
                    presence: { key: currentUser || 'Anonyme' }
                }
            });

            cityRadioChannel
                .on('broadcast', { event: 'radio_sync' }, payload => {
                    const data = payload.payload;
                    handleRadioSync(data);
                })
                .on('broadcast', { event: 'radio_sync_request' }, payload => {
                    const data = payload.payload;
                    handleRadioSyncRequest(data);
                })
                .on('presence', { event: 'sync' }, async () => {
                    const newState = cityRadioChannel.presenceState();
                    const rawUsers = Object.keys(newState);
                    roomParticipants[currentRoom] = rawUsers;
                    console.log(`[HabboCityEmoji] Presence sync for ${currentRoom}:`, rawUsers);
                    await upsertCurrentUserRoomPresence(currentRoom);

                    // Re-fetch room data to ensure DJ is up to date
                    if (currentRoom !== 'Lobby') {
                        // Use fetch to avoid potential library-specific 406 issues
                        try {
                            const resp = await fetch(`${SUPABASE_URL}/rest/v1/radio_rooms?name=eq.${encodeURIComponent(currentRoom)}&select=*`, {
                                headers: {
                                    "apikey": SUPABASE_KEY,
                                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                                    "Accept": "application/json"
                                }
                            });
                            if (resp.ok) {
                                const rooms = await resp.json();
                                if (rooms && rooms.length > 0) {
                                    currentRoomData = rooms[0];
                                    const activeUsers = await fetchActiveUsersInRoom(currentRoom);
                                    await ensureRoomDjAssigned(currentRoom, currentRoomData, newState, activeUsers);
                                }
                            }
                        } catch (e) {
                            console.warn("[HabboCityEmoji] Failed to fetch room data on presence sync:", e);
                        }
                    }

                    if (radioPanel && radioPanel.classList.contains('active')) {
                        refreshRadioPanel();
                    }
                })
                .subscribe(async (status) => {
                    if (status === 'SUBSCRIBED') {
                        await cityRadioChannel.track({
                            online_at: new Date().toISOString(),
                        });
                        await upsertCurrentUserRoomPresence(currentRoom);
                        roomPresenceHeartbeat = setInterval(() => {
                            upsertCurrentUserRoomPresence(currentRoom).catch(() => { });
                        }, 30000);

                        if (currentRoom !== 'Lobby') {
                            ensureRoomPlayerWindowOpen();
                            try {
                                const resp = await fetch(`${SUPABASE_URL}/rest/v1/radio_rooms?name=eq.${encodeURIComponent(currentRoom)}&select=*`, {
                                    headers: {
                                        "apikey": SUPABASE_KEY,
                                        "Authorization": `Bearer ${SUPABASE_KEY}`,
                                        "Accept": "application/json"
                                    }
                                });
                                if (resp.ok) {
                                    const rooms = await resp.json();
                                    if (rooms && rooms.length > 0) {
                                        currentRoomData = rooms[0];
                                        const activeUsers = await fetchActiveUsersInRoom(currentRoom);
                                        await ensureRoomDjAssigned(currentRoom, currentRoomData, cityRadioChannel?.presenceState() || {}, activeUsers);
                                        ensureRoomPlayerWindowOpen();
                                        if (!isCurrentUserDj()) {
                                            manualResync({ silent: true, reason: 'room_join' });
                                        }
                                        refreshRadioPanel();
                                    }
                                }
                            } catch (e) {
                                console.warn("[HabboCityEmoji] Failed to fetch room data on subscribe:", e);
                            }
                        }
                    }
                });

            updateRoomActivity();

        } catch (e) {
            console.error("[HabboCityEmoji] Failed to init Realtime:", e);
        }
    }

    async function updateRoomActivity(videoId = null, startedAtIso = null, playbackSnapshot = null) {
        if (!currentRoom || currentRoom === 'Lobby') return;
        if (!currentUser || !getPin()) return;

        const updateData = {
            name: currentRoom,
            last_activity: new Date().toISOString()
        };
        if (videoId) {
            updateData.current_video_id = videoId;
            updateData.current_video_started_at = startedAtIso || new Date().toISOString();
        }
        if (currentUser && (videoId || isCurrentUserDj())) {
            updateData.current_dj = currentUser;
        }
        if (playbackSnapshot) {
            if (Number.isFinite(playbackSnapshot.positionSeconds)) {
                updateData.current_video_position_seconds = Math.max(0, playbackSnapshot.positionSeconds);
            }
            if (Number.isFinite(playbackSnapshot.positionCapturedAt)) {
                updateData.current_video_position_updated_at = new Date(playbackSnapshot.positionCapturedAt).toISOString();
            }
            if (typeof playbackSnapshot.isPlaying === 'boolean') {
                updateData.current_video_is_playing = playbackSnapshot.isPlaying;
            }
        }

        try {
            await fetch(`${SUPABASE_URL}/rest/v1/radio_rooms?on_conflict=name`, {
                method: 'POST',
                headers: buildSupabaseAuthHeaders({
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates"
                }),
                body: JSON.stringify(updateData)
            });
        } catch (e) {
            console.warn("[HabboCityEmoji] Failed to update room activity:", e);
        }
    }

    async function fetchActiveRooms() {
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/radio_rooms?select=*&order=last_activity.desc&limit=100`, {
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`
                }
            });
            if (response.ok) return await response.json();
        } catch (e) {
            console.error("[HabboCityEmoji] Error fetching rooms:", e);
        }
        return [];
    }

    async function patchRadioRoomByName(roomName, patchData, options = {}) {
        const keepalive = !!options.keepalive;
        if (!roomName || !patchData) return false;
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/radio_rooms?name=eq.${encodeURIComponent(roomName)}`, {
                method: 'PATCH',
                keepalive,
                headers: buildSupabaseAuthHeaders({
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                }),
                body: JSON.stringify(patchData)
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    async function deleteRadioRoomByName(roomName, options = {}) {
        const keepalive = !!options.keepalive;
        if (!roomName) return false;
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/radio_rooms?name=eq.${encodeURIComponent(roomName)}`, {
                method: 'DELETE',
                keepalive,
                headers: buildSupabaseAuthHeaders({
                    "Prefer": "return=minimal"
                })
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    async function upsertRadioRoom(roomData) {
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/radio_rooms?on_conflict=name`, {
                method: 'POST',
                headers: buildSupabaseAuthHeaders({
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=representation"
                }),
                body: JSON.stringify(roomData)
            });
            if (!response.ok) return null;
            const rows = await response.json();
            return Array.isArray(rows) ? rows[0] || null : rows;
        } catch (e) {
            return null;
        }
    }

    async function cleanupDepartedRoom(roomName, options = {}) {
        const keepalive = !!options.keepalive;
        const wasDj = !!options.wasDj;
        const presenceState = options.presenceState || {};
        const roomData = options.roomData || null;
        const normalizedRoom = normalizeRoomName(roomName);
        if (!normalizedRoom || normalizedRoom === 'Lobby') return;

        // Page unload path: do a best-effort direct delete after moving self to Lobby.
        // If other users are still active, RLS will reject deletion.
        if (keepalive) {
            await deleteRadioRoomByName(normalizedRoom, { keepalive: true });
            return;
        }

        let remainingUsers = await fetchActiveUsersInRoom(normalizedRoom);
        if (!keepalive && includesUser(remainingUsers, currentUser)) {
            await sleep(700);
            remainingUsers = await fetchActiveUsersInRoom(normalizedRoom);
        }
        const oldestRealtime = pickOldestUserFromPresenceState(presenceState, currentUser, remainingUsers);

        if (remainingUsers.length <= 0) {
            await deleteRadioRoomByName(normalizedRoom, { keepalive });
            return;
        }

        if (wasDj) {
            const newDj = oldestRealtime || remainingUsers[0];
            if (newDj) {
                await patchRadioRoomByName(normalizedRoom, {
                    current_dj: newDj,
                    last_activity: new Date().toISOString()
                }, { keepalive });
            }
            return;
        }

        await ensureRoomDjAssigned(normalizedRoom, roomData, presenceState, remainingUsers);
    }

    async function changeRoom(newRoom) {
        try {
            const normalizedRoom = normalizeRoomName(newRoom);
            if (!normalizedRoom) return;
            if (normalizedRoom === currentRoom) return;

            const previousRoom = currentRoom;
            const previousRoomData = currentRoomData;
            const wasDj = !!(previousRoomData && sameUser(previousRoomData.current_dj, currentUser));

            // Stop previous song immediately when switching rooms.
            stopMusic();

            if (previousRoom && previousRoom !== 'Lobby' && previousRoom !== normalizedRoom) {
                const state = cityRadioChannel?.presenceState() || {};
                await removeCurrentUserRoomPresence();
                await cleanupDepartedRoom(previousRoom, {
                    wasDj,
                    presenceState: state,
                    roomData: previousRoomData
                });
            }

            currentRoom = normalizedRoom;
            currentRoomData = null;
            persistCurrentRoom(currentRoom);

            if (currentRoom !== 'Lobby') {
                ensureRoomPlayerWindowOpen();
            }
            initSupabaseRealtime();
            upsertCurrentUserRoomPresence(currentRoom).catch(() => { });
            pruneInactiveRooms({ force: true }).catch(() => { });
        } catch (e) {
            console.error("Error changing room:", e);
        }
    }

    async function leaveRoom(options = {}) {
        const keepalive = !!options.keepalive;
        const skipRealtimeReinit = !!options.skipRealtimeReinit;
        const skipPanelRefresh = !!options.skipPanelRefresh;
        try {
            const roomToLeave = currentRoom;
            const wasDj = !!(currentRoomData && sameUser(currentRoomData.current_dj, currentUser));
            if (!roomToLeave || roomToLeave === 'Lobby') {
                // Just in case, reset URL/storage
                persistCurrentRoom('Lobby');
                currentRoom = 'Lobby';
                currentRoomData = null;
                if (!skipPanelRefresh) refreshRadioPanel();
                return;
            }
            const state = cityRadioChannel?.presenceState() || {};
            await removeCurrentUserRoomPresence({ keepalive });
            await cleanupDepartedRoom(roomToLeave, {
                wasDj,
                presenceState: state,
                keepalive,
                roomData: currentRoomData
            });
        } catch (e) { console.error("Error leaving room:", e); }

        currentRoom = 'Lobby';
        currentRoomData = null;
        persistCurrentRoom('Lobby');

        stopMusic();

        // Unsubscribe/re-subscribe to Lobby unless caller explicitly skips it (unload path).
        if (cityRadioChannel) {
            if (skipRealtimeReinit) {
                cityRadioChannel.unsubscribe();
            } else {
                await cityRadioChannel.unsubscribe();
            }
        }
        if (!skipRealtimeReinit) {
            initSupabaseRealtime();
            upsertCurrentUserRoomPresence('Lobby').catch(() => { });
        }
        pruneInactiveRooms({ force: true }).catch(() => { });

        if (!skipPanelRefresh) refreshRadioPanel();
    }

    function stopMusic() {
        const mount = document.getElementById('yt-player-mount');
        if (mount) mount.innerHTML = '';
        if (window._radioSyncInterval) {
            clearInterval(window._radioSyncInterval);
            window._radioSyncInterval = null;
        }
        if (ytStatePollInterval) {
            clearInterval(ytStatePollInterval);
            ytStatePollInterval = null;
        }
        ytPlayerState = -1;
        ytLastKnownTime = 0;
        ytLastKnownTimeUpdatedAt = 0;
        currentVideoTitle = '';
        djPlaybackStartTimeMs = 0;
        djLastObservedPlayerTime = null;
        djLastObservedAtMs = 0;
        djLastSeekBroadcastAtMs = 0;
        if (ytWindow) {
            ytWindow.classList.remove('active');
            updatePlayerWindowTitle('Ready');
        }
    }

    function ensureRoomPlayerWindowOpen() {
        if (!currentRoom || currentRoom === 'Lobby') return false;
        createPlayerWindow();
        if (!ytWindow) return false;
        ytWindow.classList.add('active');
        updatePlayerWindowTitle();
        return true;
    }

    function getDisplayRoomName() {
        const room = (currentRoomData && currentRoomData.name) || currentRoom || 'Lobby';
        const clean = String(room || '').trim();
        return clean || 'Lobby';
    }

    function normalizeVideoTitle(raw) {
        const text = String(raw || '').replace(/\s+/g, ' ').trim();
        return text || 'Video';
    }

    function updatePlayerWindowTitle(videoTitle = null) {
        if (!ytWindow) return;
        const titleEl = ytWindow.querySelector('.yt-player-title');
        if (!titleEl) return;

        const roomName = getDisplayRoomName();
        const finalTitle = normalizeVideoTitle(videoTitle != null ? videoTitle : currentVideoTitle);
        titleEl.innerText = `[${roomName}] ${finalTitle}`;
    }

    function refreshRadioPanel() {
        if (!radioPanel) return;
        radioPanel.innerHTML = '';
        renderMusicTab();
    }

    /**
     * Broadcasts a video state to all users
     */
    function broadcastVideo(videoId) {
        if (!isCurrentUserDj()) return;
        if (!isValidYoutubeVideoId(videoId)) return;
        if (!cityRadioChannel) {
            initSupabaseRealtime();
        }

        // IMMEDIATELY play locally for the sender
        currentPlayingVideoId = videoId;
        currentVideoTitle = videoTitleById[videoId] || 'Loading...';
        djPlaybackStartTimeMs = Date.now();
        djLastObservedPlayerTime = 0;
        djLastObservedAtMs = Date.now();
        initYoutubePlayer(videoId, 0);
        updatePlayerWindowTitle();
        sendRadioSync(videoId, 'start');

        // Update database room state
        updateRoomActivity(videoId);

        // Clear legacy sync interval; active sync is handled by player-state polling.
        if (window._radioSyncInterval) {
            clearInterval(window._radioSyncInterval);
            window._radioSyncInterval = null;
        }
    }

    function getTargetTimeFromSyncSnapshot(snapshot) {
        if (!snapshot) return null;
        const now = Date.now();

        const basePositionRaw =
            snapshot.positionSeconds ??
            snapshot.current_video_position_seconds ??
            snapshot.currentTime;

        const basePosition = Number(basePositionRaw);
        if (Number.isFinite(basePosition)) {
            let target = Math.max(0, basePosition);

            const capturedRaw =
                snapshot.positionCapturedAt ??
                snapshot.position_captured_at ??
                snapshot.current_video_position_updated_at;

            let capturedAtMs = null;
            if (Number.isFinite(capturedRaw)) {
                capturedAtMs = Number(capturedRaw);
            } else if (capturedRaw) {
                const parsed = new Date(capturedRaw).getTime();
                if (Number.isFinite(parsed)) {
                    capturedAtMs = parsed;
                }
            }

            const isPlayingRaw = snapshot.isPlaying ?? snapshot.current_video_is_playing;
            const isPlaying = typeof isPlayingRaw === 'boolean' ? isPlayingRaw : true;
            if (isPlaying && Number.isFinite(capturedAtMs)) {
                target += Math.max(0, (now - capturedAtMs) / 1000);
            }

            if (!Number.isFinite(capturedAtMs)) {
                const startRaw = snapshot.startTime ?? snapshot.current_video_started_at;
                let startAtMs = null;
                if (Number.isFinite(startRaw)) {
                    startAtMs = Number(startRaw);
                } else if (startRaw) {
                    const parsedStart = new Date(startRaw).getTime();
                    if (Number.isFinite(parsedStart)) {
                        startAtMs = parsedStart;
                    }
                }
                if (Number.isFinite(startAtMs) && isPlaying) {
                    const inferredCapturedAtMs = startAtMs + (target * 1000);
                    target += Math.max(0, (now - inferredCapturedAtMs) / 1000);
                }
            }

            return Math.max(0, target);
        }

        const startRaw = snapshot.startTime ?? snapshot.current_video_started_at;
        let startAtMs = null;
        if (Number.isFinite(startRaw)) {
            startAtMs = Number(startRaw);
        } else if (startRaw) {
            const parsed = new Date(startRaw).getTime();
            if (Number.isFinite(parsed)) {
                startAtMs = parsed;
            }
        }

        if (Number.isFinite(startAtMs)) {
            return Math.max(0, (now - startAtMs) / 1000);
        }

        return null;
    }

    function syncToDjNow() {
        const isPlayerOpen = !!(ytWindow && ytWindow.classList.contains('active'));
        const seekInPlace = (videoId, elapsed, shouldPlay = true) => {
            if (isPlayerOpen && currentPlayingVideoId === videoId && document.getElementById('yt-player-iframe')) {
                const localTime = getEstimatedPlayerTime();
                const shouldSeek =
                    !Number.isFinite(localTime) ||
                    Math.abs(localTime - elapsed) > LISTENER_SYNC_DRIFT_THRESHOLD_SECONDS;
                if (shouldSeek) {
                    sendPlayerCommand('seekTo', [Math.max(0, elapsed), true]);
                }
                if (shouldPlay) {
                    sendPlayerCommand('playVideo');
                    setTimeout(() => sendPlayerCommand('playVideo'), 180);
                } else {
                    sendPlayerCommand('pauseVideo');
                    setTimeout(() => sendPlayerCommand('pauseVideo'), 120);
                }
            } else {
                currentPlayingVideoId = videoId;
                initYoutubePlayer(videoId, elapsed);
                setTimeout(() => {
                    sendPlayerCommand('seekTo', [Math.max(0, elapsed), true]);
                    if (shouldPlay) {
                        sendPlayerCommand('playVideo');
                    } else {
                        sendPlayerCommand('pauseVideo');
                    }
                }, 250);
            }
        };

        if (lastSyncData && isValidYoutubeVideoId(lastSyncData.videoId)) {
            if (typeof lastSyncData.videoTitle === 'string' && lastSyncData.videoTitle.trim()) {
                currentVideoTitle = normalizeVideoTitle(lastSyncData.videoTitle);
                videoTitleById[lastSyncData.videoId] = currentVideoTitle;
            }
            const elapsed = getTargetTimeFromSyncSnapshot(lastSyncData);
            if (Number.isFinite(elapsed)) {
                const syncIsPlaying = typeof lastSyncData.isPlaying === 'boolean' ? lastSyncData.isPlaying : true;
                seekInPlace(lastSyncData.videoId, elapsed, syncIsPlaying);
                return true;
            }
        }

        if (currentRoomData && isValidYoutubeVideoId(currentRoomData.current_video_id)) {
            const elapsed = getTargetTimeFromSyncSnapshot(currentRoomData);
            if (Number.isFinite(elapsed)) {
                const syncIsPlaying = typeof currentRoomData.current_video_is_playing === 'boolean'
                    ? currentRoomData.current_video_is_playing
                    : true;
                seekInPlace(currentRoomData.current_video_id, elapsed, syncIsPlaying);
                return true;
            }
        }

        return false;
    }

    function requestLiveDjSync(reason = 'manual') {
        if (!cityRadioChannel) return false;
        if (isCurrentUserDj()) return false;
        cityRadioChannel.send({
            type: 'broadcast',
            event: 'radio_sync_request',
            payload: {
                requestedBy: currentUser || 'Anonyme',
                reason: reason,
                requestedAt: Date.now()
            }
        });
        return true;
    }

    // Keep room rows alive while users are in-room, even without an active player window.
    setInterval(() => {
        if (currentRoom && currentRoom !== 'Lobby') {
            updateRoomActivity();
        }
    }, 60000); // Every minute

    // Opportunistic cleanup for stale rows that are no longer occupied.
    setInterval(() => {
        pruneInactiveRooms().catch(() => { });
    }, ROOM_PRUNE_INTERVAL_MS);

    /**
     * Handles incoming radio_sync events
     */
    function handleRadioSync(data) {
        const { videoId, startTime, currentTime, positionSeconds, positionCapturedAt, isPlaying, dj, reason, videoTitle } = data;
        if (!isValidYoutubeVideoId(videoId)) return;
        lastSyncData = data;
        lastSyncDataUpdatedAt = Date.now();
        const elapsed = getTargetTimeFromSyncSnapshot({
            startTime,
            currentTime,
            positionSeconds,
            positionCapturedAt,
            isPlaying
        });
        const playerIsOpen = !!(ytWindow && ytWindow.classList.contains('active'));

        console.log(`[HabboCityEmoji] Sync Event: ${videoId} from ${dj} (${reason || 'state'}) -> ${Number.isFinite(elapsed) ? elapsed.toFixed(2) : 'n/a'}s`);

        // DJ PRIORITY: If I am the DJ, I source the sync, I never follow it
        if (currentRoomData && sameUser(currentRoomData.current_dj, currentUser)) {
            return;
        }

        currentPlayingVideoId = videoId;
        if (typeof videoTitle === 'string' && videoTitle.trim()) {
            currentVideoTitle = normalizeVideoTitle(videoTitle);
            videoTitleById[videoId] = currentVideoTitle;
        } else if (videoTitleById[videoId]) {
            currentVideoTitle = videoTitleById[videoId];
        } else if (!currentVideoTitle) {
            currentVideoTitle = 'Loading...';
        }
        if (currentRoomData) {
            currentRoomData.current_video_id = videoId;
            if (startTime) {
                currentRoomData.current_video_started_at = new Date(startTime).toISOString();
            }
            const roomPosition = Number.isFinite(positionSeconds) ? positionSeconds : currentTime;
            if (Number.isFinite(roomPosition)) {
                currentRoomData.current_video_position_seconds = Math.max(0, roomPosition);
            }
            if (Number.isFinite(positionCapturedAt)) {
                currentRoomData.current_video_position_updated_at = new Date(positionCapturedAt).toISOString();
            } else {
                currentRoomData.current_video_position_updated_at = new Date().toISOString();
            }
            if (typeof isPlaying === 'boolean') {
                currentRoomData.current_video_is_playing = isPlaying;
            }
        }

        // Player is mandatory in-room. If it is closed, exit the room.
        if (!playerIsOpen) {
            const playerWindowClosed = !ytWindow || !document.body.contains(ytWindow);
            if (playerWindowClosed && currentRoom && currentRoom !== 'Lobby') {
                leaveRoom().catch(() => { });
            }
            return;
        }

        syncToDjNow();
        updatePlayerWindowTitle();
    }

    function handleRadioSyncRequest(data) {
        if (!isCurrentUserDj()) return;
        if (!currentPlayingVideoId) return;
        if (!data || data.requestedBy === currentUser) return;
        sendPlayerCommand('getCurrentTime');
        sendPlayerCommand('getPlayerState');
        setTimeout(() => {
            if (!isCurrentUserDj() || !currentPlayingVideoId) return;
            sendRadioSync(currentPlayingVideoId, 'manual_response');
        }, 150);
    }

    function manualResync(options = {}) {
        const silent = !!options.silent;
        const reason = typeof options.reason === 'string' && options.reason.trim()
            ? options.reason.trim()
            : 'manual';
        if (isCurrentUserDj()) return false;
        (async () => {
            const beforeRequestSyncAt = lastSyncDataUpdatedAt;
            const requested = requestLiveDjSync(reason);
            if (requested) {
                const waitUntil = Date.now() + 1800;
                while (Date.now() < waitUntil) {
                    if (lastSyncData && lastSyncDataUpdatedAt > beforeRequestSyncAt) {
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 120));
                }
            }

            try {
                if (currentRoom && currentRoom !== 'Lobby') {
                    const resp = await fetch(`${SUPABASE_URL}/rest/v1/radio_rooms?name=eq.${encodeURIComponent(currentRoom)}&select=*`, {
                        headers: {
                            "apikey": SUPABASE_KEY,
                            "Authorization": `Bearer ${SUPABASE_KEY}`,
                            "Accept": "application/json"
                        }
                    });
                    if (resp.ok) {
                        const rows = await resp.json();
                        if (rows && rows[0]) currentRoomData = rows[0];
                    }
                }
            } catch (e) { }

            if (
                (!lastSyncData || lastSyncDataUpdatedAt <= beforeRequestSyncAt) &&
                currentRoomData?.current_video_id &&
                (currentRoomData?.current_video_started_at || Number.isFinite(Number(currentRoomData?.current_video_position_seconds)))
            ) {
                const dbPosition = Number(currentRoomData.current_video_position_seconds);
                const dbPositionUpdatedAt = currentRoomData.current_video_position_updated_at
                    ? new Date(currentRoomData.current_video_position_updated_at).getTime()
                    : Date.now();
                lastSyncData = {
                    videoId: currentRoomData.current_video_id,
                    startTime: currentRoomData.current_video_started_at
                        ? new Date(currentRoomData.current_video_started_at).getTime()
                        : Date.now(),
                    currentTime: Number.isFinite(dbPosition) ? dbPosition : undefined,
                    positionSeconds: Number.isFinite(dbPosition) ? dbPosition : undefined,
                    positionCapturedAt: dbPositionUpdatedAt,
                    isPlaying: typeof currentRoomData.current_video_is_playing === 'boolean'
                        ? currentRoomData.current_video_is_playing
                        : true,
                    reason: reason,
                    dj: currentRoomData.current_dj || 'DJ'
                };
                lastSyncDataUpdatedAt = Date.now();
            }

            if (!syncToDjNow() && !silent) {
                alert("No sync data received yet.");
            }
        })();
        return true;
    }

    /**
     * Renders the Music Tab for DJing
     */
    async function renderMusicTab() {
        if (!currentUser) {
            renderIdentityTab();
            return;
        }

        if (!radioPanel) return;
        radioPanel.innerHTML = '';

        // HEADER (v0 DJOverlay Wrapper)
        const header = document.createElement('div');
        header.className = 'radio-v0-header';
        header.innerHTML = `
            <div class="radio-v0-header-title">
                <div class="radio-v0-header-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>
                </div>
                <div class="radio-v0-header-text">
                    <h2>DJ Rooms</h2>
                    <p>Listen together</p>
                </div>
            </div>
            <div class="radio-v0-close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </div>
        `;
        header.querySelector('.radio-v0-close').onclick = () => {
            radioPanel.classList.remove('active');
            document.querySelector('.radio-ext-backdrop')?.classList.remove('active');
            document.querySelector('.radio-ext-button')?.classList.remove('active');
        };
        radioPanel.appendChild(header);

        const body = document.createElement('div');
        body.className = 'radio-v0-body';
        radioPanel.appendChild(body);

        if (currentRoom === 'Lobby') {
            await renderRoomSelectionView(body);
        } else {
            await renderInsideRoomView(body);
        }
    }

    async function renderRoomSelectionView(container) {
        // Tabs
        const tabs = document.createElement('div');
        tabs.className = 'radio-v0-tabs';
        tabs.innerHTML = `
            <div class="radio-v0-tab active">Browse Rooms</div>
            <div class="radio-v0-tab">Create Room</div>
        `;
        container.appendChild(tabs);

        const listContainer = document.createElement('div');
        listContainer.className = 'radio-v0-list-container';
        container.appendChild(listContainer);

        const createContainer = document.createElement('div');
        createContainer.className = 'radio-v0-create-container';
        createContainer.style.display = 'none';
        createContainer.innerHTML = `
            <div class="radio-v0-field">
                <label class="radio-v0-label">Room Name</label>
                <input type="text" class="radio-v0-input" placeholder="Give your room a name..." maxlength="40">
            </div>
            <button class="radio-v0-btn-primary">Create Room</button>
        `;
        container.appendChild(createContainer);

        // Tab Switching
        const tabEls = tabs.querySelectorAll('.radio-v0-tab');
        tabEls[0].onclick = () => {
            tabEls[0].classList.add('active');
            tabEls[1].classList.remove('active');
            listContainer.style.display = 'block';
            createContainer.style.display = 'none';
        };
        tabEls[1].onclick = () => {
            tabEls[1].classList.add('active');
            tabEls[0].classList.remove('active');
            listContainer.style.display = 'none';
            createContainer.style.display = 'block';
        };

        // Create Logic
        createContainer.querySelector('button').onclick = async () => {
            const input = createContainer.querySelector('input');
            const name = input.value.trim();
            if (name) {
                await createNewRoom(name);
            }
        };

        // Room List
        await pruneInactiveRooms();
        const rooms = await fetchActiveRooms();
        const presenceCounts = await fetchRoomPresenceCountMap();
        const now = Date.now();
        const visibleRooms = rooms.filter(room => {
            const roomName = normalizeRoomName(room?.name);
            if (!roomName || roomName === 'Lobby') return false;
            const total = presenceCounts[roomName]?.total ?? roomParticipants[roomName]?.length ?? 0;
            const lastActivityMs = new Date(room.last_activity || 0).getTime();
            const recentlyActive = Number.isFinite(lastActivityMs) && (now - lastActivityMs <= ROOM_STALE_ACTIVITY_WINDOW_MS);
            return roomName === currentRoom || total > 0 || recentlyActive;
        });
        if (visibleRooms.length === 0) {
            listContainer.innerHTML = `
                <div class="radio-v0-empty-state">
                    <p>No rooms yet.</p>
                    <span>Create one and start the session.</span>
                </div>
            `;
        } else {
            visibleRooms.forEach(room => {
                const roomName = normalizeRoomName(room?.name) || 'Room';
                const totalListeners = presenceCounts[roomName]?.total ?? roomParticipants[roomName]?.length ?? 0;
                const safeRoomName = escapeHtml(roomName);
                const safeDjName = escapeHtml(room.current_dj || 'Unknown');
                const card = document.createElement('div');
                card.className = 'radio-v0-room-card';
                card.innerHTML = `
                    <div class="radio-v0-room-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/></svg>
                    </div>
                    <div class="radio-v0-room-info">
                        <span class="radio-v0-room-name">${safeRoomName}</span>
                        <div class="radio-v0-room-meta">
                            <span>DJ: ${safeDjName}</span>
                        </div>
                    </div>
                    <div class="radio-v0-room-listeners">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="19" cy="11" r="2"/></svg>
                        <span>${totalListeners}</span>
                    </div>
                    <div class="radio-v0-room-chevron" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg>
                    </div>
                `;
                card.onclick = () => changeRoom(roomName);
                listContainer.appendChild(card);
            });
        }
    }

    async function renderInsideRoomView(container) {
        ensureRoomPlayerWindowOpen();

        const isDJ = currentRoomData && sameUser(currentRoomData.current_dj, currentUser);
        const presenceCounts = await fetchRoomPresenceCountMap();
        const roomListenerCount = presenceCounts[currentRoom]?.total ?? roomParticipants[currentRoom]?.length ?? 0;
        const safeCurrentRoom = escapeHtml(currentRoom || 'Lobby');
        const safeCurrentDj = escapeHtml(currentRoomData?.current_dj || 'Unknown');

        // Back / Info Header
        const activeHeader = document.createElement('div');
        activeHeader.className = 'radio-v0-active-header';
        activeHeader.innerHTML = `
            <div class="radio-v0-back">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
            </div>
            <div class="radio-v0-active-meta">
                <h3 class="radio-v0-active-room">${safeCurrentRoom}</h3>
                <p class="radio-v0-active-sub">${roomListenerCount} listening</p>
            </div>
            ${isDJ ? `<span class="radio-v0-dj-tag">DJ</span>` : ''}
        `;
        activeHeader.querySelector('.radio-v0-back').onclick = () => leaveRoom();
        container.appendChild(activeHeader);

        // DJ Slot
        const djSlot = document.createElement('div');
        djSlot.className = 'radio-v0-dj-slot';
        djSlot.innerHTML = `
            <div class="radio-v0-dj-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-2a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div class="radio-v0-dj-copy">
                <p class="radio-v0-dj-label">Current DJ</p>
                <p class="radio-v0-dj-name">${safeCurrentDj}</p>
            </div>
        `;
        container.appendChild(djSlot);

        // User List
        const activeUsersFromDb = await fetchActiveUsersInRoom(currentRoom);
        const activeUsersFromPresence = Array.isArray(roomParticipants[currentRoom]) ? roomParticipants[currentRoom] : [];
        const participantsMap = new Map();
        [...activeUsersFromDb, ...activeUsersFromPresence].forEach((user) => {
            const key = String(user || '').trim().toLowerCase();
            if (!key || participantsMap.has(key)) return;
            participantsMap.set(key, String(user).trim());
        });
        const participants = Array.from(participantsMap.values()).sort((a, b) => {
            const aIsDj = sameUser(a, currentRoomData?.current_dj);
            const bIsDj = sameUser(b, currentRoomData?.current_dj);
            if (aIsDj && !bIsDj) return -1;
            if (!aIsDj && bIsDj) return 1;
            return a.localeCompare(b);
        });

        const usersBox = document.createElement('div');
        usersBox.className = 'radio-v0-users-list';
        usersBox.innerHTML = `
            <div class="radio-v0-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="19" cy="11" r="2"/></svg>
                Listeners (${participants.length})
            </div>
            <div class="radio-v0-users-table"></div>
        `;
        const table = usersBox.querySelector('.radio-v0-users-table');
        participants.forEach(user => {
            const row = document.createElement('div');
            const isUserDJ = sameUser(user, currentRoomData?.current_dj);
            const isSelf = sameUser(user, currentUser);
            row.className = `radio-v0-user-row ${isUserDJ ? 'is-dj' : ''} ${isSelf ? 'is-self' : ''}`.trim();

            const avatar = document.createElement('div');
            avatar.className = 'radio-v0-user-avatar';
            avatar.textContent = String(user || '?').slice(0, 1).toUpperCase();

            const copy = document.createElement('div');
            copy.className = 'radio-v0-user-copy';

            const name = document.createElement('p');
            name.className = 'radio-v0-user-name';
            name.textContent = user;

            const role = document.createElement('p');
            role.className = 'radio-v0-user-role';
            role.textContent = isUserDJ ? 'DJ' : (isSelf ? 'You' : 'Listener');

            copy.appendChild(name);
            copy.appendChild(role);
            row.appendChild(avatar);
            row.appendChild(copy);

            if (isUserDJ) {
                const pill = document.createElement('span');
                pill.className = 'radio-v0-user-pill';
                pill.textContent = 'DJ';
                row.appendChild(pill);
            }

            table.appendChild(row);
        });
        container.appendChild(usersBox);

        // Footer Controls
        const footer = document.createElement('div');
        footer.className = 'radio-v0-footer';

        if (isDJ) {
            footer.innerHTML = `
                <label class="radio-v0-label">Broadcast YouTube URL</label>
                <div class="radio-v0-inline-row">
                    <input type="text" class="radio-v0-input radio-v0-input-inline" placeholder="https://...">
                    <button class="radio-v0-btn-primary radio-v0-btn-inline" id="play-v0">Play</button>
                </div>
                <div class="radio-v0-inline-row">
                    <button id="leave-v0" class="radio-v0-btn-secondary radio-v0-btn-danger">Leave</button>
                </div>
            `;
            footer.querySelector('#play-v0').onclick = () => {
                const url = footer.querySelector('input').value.trim();
                const videoId = extractVideoId(url);
                if (videoId) broadcastVideo(videoId);
                else alert("Lien YouTube invalide.");
            };
        } else {
            footer.innerHTML = `
                <div class="radio-v0-listener-note">Player opens automatically while you are in this room.</div>
                <button id="leave-v0" class="radio-v0-btn-secondary">Leave Room</button>
            `;
        }

        footer.querySelector('#leave-v0').onclick = () => leaveRoom();
        container.appendChild(footer);
    }



    async function createNewRoom(name) {
        try {
            const pinReady = await ensurePinReadyForCurrentUser({ interactive: true });
            if (!pinReady) return;

            const normalizedName = normalizeRoomName(name);
            if (!normalizedName) {
                alert('Invalid room name (1-40 chars).');
                return;
            }

            // Check if room already exists
            let existing = null;
            try {
                const resp = await fetch(`${SUPABASE_URL}/rest/v1/radio_rooms?name=eq.${encodeURIComponent(normalizedName)}&select=*`, {
                    headers: {
                        "apikey": SUPABASE_KEY,
                        "Authorization": `Bearer ${SUPABASE_KEY}`,
                        "Accept": "application/json"
                    }
                });
                if (resp.ok) {
                    const rooms = await resp.json();
                    if (rooms && rooms.length > 0) existing = rooms[0];
                }
            } catch (e) { }

            if (existing) {
                // If it exists but has no activity for 5 mins, we can take it over
                const lastActive = new Date(existing.last_activity).getTime();
                const now = Date.now();
                if (now - lastActive > ROOM_STALE_ACTIVITY_WINDOW_MS) {
                    await deleteRadioRoomByName(normalizedName);
                } else {
                    alert("Ce nom de room est dÃƒÂ©jÃƒÂ  pris !");
                    return;
                }
            }

            const data = await upsertRadioRoom({
                name: normalizedName,
                current_dj: currentUser,
                last_activity: new Date().toISOString()
            });
            if (!data) throw new Error('Room upsert failed');

            currentRoom = normalizedName;
            currentRoomData = data;
            persistCurrentRoom(normalizedName);
            await upsertCurrentUserRoomPresence(normalizedName);
            ensureRoomPlayerWindowOpen();
            initSupabaseRealtime();
            refreshRadioPanel();
        } catch (e) {
            console.error("Error creating room:", e);
        }
    }

    function isValidYoutubeVideoId(videoId) {
        return /^[A-Za-z0-9_-]{11}$/.test(String(videoId || '').trim());
    }

    function extractVideoId(url) {
        const raw = String(url || '').trim();
        if (isValidYoutubeVideoId(raw)) return raw;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = raw.match(regExp);
        const candidate = match ? match[2] : null;
        return isValidYoutubeVideoId(candidate) ? candidate : null;
    }

    /**
     * Floating Player UI (Completely Rebuilt)
     */
    function createPlayerWindow() {
        // Singleton check
        if (ytWindow && document.body.contains(ytWindow)) return;
        if (ytWindow && !document.body.contains(ytWindow)) ytWindow = null;

        // Create player window
        ytWindow = document.createElement('div');
        ytWindow.className = 'yt-player-window';
        ytWindow.style.cssText = 'position:fixed; left:100px; top:100px; width:560px; height:360px; z-index:999999;';

        ytWindow.innerHTML = `
        <div class="yt-player-header" style="cursor:move; user-select:none;">
            <span class="yt-player-title">[Lobby] Ready</span>
            <div class="yt-control-btn" id="yt-close-win">X</div>
        </div>
        <div class="yt-player-content">
            <div id="yt-player-mount" style="width:100%; height:100%; pointer-events:auto;"></div>
            <div class="yt-player-overlay"></div>
        </div>
        <div class="yt-resize-handle" style="cursor:nwse-resize; user-select:none;"></div>
    `;
        document.body.appendChild(ytWindow);

        const header = ytWindow.querySelector('.yt-player-header');
        const resizeHandle = ytWindow.querySelector('.yt-resize-handle');
        const closeBtn = ytWindow.querySelector('#yt-close-win');
        const overlay = ytWindow.querySelector('.yt-player-overlay');

        const setInteractionOverlay = (active) => {
            if (!overlay) return;
            overlay.classList.toggle('active', active);
        };

        // Drag variables
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let windowStartX = 0;
        let windowStartY = 0;

        // Resize variables
        let isResizing = false;
        let resizeStartX = 0;
        let resizeStartY = 0;
        let windowStartW = 0;
        let windowStartH = 0;

        const onMouseMove = (e) => {
            if (!ytWindow) return;

            if (isDragging) {
                const dx = e.clientX - dragStartX;
                const dy = e.clientY - dragStartY;

                ytWindow.style.left = (windowStartX + dx) + 'px';
                ytWindow.style.top = (windowStartY + dy) + 'px';
            }

            if (isResizing) {
                const dx = e.clientX - resizeStartX;
                const dy = e.clientY - resizeStartY;

                const newW = Math.max(300, windowStartW + dx);
                const newH = Math.max(200, windowStartH + dy);

                ytWindow.style.width = newW + 'px';
                ytWindow.style.height = newH + 'px';
            }
        };

        const onMouseUp = () => {
            if (isDragging || isResizing) {
                isDragging = false;
                isResizing = false;
                setInteractionOverlay(false);
            }
        };

        // Close button
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            const shouldLeaveRoom = !!(currentRoom && currentRoom !== 'Lobby');
            window.removeEventListener('mousemove', onMouseMove, true);
            window.removeEventListener('mouseup', onMouseUp, true);
            ytWindow.remove();
            ytWindow = null;
            if (shouldLeaveRoom) {
                leaveRoom().catch(() => { });
            } else {
                stopMusic();
            }
        };

        // DRAG: Mouse down on header
        header.addEventListener('mousedown', function (e) {
            if (e.target.closest('.yt-control-btn')) return;
            e.preventDefault();

            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            const rect = ytWindow.getBoundingClientRect();
            windowStartX = rect.left;
            windowStartY = rect.top;
            setInteractionOverlay(true);
        });

        // RESIZE: Mouse down on resize handle
        resizeHandle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();

            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;

            windowStartW = ytWindow.offsetWidth;
            windowStartH = ytWindow.offsetHeight;
            setInteractionOverlay(true);
        });

        window.addEventListener('mousemove', onMouseMove, true);
        window.addEventListener('mouseup', onMouseUp, true);
    }


    /**
     * YouTube API Management via direct Iframe (CSP Safe)
     */
    function getYoutubeTargetOrigin(iframe) {
        if (!iframe?.src) return null;
        try {
            const origin = new URL(iframe.src).origin;
            if (origin === 'https://www.youtube.com' || origin === 'https://www.youtube-nocookie.com') {
                return origin;
            }
        } catch (e) { }
        return null;
    }

    function sendPlayerCommand(func, args = []) {
        const iframe = document.getElementById('yt-player-iframe');
        if (!iframe) return;
        const targetOrigin = getYoutubeTargetOrigin(iframe);
        if (!targetOrigin || !iframe.contentWindow) return;
        iframe.contentWindow.postMessage(JSON.stringify({
            event: 'command',
            func: func,
            args: args
        }), targetOrigin);
    }

    function initYoutubePlayer(videoId, seekTo = 0) {
        createPlayerWindow();
        ytWindow.classList.add('active');
        if (videoTitleById[videoId]) {
            currentVideoTitle = videoTitleById[videoId];
        } else if (!currentVideoTitle) {
            currentVideoTitle = 'Loading...';
        }
        updatePlayerWindowTitle();
        mountPlayer(videoId, seekTo);
    }

    function isCurrentUserDj() {
        if (!currentRoomData || !currentUser || !currentRoomData.current_dj) return false;
        return String(currentRoomData.current_dj).trim().toLowerCase() === String(currentUser).trim().toLowerCase();
    }

    function getEstimatedPlayerTime() {
        if (!Number.isFinite(ytLastKnownTime) || ytLastKnownTimeUpdatedAt <= 0) {
            return null;
        }
        if (ytPlayerState === 1) {
            return Math.max(0, ytLastKnownTime + ((Date.now() - ytLastKnownTimeUpdatedAt) / 1000));
        }
        return Math.max(0, ytLastKnownTime);
    }

    function buildDjPlaybackSnapshot(overrideTime = null) {
        const now = Date.now();
        let playerTime = Number.isFinite(overrideTime) ? overrideTime : getEstimatedPlayerTime();

        if (!Number.isFinite(playerTime) && Number.isFinite(djLastObservedPlayerTime)) {
            if (ytPlayerState === 1 && djLastObservedAtMs > 0) {
                playerTime = Math.max(0, djLastObservedPlayerTime + ((now - djLastObservedAtMs) / 1000));
            } else {
                playerTime = Math.max(0, djLastObservedPlayerTime);
            }
        }

        if (!Number.isFinite(playerTime) && djPlaybackStartTimeMs > 0) {
            playerTime = Math.max(0, (now - djPlaybackStartTimeMs) / 1000);
        }

        if (!Number.isFinite(playerTime)) {
            return null;
        }

        const safeTime = Math.max(0, playerTime);
        return {
            positionSeconds: safeTime,
            positionCapturedAt: now,
            isPlaying: ytPlayerState !== 2,
            startTime: Math.round(now - (safeTime * 1000))
        };
    }

    function sendRadioSync(videoId, reason = 'state', options = null) {
        if (!cityRadioChannel || !isCurrentUserDj() || !isValidYoutubeVideoId(videoId)) return;
        const overrideTime = options && Number.isFinite(options.overrideTime) ? options.overrideTime : null;
        const snapshot = buildDjPlaybackSnapshot(overrideTime);
        if (!snapshot) return;

        const payload = {
            videoId: videoId,
            startTime: snapshot.startTime,
            currentTime: snapshot.positionSeconds,
            positionSeconds: snapshot.positionSeconds,
            positionCapturedAt: snapshot.positionCapturedAt,
            isPlaying: snapshot.isPlaying,
            reason: reason,
            dj: currentUser || 'Anonyme',
            videoTitle: normalizeVideoTitle(currentVideoTitle || videoTitleById[videoId] || 'Loading...')
        };
        console.log(`[HabboCityEmoji] DJ Sync Out (${reason}): ${payload.positionSeconds.toFixed(2)}s playing=${payload.isPlaying}`);
        djPlaybackStartTimeMs = payload.startTime;
        if (currentRoomData) {
            currentRoomData.current_video_id = videoId;
            currentRoomData.current_video_started_at = new Date(payload.startTime).toISOString();
            currentRoomData.current_video_position_seconds = payload.positionSeconds;
            currentRoomData.current_video_position_updated_at = new Date(payload.positionCapturedAt).toISOString();
            currentRoomData.current_video_is_playing = payload.isPlaying;
        }
        updateRoomActivity(videoId, new Date(payload.startTime).toISOString(), snapshot);
        cityRadioChannel.send({
            type: 'broadcast',
            event: 'radio_sync',
            payload: payload
        });
    }

    function handleDetectedDjSeek(currentTime) {
        if (!isCurrentUserDj() || !currentPlayingVideoId) return;
        const now = Date.now();
        if (now - djLastSeekBroadcastAtMs < 800) return;
        djPlaybackStartTimeMs = now - (Math.max(0, currentTime) * 1000);
        sendRadioSync(currentPlayingVideoId, 'seek', { overrideTime: currentTime });
        djLastSeekBroadcastAtMs = now;
        djLastStateBroadcastAtMs = now;
    }

    function ensureYoutubeMessageBridge() {
        if (ytMessageListenerBound) return;
        const messageHandler = (event) => {
            if (event.origin !== "https://www.youtube.com" && event.origin !== "https://www.youtube-nocookie.com") return;
            const iframe = document.getElementById('yt-player-iframe');
            if (!iframe || event.source !== iframe.contentWindow) return;
            let data = event.data;

            if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    return;
                }
            }

            if (!data || typeof data !== 'object') return;

            if (data.event === 'onStateChange' && typeof data.info === 'number') {
                ytPlayerState = data.info;
                ytLastKnownTimeUpdatedAt = Date.now();
                if (isCurrentUserDj() && currentPlayingVideoId) {
                    sendPlayerCommand('getCurrentTime');
                }
                return;
            }

            if (data.event === 'infoDelivery' && data.info) {
                if (data.info.videoData && typeof data.info.videoData.title === 'string' && currentPlayingVideoId) {
                    const nextTitle = normalizeVideoTitle(data.info.videoData.title);
                    if (nextTitle && nextTitle !== currentVideoTitle) {
                        currentVideoTitle = nextTitle;
                        videoTitleById[currentPlayingVideoId] = nextTitle;
                        updatePlayerWindowTitle(nextTitle);
                    }
                }
                if (typeof data.info.playerState === 'number') {
                    ytPlayerState = data.info.playerState;
                }
                if (typeof data.info.currentTime === 'number') {
                    const now = Date.now();
                    ytLastKnownTime = data.info.currentTime;
                    ytLastKnownTimeUpdatedAt = now;
                    if (isCurrentUserDj() && currentPlayingVideoId) {
                        if (Number.isFinite(djLastObservedPlayerTime) && djLastObservedAtMs > 0) {
                            const elapsedWall = Math.max(0, (now - djLastObservedAtMs) / 1000);
                            const deltaMedia = data.info.currentTime - djLastObservedPlayerTime;
                            const expectedDelta = ytPlayerState === 1 ? elapsedWall : 0;
                            const drift = deltaMedia - expectedDelta;
                            const jump = Math.abs(drift) >= 1.3 && Math.abs(deltaMedia) >= 0.9;
                            if (jump) {
                                handleDetectedDjSeek(data.info.currentTime);
                            }
                        }
                        djPlaybackStartTimeMs = now - (data.info.currentTime * 1000);
                        djLastObservedPlayerTime = data.info.currentTime;
                        djLastObservedAtMs = now;
                        if (now - djLastStateBroadcastAtMs > 1200) {
                            sendRadioSync(currentPlayingVideoId, 'state');
                            djLastStateBroadcastAtMs = now;
                        }
                    }
                }
            }
        };

        window.addEventListener('message', messageHandler);
        ytMessageListenerBound = true;
    }

    function mountPlayer(videoId, seekTo = 0) {
        if (!isValidYoutubeVideoId(videoId)) return;
        const container = document.getElementById('yt-player-mount');
        if (!container) return;
        currentPlayingVideoId = videoId;
        updatePlayerWindowTitle();

        // Use direct iframe with minimal params to avoid issues
        // Autoplay policy often requires mute=1
        const iframeUrl = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&mute=1&controls=1&playsinline=1&origin=${encodeURIComponent(window.location.origin)}&start=${Math.floor(seekTo)}`;

        container.innerHTML = `
            <iframe id="yt-player-iframe" width="100%" height="100%" src="${iframeUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
        `;

        // Attempt automatic unMute/play call
        setTimeout(() => {
            const iframe = document.getElementById('yt-player-iframe');
            const targetOrigin = getYoutubeTargetOrigin(iframe);
            if (iframe && iframe.contentWindow && targetOrigin) {
                iframe.contentWindow.postMessage(JSON.stringify({
                    event: 'listening',
                    id: 'yt-player-iframe',
                    channel: 'widget'
                }), targetOrigin);
            }
            sendPlayerCommand('addEventListener', ['onStateChange']);
            sendPlayerCommand('unMute');
            sendPlayerCommand('playVideo');
            sendPlayerCommand('getCurrentTime');
            sendPlayerCommand('getPlayerState');
        }, 1200);

        ensureYoutubeMessageBridge();
        if (ytStatePollInterval) clearInterval(ytStatePollInterval);
        ytStatePollInterval = setInterval(() => {
            const now = Date.now();
            sendPlayerCommand('getCurrentTime');
            sendPlayerCommand('getPlayerState');
            if (isCurrentUserDj() && currentPlayingVideoId && now - djLastStateBroadcastAtMs > 1200) {
                sendRadioSync(currentPlayingVideoId, 'state');
                djLastStateBroadcastAtMs = now;
            }
        }, 400);
    }

    // --- INITIALIZATION ---

    async function initExtension() {
        await bootstrapExtensionStorage();
        loadIdentity();
        setupChatObserver();

        // One-time global listeners
        document.addEventListener('click', (e) => {
            const btn = document.querySelector('.emoji-ext-button');
            const radioBtn = document.querySelector('.radio-ext-button');

            if (emojiPanel && emojiPanel.classList.contains('active')) {
                if (!emojiPanel.contains(e.target) && (!btn || !btn.contains(e.target))) {
                    emojiPanel.classList.remove('active');
                    btn?.classList.remove('active');
                }
            }
            if (radioPanel && radioPanel.classList.contains('active')) {
                if (!radioPanel.contains(e.target) && (!radioBtn || !radioBtn.contains(e.target))) {
                    radioPanel.classList.remove('active');
                    radioBtn?.classList.remove('active');
                }
            }
        });

        // Loop for injection
        setInterval(() => {
            injectEmojiButton();
        }, 2000);

        // Realtime
        initSupabaseRealtime();
        if (currentRoom && currentRoom !== 'Lobby') {
            ensureRoomPlayerWindowOpen();
        }

        window.addEventListener('beforeunload', () => {
            leaveRoom({
                keepalive: true,
                skipRealtimeReinit: true,
                skipPanelRefresh: true
            }).catch(() => { });
        });
    }

    initExtension().catch((e) => {
        console.error("[HabboCityEmoji] Failed to initialize extension:", e);
    });

})();







