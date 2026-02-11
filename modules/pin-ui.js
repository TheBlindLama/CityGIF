(function (global) {
    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
                    <button type="button" id="ext-pin-back" style="height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#111827;color:white;cursor:pointer;">Back</button>
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
            } catch (e) {
                // no-op
            }

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
                e.preventDefault();
                e.stopPropagation();
            };

            renderStep();
            renderDisplay();
            setTimeout(() => modal.focus(), 0);
        });
    }

    global.CityGifPinUI = Object.freeze({
        requestPinInPluginUI
    });
})(window);
