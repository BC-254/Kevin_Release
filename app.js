// Configuration & State
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const PRODUCTION_APP_ID = "34inlHAdbqgeqGEq8nzMo";
const DEFAULT_APP_ID = IS_LOCAL ? "1089" : (PRODUCTION_APP_ID || "1089");

function getDerivGateways(id) {
    const isAlphanumeric = /[a-zA-Z]/.test(id);
    if (isAlphanumeric) {
        return [
            { name: "api.derivws.com (Modern Gateway)", url: `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${id}&l=EN&brand=deriv` },
            { name: "api.derivws.com (Direct)", url: `wss://api.derivws.com/trading/v1/options/ws/public` }
        ];
    } else {
        // Numeric IDs (on localhost)
        return [
            { name: "api.derivws.com (Modern Gateway)", url: `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${id}&l=EN&brand=deriv` },
            { name: "ws.derivws.com (Legacy v3)", url: `wss://ws.derivws.com/websockets/v3?app_id=${id}&l=EN&brand=deriv` },
            { name: "ws.binaryws.com (Legacy v3)", url: `wss://ws.binaryws.com/websockets/v3?app_id=${id}&l=EN&brand=deriv` }
        ];
    }
}

let currentGatewayIndex = 0;
let appId = localStorage.getItem('kelvin_app_id') || DEFAULT_APP_ID;
let apiToken = localStorage.getItem('kelvin_api_token') || null;
let accountId = localStorage.getItem('kelvin_account_id') || null;
let accountCurrency = 'USD';
let accountBalance = null;
let ws = null;
let isConnected = false;
let activeMarket = 'R_100';
let intentionallyClosed = false;
let pingInterval = null;
let tickPollInterval = null;
let reconnectAttempts = 0;
let authFailed = false;
let hasInvalidAppId = false;

// Standard decimal precision for all tracked Deriv synthetic indices per official specs
const DEFAULT_DECIMALS = {
    'R_10': 3,
    'R_25': 3,
    'R_50': 4,
    'R_75': 4,
    'R_100': 2,
    '1HZ10V': 3,
    '1HZ15V': 3,
    '1HZ25V': 3,
    '1HZ30V': 3,
    '1HZ50V': 4,
    '1HZ75V': 4,
    '1HZ90V': 4,
    '1HZ100V': 2
};

// Every Deriv volatility / crash-boom style synthetic index
// (Standard 2s-update indices + the 1s "1HZ" versions.)
let markets = [
    { id: 'R_10', name: 'VOLATILITY 10 INDEX' },
    { id: 'R_25', name: 'VOLATILITY 25 INDEX' },
    { id: 'R_50', name: 'VOLATILITY 50 INDEX' },
    { id: 'R_75', name: 'VOLATILITY 75 INDEX' },
    { id: 'R_100', name: 'VOLATILITY 100 INDEX' },
    { id: '1HZ10V', name: 'VOLATILITY 10 (1s) INDEX' },
    { id: '1HZ15V', name: 'VOLATILITY 15 (1s) INDEX' },
    { id: '1HZ25V', name: 'VOLATILITY 25 (1s) INDEX' },
    { id: '1HZ30V', name: 'VOLATILITY 30 (1s) INDEX' },
    { id: '1HZ50V', name: 'VOLATILITY 50 (1s) INDEX' },
    { id: '1HZ75V', name: 'VOLATILITY 75 (1s) INDEX' },
    { id: '1HZ90V', name: 'VOLATILITY 90 (1s) INDEX' },
    { id: '1HZ100V', name: 'VOLATILITY 100 (1s) INDEX' }
];

// Per-symbol rolling tick data used for every stat in the app.
const MAX_SAMPLE = 250;
let digitStats = {};
let reqIdToSymbol = {};
let reqCounter = 1000;
let symbolsReady = false;

// Prediction State
let predType = 'rise_fall';
let predDigit = 0;
let predDuration = 3;
let predMode = 'manual';
let autoSuggestion = null;

// Radar controls
let radarOuBarrier = 4;
let radarSampleSize = 120;

// Digit Scope panel
let scopeMarket = 'R_10';
let scopeSampleSize = 120;
let scopeTradeType = 'even_odd';
let botGenTradeType = 'even_odd';

// History & Stats
let predictions = JSON.parse(localStorage.getItem('kelvin_predictions')) || [];
let activePrediction = null;

// DOM Elements
const elGlobalStatusDot = document.getElementById('global-status-dot');
const elGlobalStatusText = document.getElementById('global-status-text');
const elMarketStatusDot = document.getElementById('market-status-dot');
const elMarketStatusText = document.getElementById('market-status-text');
const elLoginBtn = document.getElementById('login-modal-btn');
const elAuthWarning = document.getElementById('auth-warning');
const elHeaderMarkets = document.getElementById('header-markets');
const elMarketCards = document.getElementById('market-cards');
const elActiveMarketName = document.getElementById('active-market-name');
const elCurrentPriceDisplay = document.getElementById('current-price-display');
const elMomentumVal = document.getElementById('momentum-val');
const elMomentumLabel = document.getElementById('momentum-label');
const elGaugeNeedle = document.getElementById('gauge-needle');
const elModeToggle = document.getElementById('mode-toggle');
const elModeHelp = document.getElementById('mode-help');
const elPredictionTypeBtns = document.querySelectorAll('#prediction-type .toggle-btn');
const elDigitGroup = document.getElementById('digit-selection-group');
const elDigitLabel = document.getElementById('digit-selection-label');
const elDigitBtns = document.querySelectorAll('#digit-value .toggle-btn');
const elDurationBtns = document.querySelectorAll('#duration-ticks .toggle-btn');
const elBtnUp = document.getElementById('btn-up');
const elBtnDown = document.getElementById('btn-down');
const elActionButtonsContainer = document.getElementById('action-buttons-container');
const elAutoBox = document.getElementById('auto-predict-box');
const elAutoConfidence = document.getElementById('auto-confidence');
const elAutoSide = document.getElementById('auto-side');
const elAutoBarFill = document.getElementById('auto-bar-fill');
const elBtnConfirmAuto = document.getElementById('btn-confirm-auto');
const elAccuracyBar = document.getElementById('accuracy-bar');
const elAccuracyText = document.getElementById('accuracy-text');
const elAccuracySubtext = document.getElementById('accuracy-subtext');
const elAccuracyBreakdown = document.getElementById('accuracy-breakdown');
const elHistoryList = document.getElementById('history-list');
const elLoginModal = document.getElementById('login-modal');
const elCancelLogin = document.getElementById('cancel-login');
const elSubmitLogin = document.getElementById('submit-login');
const elInputAppId = document.getElementById('app-id');
const elInputApiToken = document.getElementById('api-token');
const elInputAccountId = document.getElementById('account-id');
const elBanner = document.getElementById('prediction-banner');
const elBannerText = document.getElementById('banner-text');
const elShowLogBtn = document.getElementById('show-log-btn');
const elLogModal = document.getElementById('log-modal');
const elCloseLogBtn = document.getElementById('close-log-btn');
const elLogContainer = document.getElementById('log-container');
const elRadarGrid = document.getElementById('radar-grid');
const elRadarOuBarrier = document.getElementById('radar-ou-barrier');
const elRadarSampleSize = document.getElementById('radar-sample-size');
const elScanBtn = document.getElementById('scan-btn');
const elScannerConsole = document.getElementById('scanner-console');
const elScannerResult = document.getElementById('scanner-result');
const elDualMarketSelect = document.getElementById('dual-market-select');
const elDualPairSelect = document.getElementById('dual-pair-select');
const elDualOutput = document.getElementById('dual-output');
const elScopeMarketSelect = document.getElementById('scope-market-select');
const elScopeTradeType = document.getElementById('scope-trade-type');
const elScopeTickCount = document.getElementById('scope-tick-count');
const elScopePrice = document.getElementById('scope-price');
const elScopeDigits = document.getElementById('scope-digits');
const elScopeHistoryTrack = document.getElementById('scope-history-track');
const elScopeBars = document.getElementById('scope-bars');
const elScopeNote = document.getElementById('scope-note');
const elBotStake = document.getElementById('bot-stake');
const elBotDuration = document.getElementById('bot-duration');
const elBotMartingale = document.getElementById('bot-martingale');
const elBotStoploss = document.getElementById('bot-stoploss');
const elBotBarrierField = document.getElementById('bot-barrier-field');
const elBotBarrierLabel = document.getElementById('bot-barrier-label');
const elBotBarrier = document.getElementById('bot-barrier');
const elBotFlip = document.getElementById('bot-flip');
const elBotGenTabs = document.getElementById('bot-gen-tabs');
const elBotGenBtn = document.getElementById('bot-gen-btn');
const elBotGenPreview = document.getElementById('bot-gen-preview');

let connectionLogs = [];

function addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const logStr = `[${time}] ${msg}`;
    connectionLogs.push({ str: logStr, type });
    console[type === 'error' ? 'error' : 'log'](msg);

    if (elLogContainer) {
        const span = document.createElement('div');
        span.textContent = logStr;
        span.style.color = type === 'error' ? '#FF4C4C' : 'inherit';
        elLogContainer.appendChild(span);
        elLogContainer.scrollTop = elLogContainer.scrollHeight;
    }
}

// Initialization
function init() {
    markets.forEach(m => {
        digitStats[m.id] = {
            digits: [],
            directions: [],
            prices: [],
            decimals: DEFAULT_DECIMALS[m.id] !== undefined ? DEFAULT_DECIMALS[m.id] : 2,
            lastPrice: null
        };
    });

    renderMarketSelectors();
    renderRadarSkeleton();
    populateDualMarketSelect();
    populateScopeMarketSelect();
    updateAuthUI();
    connectWS();
    updateStatsUI();
    setupEventListeners();
    applyPredTypeUI();
}

