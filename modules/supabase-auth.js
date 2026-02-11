(function (global) {
    async function getUserRecord({ supabaseUrl, supabaseKey, username }) {
        if (!username || !supabaseUrl || !supabaseKey) return null;
        try {
            const response = await fetch(`${supabaseUrl}/rest/v1/users?username=ilike.${encodeURIComponent(username)}&select=username&limit=1`, {
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
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

    async function verifyUserPin({ supabaseUrl, supabaseKey, username, pin }) {
        if (!username || !pin || !supabaseUrl || !supabaseKey) return false;
        try {
            const response = await fetch(`${supabaseUrl}/rest/v1/rpc/verify_user_pin`, {
                method: 'POST',
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
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

    function buildSupabaseAuthHeaders({ supabaseKey, currentUser, pin, extraHeaders = {} }) {
        const headers = {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            ...extraHeaders
        };

        if (currentUser) headers["x-habbo-user"] = currentUser;
        if (pin) headers["x-user-pin"] = pin;
        return headers;
    }

    global.CityGifSupabaseAuth = Object.freeze({
        getUserRecord,
        verifyUserPin,
        buildSupabaseAuthHeaders
    });
})(window);
