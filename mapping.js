/**
 * HabboCity Emoji Extension - Mapping Logic
 * (Les variables SUPABASE_URL et SUPABASE_KEY sont chargées depuis config.js)
 */

if (typeof SUPABASE_KEY === 'undefined') {
    console.error("[HabboCityEmoji] ERREUR : config.js manquant ou mal configuré.");
}


let EMOJI_MAPPING = {
    ":dance:": { url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJzOHJqcmR6eXp6Z3Z6Z3Z6Z3Z6Z3Z6Z3Z6Z3Z6Z3Z6Z3Z6Z3ZjJmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/l3V0lsG6XlYZQM6r6/giphy.gif", user: "System" },
    ":fire:": { url: "https://media.giphy.com/media/26gsjCZpPolPr3sBy/giphy.gif", user: "System" },
    ":love:": { url: "https://media.giphy.com/media/l41lTfuxV5RWDY86Y/giphy.gif", user: "System" },
    ":cool:": { url: "https://media.giphy.com/media/3o7TKVUn7iM8FMEU24/giphy.gif", user: "System" },
    ":lol:": { url: "https://media.giphy.com/media/3o7TKMGpxx6r76lUKs/giphy.gif", user: "System" },
    ":clap:": { url: "https://media.giphy.com/media/3o7TKVVnTSUfW0rDk4/giphy.gif", user: "System" },
    ":cry:": { url: "https://media.giphy.com/media/3o7TKT7659qv3U8S5O/giphy.gif", user: "System" },
    ":oops:": { url: "https://media.giphy.com/media/3o7TKVznfB0vFqH9qE/giphy.gif", user: "System" },
    ":wow:": { url: "https://media.giphy.com/media/3o7TKMGpxx6r76lUKs/giphy.gif", user: "System" },
    ":yes:": { url: "https://media.giphy.com/media/3o7TKMGpxx6r76lUKs/giphy.gif", user: "System" },
    ":no:": { url: "https://media.giphy.com/media/3o7TKMGpxx6r76lUKs/giphy.gif", user: "System" },
    ":party:": { url: "https://media.giphy.com/media/26n6R5HO1FjK6BQXY/giphy.gif", user: "System" },
    ":wink:": { url: "https://media.giphy.com/media/3o7TKVUn7iM8FMEU24/giphy.gif", user: "System" },
    ":thinking:": { url: "https://media.giphy.com/media/3o7TKVUn7iM8FMEU24/giphy.gif", user: "System" },
    ":angry:": { url: "https://media.giphy.com/media/3Owa0TWDRS1BC/giphy.gif", user: "System" },
    ":sleep:": { url: "https://media.giphy.com/media/ZMQGIdpSsq12M/giphy.gif", user: "System" },
    ":shrug:": { url: "https://media.giphy.com/media/7T33BLlB7NQrjozoRB/giphy.gif", user: "System" },
};

/**
 * Charge les emojis depuis Supabase
 */
async function syncEmojis() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/emojis?select=*&order=id.asc`, {
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`
            }
        });

        if (response.status === 401) {
            console.error("[HabboCityEmoji] Erreur 401 : Bureau des plaintes ! Votre SUPABASE_KEY est probablement invalide.");
            return;
        }

        const data = await response.json();

        if (Array.isArray(data)) {
            const newMapping = {};
            data.forEach(item => {
                newMapping[item.code] = {
                    url: item.url,
                    user: item.created_by || 'Anonyme'
                };
            });
            EMOJI_MAPPING = newMapping;
            localStorage.setItem('emoji_cache', JSON.stringify(EMOJI_MAPPING));
            console.log("[HabboCityEmoji] Emojis synchronisés : ", Object.keys(EMOJI_MAPPING).length);
        }
    } catch (e) {
        console.error("[HabboCityEmoji] Erreur sync :", e);
        // Fallback sur le cache local
        const cache = localStorage.getItem('emoji_cache');
        if (cache) EMOJI_MAPPING = JSON.parse(cache);
    }
}

/**
 * Vérifie si l'utilisateur est admin
 */