// WebSocket & Deriv API
let connectionTimeoutTimer = null;
async function connectWS() {
    if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
    }
    if (connectionTimeoutTimer) {
        clearTimeout(connectionTimeoutTimer);
        connectionTimeoutTimer = null;
    }
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (tickPollInterval) {
        clearInterval(tickPollInterval);
        tickPollInterval = null;
    }

    intentionallyClosed = false;
    updateConnectionStatus('connecting');
    symbolsReady = false;

    const gateways = getDerivGateways(appId);
    if (currentGatewayIndex >= gateways.length) {
        currentGatewayIndex = 0;
    }
    const currentGateway = gateways[currentGatewayIndex];
    const wsUrl = currentGateway.url;
    const currentHost = currentGateway.name;

    if (apiToken && !authFailed) {
        addLog(`Connecting and authorizing with API token (${currentHost}, App ID: ${appId})...`);
    } else {
        addLog(`Connecting to public market stream (${currentHost}, App ID: ${appId})...`);
    }

    ws = new WebSocket(wsUrl);

    // If connection hangs or times out, auto-switch gateway
    connectionTimeoutTimer = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            addLog(`Connection to ${currentHost} took too long to respond - Switching gateway...`, 'error');
            ws.onclose = null;
            ws.onerror = null;
            ws.close();
            const gw = getDerivGateways(appId);
            currentGatewayIndex = (currentGatewayIndex + 1) % gw.length;
            connectWS();
        }
    }, 6000);

    ws.onopen = () => {
        if (connectionTimeoutTimer) {
            clearTimeout(connectionTimeoutTimer);
            connectionTimeoutTimer = null;
        }
        hasInvalidAppId = false;
        updateConnectionStatus('connected');
        addLog(`WebSocket connection opened (${currentHost}, App ID: ${appId})`);

        reconnectAttempts = 0;

        if (apiToken && !authFailed) {
            // Classic API authorization happens over the socket itself
            ws.send(JSON.stringify({ authorize: apiToken }));
        } else {
            ws.send(JSON.stringify({ active_symbols: 'brief' }));
            requestAllMarketHistories(false);
            startPublicTickPolling();
        }

        pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ ping: 1 }));
            }
        }, 25000);
    };

    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);

        if (data.error) {
            addLog(`API Error: ${data.error.message} (Code: ${data.error.code})`, 'error');

            if (data.error.code === 'InvalidAppID') {
                hasInvalidAppId = true;
                updateConnectionStatus('invalid_app_id');
                addLog(`App ID "${appId}" is not authorized for ${window.location.origin}. Please configure an App ID registered at api.deriv.com.`, 'error');
                return;
            }

            if (data.msg_type === 'authorize') {
                authFailed = true;
                addLog('API token rejected. Switching to public read-only mode. Log in again with a valid token to resume trading.', 'error');
                ws.send(JSON.stringify({ active_symbols: 'brief' }));
                requestAllMarketHistories(false);
                startPublicTickPolling();
            } else if (data.error.code === 'InvalidSymbol' && data.echo_req && (data.echo_req.ticks || data.echo_req.subscribe)) {
                // Deriv public mode rejects live subscriptions with InvalidSymbol.
                // Fall back to live polling for this market seamlessly.
                startPublicTickPolling();
            }
            return;
        }

        if (data.msg_type === 'ping') return;

        if (data.msg_type === 'authorize') {
            accountId = data.authorize.loginid;
            accountCurrency = data.authorize.currency || 'USD';
            accountBalance = data.authorize.balance;
            addLog(`Authorized as ${data.authorize.loginid} (${accountCurrency} ${accountBalance !== undefined ? accountBalance.toFixed(2) : ''})`);
            updateAuthUI();

            // Subscribe to real-time balance updates
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));

            // Request symbols and live streaming tick history
            ws.send(JSON.stringify({ active_symbols: 'brief' }));
            requestAllMarketHistories(true);
        }

        if (data.msg_type === 'balance') {
            if (data.balance) {
                accountBalance = data.balance.balance;
                accountCurrency = data.balance.currency || accountCurrency;
                updateAuthUI();
                addLog(`Account balance updated: ${accountCurrency} ${accountBalance.toFixed(2)}`);
            }
        }

        if (data.msg_type === 'active_symbols') {
            handleActiveSymbols(data.active_symbols || []);
        }

        if (data.msg_type === 'history') {
            handleHistory(data);
        }

        if (data.msg_type === 'tick') {
            handleTick(data.tick);
        }

        if (data.msg_type === 'buy') {
            addLog(`Trade placed successfully: Contract ID ${data.buy.contract_id} (Stake: ${data.buy.buy_price || ''})`);
            showBanner(`Trade placed: Contract #${data.buy.contract_id}`, 'sawa');
            if (ws && ws.readyState === WebSocket.OPEN && data.buy.contract_id) {
                ws.send(JSON.stringify({
                    proposal_open_contract: 1,
                    contract_id: data.buy.contract_id,
                    subscribe: 1
                }));
            }
        }

        if (data.msg_type === 'proposal_open_contract') {
            handleOpenContract(data.proposal_open_contract);
        }
    };

    ws.onclose = (event) => {
        if (connectionTimeoutTimer) {
            clearTimeout(connectionTimeoutTimer);
            connectionTimeoutTimer = null;
        }
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
        if (tickPollInterval) { clearInterval(tickPollInterval); tickPollInterval = null; }

        if (hasInvalidAppId) {
            updateConnectionStatus('invalid_app_id');
            addLog(`WebSocket closed because App ID "${appId}" is not authorized for ${window.location.origin}. Reconnect paused until a valid App ID is configured.`, 'error');
            return;
        }

        updateConnectionStatus('disconnected');
        if (intentionallyClosed) {
            addLog('WebSocket connection closed cleanly. Not reconnecting.', 'error');
            return;
        }

        // Switch to alternate gateway on abnormal closure
        const gateways = getDerivGateways(appId);
        if (event.code !== 1000) {
            currentGatewayIndex = (currentGatewayIndex + 1) % gateways.length;
        }

        // Real close reason instead of a generic message, so a bad
        // app_id, invalid token, or network block is actually diagnosable.
        addLog(`WebSocket connection closed (code ${event.code}${event.reason ? ': ' + event.reason : ''}).`, 'error');

        // Exponential backoff instead of hammering the server every 3s.
        reconnectAttempts++;
        const delay = Math.min(3000 * Math.pow(2, reconnectAttempts - 1), 30000);
        const nextGw = gateways[currentGatewayIndex];
        addLog(`Reconnecting via ${nextGw ? nextGw.name : 'gateway'} in ${Math.round(delay / 1000)}s...`, 'error');
        setTimeout(connectWS, delay);
    };

    ws.onerror = (event) => {
        if (connectionTimeoutTimer) {
            clearTimeout(connectionTimeoutTimer);
            connectionTimeoutTimer = null;
        }
        addLog(`WebSocket error occurred on ${currentHost} (readyState ${ws ? ws.readyState : 'none'}).`, 'error');
    };
}

function handleOpenContract(poc) {
    if (!poc) return;
    if (poc.is_sold) {
        const isWin = poc.status === 'won';
        const profit = poc.profit;
        addLog(`Contract #${poc.contract_id} closed: ${poc.status.toUpperCase()} (${profit >= 0 ? '+' : ''}${profit} ${poc.currency || ''})`);
        showBanner(`Deriv Trade ${poc.status.toUpperCase()} (${profit >= 0 ? '+' : ''}${profit} ${poc.currency || ''})`, isWin ? 'sawa' : 'mbaya');
    }
}

function handleActiveSymbols(symbols) {
    if (!symbols || symbols.length === 0) {
        addLog('Active symbols list empty or restricted in current region; using calibrated synthetic index definitions.');
    } else {
        let matched = 0;
        symbols.forEach(s => {
            const sym = s.symbol || s.instrument_code || s.underlying_symbol;
            if (digitStats[sym] && s.pip) {
                const pipStr = s.pip.toString();
                const decimals = pipStr.includes('.') ? pipStr.split('.')[1].length : 0;
                digitStats[sym].decimals = decimals;
                matched++;
            }
        });
        addLog(`Matched pip/decimal info for ${matched}/${markets.length} tracked volatility indices.`);
    }

    symbolsReady = true;
    // Ensure all markets are requested if not already loading
    requestAllMarketHistories(!!apiToken && !authFailed);
}

function requestAllMarketHistories(subscribe = false) {
    markets.forEach(m => requestTickHistory(m.id, subscribe));
}

function requestTickHistory(symbol, subscribe = false) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const reqId = ++reqCounter;
    reqIdToSymbol[reqId] = symbol;

    const payload = {
        ticks_history: symbol,
        adjust_start_time: 1,
        count: MAX_SAMPLE,
        end: 'latest',
        start: 1,
        style: 'ticks',
        req_id: reqId
    };
    if (subscribe) {
        payload.subscribe = 1;
    }
    ws.send(JSON.stringify(payload));
}

let pollRoundRobinIndex = 0;
function startPublicTickPolling() {
    if (tickPollInterval) return; // already active
    tickPollInterval = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // Poll the active market's latest tick every second
        const reqIdActive = ++reqCounter;
        reqIdToSymbol[reqIdActive] = activeMarket;
        ws.send(JSON.stringify({
            ticks_history: activeMarket,
            count: 1,
            end: 'latest',
            style: 'ticks',
            req_id: reqIdActive
        }));

        // Poll other markets in a round-robin rotation so all radar cards stay fresh
        pollRoundRobinIndex = (pollRoundRobinIndex + 1) % markets.length;
        const otherMarket = markets[pollRoundRobinIndex].id;
        if (otherMarket !== activeMarket) {
            const reqIdOther = ++reqCounter;
            reqIdToSymbol[reqIdOther] = otherMarket;
            ws.send(JSON.stringify({
                ticks_history: otherMarket,
                count: 1,
                end: 'latest',
                style: 'ticks',
                req_id: reqIdOther
            }));
        }
    }, 1000);
}

