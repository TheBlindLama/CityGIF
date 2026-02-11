(function (global) {
    function createRoomService(config) {
        const supabaseUrl = config.supabaseUrl;
        const supabaseKey = config.supabaseKey;
        const normalizeRoomName = config.normalizeRoomName;
        const sleep = config.sleep;
        const buildSupabaseAuthHeaders = config.buildSupabaseAuthHeaders;
        const getPin = config.getPin;
        const getCurrentUser = config.getCurrentUser;
        const getCurrentRoom = config.getCurrentRoom;
        const getCurrentRoomData = config.getCurrentRoomData;
        const setCurrentRoomData = config.setCurrentRoomData;
        const getLastRoomPruneAttemptAtMs = config.getLastRoomPruneAttemptAtMs;
        const setLastRoomPruneAttemptAtMs = config.setLastRoomPruneAttemptAtMs;
        const isCurrentUserDj = typeof config.isCurrentUserDj === 'function'
            ? config.isCurrentUserDj
            : (() => false);

        const ROOM_ACTIVE_PRESENCE_WINDOW_MS = Number(config.roomActivePresenceWindowMs) || (2 * 60 * 1000);
        const ROOM_EMPTY_PRUNE_GRACE_MS = Number(config.roomEmptyPruneGraceMs) || 20000;
        const ROOM_PRUNE_COOLDOWN_MS = Number(config.roomPruneCooldownMs) || 60000;
        const ROOM_PRUNE_BATCH_SIZE = Number(config.roomPruneBatchSize) || 100;

        async function upsertCurrentUserRoomPresence(roomName = getCurrentRoom()) {
            const currentUser = getCurrentUser();
            if (!currentUser) return false;
            if (!getPin()) return false;

            try {
                const response = await fetch(`${supabaseUrl}/rest/v1/users?username=eq.${encodeURIComponent(currentUser)}`, {
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
            const currentUser = getCurrentUser();
            if (!currentUser) return false;
            if (!getPin()) return false;
            try {
                const response = await fetch(`${supabaseUrl}/rest/v1/users?username=eq.${encodeURIComponent(currentUser)}`, {
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
                const response = await fetch(`${supabaseUrl}/rest/v1/users_room_presence_counts?select=room_name,total_count,admin_count,user_count`, {
                    headers: {
                        "apikey": supabaseKey,
                        "Authorization": `Bearer ${supabaseKey}`,
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
            if (!getCurrentUser() || !getPin()) return null;

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
                    `${supabaseUrl}/rest/v1/users?current_room=eq.${encodeURIComponent(roomName)}&last_seen=gt.${cutoff}&select=username,created_at&order=created_at.asc`,
                    {
                        headers: {
                            "apikey": supabaseKey,
                            "Authorization": `Bearer ${supabaseKey}`,
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
            if (!getCurrentUser() || !getPin()) return 0;
            const now = Date.now();
            const lastAttempt = Number(getLastRoomPruneAttemptAtMs()) || 0;
            if (!force && now - lastAttempt < ROOM_PRUNE_COOLDOWN_MS) {
                return 0;
            }
            setLastRoomPruneAttemptAtMs(now);

            try {
                const response = await fetch(
                    `${supabaseUrl}/rest/v1/radio_rooms?select=name,last_activity&order=last_activity.asc&limit=${ROOM_PRUNE_BATCH_SIZE}`,
                    {
                        headers: {
                            "apikey": supabaseKey,
                            "Authorization": `Bearer ${supabaseKey}`,
                            "Accept": "application/json"
                        }
                    }
                );
                if (!response.ok) return 0;

                const rows = await response.json();
                const presenceCounts = await fetchRoomPresenceCountMap();
                const candidates = Array.isArray(rows) ? rows : [];
                let deletedCount = 0;
                const currentRoom = getCurrentRoom();
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

        async function updateRoomActivity(videoId = null, startedAtIso = null, playbackSnapshot = null) {
            const currentRoom = getCurrentRoom();
            const currentUser = getCurrentUser();
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
                await fetch(`${supabaseUrl}/rest/v1/radio_rooms?on_conflict=name`, {
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
                const response = await fetch(`${supabaseUrl}/rest/v1/radio_rooms?select=*&order=last_activity.desc&limit=100`, {
                    headers: {
                        "apikey": supabaseKey,
                        "Authorization": `Bearer ${supabaseKey}`
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
                const response = await fetch(`${supabaseUrl}/rest/v1/radio_rooms?name=eq.${encodeURIComponent(roomName)}`, {
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
                const response = await fetch(`${supabaseUrl}/rest/v1/radio_rooms?name=eq.${encodeURIComponent(roomName)}`, {
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
                const response = await fetch(`${supabaseUrl}/rest/v1/radio_rooms?on_conflict=name`, {
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

            if (keepalive) {
                await deleteRadioRoomByName(normalizedRoom, { keepalive: true });
                return;
            }

            const currentUser = getCurrentUser();
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
            if (roomData && sameUser(getCurrentRoom(), normalizedRoom)) {
                setCurrentRoomData(roomData);
            }
        }

        return Object.freeze({
            upsertCurrentUserRoomPresence,
            removeCurrentUserRoomPresence,
            fetchRoomPresenceCountMap,
            pickOldestUserFromPresenceState,
            sameUser,
            includesUser,
            ensureRoomDjAssigned,
            fetchActiveUsersInRoom,
            pruneInactiveRooms,
            updateRoomActivity,
            fetchActiveRooms,
            patchRadioRoomByName,
            deleteRadioRoomByName,
            upsertRadioRoom,
            cleanupDepartedRoom
        });
    }

    global.CityGifRoomService = Object.freeze({
        createRoomService
    });
})(window);
