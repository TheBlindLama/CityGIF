/**
 * Content Script for HabboCity Emoji/GIF Extension
 * Handles DOM injection, message interception, and parsing.
 */

(function () {
    // --- UTILS ---
    /**
     * Détermine si une URL est un GIF
     */
    function isGif(url) {
        if (!url) return false;
        const lower = url.toLowerCase();
        return lower.endsWith('.gif') || lower.includes('giphy.com/media/') || lower.includes('.gif?');
    }

    console.log("%c[HabboCityEmoji] Extension Script Initialized", "color: #00ff00; font-weight: bold; font-size: 14px;");
    console.log("[HabboCityEmoji] Current URL: " + window.location.href);
    console.log("HabboCity Emoji Extension loaded.");

    let chatInput = null;
    let emojiPanel = null;
    let currentUser = null;
    let isAdmin = false;

    // --- IDENTITY EXTRACTION ---

    /**
     * Extracts the username from a chat bubble containing :login.
     */
    function handleLoginBubble(node, text) {
        if (!text.includes(':login')) return;

        // Find the parent bubble
        // Nitro bubbles usually have a class like .nitro-chat-bubble or .bubble-content
        const bubble = node.closest('.nitro-chat-bubble, .chat-bubble, .bubble-container');
        if (!bubble) return;

        // Find names in the bubble or nearby
        const nameNode = bubble.querySelector('.name, .username, .user-name, [class*="name"]');
        if (nameNode) {
            let name = nameNode.innerText.trim();
            // Remove trailing colon if present (e.g. "Adham:")
            if (name.endsWith(':')) name = name.slice(0, -1).trim();

            if (name && name !== currentUser) {
                currentUser = name;
                localStorage.setItem('habbo_ext_user', currentUser);
                console.log(`[HabboCityEmoji] Connecté en tant que : ${currentUser}`);
                updateButtonState();

                checkAdminStatus(currentUser).then(status => {
                    isAdmin = status;
                    if (isAdmin) console.log("[HabboCityEmoji] Droits administrateur accordés.");
                    if (emojiPanel) refreshPanel();
                });

                // Replace text with cool confirmation
                const span = document.createElement('span');
                span.style.color = '#4a90e2';
                span.style.fontWeight = 'bold';
                span.style.fontStyle = 'italic';
                span.textContent = `✨ Connexion Extension OK (${currentUser}) ✨`;

                node.parentNode.innerHTML = ''; // Safely clear
                node.parentNode.appendChild(span);
            }
        }
    }

    /**
     * Loads identity from storage.
     */
    function loadIdentity() {
        let saved = localStorage.getItem('habbo_ext_user');
        if (saved) {
            // Robust check: strip colons even from saved data
            if (saved.endsWith(':')) saved = saved.slice(0, -1).trim();
            currentUser = saved;
            console.log(`[HabboCityEmoji] Identité restaurée : ${currentUser}`);
            updateButtonState();
            checkAdminStatus(currentUser).then(status => {
                isAdmin = status;
                if (emojiPanel) refreshPanel();
            });
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
                btn.title = `Connecté en tant que ${currentUser}`;
            } else {
                btn.classList.remove('logged-in');
                btn.title = 'Emoji & GIFs (Non connecté)';
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
        if (!chatInput) {
            if (!window._lastLogTime || Date.now() - window._lastLogTime > 30000) {
                console.log("[HabboCityEmoji] Waiting for chat input...");
                window._lastLogTime = Date.now();
            }
            return;
        }

        const container = chatInput.parentElement;
        if (!container) return;

        console.log("[HabboCityEmoji] Injecting UI to container:", container);

        // Create Button
        const btn = document.createElement('div');
        btn.className = 'emoji-ext-button';
        btn.innerHTML = '🙂';
        btn.title = 'Emoji & GIFs';

        // Create Panel
        emojiPanel = document.createElement('div');
        emojiPanel.className = 'emoji-ext-panel';

        refreshPanel();

        btn.onclick = (e) => {
            console.log("[HabboCityEmoji] Button clicked!");
            e.stopPropagation();
            e.preventDefault();
            emojiPanel.classList.toggle('active');
            // Sync emojis when opening
            syncEmojis().then(() => refreshPanel());
        };

        // Inject
        // Append to parent to be on the right
        container.appendChild(btn);
        // Append panel to body to avoid container clipping issues
        document.body.appendChild(emojiPanel);

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (emojiPanel && !btn.contains(e.target) && !emojiPanel.contains(e.target)) {
                emojiPanel.classList.remove('active');
            }
        });

        // Add identity check when opening panel
        btn.addEventListener('click', loadIdentity);

        updateButtonState();

        // Intercept Send
        setupInputInterception(chatInput);
    }

    let currentTab = 'gifs';

    /**
     * Re-renders the panel content (emojis + admin form if applicable)
     */
    function refreshPanel() {
        if (!emojiPanel) return;
        emojiPanel.innerHTML = '';

        // Tabs Header
        const tabsHeader = document.createElement('div');
        tabsHeader.className = 'emoji-ext-tabs';

        const tabs = [
            { id: 'gifs', label: '🖼️' },
            { id: 'emojis', label: '😊' },
            { id: 'add', label: '➕' },
            { id: 'identity', label: '👤' }
        ];

        tabs.forEach(tab => {
            const el = document.createElement('div');
            el.className = `emoji-ext-tab ${currentTab === tab.id ? 'active' : ''}`;
            el.innerText = tab.label;
            el.title = tab.id.charAt(0).toUpperCase() + tab.id.slice(1);
            el.onclick = (e) => {
                e.stopPropagation();
                currentTab = tab.id;
                refreshPanel();
            };
            tabsHeader.appendChild(el);
        });
        emojiPanel.appendChild(tabsHeader);

        // Content Area
        if (currentTab === 'add') {
            renderAddTab();
        } else if (currentTab === 'identity') {
            renderIdentityTab();
        } else if (currentTab === 'emojis') {
            renderRealEmojiList();
        } else {
            renderEmojiList(); // This is for GIFs from Supabase
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
            nameInfo.textContent = 'Connecté : ';
            const b = document.createElement('b');
            b.textContent = currentUser;
            nameInfo.appendChild(b);

            const statusInfo = document.createElement('div');
            statusInfo.style.fontSize = '11px';
            statusInfo.style.color = 'rgba(255,255,255,0.5)';
            statusInfo.style.marginBottom = '15px';
            statusInfo.textContent = 'Statut : ';
            const statusSpan = document.createElement('span');
            if (isAdmin) {
                statusSpan.style.color = '#4a90e2';
                statusSpan.textContent = 'Administrateur';
            } else {
                statusSpan.textContent = 'Utilisateur';
            }
            statusInfo.appendChild(statusSpan);

            const logoutBtn = document.createElement('button');
            logoutBtn.id = 'ext-logout-btn';
            logoutBtn.style.cssText = 'background:#d9534f; color:white; border:none; padding:8px 15px; border-radius:4px; cursor:pointer;';
            logoutBtn.textContent = 'Déconnexion';
            logoutBtn.onclick = () => {
                localStorage.removeItem('habbo_ext_user');
                currentUser = null;
                isAdmin = false;
                currentTab = 'gifs';
                updateButtonState();
                refreshPanel();
            };

            div.appendChild(nameInfo);
            div.appendChild(statusInfo);
            div.appendChild(logoutBtn);
            emojiPanel.appendChild(div);
        } else {
            const info = document.createElement('div');
            info.style.fontSize = '13px';
            info.style.marginBottom = '15px';
            info.textContent = "L'extension a besoin de connaître votre pseudo pour activer les fonctions avancées.";

            const loginBtn = document.createElement('button');
            loginBtn.id = 'ext-login-btn';
            loginBtn.style.cssText = 'background:#4a90e2; color:white; border:none; padding:10px 20px; border-radius:6px; font-weight:bold; cursor:pointer;';
            loginBtn.textContent = '🔑 Cliquer pour se connecter';
            loginBtn.onclick = () => {
                if (chatInput) {
                    chatInput.value = ':login';
                    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                    chatInput.focus();
                    const enterEv = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
                    chatInput.dispatchEvent(enterEv);
                }
                emojiPanel.classList.remove('active');
            };

            const note = document.createElement('div');
            note.style.cssText = 'font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 15px;';
            note.textContent = 'Note: Cela enverra le message ":login" dans le chat pour identifier votre pseudo.';

            div.appendChild(info);
            div.appendChild(loginBtn);
            div.appendChild(note);
            emojiPanel.appendChild(div);
        }
    }

    function renderEmojiList() {
        const list = document.createElement('div');
        list.className = 'emoji-ext-list';

        Object.keys(EMOJI_MAPPING).forEach(key => {
            const url = EMOJI_MAPPING[key];
            const isTargetGif = typeof url === 'object' ? isGif(url.url) : isGif(url);

            if ((currentTab === 'gifs' && isTargetGif) || (currentTab === 'emojis' && !isTargetGif)) {
                const img = document.createElement('img');
                img.src = isTargetGif ? url.url : url;
                img.className = 'emoji-ext-item';
                img.title = isTargetGif ? `${key} (Ajouté par ${url.user})` : key;
                img.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    insertEmoji(key);
                    emojiPanel.classList.remove('active');
                };
                list.appendChild(img);
            }
        });

        if (list.childNodes.length === 0) {
            const empty = document.createElement('div');
            empty.style.color = 'rgba(255,255,255,0.3)';
            empty.style.width = '100%';
            empty.style.textAlign = 'center';
            empty.style.padding = '20px';
            empty.innerText = 'Vide...';
            list.appendChild(empty);
        }

        emojiPanel.appendChild(list);
    }

    function renderRealEmojiList() {
        const list = document.createElement('div');
        list.className = 'emoji-ext-list';
        list.style.fontSize = '24px';
        list.style.justifyContent = 'center';

        Object.keys(BYPASS_EMOJI_MAPPING).forEach(emoji => {
            const img = document.createElement('img');
            img.src = getTwemojiUrl(emoji);
            img.className = 'emoji-ext-item-static';
            img.title = BYPASS_EMOJI_MAPPING[emoji];
            img.style.cursor = 'pointer';
            img.style.padding = '5px';
            img.style.width = '32px';
            img.style.height = '32px';
            img.style.objectFit = 'contain';
            img.onclick = (e) => {
                e.stopPropagation();
                const alias = BYPASS_EMOJI_MAPPING[emoji] || emoji;
                insertEmoji(alias);
                emojiPanel.classList.remove('active');
            };
            list.appendChild(img);
        });

        emojiPanel.appendChild(list);
    }

    /**
     * Renders a 4-digit PIN prompt for admins
     */
    function renderPinPrompt() {
        const div = document.createElement('div');
        div.style.padding = '15px';
        div.style.textAlign = 'center';
        div.onclick = (e) => e.stopPropagation();

        div.innerHTML = `
            <div style="font-size: 14px; font-weight: bold; margin-bottom: 10px; color: #4a90e2;">🔐 Sécurité Admin</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 15px;">
                Veuillez entrer votre code PIN à 4 chiffres pour accéder aux fonctions d'ajout.
            </div>
            <div style="display: flex; gap: 5px; justify-content: center; margin-bottom: 15px;">
                <input type="password" id="ext-pin-digit" maxlength="4" style="width: 80px; text-align: center; font-size: 20px; letter-spacing: 5px; background: rgba(0,0,0,0.3); border: 1px solid #4a90e2; color: white;">
            </div>
            <button id="ext-save-pin" style="background: #4a90e2; color: white; border: none; padding: 8px 20px; border-radius: 4px; font-weight: bold; cursor: pointer;">
                Valider
            </button>
        `;

        emojiPanel.appendChild(div);

        const pinInput = div.querySelector('#ext-pin-digit');
        const saveBtn = div.querySelector('#ext-save-pin');

        const validate = () => {
            const val = pinInput.value.trim();
            if (val.length === 4 && /^\d+$/.test(val)) {
                localStorage.setItem('habbo_ext_pin', val);
                refreshPanel();
            } else {
                alert("Le PIN doit contenir exactement 4 chiffres.");
            }
        };

        saveBtn.onclick = validate;
        pinInput.onkeydown = (e) => {
            if (e.key === 'Enter') validate();
        };

        setTimeout(() => pinInput.focus(), 100);
    }

    function renderAddTab() {
        if (!currentUser) {
            renderIdentityTab();
            return;
        }

        const currentPin = localStorage.getItem('habbo_ext_pin');
        // Only require PIN for 'adham' to act as admin
        if (currentUser.toLowerCase() === 'adham' && !currentPin) {
            renderPinPrompt();
            return;
        }

        const form = document.createElement('div');
        form.className = 'emoji-ext-admin-form';
        form.innerHTML = `
            <div style="font-size: 13px; font-weight: bold; margin-bottom: 5px; color: #4a90e2; display: flex; justify-content: space-between; align-items: center;">
                <span>➕ Ajouter un GIF</span>
                ${currentUser.toLowerCase() === 'adham' ? '<span id="ext-reset-pin" style="font-size: 10px; color: rgba(255,255,255,0.3); cursor: pointer; text-decoration: underline;">🔒 Reset PIN</span>' : ''}
            </div>
            
            <div style="margin-bottom: 10px;">
                <input type="text" id="ext-new-code" placeholder="Code du GIF (ex: :dance:)" style="width: 100%; box-sizing: border-box;">
            </div>

            <div class="emoji-ext-add-actions">
                <div class="emoji-ext-action-btn" id="ext-btn-link" title="Ajouter via un lien">🔗</div>
                <div class="emoji-ext-action-btn" id="ext-btn-upload" title="Uploader depuis mon PC">📁</div>
            </div>

            <div id="ext-url-container" class="emoji-ext-url-container">
                <input type="text" id="ext-new-url" placeholder="Coller l'URL du GIF ici" style="width: 100%; box-sizing: border-box;">
            </div>

            <input type="file" id="ext-file-input" accept="image/gif,image/png,image/jpeg" style="display: none;">

            <button id="ext-add-btn" style="margin-top: 10px; width: 100%;">🚀 Valider l'ajout</button>
            <div id="ext-upload-status" style="font-size: 10px; color: #4a90e2; margin-top: 5px; display:none; text-align:center;">Traitement en cours...</div>

            <div style="font-size: 13px; font-weight: bold; margin: 15px 0 10px 0; color: #d9534f; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px;">🗑️ Gérer mes GIFs</div>
            <div id="ext-manage-list" style="display: flex; flex-direction: column; gap: 5px; max-height: 150px; overflow-y: auto;">
                <!-- Deletion list will be rendered here -->
            </div>
        `;

        form.onclick = (e) => e.stopPropagation();
        emojiPanel.appendChild(form);

        const btnLink = form.querySelector('#ext-btn-link');
        const btnUpload = form.querySelector('#ext-btn-upload');
        const urlContainer = form.querySelector('#ext-url-container');
        const fileInput = form.querySelector('#ext-file-input');
        const addBtn = form.querySelector('#ext-add-btn');
        const statusMsg = form.querySelector('#ext-upload-status');
        const codeInput = form.querySelector('#ext-new-code');
        const urlInput = form.querySelector('#ext-new-url');
        const resetPin = form.querySelector('#ext-reset-pin');

        if (resetPin) {
            resetPin.onclick = (e) => {
                e.stopPropagation();
                if (confirm("Réinitialiser votre code PIN admin ?")) {
                    localStorage.removeItem('habbo_ext_pin');
                    refreshPanel();
                }
            };
        }

        let uploadMode = 'link'; // 'link' or 'file'

        btnLink.onclick = () => {
            uploadMode = 'link';
            btnLink.classList.add('active');
            btnUpload.classList.remove('active');
            urlContainer.classList.add('show');
            fileInput.value = ''; // Reset file input
        };

        btnUpload.onclick = () => {
            uploadMode = 'file';
            btnUpload.classList.add('active');
            btnLink.classList.remove('active');
            urlContainer.classList.remove('show');
            fileInput.click();
        };

        fileInput.onchange = () => {
            if (fileInput.files.length > 0) {
                const name = fileInput.files[0].name;
                statusMsg.innerText = `Fichier sélectionné : ${name}`;
                statusMsg.style.display = 'block';
            }
        };

        const manageList = form.querySelector('#ext-manage-list');
        Object.keys(EMOJI_MAPPING).forEach(key => {
            const data = EMOJI_MAPPING[key];
            const url = typeof data === 'object' ? data.url : data;
            const creator = typeof data === 'object' ? (data.user || 'System') : 'System';

            if (!isGif(url)) return;

            // Only show if user owns it OR is admin (Adham)
            const isOwner = creator.toLowerCase() === currentUser.toLowerCase();
            const isAdham = currentUser.toLowerCase() === 'adham';

            if (!isOwner && !isAdham) return;

            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 5px; border-radius: 4px;';

            const span = document.createElement('span');
            span.style.cssText = 'font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;';
            span.textContent = `${key} ${isAdham && !isOwner ? `(${data.user})` : ''}`;

            const delBtn = document.createElement('button');
            delBtn.className = 'ext-del-btn';
            delBtn.style.cssText = 'background: none; border: none; color: #d9534f; cursor: pointer; font-size: 12px;';
            delBtn.textContent = '🗑️';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Supprimer ${key} ?`)) {
                    const success = await deleteEmojiFromSupabase(key);
                    if (success) {
                        await syncEmojis();
                        refreshPanel();
                    } else {
                        alert(`Erreur lors de la suppression de "${key}".\n\nNote: Seul le créateur ou l'admin peut supprimer un GIF.`);
                    }
                }
            };

            row.appendChild(span);
            row.appendChild(delBtn);
            manageList.appendChild(row);
        });

        addBtn.onclick = async () => {
            const code = codeInput.value.trim();
            const url = urlInput.value.trim();
            const file = fileInput.files[0];

            if (!code) {
                alert("Veuillez entrer un code (ex: :dance:)");
                statusMsg.style.display = 'none';
                addBtn.disabled = false;
                return;
            }

            // Strict Code Sanitization: MUST start and end with ':'
            if (!/^:[a-zA-Z0-9_\-]+:$/.test(code)) {
                alert("Format invalide : Le code doit obligatoirement commencer et finir par ':' (ex: :mon_gif:)");
                statusMsg.style.display = 'none';
                addBtn.disabled = false;
                return;
            }

            // URL Validation for security
            if (uploadMode === 'link' && !url.startsWith('https://')) {
                alert("Sécurité : L'URL doit commencer par https://");
                statusMsg.style.display = 'none';
                addBtn.disabled = false;
                return;
            }

            statusMsg.style.display = 'block';
            addBtn.disabled = true;

            let finalUrl = null;

            if (uploadMode === 'file' && file) {
                statusMsg.innerText = "Téléchargement du fichier...";
                finalUrl = await uploadToSupabaseStorage(file);
                if (!finalUrl) {
                    statusMsg.innerText = "Erreur lors de l'upload du fichier.";
                    addBtn.disabled = false;
                    return;
                }
            } else if (uploadMode === 'link' && url) {
                finalUrl = url;
            }

            if (finalUrl) {
                statusMsg.innerText = "Enregistrement dans la base...";
                const success = await saveEmojiToSupabase(code, finalUrl);
                if (success) {
                    await syncEmojis();
                    currentTab = 'gifs';
                    refreshPanel();
                } else {
                    statusMsg.innerText = "Erreur (Code déjà utilisé ?)";
                    setTimeout(() => {
                        statusMsg.style.display = 'none';
                        addBtn.disabled = false;
                    }, 2000);
                }
            } else {
                statusMsg.innerText = uploadMode === 'file' ? "Aucun fichier sélectionné." : "Veuillez entrer une URL.";
                addBtn.disabled = false;
            }
        };
    }


    /**
     * Uploads a file to Supabase Storage
     */
    async function uploadToSupabaseStorage(file) {
        try {
            const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
            const response = await fetch(`${SUPABASE_URL}/storage/v1/object/gifs/${fileName}`, {
                method: 'POST',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": file.type
                },
                body: file
            });

            if (response.ok) {
                return `${SUPABASE_URL}/storage/v1/object/public/gifs/${fileName}`;
            }
            const err = await response.json();
            console.error("[HabboCityEmoji] Storage Error:", err);
            return null;
        } catch (e) {
            console.error("[HabboCityEmoji] Upload Exception:", e);
            return null;
        }
    }

    /**
     * Supprime un emoji de Supabase
     */
    async function deleteEmojiFromSupabase(code) {
        try {
            console.log(`[HabboCityEmoji] Tentative de suppression de : ${code}`);
            const response = await fetch(`${SUPABASE_URL}/rest/v1/emojis?code=eq.${encodeURIComponent(code)}`, {
                method: 'DELETE',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "x-habbo-user": currentUser || '',
                    "x-admin-pin": localStorage.getItem('habbo_ext_pin') || ''
                }
            });
            if (!response.ok) {
                const err = await response.text();
                console.error(`[HabboCityEmoji] Erreur suppression (${response.status}):`, err);
            }
            return response.ok;
        } catch (e) {
            console.error("[HabboCityEmoji] Exception suppression :", e);
            return false;
        }
    }

    /**
     * Envoie un nouvel emoji à Supabase
     */
    async function saveEmojiToSupabase(code, url) {
        try {
            console.log(`[HabboCityEmoji] Enregistrement de ${code}...`);
            const response = await fetch(`${SUPABASE_URL}/rest/v1/emojis`, {
                method: 'POST',
                headers: {
                    "apikey": SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                    "x-habbo-user": currentUser || '',
                    "x-admin-pin": localStorage.getItem('habbo_ext_pin') || ''
                },
                body: JSON.stringify({ code, url, created_by: currentUser })
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

    /**
     * Inserts the emoji code into the input field.
     */
    function insertEmoji(code) {
        if (!chatInput) return;
        const start = chatInput.selectionStart;
        const end = chatInput.selectionEnd;
        const text = chatInput.value;
        const isInputEmpty = text.trim() === '';

        chatInput.value = text.substring(0, start) + code + text.substring(end);
        chatInput.focus();
        chatInput.selectionStart = chatInput.selectionEnd = start + code.length;

        // Trigger React change event if needed
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Auto-send if input was empty
        if (isInputEmpty) {
            console.log("[HabboCityEmoji] Auto-sending empty input...");
            const enterEv = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
            chatInput.dispatchEvent(enterEv);
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
     * Observes the chat history to replace placeholders with images.
     */
    function setupChatObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        parseNodeForPlaceholders(node);
                    }
                });
            });
        });

        // Start observing the whole body to find the chat container dynamically
        observer.observe(document.body, { childList: true, subtree: true });

        // Also parse existing content
        parseNodeForPlaceholders(document.body);
    }

    /**
     * Recursively searches for placeholders in text nodes and replaces them.
     */
    function parseNodeForPlaceholders(node) {
        // We look for elements that might contain chat text
        // Nitro chat bubbles often have specific classes, but we can search broadly
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
        let textNode;
        const nodesToReplace = [];

        while (textNode = walker.nextNode()) {
            const text = textNode.nodeValue;

            // Check for GIF codes or Unicode Aliases
            // GIF codes and Aliases both start and end with ':'
            const hasPotentialCode = text.includes(':');

            if (hasPotentialCode) {
                nodesToReplace.push(textNode);
            }

            // CHECK FOR LOGIN COMMAND
            if (text.includes(':login')) {
                handleLoginBubble(textNode.parentNode, text);
            }
        }

        nodesToReplace.forEach(node => {
            const content = node.nodeValue;

            // Regex to find :code: patterns
            const codeRegex = /:[a-z_0-9\-]+:/g;

            let matches = [];
            let match;

            while ((match = codeRegex.exec(content)) !== null) {
                const code = match[0];

                // Check if it's a GIF
                if (EMOJI_MAPPING[code]) {
                    matches.push({ index: match.index, length: code.length, type: 'gif', value: code, url: EMOJI_MAPPING[code] });
                }
                // Check if it's a Unicode emoji alias
                else if (REVERSE_BYPASS_MAPPING[code]) {
                    matches.push({ index: match.index, length: code.length, type: 'unicode', value: REVERSE_BYPASS_MAPPING[code] });
                }
            }

            // Sort matches by index to parse linearly
            matches.sort((a, b) => a.index - b.index);

            if (matches.length === 0) return;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            matches.forEach(m => {
                // Add text before match
                fragment.appendChild(document.createTextNode(content.substring(lastIndex, m.index)));

                if (m.type === 'gif') {
                    const data = EMOJI_MAPPING[m.value];
                    const url = data ? data.url : null;
                    if (url) {
                        const img = document.createElement('img');
                        img.src = url;
                        img.className = 'emoji-ext-img';
                        img.title = `${m.value} (Ajouté par ${data.user})`;
                        img.onload = () => console.log(`[HabboCityEmoji] image loaded: ${url}`);
                        img.onerror = () => {
                            console.error(`[HabboCityEmoji] IMAGE LOAD ERROR: ${url}`);
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
                    const url = getTwemojiUrl(m.value);
                    if (url) {
                        const img = document.createElement('img');
                        img.src = url;
                        img.className = 'emoji-ext-unicode-img';
                        img.title = BYPASS_EMOJI_MAPPING[m.value] || m.value;
                        img.onerror = () => {
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

    // --- INITIALIZATION ---

    loadIdentity();

    // Periodically check for the input if it's not present (Nitro is a SPA)
    setInterval(() => {
        injectEmojiButton();
    }, 2000);
    setupChatObserver();

})();