function handleHistory(data) {
    const symbol = (data.echo_req && data.echo_req.ticks_history) || reqIdToSymbol[data.req_id];
    if (!symbol || !digitStats[symbol]) return;

    const prices = (data.history && data.history.prices) || [];
    const times = (data.history && data.history.times) || [];
    const stat = digitStats[symbol];

    if (prices.length === 1) {
        // Single tick polled from public fallback stream
        const quote = parseFloat(prices[0]);
        const epoch = times[0] || Math.floor(Date.now() / 1000);
        handleTick({ symbol, quote, epoch });
        return;
    }

    if (stat.decimals === null) {
        if (DEFAULT_DECIMALS[symbol] !== undefined) {
            stat.decimals = DEFAULT_DECIMALS[symbol];
        } else if (prices.length) {
            const str = prices[0].toString();
            stat.decimals = str.includes('.') ? str.split('.')[1].length : 0;
        } else {
            stat.decimals = 2;
        }
    }

    stat.prices = [];
    stat.digits = [];
    stat.directions = [];
    stat.lastPrice = null;

    prices.forEach(p => pushPrice(symbol, parseFloat(p)));

    addLog(`Loaded ${prices.length} historical ticks for ${symbol}`);
    updateRadarCard(symbol);
    if (symbol === scopeMarket) updateScopePanel();

    if (symbol === activeMarket) {
        elCurrentPriceDisplay.textContent = stat.lastPrice !== null ? stat.lastPrice.toFixed(stat.decimals || 2) : 'waiting for data...';
        updateGaugeUI();
        recomputeAutoSuggestion();
    }
    if (elDualMarketSelect && (elDualMarketSelect.value === symbol || !elDualMarketSelect.value)) updateDualAssistant();
}

function handleTick(tick) {
    const symbol = tick.symbol;
    if (!symbol || !digitStats[symbol]) return;

    // Avoid duplicate calculations if quote hasn't changed
    const stat = digitStats[symbol];
    if (stat.lastPrice === tick.quote && stat.prices.length > 0) return;

    pushPrice(symbol, tick.quote);
    updateRadarCard(symbol);
    if (symbol === scopeMarket) updateScopePanel();

    if (symbol === activeMarket) {
        elCurrentPriceDisplay.textContent = tick.quote.toFixed(stat.decimals || 2);
        updateGaugeUI();
        recomputeAutoSuggestion();
        checkActivePrediction();
    }

    if (elDualMarketSelect && elDualMarketSelect.value === symbol) updateDualAssistant();
}

function pushPrice(symbol, price) {
    const stat = digitStats[symbol];
    if (stat.decimals === null) stat.decimals = 2;

    const digit = parseInt(price.toFixed(stat.decimals).slice(-1));
    const direction = stat.lastPrice !== null ? (price > stat.lastPrice ? 1 : (price < stat.lastPrice ? -1 : 0)) : 0;

    stat.prices.push(price);
    stat.digits.push(digit);
    stat.directions.push(direction);

    if (stat.prices.length > MAX_SAMPLE) {
        stat.prices.shift();
        stat.digits.shift();
        stat.directions.shift();
    }

    stat.lastPrice = price;
}

function updateConnectionStatus(status) {
    if (status === 'invalid_app_id') {
        isConnected = false;
        elGlobalStatusDot.className = 'status-indicator error';
        elGlobalStatusText.innerHTML = 'App ID needed for this domain — <span style="text-decoration:underline;cursor:pointer;color:var(--accent-yellow);" id="open-config-status-btn">configure</span>';
        const btn = document.getElementById('open-config-status-btn');
        if (btn) btn.onclick = (e) => { e.stopPropagation(); openLoginModal(); };
        elMarketStatusDot.className = 'status-indicator error';
        elMarketStatusText.textContent = 'App ID required';
        return;
    }

    isConnected = status === 'connected';
    const classList = ['status-indicator', status];
    const connectingLabel = reconnectAttempts > 0 ? 'reconnecting...' : 'connecting...';
    let text = status === 'connected' ? 'connected (public stream)' : (status === 'connecting' ? connectingLabel : 'disconnected');
    if (status === 'connected' && apiToken && !authFailed) {
        text = 'connected (authorized)';
    }

    elGlobalStatusDot.className = classList.join(' ');
    elGlobalStatusText.textContent = text;
    elMarketStatusDot.className = classList.join(' ');
    elMarketStatusText.textContent = text;
}

// Stats engine 
function computeStats(symbol, sampleSize) {
    const stat = digitStats[symbol];
    if (!stat) return null;

    const n = Math.min(sampleSize || radarSampleSize, stat.digits.length);
    if (n === 0) return null;

    const digits = stat.digits.slice(-n);
    const directions = stat.directions.slice(-n);

    const digitFreq = new Array(10).fill(0);
    let evenCount = 0, oddCount = 0;
    let overCount = 0, underCount = 0;
    digits.forEach(d => {
        digitFreq[d]++;
        if (d % 2 === 0) evenCount++; else oddCount++;
        if (d > radarOuBarrier) overCount++;
        else if (d < radarOuBarrier) underCount++;
    });

    let upCount = 0, downCount = 0, flatCount = 0;
    directions.forEach(dir => {
        if (dir === 1) upCount++;
        else if (dir === -1) downCount++;
        else flatCount++;
    });
    const validMoves = upCount + downCount;

    const digitPct = digitFreq.map(c => (c / n) * 100);
    const overUnderTotal = overCount + underCount;

    return {
        n,
        digitFreq,
        digitPct,
        evenPct: (evenCount / n) * 100,
        oddPct: (oddCount / n) * 100,
        risePct: validMoves ? (upCount / validMoves) * 100 : 50,
        fallPct: validMoves ? (downCount / validMoves) * 100 : 50,
        overPct: overUnderTotal ? (overCount / overUnderTotal) * 100 : 50,
        underPct: overUnderTotal ? (underCount / overUnderTotal) * 100 : 50,
        lastPrice: stat.lastPrice,
        decimals: stat.decimals
    };
}

function edgeTag(pctA) {
    const edge = Math.abs(pctA - 50);
    if (edge >= 8) return { cls: 'strong', label: 'STRONG EDGE' };
    if (edge >= 3) return { cls: 'mild', label: 'MILD EDGE' };
    return { cls: 'flat', label: 'NO EDGE' };
}

// Momentum Gauge
function updateGaugeUI() {
    const s = computeStats(activeMarket, radarSampleSize);
    if (!s || s.risePct === undefined) {
        setGaugeValue(50, 'neutral');
        return;
    }
    const momentumPercent = Math.round(s.risePct);
    let label = 'neutral';
    if (momentumPercent > 70) label = 'hot';
    else if (momentumPercent > 55) label = 'warm';
    else if (momentumPercent < 30) label = 'cold';
    else if (momentumPercent < 45) label = 'cool';

    setGaugeValue(momentumPercent, label);
}

function setGaugeValue(percent, label) {
    elMomentumVal.textContent = `${percent}K`;
    elMomentumLabel.textContent = label;
    const angle = (percent / 100) * 180 - 90;
    elGaugeNeedle.style.transform = `rotate(${angle}deg)`;
}

// Auto-Predict 
function recomputeAutoSuggestion() {
    if (predMode !== 'auto') return;
    const s = computeStats(activeMarket, radarSampleSize);
    if (!s) {
        elAutoSide.textContent = 'waiting for data...';
        elAutoSide.className = 'auto-side side-neutral';
        elAutoConfidence.textContent = '--%';
        elAutoBarFill.style.width = '50%';
        autoSuggestion = null;
        return;
    }

    let action, label, confidence, sideClass;

    if (predType === 'rise_fall') {
        const upFav = s.risePct >= s.fallPct;
        action = upFav ? 'up' : 'down';
        label = upFav ? '↑ RISE' : '↓ FALL';
        confidence = upFav ? s.risePct : s.fallPct;
        sideClass = upFav ? 'side-a' : 'side-b';
    } else if (predType === 'even_odd') {
        const evenFav = s.evenPct >= s.oddPct;
        action = evenFav ? 'up' : 'down';
        label = evenFav ? 'EVEN' : 'ODD';
        confidence = evenFav ? s.evenPct : s.oddPct;
        sideClass = evenFav ? 'side-a' : 'side-b';
    } else if (predType === 'over_under') {
        const overFav = s.overPct >= s.underPct;
        action = overFav ? 'up' : 'down';
        label = overFav ? `OVER ${radarOuBarrier}` : `UNDER ${radarOuBarrier}`;
        confidence = overFav ? s.overPct : s.underPct;
        sideClass = overFav ? 'side-a' : 'side-b';
    } else { // matches_differs
        // Best "Matches" candidate = most frequent digit. Best "Differs" candidate = least frequent digit.
        let hottest = 0, coolest = 0;
        for (let d = 1; d < 10; d++) {
            if (s.digitPct[d] > s.digitPct[hottest]) hottest = d;
            if (s.digitPct[d] < s.digitPct[coolest]) coolest = d;
        }
        // Differs is naturally ~90% likely on any digit, so it only becomes an interesting
        // "signal" when Matches has an unusually strong peak digit to fade.
        const matchesEdge = s.digitPct[hottest] - 10; // vs the flat 10% baseline
        if (matchesEdge >= 2) {
            action = 'up';
            predDigit = hottest;
            label = `MATCHES ${hottest}`;
            confidence = s.digitPct[hottest];
        } else {
            action = 'down';
            predDigit = coolest;
            label = `DIFFERS ${coolest}`;
            confidence = 100 - s.digitPct[coolest];
        }
        sideClass = action === 'up' ? 'side-a' : 'side-b';
        syncDigitButtons();
    }

    autoSuggestion = { action, label, confidence: Math.round(confidence * 10) / 10 };

    elAutoSide.textContent = label;
    elAutoSide.className = `auto-side ${sideClass}`;
    elAutoConfidence.textContent = `${autoSuggestion.confidence}%`;
    elAutoBarFill.style.width = `${Math.min(100, Math.max(0, autoSuggestion.confidence))}%`;
}

