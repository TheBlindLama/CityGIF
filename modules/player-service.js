(function (global) {
    function createPlayerService(config) {
        const supabaseUrl = config.supabaseUrl;
        const supabaseKey = config.supabaseKey;
        const sameUser = config.sameUser;
        const updateRoomActivity = config.updateRoomActivity;
        const initSupabaseRealtime = config.initSupabaseRealtime;
        const leaveRoom = config.leaveRoom;
        const getCityRadioChannel = config.getCityRadioChannel;
        const getCurrentRoom = config.getCurrentRoom;
        const getCurrentRoomData = config.getCurrentRoomData;
        const setCurrentRoomData = config.setCurrentRoomData;
        const getCurrentUser = config.getCurrentUser;
        const getCurrentPlayingVideoId = config.getCurrentPlayingVideoId;
        const setCurrentPlayingVideoId = config.setCurrentPlayingVideoId;
        const getLastSyncData = config.getLastSyncData;
        const setLastSyncData = config.setLastSyncData;
        const getLastSyncDataUpdatedAt = config.getLastSyncDataUpdatedAt;
        const setLastSyncDataUpdatedAt = config.setLastSyncDataUpdatedAt;
        const getYtWindow = config.getYtWindow;
        const setYtWindow = config.setYtWindow;
        const getYtMessageListenerBound = config.getYtMessageListenerBound;
        const setYtMessageListenerBound = config.setYtMessageListenerBound;
        const getYtStatePollInterval = config.getYtStatePollInterval;
        const setYtStatePollInterval = config.setYtStatePollInterval;
        const getYtPlayerState = config.getYtPlayerState;
        const setYtPlayerState = config.setYtPlayerState;
        const getYtLastKnownTime = config.getYtLastKnownTime;
        const setYtLastKnownTime = config.setYtLastKnownTime;
        const getYtLastKnownTimeUpdatedAt = config.getYtLastKnownTimeUpdatedAt;
        const setYtLastKnownTimeUpdatedAt = config.setYtLastKnownTimeUpdatedAt;
        const getCurrentVideoTitle = config.getCurrentVideoTitle;
        const setCurrentVideoTitle = config.setCurrentVideoTitle;
        const getVideoTitleById = config.getVideoTitleById;
        const getDjPlaybackStartTimeMs = config.getDjPlaybackStartTimeMs;
        const setDjPlaybackStartTimeMs = config.setDjPlaybackStartTimeMs;
        const getDjLastObservedPlayerTime = config.getDjLastObservedPlayerTime;
        const setDjLastObservedPlayerTime = config.setDjLastObservedPlayerTime;
        const getDjLastObservedAtMs = config.getDjLastObservedAtMs;
        const setDjLastObservedAtMs = config.setDjLastObservedAtMs;
        const getDjLastSeekBroadcastAtMs = config.getDjLastSeekBroadcastAtMs;
        const setDjLastSeekBroadcastAtMs = config.setDjLastSeekBroadcastAtMs;
        const getDjLastStateBroadcastAtMs = config.getDjLastStateBroadcastAtMs;
        const setDjLastStateBroadcastAtMs = config.setDjLastStateBroadcastAtMs;
        const LISTENER_SYNC_DRIFT_THRESHOLD_SECONDS = Number(config.listenerSyncDriftThresholdSeconds) || 1;

        function getVideoTitleMap() {
            const map = getVideoTitleById();
            return map && typeof map === 'object' ? map : {};
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

        function normalizeVideoTitle(raw) {
            const text = String(raw || '').replace(/\s+/g, ' ').trim();
            return text || 'Video';
        }

        function getDisplayRoomName() {
            const currentRoomData = getCurrentRoomData();
            const currentRoom = getCurrentRoom();
            const room = (currentRoomData && currentRoomData.name) || currentRoom || 'Lobby';
            const clean = String(room || '').trim();
            return clean || 'Lobby';
        }

        function updatePlayerWindowTitle(videoTitle = null) {
            const ytWindow = getYtWindow();
            if (!ytWindow) return;
            const titleEl = ytWindow.querySelector('.yt-player-title');
            if (!titleEl) return;

            const roomName = getDisplayRoomName();
            const finalTitle = normalizeVideoTitle(videoTitle != null ? videoTitle : getCurrentVideoTitle());
            titleEl.innerText = `[${roomName}] ${finalTitle}`;
        }

        function stopMusic() {
            const mount = document.getElementById('yt-player-mount');
            if (mount) mount.innerHTML = '';
            if (window._radioSyncInterval) {
                clearInterval(window._radioSyncInterval);
                window._radioSyncInterval = null;
            }
            const ytStatePollInterval = getYtStatePollInterval();
            if (ytStatePollInterval) {
                clearInterval(ytStatePollInterval);
                setYtStatePollInterval(null);
            }
            setYtPlayerState(-1);
            setYtLastKnownTime(0);
            setYtLastKnownTimeUpdatedAt(0);
            setCurrentVideoTitle('');
            setDjPlaybackStartTimeMs(0);
            setDjLastObservedPlayerTime(null);
            setDjLastObservedAtMs(0);
            setDjLastSeekBroadcastAtMs(0);
            const ytWindow = getYtWindow();
            if (ytWindow) {
                ytWindow.classList.remove('active');
                updatePlayerWindowTitle('Ready');
            }
        }

        function ensureRoomPlayerWindowOpen() {
            const currentRoom = getCurrentRoom();
            if (!currentRoom || currentRoom === 'Lobby') return false;
            createPlayerWindow();
            const ytWindow = getYtWindow();
            if (!ytWindow) return false;
            ytWindow.classList.add('active');
            updatePlayerWindowTitle();
            return true;
        }

        function broadcastVideo(videoId) {
            if (!isCurrentUserDj()) return;
            if (!isValidYoutubeVideoId(videoId)) return;
            if (!getCityRadioChannel()) {
                initSupabaseRealtime();
            }

            setCurrentPlayingVideoId(videoId);
            const titleMap = getVideoTitleMap();
            setCurrentVideoTitle(titleMap[videoId] || 'Loading...');
            setDjPlaybackStartTimeMs(Date.now());
            setDjLastObservedPlayerTime(0);
            setDjLastObservedAtMs(Date.now());
            initYoutubePlayer(videoId, 0);
            updatePlayerWindowTitle();
            sendRadioSync(videoId, 'start');

            updateRoomActivity(videoId);

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
            const ytWindow = getYtWindow();
            const isPlayerOpen = !!(ytWindow && ytWindow.classList.contains('active'));
            const seekInPlace = (videoId, elapsed, shouldPlay = true) => {
                if (isPlayerOpen && getCurrentPlayingVideoId() === videoId && document.getElementById('yt-player-iframe')) {
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
                    setCurrentPlayingVideoId(videoId);
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

            const lastSyncData = getLastSyncData();
            if (lastSyncData && isValidYoutubeVideoId(lastSyncData.videoId)) {
                if (typeof lastSyncData.videoTitle === 'string' && lastSyncData.videoTitle.trim()) {
                    const normalizedTitle = normalizeVideoTitle(lastSyncData.videoTitle);
                    setCurrentVideoTitle(normalizedTitle);
                    getVideoTitleMap()[lastSyncData.videoId] = normalizedTitle;
                }
                const elapsed = getTargetTimeFromSyncSnapshot(lastSyncData);
                if (Number.isFinite(elapsed)) {
                    const syncIsPlaying = typeof lastSyncData.isPlaying === 'boolean' ? lastSyncData.isPlaying : true;
                    seekInPlace(lastSyncData.videoId, elapsed, syncIsPlaying);
                    return true;
                }
            }

            const currentRoomData = getCurrentRoomData();
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
            const cityRadioChannel = getCityRadioChannel();
            if (!cityRadioChannel) return false;
            if (isCurrentUserDj()) return false;
            cityRadioChannel.send({
                type: 'broadcast',
                event: 'radio_sync_request',
                payload: {
                    requestedBy: getCurrentUser() || 'Anonyme',
                    reason: reason,
                    requestedAt: Date.now()
                }
            });
            return true;
        }

        function handleRadioSync(data) {
            const { videoId, startTime, currentTime, positionSeconds, positionCapturedAt, isPlaying, dj, reason, videoTitle } = data;
            if (!isValidYoutubeVideoId(videoId)) return;
            setLastSyncData(data);
            setLastSyncDataUpdatedAt(Date.now());
            const elapsed = getTargetTimeFromSyncSnapshot({
                startTime,
                currentTime,
                positionSeconds,
                positionCapturedAt,
                isPlaying
            });
            const ytWindow = getYtWindow();
            const playerIsOpen = !!(ytWindow && ytWindow.classList.contains('active'));

            console.log(`[HabboCityEmoji] Sync Event: ${videoId} from ${dj} (${reason || 'state'}) -> ${Number.isFinite(elapsed) ? elapsed.toFixed(2) : 'n/a'}s`);

            const currentRoomData = getCurrentRoomData();
            if (currentRoomData && sameUser(currentRoomData.current_dj, getCurrentUser())) {
                return;
            }

            setCurrentPlayingVideoId(videoId);
            if (typeof videoTitle === 'string' && videoTitle.trim()) {
                const normalizedTitle = normalizeVideoTitle(videoTitle);
                setCurrentVideoTitle(normalizedTitle);
                getVideoTitleMap()[videoId] = normalizedTitle;
            } else if (getVideoTitleMap()[videoId]) {
                setCurrentVideoTitle(getVideoTitleMap()[videoId]);
            } else if (!getCurrentVideoTitle()) {
                setCurrentVideoTitle('Loading...');
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
                setCurrentRoomData(currentRoomData);
            }

            if (!playerIsOpen) {
                const playerWindowClosed = !ytWindow || !document.body.contains(ytWindow);
                if (playerWindowClosed && getCurrentRoom() && getCurrentRoom() !== 'Lobby') {
                    leaveRoom().catch(() => { });
                }
                return;
            }

            syncToDjNow();
            updatePlayerWindowTitle();
        }

        function handleRadioSyncRequest(data) {
            if (!isCurrentUserDj()) return;
            if (!getCurrentPlayingVideoId()) return;
            if (!data || data.requestedBy === getCurrentUser()) return;
            sendPlayerCommand('getCurrentTime');
            sendPlayerCommand('getPlayerState');
            setTimeout(() => {
                if (!isCurrentUserDj() || !getCurrentPlayingVideoId()) return;
                sendRadioSync(getCurrentPlayingVideoId(), 'manual_response');
            }, 150);
        }

        function manualResync(options = {}) {
            const silent = !!options.silent;
            const reason = typeof options.reason === 'string' && options.reason.trim()
                ? options.reason.trim()
                : 'manual';
            if (isCurrentUserDj()) return false;
            (async () => {
                const beforeRequestSyncAt = getLastSyncDataUpdatedAt();
                const requested = requestLiveDjSync(reason);
                if (requested) {
                    const waitUntil = Date.now() + 1800;
                    while (Date.now() < waitUntil) {
                        if (getLastSyncData() && getLastSyncDataUpdatedAt() > beforeRequestSyncAt) {
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 120));
                    }
                }

                try {
                    const currentRoom = getCurrentRoom();
                    if (currentRoom && currentRoom !== 'Lobby') {
                        const resp = await fetch(`${supabaseUrl}/rest/v1/radio_rooms?name=eq.${encodeURIComponent(currentRoom)}&select=*`, {
                            headers: {
                                "apikey": supabaseKey,
                                "Authorization": `Bearer ${supabaseKey}`,
                                "Accept": "application/json"
                            }
                        });
                        if (resp.ok) {
                            const rows = await resp.json();
                            if (rows && rows[0]) setCurrentRoomData(rows[0]);
                        }
                    }
                } catch (e) {
                    // no-op
                }

                const currentRoomData = getCurrentRoomData();
                if (
                    (!getLastSyncData() || getLastSyncDataUpdatedAt() <= beforeRequestSyncAt) &&
                    currentRoomData?.current_video_id &&
                    (currentRoomData?.current_video_started_at || Number.isFinite(Number(currentRoomData?.current_video_position_seconds)))
                ) {
                    const dbPosition = Number(currentRoomData.current_video_position_seconds);
                    const dbPositionUpdatedAt = currentRoomData.current_video_position_updated_at
                        ? new Date(currentRoomData.current_video_position_updated_at).getTime()
                        : Date.now();
                    setLastSyncData({
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
                    });
                    setLastSyncDataUpdatedAt(Date.now());
                }

                if (!syncToDjNow() && !silent) {
                    alert("No sync data received yet.");
                }
            })();
            return true;
        }

        function createPlayerWindow() {
            let ytWindow = getYtWindow();
            if (ytWindow && document.body.contains(ytWindow)) return;
            if (ytWindow && !document.body.contains(ytWindow)) {
                ytWindow = null;
                setYtWindow(null);
            }

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
            setYtWindow(ytWindow);

            const header = ytWindow.querySelector('.yt-player-header');
            const resizeHandle = ytWindow.querySelector('.yt-resize-handle');
            const closeBtn = ytWindow.querySelector('#yt-close-win');
            const overlay = ytWindow.querySelector('.yt-player-overlay');

            const setInteractionOverlay = (active) => {
                if (!overlay) return;
                overlay.classList.toggle('active', active);
            };

            let isDragging = false;
            let dragStartX = 0;
            let dragStartY = 0;
            let windowStartX = 0;
            let windowStartY = 0;

            let isResizing = false;
            let resizeStartX = 0;
            let resizeStartY = 0;
            let windowStartW = 0;
            let windowStartH = 0;

            const onMouseMove = (e) => {
                const activeWindow = getYtWindow();
                if (!activeWindow) return;

                if (isDragging) {
                    const dx = e.clientX - dragStartX;
                    const dy = e.clientY - dragStartY;

                    activeWindow.style.left = (windowStartX + dx) + 'px';
                    activeWindow.style.top = (windowStartY + dy) + 'px';
                }

                if (isResizing) {
                    const dx = e.clientX - resizeStartX;
                    const dy = e.clientY - resizeStartY;

                    const newW = Math.max(300, windowStartW + dx);
                    const newH = Math.max(200, windowStartH + dy);

                    activeWindow.style.width = newW + 'px';
                    activeWindow.style.height = newH + 'px';
                }
            };

            const onMouseUp = () => {
                if (isDragging || isResizing) {
                    isDragging = false;
                    isResizing = false;
                    setInteractionOverlay(false);
                }
            };

            closeBtn.onclick = (e) => {
                e.stopPropagation();
                const shouldLeaveRoom = !!(getCurrentRoom() && getCurrentRoom() !== 'Lobby');
                window.removeEventListener('mousemove', onMouseMove, true);
                window.removeEventListener('mouseup', onMouseUp, true);
                const activeWindow = getYtWindow();
                if (activeWindow) {
                    activeWindow.remove();
                }
                setYtWindow(null);
                if (shouldLeaveRoom) {
                    leaveRoom().catch(() => { });
                } else {
                    stopMusic();
                }
            };

            header.addEventListener('mousedown', function (e) {
                if (e.target.closest('.yt-control-btn')) return;
                e.preventDefault();

                isDragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;

                const activeWindow = getYtWindow();
                if (!activeWindow) return;
                const rect = activeWindow.getBoundingClientRect();
                windowStartX = rect.left;
                windowStartY = rect.top;
                setInteractionOverlay(true);
            });

            resizeHandle.addEventListener('mousedown', function (e) {
                e.preventDefault();
                e.stopPropagation();

                isResizing = true;
                resizeStartX = e.clientX;
                resizeStartY = e.clientY;

                const activeWindow = getYtWindow();
                if (!activeWindow) return;
                windowStartW = activeWindow.offsetWidth;
                windowStartH = activeWindow.offsetHeight;
                setInteractionOverlay(true);
            });

            window.addEventListener('mousemove', onMouseMove, true);
            window.addEventListener('mouseup', onMouseUp, true);
        }

        function getYoutubeTargetOrigin(iframe) {
            if (!iframe?.src) return null;
            try {
                const origin = new URL(iframe.src).origin;
                if (origin === 'https://www.youtube.com' || origin === 'https://www.youtube-nocookie.com') {
                    return origin;
                }
            } catch (e) {
                // no-op
            }
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
            const ytWindow = getYtWindow();
            if (!ytWindow) return;
            ytWindow.classList.add('active');
            if (getVideoTitleMap()[videoId]) {
                setCurrentVideoTitle(getVideoTitleMap()[videoId]);
            } else if (!getCurrentVideoTitle()) {
                setCurrentVideoTitle('Loading...');
            }
            updatePlayerWindowTitle();
            mountPlayer(videoId, seekTo);
        }

        function isCurrentUserDj() {
            const currentRoomData = getCurrentRoomData();
            const currentUser = getCurrentUser();
            if (!currentRoomData || !currentUser || !currentRoomData.current_dj) return false;
            return sameUser(currentRoomData.current_dj, currentUser);
        }

        function getEstimatedPlayerTime() {
            const ytLastKnownTime = getYtLastKnownTime();
            const ytLastKnownTimeUpdatedAt = getYtLastKnownTimeUpdatedAt();
            if (!Number.isFinite(ytLastKnownTime) || ytLastKnownTimeUpdatedAt <= 0) {
                return null;
            }
            if (getYtPlayerState() === 1) {
                return Math.max(0, ytLastKnownTime + ((Date.now() - ytLastKnownTimeUpdatedAt) / 1000));
            }
            return Math.max(0, ytLastKnownTime);
        }

        function buildDjPlaybackSnapshot(overrideTime = null) {
            const now = Date.now();
            let playerTime = Number.isFinite(overrideTime) ? overrideTime : getEstimatedPlayerTime();

            if (!Number.isFinite(playerTime) && Number.isFinite(getDjLastObservedPlayerTime())) {
                if (getYtPlayerState() === 1 && getDjLastObservedAtMs() > 0) {
                    playerTime = Math.max(0, getDjLastObservedPlayerTime() + ((now - getDjLastObservedAtMs()) / 1000));
                } else {
                    playerTime = Math.max(0, getDjLastObservedPlayerTime());
                }
            }

            if (!Number.isFinite(playerTime) && getDjPlaybackStartTimeMs() > 0) {
                playerTime = Math.max(0, (now - getDjPlaybackStartTimeMs()) / 1000);
            }

            if (!Number.isFinite(playerTime)) {
                return null;
            }

            const safeTime = Math.max(0, playerTime);
            return {
                positionSeconds: safeTime,
                positionCapturedAt: now,
                isPlaying: getYtPlayerState() !== 2,
                startTime: Math.round(now - (safeTime * 1000))
            };
        }

        function sendRadioSync(videoId, reason = 'state', options = null) {
            const cityRadioChannel = getCityRadioChannel();
            if (!cityRadioChannel || !isCurrentUserDj() || !isValidYoutubeVideoId(videoId)) return;
            const overrideTime = options && Number.isFinite(options.overrideTime) ? options.overrideTime : null;
            const snapshot = buildDjPlaybackSnapshot(overrideTime);
            if (!snapshot) return;

            const currentUser = getCurrentUser();
            const payload = {
                videoId: videoId,
                startTime: snapshot.startTime,
                currentTime: snapshot.positionSeconds,
                positionSeconds: snapshot.positionSeconds,
                positionCapturedAt: snapshot.positionCapturedAt,
                isPlaying: snapshot.isPlaying,
                reason: reason,
                dj: currentUser || 'Anonyme',
                videoTitle: normalizeVideoTitle(getCurrentVideoTitle() || getVideoTitleMap()[videoId] || 'Loading...')
            };
            console.log(`[HabboCityEmoji] DJ Sync Out (${reason}): ${payload.positionSeconds.toFixed(2)}s playing=${payload.isPlaying}`);
            setDjPlaybackStartTimeMs(payload.startTime);
            const currentRoomData = getCurrentRoomData();
            if (currentRoomData) {
                currentRoomData.current_video_id = videoId;
                currentRoomData.current_video_started_at = new Date(payload.startTime).toISOString();
                currentRoomData.current_video_position_seconds = payload.positionSeconds;
                currentRoomData.current_video_position_updated_at = new Date(payload.positionCapturedAt).toISOString();
                currentRoomData.current_video_is_playing = payload.isPlaying;
                setCurrentRoomData(currentRoomData);
            }
            updateRoomActivity(videoId, new Date(payload.startTime).toISOString(), snapshot);
            cityRadioChannel.send({
                type: 'broadcast',
                event: 'radio_sync',
                payload: payload
            });
        }

        function handleDetectedDjSeek(currentTime) {
            if (!isCurrentUserDj() || !getCurrentPlayingVideoId()) return;
            const now = Date.now();
            if (now - getDjLastSeekBroadcastAtMs() < 800) return;
            setDjPlaybackStartTimeMs(now - (Math.max(0, currentTime) * 1000));
            sendRadioSync(getCurrentPlayingVideoId(), 'seek', { overrideTime: currentTime });
            setDjLastSeekBroadcastAtMs(now);
            setDjLastStateBroadcastAtMs(now);
        }

        function ensureYoutubeMessageBridge() {
            if (getYtMessageListenerBound()) return;
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
                    setYtPlayerState(data.info);
                    setYtLastKnownTimeUpdatedAt(Date.now());
                    if (isCurrentUserDj() && getCurrentPlayingVideoId()) {
                        sendPlayerCommand('getCurrentTime');
                    }
                    return;
                }

                if (data.event === 'infoDelivery' && data.info) {
                    if (data.info.videoData && typeof data.info.videoData.title === 'string' && getCurrentPlayingVideoId()) {
                        const nextTitle = normalizeVideoTitle(data.info.videoData.title);
                        if (nextTitle && nextTitle !== getCurrentVideoTitle()) {
                            setCurrentVideoTitle(nextTitle);
                            getVideoTitleMap()[getCurrentPlayingVideoId()] = nextTitle;
                            updatePlayerWindowTitle(nextTitle);
                        }
                    }
                    if (typeof data.info.playerState === 'number') {
                        setYtPlayerState(data.info.playerState);
                    }
                    if (typeof data.info.currentTime === 'number') {
                        const now = Date.now();
                        setYtLastKnownTime(data.info.currentTime);
                        setYtLastKnownTimeUpdatedAt(now);
                        if (isCurrentUserDj() && getCurrentPlayingVideoId()) {
                            if (Number.isFinite(getDjLastObservedPlayerTime()) && getDjLastObservedAtMs() > 0) {
                                const elapsedWall = Math.max(0, (now - getDjLastObservedAtMs()) / 1000);
                                const deltaMedia = data.info.currentTime - getDjLastObservedPlayerTime();
                                const expectedDelta = getYtPlayerState() === 1 ? elapsedWall : 0;
                                const drift = deltaMedia - expectedDelta;
                                const jump = Math.abs(drift) >= 1.3 && Math.abs(deltaMedia) >= 0.9;
                                if (jump) {
                                    handleDetectedDjSeek(data.info.currentTime);
                                }
                            }
                            setDjPlaybackStartTimeMs(now - (data.info.currentTime * 1000));
                            setDjLastObservedPlayerTime(data.info.currentTime);
                            setDjLastObservedAtMs(now);
                            if (now - getDjLastStateBroadcastAtMs() > 1200) {
                                sendRadioSync(getCurrentPlayingVideoId(), 'state');
                                setDjLastStateBroadcastAtMs(now);
                            }
                        }
                    }
                }
            };

            window.addEventListener('message', messageHandler);
            setYtMessageListenerBound(true);
        }

        function mountPlayer(videoId, seekTo = 0) {
            if (!isValidYoutubeVideoId(videoId)) return;
            const container = document.getElementById('yt-player-mount');
            if (!container) return;
            setCurrentPlayingVideoId(videoId);
            updatePlayerWindowTitle();

            const iframeUrl = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&mute=1&controls=1&playsinline=1&origin=${encodeURIComponent(window.location.origin)}&start=${Math.floor(seekTo)}`;

            container.innerHTML = `
            <iframe id="yt-player-iframe" width="100%" height="100%" src="${iframeUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
        `;

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
            const ytStatePollInterval = getYtStatePollInterval();
            if (ytStatePollInterval) clearInterval(ytStatePollInterval);
            setYtStatePollInterval(setInterval(() => {
                const now = Date.now();
                sendPlayerCommand('getCurrentTime');
                sendPlayerCommand('getPlayerState');
                if (isCurrentUserDj() && getCurrentPlayingVideoId() && now - getDjLastStateBroadcastAtMs() > 1200) {
                    sendRadioSync(getCurrentPlayingVideoId(), 'state');
                    setDjLastStateBroadcastAtMs(now);
                }
            }, 400));
        }

        return Object.freeze({
            stopMusic,
            ensureRoomPlayerWindowOpen,
            getDisplayRoomName,
            normalizeVideoTitle,
            updatePlayerWindowTitle,
            broadcastVideo,
            getTargetTimeFromSyncSnapshot,
            syncToDjNow,
            requestLiveDjSync,
            handleRadioSync,
            handleRadioSyncRequest,
            manualResync,
            isValidYoutubeVideoId,
            extractVideoId,
            createPlayerWindow,
            getYoutubeTargetOrigin,
            sendPlayerCommand,
            initYoutubePlayer,
            isCurrentUserDj,
            getEstimatedPlayerTime,
            buildDjPlaybackSnapshot,
            sendRadioSync,
            handleDetectedDjSeek,
            ensureYoutubeMessageBridge,
            mountPlayer
        });
    }

    global.CityGifPlayerService = Object.freeze({
        createPlayerService
    });
})(window);