async function checkAdminStatus(username) {
    if (!username) return false;
    try {
        // Log query for debugging
        console.log(`[HabboCityEmoji] Vérification admin pour : "${username}"`);

        // Use .ilike for case-insensitive check
        const response = await fetch(`${SUPABASE_URL}/rest/v1/admins?username=ilike.${username}&select=*`, {
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`
            }
        });

        if (!response.ok) {
            console.error(`[HabboCityEmoji] Erreur checkAdmin (${response.status})`);
            return false;
        }

        const data = await response.json();
        console.log(`[HabboCityEmoji] Résultat checkAdmin :`, data);

        // Final fallback: check case-insensitively on client if exact match failed
        const isUserAdmin = Array.isArray(data) && data.some(a => a.username.toLowerCase() === username.toLowerCase());

        if (isUserAdmin) {
            console.log("%c[HabboCityEmoji] ACCÈS ADMIN CONFIRMÉ", "color: #00ff00; font-weight: bold;");
        } else {
            console.warn("[HabboCityEmoji] ACCÈS ADMIN REFUSÉ. Vérifiez que le pseudo est EXACTEMENT le même dans Supabase.");
        }

        return isUserAdmin;
    } catch (e) {
        console.error("[HabboCityEmoji] Erreur critique checkAdmin :", e);
        return false;
    }
}

// Initial Sync
syncEmojis();

const BYPASS_EMOJI_MAPPING = {
    "😀": ":smile:", "😁": ":grin:", "😂": ":joy:", "🤣": ":rofl:", "😃": ":smiley:", "😄": ":smile_eyes:", "😅": ":sweat_smile:", "😆": ":laughing:", "😉": ":wink:", "😊": ":blush:", "😋": ":yum:", "😎": ":cool:", "😍": ":heart_eyes:", "😘": ":kissing_heart:", "😗": ":kissing:", "😙": ":kissing_smiling_eyes:", "😚": ":kissing_closed_eyes:", "🙂": ":slight_smile:", "🤗": ":hugging:", "🤩": ":star_eyes:",
    "🤔": ":thinking:", "🤨": ":raised_eyebrow:", "😐": ":neutral_face:", "😑": ":expressionless:", "😶": ":no_mouth:", "🙄": ":rolling_eyes:", "😏": ":smirking:", "😣": ":persevering:", "😥": ":disappointed_relieved:", "😮": ":open_mouth:", "🤐": ":zipper_mouth:", "😯": ":hushed:", "😪": ":sleepy:", "😫": ":tired_face:", "😴": ":sleeping:", "😌": ":relieved:", "😛": ":stuck_out_tongue:", "😜": ":stuck_out_tongue_winking_eye:", "😝": ":stuck_out_tongue_closed_eyes:", "🤤": ":drooling_face:",
    "😒": ":unamused:", "😓": ":sweat:", "😔": ":pensive:", "😕": ":confused:", "🙃": ":upside_down:", "🤑": ":money_mouth:", "😲": ":astonished:", "☹️": ":frowning_face:", "🙁": ":slight_frowning_face:", "😖": ":confounded:", "😞": ":disappointed:", "😟": ":worried:", "😤": ":triumph:", "😢": ":cry:", "😭": ":sob:", "😦": ":frowning_open_mouth:", "😧": ":anguished:", "😨": ":fearful:", "😩": ":weary:", "🤯": ":exploding_head:",
    "😬": ":grimacing:", "😰": ":cold_sweat:", "😱": ":scream:", "🥵": ":hot_face:", "🥶": ":cold_face:", "😳": ":flushed:", "🤪": ":zany_face:", "😵": ":dizzy_face:", "😡": ":rage:", "😠": ":angry:", "🤬": ":cursing:", "😷": ":mask:", "🤒": ":fever:", "🤕": ":bandage:", "🤢": ":nauseated:", "🤮": ":vomiting:", "🤧": ":sneezing:", "😇": ":innocent:", "🥳": ":partying:", "🥺": ":pleading:",
    "🧐": ":monocle:", "🤓": ":nerd:", "😈": ":smiling_imp:", "👿": ":imp:", "🤡": ":clown:", "👹": ":ogre:", "👺": ":goblin:", "👻": ":ghost:", "💀": ":skull:", "☠️": ":crossbones:", "👽": ":alien:", "👾": ":space_invader:", "🤖": ":robot:", "💩": ":poop:", "😺": ":smiley_cat:", "😸": ":smile_cat:", "😹": ":joy_cat:", "😻": ":heart_eyes_cat:", "😼": ":smirk_cat:", "😽": ":kissing_cat:",
    "💋": ":kiss:", "❤️": ":heart:", "🔥": ":fire:", "✨": ":sparkles:", "⭐": ":star:", "⚡": ":zap:", "🌈": ":rainbow:", "☀️": ":sun:", "☁️": ":cloud:", "❄️": ":snowflake:", "🌊": ":ocean:", "🎈": ":balloon:", "🎉": ":tada:", "🎁": ":gift:", "🎂": ":birthday:", "🏆": ":trophy:", "🍕": ":pizza:", "🍔": ":burger:", "🍟": ":fries:", "🍦": ":icecream:"
};

const REVERSE_BYPASS_MAPPING = Object.entries(BYPASS_EMOJI_MAPPING).reduce((acc, [emoji, alias]) => {
    acc[alias] = emoji;
    return acc;
}, {});

/**
 * Formatte l'URL Twemoji pour un emoji donné
 */
function getTwemojiUrl(emoji) {
    if (!emoji) return null;
    try {
        // Convert emoji to hex code points
        const codePoints = [...emoji]
            .map(char => char.codePointAt(0).toString(16))
            .filter(cp => cp !== 'fe0f') // Remove variation selector for Twemoji compatibility
            .join('-');
        return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${codePoints}.png`;
    } catch (e) {
        return null;
    }
}

/**
 * Détermine si une URL est un GIF
 */
function isGif(url) {
    return url && (url.toLowerCase().endsWith('.gif') || url.toLowerCase().includes('giphy.com/media/'));
}