function syncDigitButtons() {
    elDigitBtns.forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.val) === predDigit);
    });
}

// Prediction Logic
function placePrediction(action) {
    if (activePrediction) {
        alert("A prediction is already running.");
        return;
    }
    const stat = digitStats[activeMarket];
    if (!stat || stat.lastPrice === null) {
        alert("Waiting for market data...");
        return;
    }

    const s = computeStats(activeMarket, radarSampleSize);
    let withTrend = false;
    if (predType === 'rise_fall') {
        withTrend = (action === 'up' && s.risePct >= 50) || (action === 'down' && s.fallPct >= 50);
    } else if (predType === 'even_odd') {
        withTrend = (action === 'up' && s.evenPct >= 50) || (action === 'down' && s.oddPct >= 50);
    } else if (predType === 'over_under') {
        withTrend = (action === 'up' && s.overPct >= 50) || (action === 'down' && s.underPct >= 50);
    } else {
        withTrend = true;
    }

    if (apiToken && ws && ws.readyState === WebSocket.OPEN && !authFailed) {
        addLog(`Executing live Deriv order for ${activeMarket}: ${actionLabel(predType, action, predDigit)}...`);
        let contractType = null;
        let barrier = null;

        if (predType === 'rise_fall') {
            contractType = action === 'up' ? 'CALL' : 'PUT';
        } else if (predType === 'even_odd') {
            contractType = action === 'up' ? 'DIGITEVEN' : 'DIGITODD';
        } else if (predType === 'over_under') {
            contractType = action === 'up' ? 'DIGITOVER' : 'DIGITUNDER';
            barrier = predDigit.toString();
        } else if (predType === 'matches_differs') {
            contractType = action === 'up' ? 'DIGITMATCH' : 'DIGITDIFF';
            barrier = predDigit.toString();
        }

        if (contractType) {
            const buyParams = {
                amount: 1,
                basis: 'stake',
                contract_type: contractType,
                currency: accountCurrency || 'USD',
                duration: predDuration,
                duration_unit: 't',
                symbol: activeMarket
            };
            if (barrier !== null) {
                buyParams.barrier = barrier;
            }

            ws.send(JSON.stringify({
                buy: 1,
                price: 1,
                parameters: buyParams
            }));
        }
    }

    activePrediction = {
        market: activeMarket,
        startPrice: stat.lastPrice,
        type: predType,
        digit: predDigit,
        action: action,
        targetTicks: predDuration,
        ticksPassed: 0,
        withTrend: withTrend,
        timestamp: new Date().getTime()
    };

    showBanner('Prediction locked in!', 'sawa');
}

function checkActivePrediction() {
    if (!activePrediction) return;

    activePrediction.ticksPassed++;

    if (activePrediction.ticksPassed >= activePrediction.targetTicks) {
        resolvePrediction();
    }
}

function resolvePrediction() {
    const stat = digitStats[activePrediction.market];
    const endPrice = stat.lastPrice;
    const startPrice = activePrediction.startPrice;
    const decimals = stat.decimals || 2;
    let isWin = false;

    if (activePrediction.type === 'rise_fall') {
        if (activePrediction.action === 'up') isWin = endPrice > startPrice;
        if (activePrediction.action === 'down') isWin = endPrice < startPrice;
    } else if (activePrediction.type === 'even_odd') {
        const lastDigit = parseInt(endPrice.toFixed(decimals).slice(-1));
        const isEven = lastDigit % 2 === 0;
        if (activePrediction.action === 'up') isWin = isEven;
        if (activePrediction.action === 'down') isWin = !isEven;
    } else if (activePrediction.type === 'over_under') {
        const lastDigit = parseInt(endPrice.toFixed(decimals).slice(-1));
        if (activePrediction.action === 'up') isWin = lastDigit > activePrediction.digit;
        if (activePrediction.action === 'down') isWin = lastDigit < activePrediction.digit;
    } else if (activePrediction.type === 'matches_differs') {
        const lastDigit = parseInt(endPrice.toFixed(decimals).slice(-1));
        const isMatch = lastDigit === activePrediction.digit;
        if (activePrediction.action === 'up') isWin = isMatch;   // Matches
        if (activePrediction.action === 'down') isWin = !isMatch; // Differs
    }

    if (activePrediction.withTrend) {
        showBanner('Iko Sawa (Trend Aligned)', 'sawa');
    } else {
        showBanner('Iko Mbaya (Against Trend)', 'mbaya');
    }

    predictions.unshift({
        market: activePrediction.market,
        type: activePrediction.type,
        action: activePrediction.action,
        digit: activePrediction.digit,
        isWin: isWin,
        date: new Date().toLocaleString()
    });

    if (predictions.length > 50) predictions.pop();
    localStorage.setItem('kelvin_predictions', JSON.stringify(predictions));

    activePrediction = null;
    updateStatsUI();
}

// --- UI Updates ---
function updateStatsUI() {
    elHistoryList.innerHTML = '';

    if (predictions.length === 0) {
        elHistoryList.innerHTML = '<div class="empty-state">no predictions yet</div>';
        elAccuracyText.textContent = '—%';
        elAccuracyBar.style.width = '0%';
        elAccuracySubtext.textContent = 'no predictions yet';
        elAccuracyBreakdown.innerHTML = '';
        return;
    }

    let wins = 0;
    const byType = {}; // type -> {wins, total}

    predictions.forEach(p => {
        if (p.isWin) wins++;

        if (!byType[p.type]) byType[p.type] = { wins: 0, total: 0 };
        byType[p.type].total++;
        if (p.isWin) byType[p.type].wins++;

        const el = document.createElement('div');
        el.className = 'history-item';

        let actionText = actionLabel(p.type, p.action, p.digit);

        const outcomeClass = p.isWin ? 'win' : 'loss';
        const outcomeText = p.isWin ? 'WON' : 'LOST';

        el.innerHTML = `
            <span>${p.market} - ${actionText}</span>
            <span class="outcome ${outcomeClass}">${outcomeText}</span>
        `;
        elHistoryList.appendChild(el);
    });

    const accuracy = Math.round((wins / predictions.length) * 100);
    elAccuracyText.textContent = `${accuracy}%`;
    elAccuracyBar.style.width = `${accuracy}%`;
    elAccuracySubtext.textContent = `${wins} won out of ${predictions.length}`;

    const typeNames = { rise_fall: 'Rise/Fall', even_odd: 'Even/Odd', over_under: 'Over/Under', matches_differs: 'Matches/Differs' };
    elAccuracyBreakdown.innerHTML = '';
    Object.keys(typeNames).forEach(t => {
        const rec = byType[t];
        const row = document.createElement('div');
        row.className = 'breakdown-row';
        if (rec) {
            const pct = Math.round((rec.wins / rec.total) * 100);
            row.innerHTML = `<span>${typeNames[t]}</span><span>${pct}% (${rec.wins}/${rec.total})</span>`;
        } else {
            row.innerHTML = `<span>${typeNames[t]}</span><span>—</span>`;
        }
        elAccuracyBreakdown.appendChild(row);
    });
}

function actionLabel(type, action, digit) {
    if (type === 'rise_fall') return action === 'up' ? 'Rise' : 'Fall';
    if (type === 'even_odd') return action === 'up' ? 'Even' : 'Odd';
    if (type === 'over_under') return action === 'up' ? `Over ${digit}` : `Under ${digit}`;
    if (type === 'matches_differs') return action === 'up' ? `Matches ${digit}` : `Differs ${digit}`;
    return action;
}

function showBanner(text, type) {
    elBannerText.textContent = text;
    elBanner.className = `notification-banner ${type}`;
    elBanner.style.display = 'block';

    setTimeout(() => {
        elBanner.style.display = 'none';
    }, 3000);
}

function renderMarketSelectors() {
    elHeaderMarkets.innerHTML = '';
    elMarketCards.innerHTML = '';

    markets.forEach(m => {
        const pill = document.createElement('button');
        pill.className = `market-pill ${m.id === activeMarket ? 'active' : ''}`;
        pill.textContent = m.id;
        pill.onclick = () => selectMarket(m.id);
        elHeaderMarkets.appendChild(pill);

        const card = document.createElement('div');
        card.className = `m-card ${m.id === activeMarket ? 'active' : ''}`;
        card.onclick = () => selectMarket(m.id);
        card.innerHTML = `
            <h3>${m.id}</h3>
            <div class="m-price" id="card-price-${m.id}">-</div>
            <div class="m-trend">trend</div>
        `;
        elMarketCards.appendChild(card);
    });
}

function selectMarket(marketId) {
    activeMarket = marketId;
    const marketObj = markets.find(m => m.id === marketId);
    elActiveMarketName.textContent = marketObj.name;

    const stat = digitStats[marketId];
    elCurrentPriceDisplay.textContent = stat && stat.lastPrice !== null ? stat.lastPrice.toFixed(stat.decimals || 2) : 'waiting for data...';

    renderMarketSelectors();
    updateGaugeUI();
    recomputeAutoSuggestion();
    highlightActiveRadarCard();
}

// Digit Radar
function renderRadarSkeleton() {
    elRadarGrid.innerHTML = '';
    markets.forEach(m => {
        const card = document.createElement('div');
        card.className = `radar-card ${m.id === activeMarket ? 'is-active' : ''}`;
        card.id = `radar-card-${m.id}`;
        card.onclick = () => selectMarket(m.id);
        card.innerHTML = `
            <div class="radar-card-head">
                <h3>${m.id}</h3>
                <span class="radar-card-price" id="radar-price-${m.id}">—</span>
            </div>
            <div class="radar-sample-note" id="radar-sample-${m.id}">waiting for ticks...</div>
            <div class="digit-circles" id="radar-digits-${m.id}"></div>
            <div class="split-bar-row">
                <div class="split-bar-label"><span>Even</span><span>Odd</span></div>
                <div class="split-bar" id="radar-evenodd-${m.id}"></div>
            </div>
            <div class="split-bar-row">
                <div class="split-bar-label"><span>Rise</span><span>Fall</span></div>
                <div class="split-bar" id="radar-risefall-${m.id}"></div>
            </div>
            <div class="split-bar-row">
                <div class="split-bar-label"><span id="radar-over-label-${m.id}">Over 4</span><span id="radar-under-label-${m.id}">Under 4</span></div>
                <div class="split-bar" id="radar-overunder-${m.id}"></div>
            </div>
            <div class="radar-suggestion" id="radar-suggestion-${m.id}">gathering data…</div>
        `;
        elRadarGrid.appendChild(card);
    });
}

