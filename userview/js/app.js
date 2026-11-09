const App = {
    socket: null,
    reconnectInterval: 1000,
    currentView: 'view-loading',
    ipAddress: '---.---.---.---',
    isConnectedToRemote: false,
    hardwareConfig: {
        sound_enabled: true,
        beep_tone: 2,
        beep_duration: 2,
        led_mode: 'auto',
        live_preview_enabled: true,
        roll_boxes_1_to_10: true
    },

    init() {
        this.setStatus("Connecting to Server...");
        this.connect();
        this.setupKeyHandlers();
        this.setupWifiHandlers();
        this.setupSettingsHandlers();
        this.initActivityMonitor();
    },

    initActivityMonitor() {
        const body = document.body;
        const panels = document.querySelectorAll('.glass-panel');
        let activityTimeout;

        const TIMEOUT_READY = 30000;

        const goDim = () => {
            if (this.currentView === 'view-scanning' || this.currentView === 'view-settings') return;

            body.classList.remove('user-active');
            body.classList.remove('show-cursor');
            panels.forEach(p => p.classList.add('dimmed'));
        };

        const goActive = () => {
            body.classList.add('user-active');
            body.classList.add('show-cursor');
            panels.forEach(p => p.classList.remove('dimmed'));

            clearTimeout(activityTimeout);

            if (this.currentView === 'view-scanning' || this.currentView === 'view-settings') {
                return;
            }

            activityTimeout = setTimeout(goDim, TIMEOUT_READY);
        };

        this.triggerActivity = goActive;
        goActive();

        ['mousemove', 'click', 'touchstart', 'keydown'].forEach(evt => {
            document.addEventListener(evt, goActive);
        });
    },

    setStatus(msg) {
        const el = document.querySelector('#view-loading .status-text');
        if (el) el.innerText = msg;
    },

    connect() {
        console.log("Connecting to WebSocket...");
        const host = window.location.hostname || 'localhost';
        this.socket = new WebSocket(`ws://${host}:8888/ws`);

        this.socket.onopen = () => {
            console.log("WebSocket Connected");
            this.setStatus("Syncing...");
            this.send({ action: "GET_SYSTEM_INFO" });
            this.send({ action: "GET_CONFIG" });
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (e) {
                console.error("Error parsing message", e);
            }
        };

        this.socket.onclose = () => {
            console.warn("WebSocket Disconnected. Reconnecting...");
            this.switchView('view-loading');
            setTimeout(() => this.connect(), this.reconnectInterval);
        };

        this.socket.onerror = (err) => {
            console.error("WebSocket Error", err);
        };
    },

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        }
    },

    handleMessage(data) {
        switch (data.type) {
            case 'log':
                console.log("Server Log:", data.message);
                break;

            case 'system_info':
                this.updateSystemInfo(data);
                break;

            case 'config':
                if (data.config) {
                    this.hardwareConfig = Object.assign(this.hardwareConfig, data.config);
                    this.syncSettingsForm();
                }
                break;

            case 'wifi_list':
                this.renderWifiList(data.networks);
                break;

            case 'wifi_status':
                this.handleWifiStatus(data);
                break;

            case 'client_connection_status':
                this.handleClientConnection(data.connected);
                break;

            case 'status':
                this.handleStatusUpdate(data);
                break;

            case 'roll_state':
                this.handleRollState(data);
                break;

            case 'preview':
                this.handlePreviewFrame(data);
                break;

            case 'result':
                this.switchView('view-ready');
                break;
        }
    },

    handleRollState(data) {
        const scanInstr = document.getElementById('scan-instruction');
        if (scanInstr && data.message) {
            scanInstr.innerText = data.message;
        }
    },

    handlePreviewFrame(data) {
        const previewWrapper = document.getElementById('live-preview-wrapper');
        const previewImg = document.getElementById('live-preview-img');
        if (!this.hardwareConfig.live_preview_enabled) {
            if (previewWrapper) previewWrapper.classList.add('hidden');
            return;
        }
        if (previewWrapper) previewWrapper.classList.remove('hidden');
        if (previewImg && data.image) {
            previewImg.src = `data:image/bmp;base64,${data.image}`;
        }
    },

    updateSystemInfo(data) {
        const ipDisplay = document.getElementById('device-ip');
        this.ipAddress = data.ip || '---.---.---.---';
        ipDisplay.innerText = this.ipAddress;

        const qrContainer = document.getElementById('qrcode');
        if (qrContainer && this.ipAddress !== '---.---.---.---') {
            qrContainer.innerHTML = '';
            try {
                if (window.QRCode) {
                    new QRCode(qrContainer, {
                        text: this.ipAddress,
                        width: 128,
                        height: 128,
                        colorDark: "#000000",
                        colorLight: "#ffffff",
                        correctLevel: QRCode.CorrectLevel.M
                    });
                }
            } catch (e) {
                console.error("QR Generation failed", e);
            }
        }

        if (!data.connected && !this.ipAddress.startsWith("192") && !this.ipAddress.startsWith("10") && !this.ipAddress.startsWith("172")) {
            if (data.wifi_needed || data.ip === '127.0.0.1' || !data.ip) {
                this.switchView('view-wifi');
                this.send({ action: "WIFI_SCAN" });
                return;
            }
        }

        if (this.currentView === 'view-loading' || this.currentView === 'view-wifi') {
            this.switchView('view-ready');
        }
    },

    handleClientConnection(isConnected) {
        this.isConnectedToRemote = isConnected;
        const statusText = document.getElementById('connection-status');
        const dot = document.querySelector('.dot');

        if (isConnected) {
            statusText.innerText = "Target Connected";
            statusText.style.color = "var(--success-color)";
            dot.classList.add('connected');
        } else {
            statusText.innerText = "Waiting for Client";
            statusText.style.color = "var(--text-secondary)";
            dot.classList.remove('connected');
        }
    },

    handleStatusUpdate(data) {
        const msg = (typeof data === 'string') ? data : data.message;
        const param = (typeof data === 'object') ? data.scan_param : null;

        const el = document.querySelector('#view-loading .status-text');
        if (el) el.innerText = msg;

        const scanInstr = document.getElementById('scan-instruction');
        if (scanInstr) scanInstr.innerText = msg;

        if (msg.includes("Starting Capture")) {
            const previewImg = document.getElementById('live-preview-img');
            if (previewImg) previewImg.src = '';
            const previewWrapper = document.getElementById('live-preview-wrapper');
            if (previewWrapper) {
                if (this.hardwareConfig.live_preview_enabled) {
                    previewWrapper.classList.remove('hidden');
                } else {
                    previewWrapper.classList.add('hidden');
                }
            }
            this.switchView('view-scanning');
            if (param !== undefined && param !== null) {
                this.updateScanVisualizer(param);
            } else {
                this.updateScanVisualizer(null);
            }
        } else if (msg.includes("Device Initialized")) {
            if (this.currentView !== 'view-scanning' && this.currentView !== 'view-settings') {
                this.switchView('view-ready');
            }
        } else if (msg.includes("Capture Cancelled") || msg.includes("Capture Timed Out")) {
            this.switchView('view-ready');
        }
    },

    updateScanVisualizer(param) {
        const img = document.getElementById('hand-image');
        if (!img) return;

        let p = parseInt(param);

        if (isNaN(p)) {
            if (param === 'R_SLAP') p = 13;
            else if (param === 'L_SLAP') p = 14;
            else if (param === 'THUMBS') p = 15;
            else p = 2;
        }

        let side = 'left';
        let finger = '';
        let text = "Finger";
        if ((p >= 1 && p <= 5) || p === 13 || p === 15) {
            side = 'right';
        }

        switch (p) {
            case 1: finger = 'thumb'; text = "Right Thumb (Roll)"; break;
            case 2: finger = 'index'; text = "Right Index (Roll)"; break;
            case 3: finger = 'middle'; text = "Right Middle (Roll)"; break;
            case 4: finger = 'ring'; text = "Right Ring (Roll)"; break;
            case 5: finger = 'little'; text = "Right Little (Roll)"; break;

            case 6: finger = 'thumb'; text = "Left Thumb (Roll)"; break;
            case 7: finger = 'index'; text = "Left Index (Roll)"; break;
            case 8: finger = 'middle'; text = "Left Middle (Roll)"; break;
            case 9: finger = 'ring'; text = "Left Ring (Roll)"; break;
            case 10: finger = 'little'; text = "Left Little (Roll)"; break;

            case 13: finger = 'four'; text = "Right 4 Fingers (Slap)"; break;
            case 14: finger = 'four'; text = "Left 4 Fingers (Slap)"; break;

            case 15:
                side = 'right';
                finger = 'thumb';
                text = "Both Thumbs (Flat)";
                break;

            default:
                side = 'right';
                finger = 'index';
                text = "Right Index";
        }

        const filename = `hand-${side}-${finger}.png`;
        const fullSrc = `/assets/hand/${filename}?v=${new Date().getTime()}`;

        img.src = fullSrc;
        img.alt = filename;

        const titleEl = document.getElementById('scan-title');
        if (titleEl) titleEl.innerText = "Scanning " + text;
    },

    switchView(viewId) {
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        const target = document.getElementById(viewId);
        if (target) target.classList.add('active');
        this.currentView = viewId;

        if (this.triggerActivity) {
            this.triggerActivity();
        }
    },

    setupKeyHandlers() {
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.altKey && (event.key.toLowerCase() === 'q')) {
                this.send({ action: "EXIT_APP" });
                try {
                    window.close();
                } catch (e) {}
            }
        });
    },

    syncSettingsForm() {
        const soundEl = document.getElementById('cfg-sound-enabled');
        const toneEl = document.getElementById('cfg-beep-tone');
        const durEl = document.getElementById('cfg-beep-duration');
        const ledEl = document.getElementById('cfg-led-mode');
        const prevEl = document.getElementById('cfg-live-preview');
        const rollEl = document.getElementById('cfg-roll-1-10');

        if (soundEl) soundEl.checked = !!this.hardwareConfig.sound_enabled;
        if (toneEl) toneEl.value = String(this.hardwareConfig.beep_tone ?? 2);
        if (durEl) durEl.value = String(this.hardwareConfig.beep_duration ?? 2);
        if (ledEl) ledEl.value = this.hardwareConfig.led_mode || 'auto';
        if (prevEl) prevEl.checked = !!this.hardwareConfig.live_preview_enabled;
        if (rollEl) rollEl.checked = !!this.hardwareConfig.roll_boxes_1_to_10;
    },

    setupSettingsHandlers() {
        const openBtn = document.getElementById('btn-open-settings');
        const backBtn = document.getElementById('btn-settings-back');
        const saveBtn = document.getElementById('btn-settings-save');
        const testBeepBtn = document.getElementById('btn-test-beep');

        if (openBtn) {
            openBtn.addEventListener('click', () => {
                this.syncSettingsForm();
                this.switchView('view-settings');
            });
        }

        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.switchView('view-ready');
            });
        }

        if (testBeepBtn) {
            testBeepBtn.addEventListener('click', () => {
                const cfg = this.readSettingsForm();
                this.send({ action: "UPDATE_CONFIG", config: cfg });
                this.send({ action: "TEST_BEEP" });
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const cfg = this.readSettingsForm();
                this.hardwareConfig = Object.assign(this.hardwareConfig, cfg);
                this.send({ action: "UPDATE_CONFIG", config: cfg });
                this.switchView('view-ready');
            });
        }
    },

    readSettingsForm() {
        return {
            sound_enabled: document.getElementById('cfg-sound-enabled')?.checked ?? true,
            beep_tone: parseInt(document.getElementById('cfg-beep-tone')?.value ?? "2"),
            beep_duration: parseInt(document.getElementById('cfg-beep-duration')?.value ?? "2"),
            led_mode: document.getElementById('cfg-led-mode')?.value ?? "auto",
            live_preview_enabled: document.getElementById('cfg-live-preview')?.checked ?? true,
            roll_boxes_1_to_10: document.getElementById('cfg-roll-1-10')?.checked ?? true
        };
    },

    setupWifiHandlers() {
        const listContainer = document.getElementById('wifi-list-container');
        const listContent = document.getElementById('wifi-list');
        const formContainer = document.getElementById('wifi-form-container');
        const passwordInput = document.getElementById('wifi-password');

        const btnBack = document.getElementById('btn-wifi-back');
        const btnConnect = document.getElementById('btn-wifi-connect');

        const keyboardView = document.getElementById('view-keyboard');
        const keyboardInput = document.getElementById('keyboard-input');
        const keyboardCloseBtn = document.getElementById('btn-keyboard-close');
        const keyboardCancelBtn = document.getElementById('btn-keyboard-cancel');

        let selectedSsid = null;
        let isConnectingMode = false;
        let keyboard = null;

        const updateNav = () => {
            if (isConnectingMode) {
                listContainer.classList.add('hidden');
                formContainer.classList.remove('hidden');
                btnBack.querySelector('span').innerText = 'Cancel';
                btnConnect.classList.remove('hidden');
            } else {
                listContainer.classList.remove('hidden');
                formContainer.classList.add('hidden');
                btnBack.querySelector('span').innerText = 'Back';
                btnConnect.classList.add('hidden');
            }
        };

        const openKeyboard = (initialValue) => {
            keyboardView.classList.add('active');
            keyboardInput.value = initialValue || "";

            if (!keyboard && window.SimpleKeyboard) {
                const SimpleKeyboard = window.SimpleKeyboard.default;
                keyboard = new SimpleKeyboard({
                    onChange: input => {
                        keyboardInput.value = input;
                    },
                    onKeyPress: button => {
                        if (button === "{enter}") closeKeyboard(true);
                        if (button === "{escape}") closeKeyboard(false);
                    },
                    theme: "hg-theme-default hg-layout-default myTheme",
                    layout: {
                        default: [
                            "` 1 2 3 4 5 6 7 8 9 0 - = {bksp}",
                            "q w e r t y u i o p [ ] \\",
                            "a s d f g h j k l ; ' {enter}",
                            "{shift} z x c v b n m , . / {shift}",
                            "{space}"
                        ],
                        shift: [
                            "~ ! @ # $ % ^ & * ( ) _ + {bksp}",
                            "Q W E R T Y U I O P { } |",
                            "A S D F G H J K L : \" {enter}",
                            "{shift} Z X C V B N M < > ? {shift}",
                            "{space}"
                        ]
                    }
                });
            } else if (keyboard) {
                keyboard.setInput(initialValue || "");
            }
        };

        const closeKeyboard = (save) => {
            keyboardView.classList.remove('active');
            if (save) {
                passwordInput.value = keyboardInput.value;
            }
        };

        passwordInput.addEventListener('click', () => {
            openKeyboard(passwordInput.value);
        });

        keyboardCloseBtn.addEventListener('click', () => closeKeyboard(true));
        keyboardCancelBtn.addEventListener('click', () => closeKeyboard(false));

        btnBack.addEventListener('click', () => {
            if (isConnectingMode) {
                isConnectingMode = false;
                updateNav();
            } else {
                this.switchView('view-ready');
            }
        });

        btnConnect.addEventListener('click', () => {
            const password = passwordInput.value;
            if (selectedSsid) {
                this.switchView('view-loading');
                this.send({
                    action: "WIFI_CONNECT",
                    ssid: selectedSsid,
                    password: password
                });
            }
        });

        listContent.addEventListener('click', (e) => {
            const item = e.target.closest('.wifi-item');
            if (item) {
                selectedSsid = item.dataset.ssid;
                document.getElementById('selected-ssid').innerText = selectedSsid;
                passwordInput.value = '';

                isConnectingMode = true;
                updateNav();
            }
        });

        const openWifiBtn = document.getElementById('btn-open-wifi');
        if (openWifiBtn) {
            openWifiBtn.addEventListener('click', () => {
                this.switchView('view-wifi');
                isConnectingMode = false;
                updateNav();
                this.send({ action: "WIFI_SCAN" });
            });
        }
    },

    renderWifiList(networks) {
        const listContainer = document.getElementById('wifi-list');
        listContainer.innerHTML = '';

        if (!networks || networks.length === 0) {
            listContainer.innerHTML = '<div style="padding:10px; opacity:0.7">No networks found. Retrying...</div>';
            setTimeout(() => this.send({ action: "WIFI_SCAN" }), 5000);
            return;
        }

        networks.forEach(net => {
            const div = document.createElement('div');
            div.className = 'wifi-item';
            div.dataset.ssid = net.ssid;
            div.innerHTML = `
                <span>${net.ssid}</span>
                <span style="opacity:0.5">${net.signal || ''}%</span>
            `;
            listContainer.appendChild(div);
        });
    },

    handleWifiStatus(data) {
        if (data.connected) {
            setTimeout(() => this.send({ action: "GET_SYSTEM_INFO" }), 2000);
        } else {
            alert("Failed to connect: " + (data.message || "Unknown error"));
            this.switchView('view-wifi');
            this.send({ action: "WIFI_SCAN" });
        }
    }
};

window.addEventListener('load', () => App.init());
