/*
   Simulasi Peringatan Dini Banjir di Lingkungan FKIP UNMUL
   Terhubung langsung ke Firebase Realtime Database (iotesp32-916ac)
   Perangkat: ESP32, Sensor Ultrasonik AJ-SR04M, Pompa Pengisi Air (1 cm, 2 cm, 3 cm), Buzzer, 3 LED
*/

(function () {
    'use strict';

    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyBZDnWAdGI_SmPBF43SxYOpuwNs4S5emjs",
        authDomain: "fkipunmul.firebaseapp.com",
        databaseURL: "https://fkipunmul-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "fkipunmul",
        storageBucket: "fkipunmul.firebasestorage.app",
        messagingSenderId: "189604273680",
        appId: "1:189604273680:web:8c95aae4dfb82b7f797495",
        measurementId: "G-MR6WHRR8V6"
    };
    const DEVICE_BASE = 'devices/esp32_001';

    const STORAGE_KEYS = {
        THRESHOLDS: 'fkip_ews_thresholds_v2',
        THEME: 'fkip_ews_theme_v1'
    };

    const state = {
        maxWater: 5,
        thresholdWaspada: 2,
        thresholdBahaya: 3,

        // Live telemetry from Firebase (AJ-SR04M sensor)
        hasReceivedData: false,
        waterLevel: null,
        sensorDistance: null,
        lastWaterLevel: null,
        lastUpdateTimestamp: null,
        rateOfChange: 0,

        // Hardware actuator states (Pump fills water to target level 1cm, 2cm, 3cm or manual ON/OFF)
        pumpMode: 'manual', // 'target' | 'manual'
        targetLevelCm: null, // 1 | 2 | 3 | null
        pumpActive: false,
        buzzerActive: false,
        muteBuzzer: false,
        ledGreen: false,
        ledYellow: false,
        ledRed: false,

        connectionState: 'connecting',
        readings: [],
        history: [],
        warningLog: [],
        lastStatus: null,
        isDarkMode: false
    };

    let firebaseApp = null;
    let firebaseDb = null;
    let rootRef = null;
    let connectedRef = null;
    let restPollTimer = null;
    let waterChart = null;
    let lastRecordedLevel = null;
    let lastRecordedTimeMs = 0;

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        sidebar: $('#sidebar'),
        menuToggle: $('#menu-toggle'),
        overlay: $('#sidebar-overlay'),
        navItems: $$('.nav-item'),
        sections: $$('.section'),

        // Banner & System State
        connectionBadge: $('#connection-badge'),
        connectionDot: $('#connection-dot'),
        connectionText: $('#connection-text'),
        currentTime: $('#current-time'),
        systemStateBanner: $('#system-state-banner'),
        stateBannerIcon: $('#state-banner-icon'),
        stateBannerTitle: $('#state-banner-title'),
        stateBannerDesc: $('#state-banner-desc'),
        lastSyncInfo: $('#last-sync-info'),

        // Dashboard Water Level
        waterFill: $('#water-fill'),
        waterLevelValue: $('#water-level-value'),
        sensorDistanceValue: $('#sensor-distance-value'),
        targetLevelDisplay: $('#target-level-display'),
        levelBadge: $('#level-badge'),
        waterStatusBadge: $('#water-status-badge'),
        statusIcon: $('#status-icon'),
        statusText: $('#water-status-text'),
        statusDesc: $('#status-description'),
        waspadaLine: $('#waspada-line'),
        bahayaLine: $('#bahaya-line'),

        // Dashboard Pump Quick Control (1cm, 2cm, 3cm target buttons & manual ON/OFF)
        dashPumpPill: $('#dash-pump-pill'),
        targetBtns: $$('.target-btn'),
        pumpModeHint: $('#pump-mode-hint'),
        btnDashPumpOn: $('#btn-dash-pump-on'),
        btnDashPumpOff: $('#btn-dash-pump-off'),
        levelNormal: $('#level-normal'),
        levelWaspada: $('#level-waspada'),
        levelBahaya: $('#level-bahaya'),
        rangeNormalText: $('#range-normal-text'),
        rangeWaspadaText: $('#range-waspada-text'),
        rangeBahayaText: $('#range-bahaya-text'),

        // Dashboard Hardware Status & Stats
        espBadge: $('#esp-badge'),
        espDeviceDesc: $('#esp-device-desc'),
        ultrasonicBadge: $('#ultrasonic-badge'),
        ultrasonicDesc: $('#ultrasonic-desc'),
        ledBadge: $('#led-badge'),
        ledStatusText: $('#led-status-text'),
        buzzerBadge: $('#buzzer-badge'),
        buzzerDesc: $('#buzzer-desc'),
        pumpBadge: $('#pump-badge'),
        pumpDesc: $('#pump-desc'),
        statMax: $('#stat-max'),
        statMin: $('#stat-min'),
        statAvg: $('#stat-avg'),
        statReadings: $('#stat-readings'),
        btnResetStats: $('#btn-reset-stats'),

        // Section 2: Kontrol Pompa & Maket
        btnSimPumpOn: $('#btn-sim-pump-on'),
        btnSimPumpOff: $('#btn-sim-pump-off'),
        btnToggleMuteBuzzer: $('#btn-toggle-mute-buzzer'),
        simTargetStatus: $('#sim-target-status'),
        lastCommandSent: $('#last-command-sent'),
        simWaterFill: $('#sim-water-fill'),
        simWaspadaLine: $('#sim-waspada-line'),
        simBahayaLine: $('#sim-bahaya-line'),
        simWaterLevel: $('#sim-water-level'),
        simStatusBadge: $('#sim-status-badge'),
        simStatusText: $('#sim-status-text'),
        simRate: $('#sim-rate'),
        simLed: $('#sim-led'),
        simBuzzer: $('#sim-buzzer'),
        simPump: $('#sim-pump'),

        // Section 3: Grafik
        waterChartCanvas: $('#waterChart'),
        btnChartClear: $('#btn-chart-clear'),
        chartSampleCount: $('#chart-sample-count'),

        // Section 4: Data Historis
        historyTbody: $('#history-tbody'),
        btnExportCsv: $('#btn-export-csv'),
        btnClearHistory: $('#btn-clear-history'),
        tableCount: $('#table-count'),

        // Section 5: Peringatan
        ledGreen: $('#led-green'),
        ledYellow: $('#led-yellow'),
        ledRed: $('#led-red'),
        ledGreenState: $('#led-green-state'),
        ledYellowState: $('#led-yellow-state'),
        ledRedState: $('#led-red-state'),
        buzzerIndicator: $('#buzzer-indicator'),
        buzzerStatusText: $('#buzzer-status-text'),
        pumpIndicator: $('#pump-indicator'),
        pumpStatusText: $('#pump-status-text'),
        warningLog: $('#warning-log'),
        btnClearLog: $('#btn-clear-log'),

        // Section 8: Pengaturan
        thresholdConfigForm: $('#threshold-config-form'),
        thresholdMaxWaterInput: $('#threshold-max-water'),
        thresholdWaspadaInput: $('#threshold-waspada'),
        thresholdBahayaInput: $('#threshold-bahaya'),

        btnToggleTheme: $('#btn-toggle-theme'),
        mobileThemeToggle: $('#mobile-theme-toggle'),
        btnFullscreen: $('#btn-fullscreen'),

        notifContainer: $('#notification-container')
    };

    // Navigation & Mobile Drawer
    function closeMobileSidebar() {
        dom.sidebar.classList.remove('open');
        dom.overlay.classList.remove('active');
        dom.menuToggle.setAttribute('aria-expanded', 'false');
    }

    function navigateTo(sectionId) {
        dom.sections.forEach(s => s.classList.remove('active'));
        dom.navItems.forEach(n => {
            n.classList.remove('active');
            n.removeAttribute('aria-current');
        });

        const section = document.getElementById(sectionId);
        const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);

        if (section) section.classList.add('active');
        if (navItem) {
            navItem.classList.add('active');
            navItem.setAttribute('aria-current', 'page');
        }

        closeMobileSidebar();
    }

    dom.navItems.forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.section));
    });

    dom.menuToggle.addEventListener('click', () => {
        const isOpen = dom.sidebar.classList.toggle('open');
        dom.overlay.classList.toggle('active', isOpen);
        dom.menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    dom.overlay.addEventListener('click', closeMobileSidebar);

    // System Clock
    function updateClock() {
        const now = new Date();
        dom.currentTime.textContent = now.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }
    setInterval(updateClock, 1000);
    updateClock();

    // Chart.js Initialization
    function initChart() {
        if (!dom.waterChartCanvas || typeof Chart === 'undefined') return;
        const ctx = dom.waterChartCanvas.getContext('2d');
        const gridColor = state.isDarkMode ? 'rgba(148, 163, 184, 0.15)' : 'rgba(15, 23, 42, 0.08)';
        const tickColor = state.isDarkMode ? '#94A3B8' : '#475569';
        const lineColor = state.isDarkMode ? '#60A5FA' : '#1E3A8A';

        waterChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Ketinggian Air AJ-SR04M (cm)',
                        data: [],
                        borderColor: lineColor,
                        backgroundColor: state.isDarkMode ? 'rgba(96, 165, 250, 0.12)' : 'rgba(30, 58, 138, 0.08)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.25,
                        pointRadius: 3,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Ambang Waspada',
                        data: [],
                        borderColor: '#B45309',
                        borderWidth: 1.5,
                        borderDash: [6, 4],
                        pointRadius: 0,
                        fill: false
                    },
                    {
                        label: 'Ambang Bahaya',
                        data: [],
                        borderColor: '#B91C1C',
                        borderWidth: 1.5,
                        borderDash: [6, 4],
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#0F172A',
                        titleColor: '#F8FAFC',
                        bodyColor: '#CBD5E1',
                        padding: 10,
                        cornerRadius: 6,
                        callbacks: {
                            label: (context) => `${context.dataset.label}: ${Number(context.parsed.y).toFixed(1)} cm`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: tickColor, font: { family: "'IBM Plex Mono', monospace", size: 11 }, maxTicksLimit: 12 }
                    },
                    y: {
                        min: 0,
                        max: state.maxWater,
                        grid: { color: gridColor },
                        ticks: {
                            color: tickColor,
                            font: { family: "'IBM Plex Mono', monospace", size: 11 },
                            callback: (v) => v + ' cm'
                        }
                    }
                },
                animation: { duration: 200 }
            }
        });
    }

    function appendChartPoint(timeLabel, waterLevel) {
        if (!waterChart) return;
        const maxPoints = 60;

        waterChart.data.labels.push(timeLabel);
        waterChart.data.datasets[0].data.push(waterLevel);
        waterChart.data.datasets[1].data.push(state.thresholdWaspada);
        waterChart.data.datasets[2].data.push(state.thresholdBahaya);

        if (waterChart.data.labels.length > maxPoints) {
            waterChart.data.labels.shift();
            waterChart.data.datasets.forEach(ds => ds.data.shift());
        }

        waterChart.options.scales.y.max = state.maxWater;
        waterChart.update('none');
        dom.chartSampleCount.textContent = `${waterChart.data.labels.length} titik data`;
    }

    function clearChart() {
        if (!waterChart) return;
        waterChart.data.labels = [];
        waterChart.data.datasets.forEach(ds => { ds.data = []; });
        waterChart.update();
        dom.chartSampleCount.textContent = '0 titik data';
    }

    // Status Evaluation
    function evaluateWaterStatus(level) {
        if (level === null || isNaN(level)) return 'neutral';
        if (level >= state.thresholdBahaya) return 'bahaya';
        if (level >= state.thresholdWaspada) return 'waspada';
        return 'normal';
    }

    function getStatusMetadata(status) {
        switch (status) {
            case 'bahaya':
                return {
                    label: 'BAHAYA (SIAGA 1)',
                    desc: 'Ketinggian air mencapai/melampaui batas Bahaya (3 cm). LED Merah & Buzzer alarm cepat aktif.',
                    icon: 'fas fa-triangle-exclamation',
                    waterColor: 'var(--water-bahaya)'
                };
            case 'waspada':
                return {
                    label: 'WASPADA (SIAGA 2)',
                    desc: 'Permukaan air naik memasuki zona Waspada (2 cm). LED Kuning & peringatan Buzzer aktif.',
                    icon: 'fas fa-circle-exclamation',
                    waterColor: 'var(--water-waspada)'
                };
            case 'normal':
                return {
                    label: 'NORMAL (AMAN)',
                    desc: 'Ketinggian air berada pada zona aman (~1 cm). LED Hijau menyala, kondisi lingkungan maket FKIP UNMUL terkendali.',
                    icon: 'fas fa-circle-check',
                    waterColor: 'var(--water-normal)'
                };
            default:
                return {
                    label: 'MENUNGGU DATA',
                    desc: 'Menunggu pengiriman data sensor AJ-SR04M dari mikrokontroler ESP32.',
                    icon: 'fas fa-minus-circle',
                    waterColor: 'var(--water-normal)'
                };
        }
    }

    // Connection State Banner (Loading / Empty / Error / Online States)
    function setConnectionState(newState, customMessage) {
        state.connectionState = newState;

        if (newState === 'connecting') {
            dom.connectionDot.className = 'status-dot connecting';
            dom.connectionText.textContent = 'Menghubungkan ke Server...';
            dom.systemStateBanner.className = 'system-state-banner';
            dom.stateBannerIcon.className = 'fas fa-spinner fa-spin';
            dom.stateBannerTitle.textContent = 'Menghubungkan ke Database Telemetri Real-time...';
            dom.stateBannerDesc.textContent = customMessage || 'Menyambungkan saluran data ESP32, sensor AJ-SR04M, dan kontrol pompa pengisi air.';
            dom.espBadge.className = 'sensor-badge active-warning';
            dom.espBadge.textContent = 'Sinkronisasi...';
        } else if (newState === 'online') {
            dom.connectionDot.className = 'status-dot online';
            dom.connectionText.textContent = 'Terhubung Real-time';
            dom.systemStateBanner.className = 'system-state-banner state-online';
            dom.stateBannerIcon.className = 'fas fa-circle-check';
            dom.stateBannerTitle.textContent = state.hasReceivedData
                ? 'Sistem Aktif: Menerima Telemetri Real-time Sensor AJ-SR04M'
                : 'Terhubung ke Database (Menunggu Paket Data dari ESP32)';
            dom.stateBannerDesc.textContent = customMessage || (state.hasReceivedData
                ? 'Komunikasi dua arah dengan ESP32, sensor AJ-SR04M, LED, Buzzer, dan Pompa Pengisi Air berjalan normal.'
                : 'Database sudah terhubung. Nyalakan perangkat ESP32 atau gunakan tombol kontrol pompa di bawah untuk memulai pengujian.');
            dom.espBadge.className = 'sensor-badge online';
            dom.espBadge.textContent = 'Terhubung';
            dom.espDeviceDesc.textContent = 'Komunikasi cloud aktif';
        } else if (newState === 'error') {
            dom.connectionDot.className = 'status-dot error';
            dom.connectionText.textContent = 'Gangguan Koneksi';
            dom.systemStateBanner.className = 'system-state-banner state-error';
            dom.stateBannerIcon.className = 'fas fa-triangle-exclamation';
            dom.stateBannerTitle.textContent = 'Gangguan Koneksi Database Real-time';
            dom.stateBannerDesc.textContent = customMessage || 'Periksa koneksi internet Anda atau pastikan izin akses (Rules) pada database telah diaktifkan.';
            dom.espBadge.className = 'sensor-badge active-danger';
            dom.espBadge.textContent = 'Gangguan';
        }
    }

    // Update UI with Real Telemetry
    function renderTelemetryUI() {
        const hasData = state.hasReceivedData && state.waterLevel !== null;
        const level = hasData ? state.waterLevel : 0;
        const pct = hasData ? Math.max(0, Math.min((level / state.maxWater) * 100, 100)) : 0;
        const status = hasData ? evaluateWaterStatus(level) : 'neutral';
        const meta = getStatusMetadata(status);

        // Tank fill
        dom.waterFill.style.height = pct + '%';
        dom.simWaterFill.style.height = pct + '%';
        dom.waterFill.style.backgroundColor = meta.waterColor;
        dom.simWaterFill.style.backgroundColor = meta.waterColor;

        // Numeric readouts
        const formattedLevel = hasData ? level.toFixed(1) : '--';
        dom.waterLevelValue.textContent = formattedLevel;
        dom.simWaterLevel.textContent = formattedLevel;
        dom.levelBadge.textContent = hasData ? `${formattedLevel} cm` : '-- cm';

        if (state.sensorDistance !== null && !isNaN(state.sensorDistance)) {
            dom.sensorDistanceValue.textContent = `${Number(state.sensorDistance).toFixed(1)} cm`;
        } else if (hasData) {
            const calcDist = Math.max(0, state.maxWater - level);
            dom.sensorDistanceValue.textContent = `${calcDist.toFixed(1)} cm`;
        } else {
            dom.sensorDistanceValue.textContent = '-- cm';
        }

        // Target fill level display
        if (state.targetLevelCm !== null) {
            const targetText = `${state.targetLevelCm} cm (${state.pumpActive ? 'Sedang Mengisi...' : 'Tercapai / Siaga'})`;
            dom.targetLevelDisplay.textContent = targetText;
            dom.simTargetStatus.textContent = targetText;
        } else {
            dom.targetLevelDisplay.textContent = state.pumpActive ? 'Pengisian Manual Kontinu' : 'Tidak ada target aktif';
            dom.simTargetStatus.textContent = state.pumpActive ? 'Manual Kontinu (ON)' : 'Manual (Mati)';
        }

        // Highlight active preset target button (1 cm, 2 cm, 3 cm)
        dom.targetBtns.forEach(btn => {
            const btnCm = Number(btn.dataset.targetCm);
            btn.classList.toggle('active', state.pumpMode === 'target' && state.targetLevelCm === btnCm);
        });

        // Status Badges
        dom.waterStatusBadge.className = `status-indicator-badge ${status}`;
        dom.statusIcon.className = meta.icon;
        dom.statusText.textContent = meta.label;
        dom.statusDesc.textContent = meta.desc;

        dom.simStatusBadge.className = `sim-status-badge ${status}`;
        dom.simStatusBadge.querySelector('i').className = meta.icon;
        dom.simStatusText.textContent = meta.label;

        // Threshold active row highlight
        dom.levelNormal.classList.toggle('active', status === 'normal');
        dom.levelWaspada.classList.toggle('active', status === 'waspada');
        dom.levelBahaya.classList.toggle('active', status === 'bahaya');

        // Rate of change
        if (hasData) {
            const sign = state.rateOfChange > 0 ? '+' : '';
            dom.simRate.textContent = `${sign}${state.rateOfChange.toFixed(2)} cm/dtk`;
        } else {
            dom.simRate.textContent = '-- cm/dtk';
        }

        // Ultrasonic AJ-SR04M badge
        if (hasData) {
            dom.ultrasonicBadge.className = 'sensor-badge online';
            dom.ultrasonicBadge.textContent = 'Aktif';
            dom.ultrasonicDesc.textContent = `AJ-SR04M: Tinggi ${formattedLevel} cm`;
        } else {
            dom.ultrasonicBadge.className = 'sensor-badge offline';
            dom.ultrasonicBadge.textContent = 'Menunggu';
        }

        renderActuatorStates(status, hasData);
    }

    function renderActuatorStates(status, hasData) {
        const greenOn = hasData && state.ledGreen;
        const yellowOn = hasData && state.ledYellow;
        const redOn = hasData && state.ledRed;

        dom.ledGreen.classList.toggle('active', greenOn);
        dom.ledYellow.classList.toggle('active', yellowOn);
        dom.ledRed.classList.toggle('active', redOn);

        dom.ledGreenState.textContent = greenOn ? 'MENYALA (Normal)' : 'Nonaktif';
        dom.ledYellowState.textContent = yellowOn ? 'MENYALA (Waspada)' : 'Nonaktif';
        dom.ledRedState.textContent = redOn ? 'MENYALA (Bahaya)' : 'Nonaktif';

        if (!hasData) {
            dom.ledBadge.className = 'sensor-badge offline';
            dom.ledBadge.textContent = 'Menunggu';
            dom.ledStatusText.textContent = 'Tidak ada status aktif';
            dom.simLed.textContent = 'Menunggu data';
        } else if (redOn) {
            dom.ledBadge.className = 'sensor-badge active-danger';
            dom.ledBadge.textContent = 'LED Merah';
            dom.ledStatusText.textContent = 'Merah Menyala (Bahaya >= 3 cm)';
            dom.simLed.textContent = 'Merah (Bahaya)';
        } else if (yellowOn) {
            dom.ledBadge.className = 'sensor-badge active-warning';
            dom.ledBadge.textContent = 'LED Kuning';
            dom.ledStatusText.textContent = 'Kuning Menyala (Waspada 2 cm)';
            dom.simLed.textContent = 'Kuning (Waspada)';
        } else {
            dom.ledBadge.className = 'sensor-badge online';
            dom.ledBadge.textContent = 'LED Hijau';
            dom.ledStatusText.textContent = 'Hijau Menyala (Normal 1 cm)';
            dom.simLed.textContent = 'Hijau (Normal)';
        }

        // Buzzer state
        const buzzerOn = state.buzzerActive && !state.muteBuzzer;
        dom.buzzerIndicator.classList.toggle('active', buzzerOn);
        dom.buzzerIndicator.querySelector('i').className = buzzerOn ? 'fas fa-bell' : 'fas fa-bell-slash';

        if (state.muteBuzzer) {
            dom.buzzerBadge.className = 'sensor-badge active-warning';
            dom.buzzerBadge.textContent = 'Diredam (Mute)';
            dom.buzzerStatusText.textContent = 'Buzzer diredam secara manual dari web dashboard';
            dom.simBuzzer.textContent = 'Diredam (Mute)';
        } else if (buzzerOn) {
            dom.buzzerBadge.className = 'sensor-badge active-danger';
            dom.buzzerBadge.textContent = 'Berbunyi';
            dom.buzzerStatusText.textContent = 'Alarm buzzer aktif pada maket FKIP UNMUL';
            dom.simBuzzer.textContent = 'Aktif Berbunyi';
        } else {
            dom.buzzerBadge.className = 'sensor-badge offline';
            dom.buzzerBadge.textContent = 'Mati';
            dom.buzzerStatusText.textContent = 'Tidak aktif (Kondisi aman)';
            dom.simBuzzer.textContent = 'Mati';
        }

        // Mute button UI
        dom.btnToggleMuteBuzzer.setAttribute('aria-pressed', state.muteBuzzer ? 'true' : 'false');
        dom.btnToggleMuteBuzzer.innerHTML = state.muteBuzzer
            ? '<i class="fas fa-volume-high" aria-hidden="true"></i> <span>Aktifkan Kembali Buzzer (Mute: ON)</span>'
            : '<i class="fas fa-volume-xmark" aria-hidden="true"></i> <span>Redam Buzzer (Mute: OFF)</span>';

        // Pump State (Filling water to 1cm, 2cm, 3cm or Manual ON/OFF)
        const targetLabel = state.targetLevelCm ? `Target ${state.targetLevelCm} cm` : 'Manual';

        if (state.pumpActive) {
            dom.dashPumpPill.className = 'actuator-pill online';
            dom.dashPumpPill.textContent = state.targetLevelCm
                ? `MENGISI AIR (-> ${state.targetLevelCm} CM)`
                : 'POMPA MENGISI (MANUAL)';
            dom.pumpBadge.className = 'sensor-badge online';
            dom.pumpBadge.textContent = 'Mengisi Air';
            dom.pumpDesc.textContent = state.targetLevelCm
                ? `Mengisi maket menuju ${state.targetLevelCm} cm`
                : 'Mengisi air maket (Manual ON)';
            dom.pumpIndicator.classList.add('pump-active');
            dom.pumpStatusText.textContent = state.targetLevelCm
                ? `Pompa sedang mengisi air menuju ketinggian ${state.targetLevelCm} cm`
                : 'Pompa pengisi air menyala secara manual dari web';
            dom.simPump.textContent = `Mengisi Air (${targetLabel})`;
        } else {
            dom.dashPumpPill.className = 'actuator-pill offline';
            dom.dashPumpPill.textContent = 'POMPA MATI';
            dom.pumpBadge.className = 'sensor-badge offline';
            dom.pumpBadge.textContent = 'Mati';
            dom.pumpDesc.textContent = state.targetLevelCm
                ? `Siaga (Target terakhir: ${state.targetLevelCm} cm)`
                : 'Pengisi air maket (1 cm / 2 cm / 3 cm)';
            dom.pumpIndicator.classList.remove('pump-active');
            dom.pumpStatusText.textContent = 'Pompa pengisi air mati (Menunggu perintah pengisian 1 cm / 2 cm / 3 cm)';
            dom.simPump.textContent = 'Mati';
        }
    }

    // Firebase telemetry ESP32; status pompa hanya dari perangkat, bukan dari klik tombol.
    function processDatabaseSnapshot(rootData) {
        const device = rootData?.devices?.esp32_001;
        const sensorNode = device?.realtime;
        if (!sensorNode || typeof sensorNode !== 'object') {
            setConnectionState('connecting', 'Menunggu telemetry dari ESP32.');
            return;
        }
        const rawLevel = sensorNode.tinggi_air;
        if (typeof sensorNode.pompa_aktif === 'boolean') state.pumpActive = sensorNode.pompa_aktif;
        if (typeof sensorNode.buzzer_aktif === 'boolean') state.buzzerActive = sensorNode.buzzer_aktif;
        if ([1, 2, 3].includes(Number(sensorNode.target_cm))) {
            state.targetLevelCm = Number(sensorNode.target_cm);
            state.pumpMode = 'target';
        }
        if (sensorNode.sensor_valid === false) {
            state.hasReceivedData = false;
            renderTelemetryUI();
            setConnectionState('error', 'Sensor ESP32 tidak valid.');
            return;
        }
        if (rawLevel !== undefined && rawLevel !== null && Number.isFinite(Number(rawLevel))) {
            const level = Math.max(0, Number(rawLevel));
            const nowMs = Date.now();
            if (state.lastWaterLevel !== null && state.lastUpdateTimestamp !== null) {
                const dtSec = Math.max(1, (nowMs - state.lastUpdateTimestamp) / 1000);
                state.rateOfChange = (level - state.lastWaterLevel) / dtSec;
            } else state.rateOfChange = 0;
            state.lastWaterLevel = level;
            state.lastUpdateTimestamp = nowMs;
            state.waterLevel = level;
            state.sensorDistance = Number.isFinite(Number(sensorNode.jarak_sensor)) ? Number(sensorNode.jarak_sensor) : null;
            state.hasReceivedData = true;
            const evaluatedStatus = evaluateWaterStatus(level);
            state.ledGreen = evaluatedStatus === 'normal';
            state.ledYellow = evaluatedStatus === 'waspada';
            state.ledRed = evaluatedStatus === 'bahaya';
            const timeLabel = new Date().toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false});
            dom.lastSyncInfo.textContent = `Pembaruan terakhir diterima: ${timeLabel}`;
            if (lastRecordedLevel !== level || nowMs - lastRecordedTimeMs > 1500) {
                lastRecordedLevel = level;
                lastRecordedTimeMs = nowMs;
                state.readings.push(level);
                updateStatsUI();
                appendChartPoint(timeLabel, Number(level.toFixed(1)));
                appendHistoryRow(level, state.sensorDistance, evaluatedStatus);
            }
            checkWarningTransitions(evaluatedStatus, level, timeLabel);
        }
        setConnectionState('online');
        renderTelemetryUI();
    }

    // Perintah atomik: id bertambah, action dan target dikirim bersama.
    // Firebase SDK harus tersedia; REST fallback hanya untuk monitoring.
    let commandBusy = false;
    async function sendPumpCommand(action, targetCm, descriptionText) {
        if (commandBusy) return;
        if (!firebaseDb) {
            showNotification('danger', 'Firebase SDK belum siap', 'Tidak bisa mengirim kontrol. Periksa koneksi internet dan script Firebase.');
            return;
        }
        if (!['START','STOP'].includes(action) || ![1,2,3].includes(targetCm)) return;
        commandBusy = true;
        const buttons = [dom.btnDashPumpOn, dom.btnDashPumpOff, dom.btnSimPumpOn, dom.btnSimPumpOff, ...dom.targetBtns];
        buttons.forEach(b => { if (b) b.disabled = true; });
        try {
            const commandRef = firebaseDb.ref(`${DEVICE_BASE}/command`);
            const result = await commandRef.transaction(current => ({
                id: Math.max(0, Number(current?.id) || 0) + 1,
                action,
                target_cm: targetCm
            }), undefined, false);
            if (!result.committed) throw new Error('Transaksi tidak disimpan');
            const timeStr = new Date().toLocaleTimeString('id-ID');
            dom.lastCommandSent.textContent = `[${timeStr}] ${descriptionText} — menunggu konfirmasi ESP32`;
            addWarningLog('info', timeStr, `Perintah Firebase: ${descriptionText}`);
            showNotification('info', 'Perintah terkirim', 'Menunggu ESP32 memproses perintah.');
        } catch (err) {
            showNotification('danger', 'Perintah gagal', err.message);
        } finally {
            commandBusy = false;
            buttons.forEach(b => { if (b) b.disabled = false; });
        }
    }

    // Tombol target langsung START. Tombol ON menggunakan target terakhir (default 3 cm).
    function triggerTargetFill(targetCm) {
        sendPumpCommand('START', targetCm, `START pengisian menuju ${targetCm} cm`);
    }
    function triggerManualPump(turnOn) {
        // Firmware tidak mendukung ON tanpa batas; ON aman dibatasi target 3 cm.
        const target = [1,2,3].includes(state.targetLevelCm) ? state.targetLevelCm : 3;
        sendPumpCommand(turnOn ? 'START' : 'STOP', target,
            turnOn ? `START menuju ${target} cm` : 'STOP pompa');
    }
    dom.targetBtns.forEach(btn => btn.addEventListener('click', () => {
        const target = Number(btn.dataset.targetCm);
        if ([1,2,3].includes(target)) triggerTargetFill(target);
    }));
    dom.btnDashPumpOn.addEventListener('click', () => triggerManualPump(true));
    dom.btnDashPumpOff.addEventListener('click', () => triggerManualPump(false));
    dom.btnSimPumpOn.addEventListener('click', () => triggerManualPump(true));
    dom.btnSimPumpOff.addEventListener('click', () => triggerManualPump(false));
    dom.btnToggleMuteBuzzer.addEventListener('click', () => {
        showNotification('info', 'Belum didukung', 'Firmware ESP32 belum mendukung mute buzzer dari website.');
    });

    function connectToFirebase() {
        setConnectionState('connecting');
        if (typeof firebase !== 'undefined' && firebase.database) {
            try {
                firebaseApp = firebase.apps?.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
                firebaseDb = firebase.database(firebaseApp);
                connectedRef = firebaseDb.ref('.info/connected');
                connectedRef.on('value', snap => {
                    if (!snap.val()) setConnectionState('connecting', 'Koneksi Firebase terputus.');
                });
                rootRef = firebaseDb.ref(DEVICE_BASE);
                rootRef.on('value', snapshot => {
                    processDatabaseSnapshot({devices: {esp32_001: snapshot.val()}});
                }, err => setConnectionState('error', `Firebase: ${err.message}`));
                return;
            } catch (err) {
                console.error('Firebase SDK error', err);
            }
        }
        startRestFallbackPolling();
    }
    function startRestFallbackPolling() {
        const url = `${FIREBASE_CONFIG.databaseURL}/${DEVICE_BASE}.json`;
        const fetchSnapshot = async () => {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                processDatabaseSnapshot({devices:{esp32_001:await res.json()}});
            } catch (err) {
                setConnectionState('error', `Firebase REST: ${err.message}`);
            }
        };
        fetchSnapshot();
        if (restPollTimer) clearInterval(restPollTimer);
        restPollTimer = setInterval(fetchSnapshot, 2000);
    }

    // Statistics
    function updateStatsUI() {
        if (state.readings.length === 0) {
            dom.statMax.textContent = '--';
            dom.statMin.textContent = '--';
            dom.statAvg.textContent = '--';
            dom.statReadings.textContent = '0';
            return;
        }

        const max = Math.max(...state.readings);
        const min = Math.min(...state.readings);
        const avg = state.readings.reduce((a, b) => a + b, 0) / state.readings.length;

        dom.statMax.textContent = max.toFixed(1);
        dom.statMin.textContent = min.toFixed(1);
        dom.statAvg.textContent = avg.toFixed(1);
        dom.statReadings.textContent = String(state.readings.length);
    }

    dom.btnResetStats.addEventListener('click', () => {
        state.readings = [];
        updateStatsUI();
        showNotification('info', 'Statistik Sesi Direset', 'Rekapitulasi nilai maksimum, minimum, dan rata-rata telah dikosongkan.');
    });

    // Historical Log Table
    function appendHistoryRow(level, distance, status) {
        const now = new Date();
        const timeStr = now.toLocaleString('id-ID', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const meta = getStatusMetadata(status);
        const pumpText = state.pumpActive
            ? (state.targetLevelCm ? `Mengisi (-> ${state.targetLevelCm} cm)` : 'Mengisi (Manual)')
            : 'Mati';
        const alarmText = status === 'bahaya'
            ? 'LED Merah + Buzzer Cepat'
            : status === 'waspada'
                ? 'LED Kuning + Buzzer'
                : 'LED Hijau';

        const entry = {
            time: timeStr,
            level: level.toFixed(1),
            distance: distance !== null ? distance.toFixed(1) : '--',
            status: status,
            statusLabel: meta.label,
            pump: pumpText,
            alarm: alarmText
        };

        state.history.push(entry);

        const emptyRow = dom.historyTbody.querySelector('.empty-row');
        if (emptyRow) emptyRow.remove();

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="mono-text">${entry.time}</td>
            <td class="mono-text"><strong>${entry.level} cm</strong></td>
            <td class="mono-text">${entry.distance} cm</td>
            <td><span class="status-cell ${entry.status}">${entry.statusLabel}</span></td>
            <td>${entry.pump}</td>
            <td>${entry.alarm}</td>
        `;
        dom.historyTbody.prepend(tr);

        if (dom.historyTbody.children.length > 200) {
            dom.historyTbody.lastElementChild.remove();
        }

        dom.tableCount.textContent = `${state.history.length} rekaman tercatat`;
    }

    function clearHistory() {
        state.history = [];
        dom.historyTbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="6">
                    <div class="empty-state">
                        <i class="fas fa-database" aria-hidden="true"></i>
                        <strong>Log Historis Dikosongkan</strong>
                        <p>Menunggu paket data berikutnya dari sensor AJ-SR04M pada ESP32.</p>
                    </div>
                </td>
            </tr>`;
        dom.tableCount.textContent = '0 rekaman tercatat';
        showNotification('info', 'Log Historis Dihapus', 'Tabel riwayat pengukuran pada sesi ini telah dibersihkan.');
    }

    function exportCSV() {
        if (state.history.length === 0) {
            showNotification('warning', 'Belum Ada Data', 'Tidak ada data historis untuk diekspor.');
            return;
        }

        let csv = 'No,Waktu Pencatatan,Ketinggian Air (cm),Jarak AJ-SR04M (cm),Status Siaga,Status Pompa Pengisi,Indikator Alarm\n';
        state.history.forEach((entry, idx) => {
            csv += `${idx + 1},"${entry.time}",${entry.level},${entry.distance},"${entry.statusLabel}","${entry.pump}","${entry.alarm}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `log_banjir_fkip_unmul_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        showNotification('success', 'Data CSV Diunduh', `${state.history.length} baris data telemetri AJ-SR04M berhasil diekspor.`);
    }

    dom.btnExportCsv.addEventListener('click', exportCSV);
    dom.btnClearHistory.addEventListener('click', clearHistory);
    dom.btnChartClear.addEventListener('click', () => {
        clearChart();
        showNotification('info', 'Grafik Dibersihkan', 'Titik sampel pada grafik telemetri telah dikosongkan.');
    });

    // Warning Transitions & Event Log
    function checkWarningTransitions(newStatus, level, timeStr) {
        if (newStatus === state.lastStatus) return;

        if (newStatus === 'waspada') {
            addWarningLog('warning', timeStr, `Status naik ke WASPADA pada ketinggian air ${level.toFixed(1)} cm. LED Kuning & Buzzer diaktifkan.`);
            showNotification('warning', 'Peringatan Waspada (2 cm)', `Ketinggian air maket FKIP UNMUL mencapai ${level.toFixed(1)} cm.`);
        } else if (newStatus === 'bahaya') {
            addWarningLog('danger', timeStr, `Status kritis BAHAYA pada ketinggian air ${level.toFixed(1)} cm. LED Merah & Buzzer alarm cepat aktif.`);
            showNotification('danger', 'Status Bahaya Banjir (3 cm)!', `Ketinggian air mencapai batas kritis (${level.toFixed(1)} cm).`);
        } else if (newStatus === 'normal' && state.lastStatus !== null) {
            addWarningLog('info', timeStr, `Ketinggian air berada di level NORMAL (${level.toFixed(1)} cm). LED Hijau aktif.`);
            showNotification('success', 'Kondisi Normal (1 cm)', `Permukaan air berada pada batas aman (${level.toFixed(1)} cm).`);
        }

        state.lastStatus = newStatus;
    }

    function addWarningLog(type, time, message) {
        const logEmpty = dom.warningLog.querySelector('.log-empty');
        if (logEmpty) logEmpty.remove();

        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-msg">${message}</span>
        `;

        dom.warningLog.prepend(entry);
        state.warningLog.push({ type, time, message });

        const entries = dom.warningLog.querySelectorAll('.log-entry');
        if (entries.length > 50) {
            entries[entries.length - 1].remove();
        }
    }

    dom.btnClearLog.addEventListener('click', () => {
        state.warningLog = [];
        dom.warningLog.innerHTML = `
            <div class="log-empty">
                <i class="fas fa-clipboard-check" aria-hidden="true"></i>
                <p>Catatan kejadian telah dibersihkan.</p>
            </div>`;
        showNotification('info', 'Catatan Dibersihkan', 'Riwayat transisi status dan pengisian pompa telah dihapus.');
    });

    // Toast Notifications
    function showNotification(type, title, message) {
        const iconMap = {
            success: 'fas fa-circle-check',
            warning: 'fas fa-triangle-exclamation',
            danger: 'fas fa-circle-radiation',
            info: 'fas fa-circle-info'
        };

        const notif = document.createElement('div');
        notif.className = `notification ${type}`;
        notif.setAttribute('role', 'status');
        notif.innerHTML = `
            <i class="notif-icon ${iconMap[type] || iconMap.info}" aria-hidden="true"></i>
            <div class="notif-content">
                <div class="notif-title">${title}</div>
                <div class="notif-message">${message}</div>
            </div>
        `;

        dom.notifContainer.appendChild(notif);

        const removeNotif = () => {
            if (notif.parentNode) notif.remove();
        };

        setTimeout(removeNotif, 5000);
        notif.addEventListener('click', removeNotif);
    }

    // Thresholds Persistence
    function updateThresholdVisuals() {
        const maxW = state.maxWater;
        const w = state.thresholdWaspada;
        const b = state.thresholdBahaya;

        const waspadaPct = Math.min(95, Math.max(5, (w / maxW) * 100));
        const bahayaPct = Math.min(98, Math.max(10, (b / maxW) * 100));

        dom.waspadaLine.style.bottom = `${waspadaPct}%`;
        dom.waspadaLine.querySelector('span').textContent = `Waspada (${w} cm)`;
        dom.bahayaLine.style.bottom = `${bahayaPct}%`;
        dom.bahayaLine.querySelector('span').textContent = `Bahaya (${b} cm)`;

        dom.simWaspadaLine.style.bottom = `${waspadaPct}%`;
        dom.simWaspadaLine.querySelector('span').textContent = `Waspada (${w} cm)`;
        dom.simBahayaLine.style.bottom = `${bahayaPct}%`;
        dom.simBahayaLine.querySelector('span').textContent = `Bahaya (${b} cm)`;

        dom.rangeNormalText.textContent = `0 sampai ${(w - 0.1).toFixed(1)} cm`;
        dom.rangeWaspadaText.textContent = `${w.toFixed(1)} sampai ${(b - 0.1).toFixed(1)} cm`;
        dom.rangeBahayaText.innerHTML = `&ge; ${b.toFixed(1)} cm`;

        const scaleSpans = document.querySelectorAll('#water-tank .tank-scale span');
        const fractions = [1, 0.8, 0.6, 0.4, 0.2, 0];
        scaleSpans.forEach((span, idx) => {
            if (fractions[idx] !== undefined) {
                const val = maxW * fractions[idx];
                span.textContent = `${val.toFixed(1)} cm`;
            }
        });

        if (waterChart) {
            waterChart.options.scales.y.max = maxW;
            waterChart.update('none');
        }
    }

    dom.thresholdConfigForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const maxW = parseFloat(dom.thresholdMaxWaterInput.value);
        const waspada = parseFloat(dom.thresholdWaspadaInput.value);
        const bahaya = parseFloat(dom.thresholdBahayaInput.value);

        if (isNaN(maxW) || isNaN(waspada) || isNaN(bahaya) || waspada <= 0 || bahaya <= waspada || maxW <= bahaya) {
            showNotification('warning', 'Parameter Tidak Valid', 'Pastikan Tinggi Wadah > Batas Bahaya > Batas Waspada.');
            return;
        }

        state.maxWater = maxW;
        state.thresholdWaspada = waspada;
        state.thresholdBahaya = bahaya;

        localStorage.setItem(STORAGE_KEYS.THRESHOLDS, JSON.stringify({
            maxWater: maxW,
            thresholdWaspada: waspada,
            thresholdBahaya: bahaya
        }));

        updateThresholdVisuals();
        renderTelemetryUI();

        showNotification('info', 'Pengaturan tampilan', 'Ambang batas website disimpan lokal; firmware ESP32 tidak diubah.');
    });

    // Theme Toggle
    function applyTheme(isDark) {
        state.isDarkMode = isDark;
        document.body.classList.toggle('dark-mode', isDark);

        dom.btnToggleTheme.innerHTML = isDark
            ? '<i class="fas fa-sun" aria-hidden="true"></i> Mode Terang (Putih)'
            : '<i class="fas fa-moon" aria-hidden="true"></i> Mode Gelap';

        dom.mobileThemeToggle.innerHTML = isDark
            ? '<i class="fas fa-sun" aria-hidden="true"></i>'
            : '<i class="fas fa-moon" aria-hidden="true"></i>';

        if (waterChart) {
            const gridColor = isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(15, 23, 42, 0.08)';
            const tickColor = isDark ? '#94A3B8' : '#475569';
            const lineColor = isDark ? '#60A5FA' : '#1E3A8A';

            waterChart.data.datasets[0].borderColor = lineColor;
            waterChart.data.datasets[0].backgroundColor = isDark ? 'rgba(96, 165, 250, 0.12)' : 'rgba(30, 58, 138, 0.08)';
            waterChart.options.scales.x.grid.color = gridColor;
            waterChart.options.scales.y.grid.color = gridColor;
            waterChart.options.scales.x.ticks.color = tickColor;
            waterChart.options.scales.y.ticks.color = tickColor;
            waterChart.update('none');
        }
    }

    function toggleTheme() {
        const nextDark = !state.isDarkMode;
        localStorage.setItem(STORAGE_KEYS.THEME, nextDark ? 'dark' : 'light');
        applyTheme(nextDark);
    }

    dom.btnToggleTheme.addEventListener('click', toggleTheme);
    dom.mobileThemeToggle.addEventListener('click', toggleTheme);

    // Fullscreen Toggle
    dom.btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
            dom.btnFullscreen.innerHTML = '<i class="fas fa-compress" aria-hidden="true"></i> Keluar Layar Penuh';
        } else {
            document.exitFullscreen();
            dom.btnFullscreen.innerHTML = '<i class="fas fa-expand" aria-hidden="true"></i> Layar Penuh';
        }
    });

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            dom.btnFullscreen.innerHTML = '<i class="fas fa-expand" aria-hidden="true"></i> Layar Penuh';
        }
    });

    // Keyboard Accessibility
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMobileSidebar();
        }
    });

    // Load Saved Settings & Initialize
    function loadSavedPreferences() {
        try {
            const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
            applyTheme(savedTheme === 'dark');

            const savedThresholds = localStorage.getItem(STORAGE_KEYS.THRESHOLDS);
            if (savedThresholds) {
                const parsed = JSON.parse(savedThresholds);
                if (parsed.maxWater) state.maxWater = Number(parsed.maxWater);
                if (parsed.thresholdWaspada) state.thresholdWaspada = Number(parsed.thresholdWaspada);
                if (parsed.thresholdBahaya) state.thresholdBahaya = Number(parsed.thresholdBahaya);

                dom.thresholdMaxWaterInput.value = state.maxWater;
                dom.thresholdWaspadaInput.value = state.thresholdWaspada;
                dom.thresholdBahayaInput.value = state.thresholdBahaya;
            }
        } catch (_) {}
    }

    function init() {
        loadSavedPreferences();
        initChart();
        updateThresholdVisuals();
        updateStatsUI();
        renderTelemetryUI();
        connectToFirebase();
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }
})();