function highlightActiveRadarCard() {
    markets.forEach(m => {
        const card = document.getElementById(`radar-card-${m.id}`);
        if (card) card.classList.toggle('is-active', m.id === activeMarket);
    });
}

function updateRadarCard(symbol) {
    const stat = digitStats[symbol];
    if (!stat) return;

    const priceEl = document.getElementById(`radar-price-${symbol}`);
    if (priceEl && stat.lastPrice !== null) priceEl.textContent = stat.lastPrice.toFixed(stat.decimals || 2);

    const cardPriceEl = document.getElementById(`card-price-${symbol}`);
    if (cardPriceEl && stat.lastPrice !== null) cardPriceEl.textContent = stat.lastPrice.toFixed(stat.decimals || 2);

    const s = computeStats(symbol, radarSampleSize);
    const sampleEl = document.getElementById(`radar-sample-${symbol}`);
    if (!s) {
        if (sampleEl) sampleEl.textContent = 'gathering ticks…';
        return;
    }
    if (sampleEl) sampleEl.textContent = `Last ${s.n} ticks`;

    // Digit circles
    const digitsEl = document.getElementById(`radar-digits-${symbol}`);
    if (digitsEl) {
        let hottest = 0, coolest = 0;
        for (let d = 1; d < 10; d++) {
            if (s.digitPct[d] > s.digitPct[hottest]) hottest = d;
            if (s.digitPct[d] < s.digitPct[coolest]) coolest = d;
        }
        digitsEl.innerHTML = '';
        for (let d = 0; d < 10; d++) {
            const c = document.createElement('div');
            let cls = 'digit-circle';
            if (d === hottest) cls += ' hottest';
            else if (d === coolest) cls += ' coolest';
            c.className = cls;
            c.innerHTML = `<span class="digit-num">${d}</span><span class="digit-pct">${s.digitPct[d].toFixed(1)}%</span>`;
            digitsEl.appendChild(c);
        }
    }

    // Even/Odd bar
    renderSplitBar(`radar-evenodd-${symbol}`, s.evenPct, s.oddPct);
    // Rise/Fall bar
    renderSplitBar(`radar-risefall-${symbol}`, s.risePct, s.fallPct);
    // Over/Under bar
    renderSplitBar(`radar-overunder-${symbol}`, s.overPct, s.underPct);
    const overLbl = document.getElementById(`radar-over-label-${symbol}`);
    const underLbl = document.getElementById(`radar-under-label-${symbol}`);
    if (overLbl) overLbl.textContent = `Over ${radarOuBarrier}`;
    if (underLbl) underLbl.textContent = `Under ${radarOuBarrier}`;

    // Suggestion (pick whichever of the 3 pairs currently shows the biggest edge)
    const candidates = [
        { name: 'EVEN', pct: s.evenPct, other: 'ODD', otherPct: s.oddPct },
        { name: 'ODD', pct: s.oddPct, other: 'EVEN', otherPct: s.evenPct },
        { name: 'RISE', pct: s.risePct, other: 'FALL', otherPct: s.fallPct },
        { name: 'FALL', pct: s.fallPct, other: 'RISE', otherPct: s.risePct },
        { name: `OVER ${radarOuBarrier}`, pct: s.overPct, other: `UNDER ${radarOuBarrier}`, otherPct: s.underPct },
        { name: `UNDER ${radarOuBarrier}`, pct: s.underPct, other: `OVER ${radarOuBarrier}`, otherPct: s.overPct }
    ];
    let best = candidates[0];
    candidates.forEach(c => { if (c.pct > best.pct) best = c; });
    const tag = edgeTag(best.pct);

    const suggestEl = document.getElementById(`radar-suggestion-${symbol}`);
    if (suggestEl) {
        suggestEl.innerHTML = `<span>Favored: <strong>${best.name}</strong> ${best.pct.toFixed(1)}%</span><span class="edge-tag ${tag.cls}">${tag.label}</span>`;
    }
}

function renderSplitBar(elId, pctA, pctB) {
    const el = document.getElementById(elId);
    if (!el) return;
    const a = Math.max(2, Math.round(pctA));
    const b = 100 - a;
    el.innerHTML = `
        <div class="split-bar-a" style="width:${a}%">${pctA.toFixed(1)}%</div>
        <div class="split-bar-b" style="width:${b}%">${pctB.toFixed(1)}%</div>
    `;
}

// AI Scanner
function runScanner() {
    elScanBtn.disabled = true;
    elScanBtn.textContent = 'SCANNING…';
    elScannerResult.style.display = 'none';
    elScannerConsole.innerHTML = '';

    const lines = [
        { t: '[INFO] Authenticating AI market matrix...', c: '' },
        { t: '[OK] Synthetic stream linked for all volatility indices', c: 'ok' },
        { t: '[INFO] Reading digit distribution across markets...', c: '' },
        { t: '[INFO] Reading Even/Odd, Rise/Fall, Over/Under splits...', c: '' },
        { t: '[WARNING] Ignoring markets with under 30 sampled ticks', c: 'warn' },
        { t: '[INFO] Ranking edges by distance from 50/50...', c: '' }
    ];

    lines.forEach((line, i) => {
        setTimeout(() => {
            const div = document.createElement('div');
            div.className = `console-line ${line.c}`;
            div.textContent = line.t;
            elScannerConsole.appendChild(div);
            elScannerConsole.scrollTop = elScannerConsole.scrollHeight;
        }, i * 260);
    });

    setTimeout(() => {
        const result = scanAllMarkets();
        const doneLine = document.createElement('div');
        if (result) {
            doneLine.className = 'console-line ok';
            doneLine.textContent = `[OK] Best edge found: ${result.market} — ${result.name} at ${result.pct.toFixed(1)}%`;
        } else {
            doneLine.className = 'console-line warn';
            doneLine.textContent = '[WARNING] Not enough tick data yet — reconnect or wait a few seconds.';
        }
        elScannerConsole.appendChild(doneLine);
        elScannerConsole.scrollTop = elScannerConsole.scrollHeight;

        if (result) {
            elScannerResult.style.display = 'block';
            elScannerResult.innerHTML = `
                <h3>Strongest edge right now</h3>
                <div class="result-row"><span>Market</span><span>${result.market}</span></div>
                <div class="result-row"><span>Suggested entry</span><span>${result.name}</span></div>
                <div class="result-row"><span>Sampled probability</span><span>${result.pct.toFixed(1)}%</span></div>
                <div class="result-row"><span>Sample size</span><span>${result.n} ticks</span></div>
                <button class="primary-btn scanner-open-scope-btn" id="scanner-open-scope-btn">Open in Digit Scope →</button>
            `;
            const openBtn = document.getElementById('scanner-open-scope-btn');
            if (openBtn) {
                openBtn.addEventListener('click', () => openResultInScope(result));
            }
        }

        elScanBtn.disabled = false;
        elScanBtn.textContent = 'SCAN ALL MARKETS FOR BEST ENTRY';
    }, lines.length * 260 + 400);
}

function scanAllMarkets() {
    let best = null;
    markets.forEach(m => {
        const s = computeStats(m.id, radarSampleSize);
        if (!s || s.n < 30) return;
        const candidates = [
            { name: 'EVEN', pct: s.evenPct },
            { name: 'ODD', pct: s.oddPct },
            { name: 'RISE', pct: s.risePct },
            { name: 'FALL', pct: s.fallPct },
            { name: `OVER ${radarOuBarrier}`, pct: s.overPct },
            { name: `UNDER ${radarOuBarrier}`, pct: s.underPct }
        ];
        candidates.forEach(c => {
            if (!best || c.pct > best.pct) {
                best = { market: m.id, name: c.name, pct: c.pct, n: s.n };
            }
        });
    });
    return best;
}

// Jump from a scanner result straight into Digit Scope, pre-selecting
// the market and trade type the scanner flagged as the strongest edge.
function openResultInScope(result) {
    if (!result) return;

    scopeMarket = result.market;
    if (result.name === 'EVEN' || result.name === 'ODD') {
        scopeTradeType = 'even_odd';
    } else if (result.name === 'RISE' || result.name === 'FALL') {
        scopeTradeType = 'rise_fall';
    } else if (result.name.startsWith('OVER') || result.name.startsWith('UNDER')) {
        scopeTradeType = 'over_under';
    }

    if (elScopeMarketSelect) elScopeMarketSelect.value = scopeMarket;
    if (elScopeTradeType) elScopeTradeType.value = scopeTradeType;
    updateScopePanel();

    const scopeNavBtn = document.querySelector('.nav-btn[data-page="page-scope"]');
    if (scopeNavBtn) scopeNavBtn.click();
}

// Digit Scope panel
function populateScopeMarketSelect() {
    elScopeMarketSelect.innerHTML = '';
    markets.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.id;
        elScopeMarketSelect.appendChild(opt);
    });
    elScopeMarketSelect.value = scopeMarket;
    updateScopePanel();
}

function updateScopePanel() {
    const symbol = scopeMarket;
    const stat = digitStats[symbol];

    if (stat && stat.lastPrice !== null) {
        elScopePrice.textContent = stat.lastPrice.toFixed(stat.decimals || 2);
    } else {
        elScopePrice.textContent = 'waiting for data...';
    }

    const s = computeStats(symbol, scopeSampleSize);
    if (!s) {
        elScopeDigits.innerHTML = '';
        elScopeHistoryTrack.innerHTML = '';
        elScopeBars.innerHTML = '';
        elScopeNote.textContent = 'gathering ticks…';
        return;
    }

    const lastDigit = stat.digits.length ? stat.digits[stat.digits.length - 1] : null;
    let favored = 0, coolest = 0;
    for (let d = 1; d < 10; d++) {
        if (s.digitPct[d] > s.digitPct[favored]) favored = d;
        if (s.digitPct[d] < s.digitPct[coolest]) coolest = d;
    }

    // Digit circles 0-9
    elScopeDigits.innerHTML = '';
    for (let d = 0; d < 10; d++) {
        const c = document.createElement('div');
        let cls = 'scope-digit';
        if (d === favored) cls += ' is-favored';
        else if (d === coolest) cls += ' is-coolest';
        if (d === lastDigit) cls += ' is-current';
        c.className = cls;
        c.innerHTML = `<span class="scope-digit-num">${d}</span><span class="scope-digit-pct">${s.digitPct[d].toFixed(2)}%</span>` +
            (d === lastDigit ? '<span class="scope-digit-marker"></span>' : '');
        elScopeDigits.appendChild(c);
    }

    // Recent E/O history strip
    elScopeHistoryTrack.innerHTML = '';
    const recentDigits = stat.digits.slice(-40);
    recentDigits.forEach(d => {
        const dot = document.createElement('div');
        const isEven = d % 2 === 0;
        dot.className = `scope-history-dot ${isEven ? 'even' : 'odd'}`;
        dot.textContent = isEven ? 'E' : 'O';
        elScopeHistoryTrack.appendChild(dot);
    });
    elScopeHistoryTrack.scrollLeft = elScopeHistoryTrack.scrollWidth;

    // Bars driven by the selected Trade Type
    elScopeBars.innerHTML = '';
    let rows;
    if (scopeTradeType === 'over_under') {
        rows = [
            { tag: `Over ${radarOuBarrier}`, pct: s.overPct, side: 'a' },
            { tag: `Under ${radarOuBarrier}`, pct: s.underPct, side: 'b' }
        ];
    } else if (scopeTradeType === 'rise_fall') {
        rows = [
            { tag: 'Rise', pct: s.risePct, side: 'a' },
            { tag: 'Fall', pct: s.fallPct, side: 'b' }
        ];
    } else {
        rows = [
            { tag: 'Even', pct: s.evenPct, side: 'a' },
            { tag: 'Odd', pct: s.oddPct, side: 'b' }
        ];
    }
    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'scope-bar-row';
        row.innerHTML = `
            <span class="scope-bar-tag">${r.tag}</span>
            <div class="scope-bar-track">
                <div class="scope-bar-fill side-${r.side}" style="width:${r.pct.toFixed(1)}%;">${r.pct.toFixed(1)}%</div>
            </div>
        `;
        elScopeBars.appendChild(row);
    });

    elScopeNote.textContent = `Last ${s.n} ticks analyzed`;
}

// Bot Generator (builds a Deriv Bot / DBot Blockly XML strategy file)
function blocklyId() {
    // Blockly just needs a unique-ish string id per block.
    return 'k' + Math.random().toString(36).slice(2, 10);
}

// Works out which side Kelvin favors for a given trade type
function getContractInfoForType(tradeType, symbol, sampleSize, barrierDigit) {
    const s = computeStats(symbol, sampleSize);
    if (!s) return null;

    if (tradeType === 'over_under') {
        const over = s.overPct >= s.underPct;
        return {
            category: 'digits',
            dbotTradeType: 'overunder',
            hasPrediction: true,
            barrier: barrierDigit,
            contractA: 'DIGITOVER',
            contractB: 'DIGITUNDER',
            favoredContract: over ? 'DIGITOVER' : 'DIGITUNDER',
            label: over ? `OVER ${barrierDigit}` : `UNDER ${barrierDigit}`,
            pct: over ? s.overPct : s.underPct
        };
    }
    if (tradeType === 'matches_differs') {
        let favored = 0, coolest = 0;
        for (let d = 1; d < 10; d++) {
            if (s.digitPct[d] > s.digitPct[favored]) favored = d;
            if (s.digitPct[d] < s.digitPct[coolest]) coolest = d;
        }
        // Predict the hottest digit for MATCHES; DIFFERS bets against the coldest digit.
        const useMatches = s.digitPct[favored] >= (100 / 10) * 1.05; // only lean MATCHES if it's meaningfully hot
        const digit = useMatches ? favored : coolest;
        return {
            category: 'digits',
            dbotTradeType: 'matchesdiffers',
            hasPrediction: true,
            barrier: digit,
            contractA: 'DIGITMATCH',
            contractB: 'DIGITDIFF',
            favoredContract: useMatches ? 'DIGITMATCH' : 'DIGITDIFF',
            label: useMatches ? `MATCHES ${digit}` : `DIFFERS ${digit}`,
            pct: useMatches ? s.digitPct[favored] : (100 - s.digitPct[coolest])
        };
    }
    if (tradeType === 'rise_fall') {
        const rise = s.risePct >= s.fallPct;
        return {
            category: 'callput',
            dbotTradeType: 'callput',
            hasPrediction: false,
            barrier: null,
            contractA: 'CALL',
            contractB: 'PUT',
            favoredContract: rise ? 'CALL' : 'PUT',
            label: rise ? 'RISE' : 'FALL',
            pct: rise ? s.risePct : s.fallPct
        };
    }
    // even_odd (default)
    const even = s.evenPct >= s.oddPct;
    return {
        category: 'digits',
        dbotTradeType: 'evenodd',
        hasPrediction: false,
        barrier: null,
        contractA: 'DIGITEVEN',
        contractB: 'DIGITODD',
        favoredContract: even ? 'DIGITEVEN' : 'DIGITODD',
        label: even ? 'EVEN' : 'ODD',
        pct: even ? s.evenPct : s.oddPct
    };
}

// Back-compat alias used elsewhere for the Scope page's own trade-type selector.
function getFavoredContract() {
    const info = getContractInfoForType(scopeTradeType, scopeMarket, scopeSampleSize, radarOuBarrier);
    if (!info) return null;
    return {
        category: info.category,
        tradeType: info.dbotTradeType,
        contractType: info.favoredContract,
        label: info.label,
        pct: info.pct,
        barrier: info.barrier
    };
}

// Builds a "scanner" Deriv Bot
function updateBotBarrierFieldVisibility() {
    if (!elBotBarrierField) return;
    if (botGenTradeType === 'over_under') {
        elBotBarrierField.style.display = '';
        elBotBarrierLabel.textContent = 'Over/Under barrier (0–9)';
        if (elBotBarrier.value === '') elBotBarrier.value = radarOuBarrier;
    } else {
        elBotBarrierField.style.display = 'none';
    }
}

function buildBotXml(opts) {
    const {
        symbol, dbotTradeType, category, hasPrediction, barrier,
        contractA, contractB, startContract, flip,
        stake, duration, martingale, stopLoss
    } = opts;

    const idDef = blocklyId(), idMarket = blocklyId(), idType = blocklyId(), idContract = blocklyId(),
        idCandle = blocklyId(), idRestartBS = blocklyId(), idRestartErr = blocklyId(),
        idTradeOptions = blocklyId(), idDurShadow = blocklyId(), idAmtShadow = blocklyId(), idAmtGet = blocklyId(),
        idPredShadow = blocklyId(),
        idVarStake = blocklyId(), idVarDirection = blocklyId(), idVarTotalLoss = blocklyId(),
        idInitStake = blocklyId(), idInitStakeNum = blocklyId(),
        idInitDir = blocklyId(), idInitDirBool = blocklyId(),
        idInitLoss = blocklyId(), idInitLossNum = blocklyId(),
        idBefore = blocklyId(),
        idBeforeIf = blocklyId(), idBeforeIfGet = blocklyId(), idPurchaseA = blocklyId(), idPurchaseB = blocklyId(), idPurchaseOnly = blocklyId(),
        idAfter = blocklyId(),
        idAfterIf = blocklyId(), idResultCheck = blocklyId(),
        idWinSetStake = blocklyId(), idWinStakeNum = blocklyId(),
        idLossSetStake = blocklyId(), idLossMath = blocklyId(), idLossStakeGet = blocklyId(), idLossMultNum = blocklyId(),
        idLossSetDir = blocklyId(), idLossNegate = blocklyId(), idLossDirGet = blocklyId(),
        idProfitRead = blocklyId(), idProfitSetTotal = blocklyId(), idProfitChange = blocklyId(), idTotalLossGet = blocklyId(),
        idStopIf = blocklyId(), idStopCompare = blocklyId(), idStopTotalGet = blocklyId(), idStopNeg = blocklyId(), idStopNum = blocklyId(),
        idTradeAgain = blocklyId();

    const predictionValue = hasPrediction ? `
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="${idPredShadow}">
            <field name="NUM">${barrier}</field>
          </shadow>
        </value>` : '';

    const tradeOptionsMutation = `<mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="${hasPrediction ? 'true' : 'false'}"></mutation>`;

    // before_purchase: flip mode alternates contractA/contractB based on the
    // `direction` variable; non-flip mode always buys the single favored side.
    const beforePurchaseStack = flip ? `
      <block type="controls_if" id="${idBeforeIf}">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="variables_get" id="${idBeforeIfGet}">
            <field name="VAR" id="${idVarDirection}">direction</field>
          </block>
        </value>
        <statement name="DO0">
          <block type="purchase" id="${idPurchaseA}">
            <field name="PURCHASE_LIST">${contractA}</field>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="purchase" id="${idPurchaseB}">
            <field name="PURCHASE_LIST">${contractB}</field>
          </block>
        </statement>
      </block>` : `
      <block type="purchase" id="${idPurchaseOnly}">
        <field name="PURCHASE_LIST">${startContract}</field>
      </block>`;

    const flipOnLossBlock = flip ? `
            <next>
              <block type="variables_set" id="${idLossSetDir}">
                <field name="VAR" id="${idVarDirection}">direction</field>
                <value name="VALUE">
                  <block type="logic_negate" id="${idLossNegate}">
                    <value name="BOOL">
                      <block type="variables_get" id="${idLossDirGet}">
                        <field name="VAR" id="${idVarDirection}">direction</field>
                      </block>
                    </value>
                  </block>
                </value>
              </block>
            </next>` : '';

    // Optional stop-after-loss-of check: once cumulative loss exceeds the
    // threshold, the bot simply stops calling trade_again
    const tradeAgainStack = stopLoss > 0 ? `
      <block type="controls_if" id="${idStopIf}">
        <value name="IF0">
          <block type="logic_compare" id="${idStopCompare}">
            <field name="OP">GT</field>
            <value name="A">
              <block type="variables_get" id="${idStopTotalGet}">
                <field name="VAR" id="${idVarTotalLoss}">totalLoss</field>
              </block>
            </value>
            <value name="B">
              <block type="math_number" id="${idStopNum}">
                <field name="NUM">${stopLoss}</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="trade_again" id="${idTradeAgain}"></block>
        </statement>
      </block>` : `
      <block type="trade_again" id="${idTradeAgain}"></block>`;

    return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="${idVarStake}">stake</variable>
    <variable id="${idVarDirection}">direction</variable>
    <variable id="${idVarTotalLoss}">totalLoss</variable>
  </variables>
  <block type="trade_definition" id="${idDef}" deletable="false" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="${idMarket}" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="${idType}" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${category}</field>
            <field name="TRADETYPE_LIST">${dbotTradeType}</field>
            <next>
              <block type="trade_definition_contracttype" id="${idContract}" deletable="false" movable="false">
                <field name="TYPE_LIST">${flip ? 'both' : startContract}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="${idCandle}" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="${idRestartBS}" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="${idRestartErr}" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION">
      <block type="variables_set" id="${idInitStake}">
        <field name="VAR" id="${idVarStake}">stake</field>
        <value name="VALUE">
          <block type="math_number" id="${idInitStakeNum}">
            <field name="NUM">${stake}</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="${idInitDir}">
            <field name="VAR" id="${idVarDirection}">direction</field>
            <value name="VALUE">
              <block type="logic_boolean" id="${idInitDirBool}">
                <field name="BOOL">TRUE</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="${idInitLoss}">
                <field name="VAR" id="${idVarTotalLoss}">totalLoss</field>
                <value name="VALUE">
                  <block type="math_number" id="${idInitLossNum}">
                    <field name="NUM">0</field>
                  </block>
                </value>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="${idTradeOptions}">
        ${tradeOptionsMutation}
        <field name="DURATIONTYPE_LIST">t</field>
        <value name="DURATION">
          <shadow type="math_number" id="${idDurShadow}">
            <field name="NUM">${duration}</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number" id="${idAmtShadow}">
            <field name="NUM">${stake}</field>
          </shadow>
          <block type="variables_get" id="${idAmtGet}">
            <field name="VAR" id="${idVarStake}">stake</field>
          </block>
        </value>${predictionValue}
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="${idBefore}" deletable="false" movable="false" x="0" y="500">
    <statement name="BEFOREPURCHASE_STACK">${beforePurchaseStack}
    </statement>
  </block>
  <block type="after_purchase" id="${idAfter}" deletable="false" movable="false" x="0" y="750">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="${idAfterIf}">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="contract_check_result" id="${idResultCheck}">
            <field name="CHECK_RESULT">win</field>
          </block>
        </value>
        <statement name="DO0">
          <block type="variables_set" id="${idWinSetStake}">
            <field name="VAR" id="${idVarStake}">stake</field>
            <value name="VALUE">
              <block type="math_number" id="${idWinStakeNum}">
                <field name="NUM">${stake}</field>
              </block>
            </value>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="variables_set" id="${idLossSetStake}">
            <field name="VAR" id="${idVarStake}">stake</field>
            <value name="VALUE">
              <block type="math_arithmetic" id="${idLossMath}">
                <field name="OP">MULTIPLY</field>
                <value name="A">
                  <block type="variables_get" id="${idLossStakeGet}">
                    <field name="VAR" id="${idVarStake}">stake</field>
                  </block>
                </value>
                <value name="B">
                  <block type="math_number" id="${idLossMultNum}">
                    <field name="NUM">${martingale}</field>
                  </block>
                </value>
              </block>
            </value>${flipOnLossBlock}
          </block>
        </statement>
        <next>
          <block type="variables_set" id="${idProfitSetTotal}">
            <field name="VAR" id="${idVarTotalLoss}">totalLoss</field>
            <value name="VALUE">
              <block type="math_arithmetic" id="${idProfitChange}">
                <field name="OP">MINUS</field>
                <value name="A">
                  <block type="variables_get" id="${idTotalLossGet}">
                    <field name="VAR" id="${idVarTotalLoss}">totalLoss</field>
                  </block>
                </value>
                <value name="B">
                  <block type="read_details" id="${idProfitRead}">
                    <field name="DETAIL_INDEX">4</field>
                  </block>
                </value>
              </block>
            </value>
            <next>${tradeAgainStack}
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>
</xml>`;
}

function generateBot() {
    const info = getContractInfoForType(botGenTradeType, scopeMarket, scopeSampleSize, parseInt(elBotBarrier.value, 10) || 4);
    if (!info) {
        elBotGenPreview.style.display = 'block';
        elBotGenPreview.innerHTML = `<div class="bgp-warn">Not enough tick data for ${scopeMarket} yet — wait for more ticks, then generate.</div>`;
        return;
    }

    const stake = Math.max(0.35, parseFloat(elBotStake.value) || 1);
    const duration = Math.max(1, Math.min(10, parseInt(elBotDuration.value, 10) || 1));
    const martingale = Math.max(1, parseFloat(elBotMartingale.value) || 1);
    const stopLoss = Math.max(0, parseFloat(elBotStoploss.value) || 0);
    const flip = !!elBotFlip.checked;

    const xml = buildBotXml({
        symbol: scopeMarket,
        dbotTradeType: info.dbotTradeType,
        category: info.category,
        hasPrediction: info.hasPrediction,
        barrier: info.barrier,
        contractA: info.contractA,
        contractB: info.contractB,
        startContract: info.favoredContract,
        flip,
        stake, duration, martingale, stopLoss
    });

    const typeSlug = botGenTradeType.replace(/_/g, '-');
    const filename = `kelvin-bot-${scopeMarket}-${typeSlug}-${info.favoredContract}.xml`;
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    elBotGenPreview.style.display = 'block';
    elBotGenPreview.innerHTML = `
        <div class="bgp-title">Downloaded ${filename}</div>
        <ul>
            <li>Market: ${scopeMarket}, favored side right now: <strong>${info.label}</strong> (${info.pct.toFixed(1)}%)</li>
            <li>Stake: ${stake} per trade, duration: ${duration} tick${duration > 1 ? 's' : ''}</li>
            <li>Martingale on loss: ×${martingale}${martingale === 1 ? ' (flat stake, no martingale)' : ''}</li>
            <li>${flip ? `Scanner mode ON — on a loss it flips to the other side of the pair (${info.contractA} ⇄ ${info.contractB}) for the next trade` : 'Scanner mode OFF — always repeats the same side, only the stake changes on a loss'}</li>
            <li>${stopLoss > 0 ? `Stops calling Trade Again once cumulative loss passes ${stopLoss} (also set DBot's own Stop Loss field in the summary card as a backup)` : 'No stop-loss set — add one in DBot\'s summary panel before running'}</li>
        </ul>
        <div class="bgp-warn">Import at app.deriv.com/bot (Import from your computer), review every block, and test on a demo account first. The favored side reflects only the sample above — it is not a guarantee, and martingale increases risk of larger drawdowns.</div>
    `;
}

// Dual-Side Assistant
function populateDualMarketSelect() {
    elDualMarketSelect.innerHTML = '';
    markets.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.id;
        elDualMarketSelect.appendChild(opt);
    });
    elDualMarketSelect.value = activeMarket;
}

function updateDualAssistant() {
    const symbol = elDualMarketSelect.value;
    const pair = elDualPairSelect.value;
    const s = computeStats(symbol, radarSampleSize);

    if (!s) {
        elDualOutput.innerHTML = 'gathering ticks for this market…';
        return;
    }

    let pctA, pctB, nameA, nameB;
    if (pair === 'even_odd') {
        pctA = s.evenPct; pctB = s.oddPct; nameA = 'EVEN'; nameB = 'ODD';
    } else {
        pctA = s.overPct; pctB = s.underPct; nameA = `OVER ${radarOuBarrier}`; nameB = `UNDER ${radarOuBarrier}`;
    }

    const edge = Math.abs(pctA - pctB);
    let verdictCls = 'skip', verdictText;
    if (edge < 3) {
        verdictCls = 'skip';
        verdictText = `Split is basically 50/50 (±${edge.toFixed(1)}pt). Both legs are covered anyway, so keep stakes flat/equal this round — there's no statistical reason to lean either way, and leaning in adds risk for no edge.`;
    } else if (edge < 8) {
        verdictCls = 'mild';
        verdictText = `Mild lean toward ${pctA >= pctB ? nameA : nameB} (${edge.toFixed(1)}pt gap). If your bot lets you set per-side stake, a light tilt (e.g. 55/45) toward the favored side is reasonable — don't go much further than that on this small an edge.`;
    } else {
        verdictCls = 'strong';
        verdictText = `Clear lean toward ${pctA >= pctB ? nameA : nameB} (${edge.toFixed(1)}pt gap) over the last ${s.n} ticks. Worth weighting stake more heavily that way, or even skipping the underdog leg for this round if your bot allows single-side entries.`;
    }

    const total = pctA + pctB;
    const weightA = Math.round((pctA / total) * 100);
    const weightB = 100 - weightA;

    elDualOutput.innerHTML = `
        <div class="dual-stake-row">
            <div class="dual-stake-card">
                <div class="side-name">${nameA}</div>
                <div class="side-pct">${pctA.toFixed(1)}%</div>
                <div class="side-weight">suggested stake weight: ${weightA}%</div>
            </div>
            <div class="dual-stake-card">
                <div class="side-name">${nameB}</div>
                <div class="side-pct">${pctB.toFixed(1)}%</div>
                <div class="side-weight">suggested stake weight: ${weightB}%</div>
            </div>
        </div>
        <div class="dual-verdict ${verdictCls}">${verdictText}</div>
    `;
}

// Auth & Login
function updateAuthUI() {
    if (apiToken && !authFailed) {
        const idLabel = accountId ? ` (${accountId})` : '';
        const balLabel = accountBalance !== null ? ` • $${accountBalance.toFixed(2)}` : '';
        elLoginBtn.textContent = `Logged In${idLabel}${balLabel}`;
        elLoginBtn.style.backgroundColor = 'var(--panel-bg)';
        elLoginBtn.style.color = 'var(--text-secondary)';
        elAuthWarning.style.display = 'none';
    } else {
        elLoginBtn.textContent = 'Login to Deriv';
        elLoginBtn.style.backgroundColor = 'var(--accent-yellow)';
        elLoginBtn.style.color = '#000';
        elAuthWarning.style.display = 'block';
    }
}

function logout() {
    apiToken = null;
    accountId = null;
    accountBalance = null;
    authFailed = false;
    localStorage.removeItem('kelvin_api_token');
    localStorage.removeItem('kelvin_account_id');
    // Note: Preserve kelvin_app_id so public live stream remains connected on hosted domains
    appId = localStorage.getItem('kelvin_app_id') || DEFAULT_APP_ID;
    updateAuthUI();
    addLog('Logged out of trading account. Staying connected to public live market stream.');
    connectWS();
}

// prediction-type UI switching
function applyPredTypeUI() {
    if (predType === 'rise_fall') {
        elDigitGroup.style.display = 'none';
        elBtnUp.textContent = '↑ Predict Rise';
        elBtnDown.textContent = '↓ Predict Fall';
    } else if (predType === 'even_odd') {
        elDigitGroup.style.display = 'none';
        elBtnUp.textContent = 'Even';
        elBtnDown.textContent = 'Odd';
    } else if (predType === 'over_under') {
        elDigitGroup.style.display = 'block';
        elDigitLabel.textContent = 'Barrier digit (0-9):';
        elBtnUp.textContent = 'Predict Over';
        elBtnDown.textContent = 'Predict Under';
    } else if (predType === 'matches_differs') {
        elDigitGroup.style.display = 'block';
        elDigitLabel.textContent = 'Digit to match (0-9):';
        elBtnUp.textContent = 'Matches';
        elBtnDown.textContent = 'Differs';
    }
    recomputeAutoSuggestion();
}

// Event Listeners Setup
function setupEventListeners() {
    elPredictionTypeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            elPredictionTypeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            predType = e.target.dataset.val;
            applyPredTypeUI();
        });
    });

    elDigitBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            elDigitBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            predDigit = parseInt(e.target.dataset.val);
        });
    });

    elDurationBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            elDurationBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            predDuration = parseInt(e.target.dataset.val);
        });
    });

    elBtnUp.addEventListener('click', () => placePrediction('up'));
    elBtnDown.addEventListener('click', () => placePrediction('down'));

    elModeToggle.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            elModeToggle.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            predMode = e.target.dataset.mode;

            if (predMode === 'auto') {
                elActionButtonsContainer.style.display = 'none';
                elAutoBox.style.display = 'block';
                elModeHelp.textContent = "Kelvin picks Even/Odd, Over/Under, Rise/Fall or Matches/Differs from live digit stats. You just confirm.";
                recomputeAutoSuggestion();
            } else {
                elActionButtonsContainer.style.display = 'grid';
                elAutoBox.style.display = 'none';
                elModeHelp.textContent = 'You choose the side. Kelvin just grades it.';
            }
        });
    });

    elBtnConfirmAuto.addEventListener('click', () => {
        if (!autoSuggestion) {
            alert('Waiting for market data...');
            return;
        }
        placePrediction(autoSuggestion.action);
    });

    function openLoginModal() {
        if (elInputAppId) {
            const savedAppId = localStorage.getItem('kelvin_app_id');
            elInputAppId.value = savedAppId || (appId !== '1089' ? appId : (IS_LOCAL ? '1089' : ''));
        }
        if (elInputApiToken) elInputApiToken.value = apiToken || '';
        if (elInputAccountId) elInputAccountId.value = accountId || '';
        const originHint = document.getElementById('current-origin-hint');
        if (originHint) {
            originHint.textContent = window.location.origin + window.location.pathname;
        }
        elLoginModal.style.display = 'flex';
    }

    elLoginBtn.addEventListener('click', () => {
        if (apiToken && !authFailed) {
            if (confirm("You are currently logged in. Do you want to log out?")) logout();
        } else {
            openLoginModal();
        }
    });

    const elModalCloseX = document.getElementById('modal-close-x');
    if (elModalCloseX) {
        elModalCloseX.addEventListener('click', () => { elLoginModal.style.display = 'none'; });
    }

    elCancelLogin.addEventListener('click', () => {
        elLoginModal.style.display = 'none';
    });

    const elSaveAppIdBtn = document.getElementById('save-app-id-btn');
    if (elSaveAppIdBtn) {
        elSaveAppIdBtn.addEventListener('click', () => {
            const idVal = elInputAppId.value.trim();
            if (!idVal) {
                localStorage.removeItem('kelvin_app_id');
                appId = DEFAULT_APP_ID;
                addLog(`Reset App ID to default (${appId})`);
            } else {
                appId = idVal;
                localStorage.setItem('kelvin_app_id', appId);
                addLog(`Saved Deriv App ID: ${appId}`);
            }
            hasInvalidAppId = false;
            reconnectAttempts = 0;
            elLoginModal.style.display = 'none';
            connectWS();
        });
    }

    elSubmitLogin.addEventListener('click', () => {
        const customAppId = elInputAppId.value.trim();
        const tokenVal = elInputApiToken.value.trim();
        const accVal = elInputAccountId ? elInputAccountId.value.trim() : '';

        if (!tokenVal) {
            alert("To log into your trading account, please enter your personal Deriv API Token.\n\n(To only stream live market data, click 'Save App ID Only' instead.)");
            return;
        }

        if (customAppId) {
            appId = customAppId;
            localStorage.setItem('kelvin_app_id', appId);
        } else if (!appId || (appId === '1089' && !IS_LOCAL)) {
            appId = DEFAULT_APP_ID;
        }

        apiToken = tokenVal;
        if (accVal) accountId = accVal;
        authFailed = false;
        hasInvalidAppId = false;
        reconnectAttempts = 0;

        localStorage.setItem('kelvin_api_token', apiToken);
        if (accVal) localStorage.setItem('kelvin_account_id', accountId);

        elLoginModal.style.display = 'none';
        addLog(`Saved login info (AppID: ${appId}, Token: ***)`);
        updateAuthUI();
        connectWS();
    });

    if (elShowLogBtn) {
        elShowLogBtn.addEventListener('click', () => { elLogModal.style.display = 'flex'; });
    }
    if (elCloseLogBtn) {
        elCloseLogBtn.addEventListener('click', () => { elLogModal.style.display = 'none'; });
    }

    elRadarOuBarrier.addEventListener('change', (e) => {
        radarOuBarrier = parseInt(e.target.value);
        markets.forEach(m => updateRadarCard(m.id));
        recomputeAutoSuggestion();
        updateDualAssistant();
    });

    elRadarSampleSize.addEventListener('change', (e) => {
        radarSampleSize = parseInt(e.target.value);
        markets.forEach(m => updateRadarCard(m.id));
        recomputeAutoSuggestion();
        updateDualAssistant();
    });

    elScanBtn.addEventListener('click', runScanner);

    elDualMarketSelect.addEventListener('change', updateDualAssistant);
    elDualPairSelect.addEventListener('change', updateDualAssistant);

    elScopeMarketSelect.addEventListener('change', (e) => {
        scopeMarket = e.target.value;
        updateScopePanel();
    });
    elScopeTradeType.addEventListener('change', (e) => {
        scopeTradeType = e.target.value;
        updateScopePanel();
    });
    elScopeTickCount.addEventListener('change', (e) => {
        let v = parseInt(e.target.value, 10);
        if (isNaN(v) || v < 10) v = 10;
        if (v > MAX_SAMPLE) v = MAX_SAMPLE;
        scopeSampleSize = v;
        e.target.value = v;
        updateScopePanel();
    });

    elBotGenBtn.addEventListener('click', generateBot);

    // Bot generator tabs (Even/Odd, Rise/Fall, Over/Under, Matches/Differs)
    if (elBotGenTabs) {
        elBotGenTabs.querySelectorAll('.bot-gen-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                elBotGenTabs.querySelectorAll('.bot-gen-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                botGenTradeType = tab.dataset.type;
                updateBotBarrierFieldVisibility();
                elBotGenPreview.style.display = 'none';
            });
        });
    }
    updateBotBarrierFieldVisibility();

    initPageNav();
}

// Page Navigation: navbar tabs, one tool page visible at a time
function initPageNav() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.app-page');
    if (!navBtns.length || !pages.length) return;

    function showPage(pageId) {
        pages.forEach(p => p.classList.toggle('active', p.id === pageId));
        navBtns.forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
        try { localStorage.setItem('kelvin_active_page', pageId); } catch (e) { }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => showPage(btn.dataset.page));
    });

    let startPage = 'page-dashboard';
    try {
        const saved = localStorage.getItem('kelvin_active_page');
        if (saved && document.getElementById(saved)) startPage = saved;
    } catch (e) { }
    showPage(startPage);
}

// Start app
init();
