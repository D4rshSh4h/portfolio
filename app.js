document.addEventListener('DOMContentLoaded', () => {

    const API_KEY = "Z5T1AO0WO4RC6C5I"; // Your Alpha Vantage API key

    // --- DOM Element Lookups ---
    const views = {
        portfolio: document.getElementById('portfolio-view'),
        addTransaction: document.getElementById('add-transaction-view'),
        depositFunds: document.getElementById('deposit-funds-view'),
    };

    const welcomeView = document.getElementById('welcome-view');
    const mainContent = document.getElementById('main-content');

    const welcomeElements = {
        form: document.getElementById('welcome-form'),
        amountInput: document.getElementById('welcome-amount'),
    };

    const portfolioElements = {
        totalValue: document.getElementById('total-value'),
        availableCash: document.getElementById('available-cash'),
        holdingsList: document.getElementById('holdings-list'),
        refreshBtn: document.getElementById('refresh-btn'),
        apiError: document.getElementById('api-error'),
    };

    const transactionElements = {
        form: document.getElementById('transaction-form'),
        ticker: document.getElementById('ticker'),
        shares: document.getElementById('shares'),
        price: document.getElementById('price'),
        commission: document.getElementById('commission'),
        saveBtn: document.getElementById('save-transaction-btn'),
        suggestions: document.getElementById('suggestions'),
        error: document.getElementById('transaction-error'),
    };
    
    const depositElements = {
        form: document.getElementById('deposit-form'),
        amountInput: document.getElementById('deposit-amount'),
        addBtn: document.getElementById('add-funds-btn'),
    };
    
    // --- App State & Logic ---
    const portfolio = {
        availableCash: 0.0,
        holdings: [],
        isFirstLaunch: true,
        initialFunds: 0.0,
        totalDeposited: 0.0,
        gbpToUsdRate: 1.0, // Will be updated on refresh
        
        load() {
            const hasSetFunds = JSON.parse(localStorage.getItem('hasSetInitialFunds'));
            this.isFirstLaunch = !hasSetFunds;
            if (!this.isFirstLaunch) {
                this.availableCash = JSON.parse(localStorage.getItem('availableCash')) || 0.0;
                this.holdings = JSON.parse(localStorage.getItem('holdings')) || [];
                this.initialFunds = JSON.parse(localStorage.getItem('initialFunds')) || 0.0;
                this.totalDeposited = JSON.parse(localStorage.getItem('totalDeposited')) || 0.0;
            }
        },

        save() {
            localStorage.setItem('hasSetInitialFunds', JSON.stringify(true));
            localStorage.setItem('availableCash', JSON.stringify(this.availableCash));
            localStorage.setItem('holdings', JSON.stringify(this.holdings));
            localStorage.setItem('initialFunds', JSON.stringify(this.initialFunds));
            localStorage.setItem('totalDeposited', JSON.stringify(this.totalDeposited));
        },
        
        setInitialFunds(amount) {
            this.availableCash = amount;
            this.initialFunds = amount;
            this.totalDeposited = amount;
            this.isFirstLaunch = false;
            this.save();
            renderUI();
        },

        depositCash(amount) {
            if (amount > 0) {
                this.availableCash += amount;
                this.totalDeposited += amount;
                this.save();
                renderUI();
            }
        },

        buy(ticker, shares, price, commission) {
            let totalCostInUsd;
            const isUkStock = ticker.toUpperCase().endsWith('.L') || ticker.toUpperCase().endsWith('.LON');

            if (isUkStock) {
                // Convert transaction cost from GBX to USD to subtract from cash
                const costInGbp = (shares * price) / 100.0;
                const commissionInGbp = costInGbp * (commission / 100.0);
                const totalCostInGbp = costInGbp + commissionInGbp;
                totalCostInUsd = totalCostInGbp * this.gbpToUsdRate;
            } else {
                const cost = shares * price;
                totalCostInUsd = cost + (cost * (commission / 100.0));
            }

            if (totalCostInUsd > this.availableCash) {
                showError('transaction-error', "Not enough cash to complete this purchase.");
                return false;
            }
            this.availableCash -= totalCostInUsd;

            const existingHolding = this.holdings.find(h => h.ticker === ticker.toUpperCase());
            if (existingHolding) {
                existingHolding.shares += shares;
            } else {
                // Store the price as entered (GBX for UK, USD for US)
                this.holdings.push({ ticker: ticker.toUpperCase(), shares, currentPrice: price });
            }
            this.save();
            renderUI();
            this.refreshPrices();
            return true;
        },

        sell(ticker, shares, price, commission) {
            const existingHolding = this.holdings.find(h => h.ticker === ticker.toUpperCase());
            if (!existingHolding) {
                showError('transaction-error', `You do not own any shares of ${ticker.toUpperCase()}.`);
                return false;
            }
            if (existingHolding.shares < shares) {
                 showError('transaction-error', 'You cannot sell more shares than you own.');
                return false;
            }

            let netProceedsInUsd;
            const isUkStock = ticker.toUpperCase().endsWith('.L') || ticker.toUpperCase().endsWith('.LON');

            if (isUkStock) {
                const proceedsInGbp = (shares * price) / 100.0;
                const commissionInGbp = proceedsInGbp * (commission / 100.0);
                const netProceedsInGbp = proceedsInGbp - commissionInGbp;
                netProceedsInUsd = netProceedsInGbp * this.gbpToUsdRate;
            } else {
                const proceeds = shares * price;
                netProceedsInUsd = proceeds - (proceeds * (commission / 100.0));
            }

            this.availableCash += netProceedsInUsd;
            existingHolding.shares -= shares;

            if (existingHolding.shares < 0.0001) {
                this.holdings = this.holdings.filter(h => h.ticker !== ticker.toUpperCase());
            }
            this.save();
            renderUI();
            return true;
        },

        async refreshPrices() {
            portfolioElements.refreshBtn.disabled = true;
            this.gbpToUsdRate = await apiService.fetchGBPtoUSDExchangeRate() || this.gbpToUsdRate;

            let failedSymbols = [];
            const pricePromises = this.holdings.map(holding => 
                apiService.fetchLatestPrice(holding.ticker).then(price => ({ ticker: holding.ticker, price }))
            );
            const results = await Promise.all(pricePromises);
            results.forEach(({ ticker, price }) => {
                const holding = this.holdings.find(h => h.ticker === ticker);
                if (price !== null && holding) {
                    // Price is now stored in its native currency (GBX or USD)
                    holding.currentPrice = price;
                } else {
                    failedSymbols.push(ticker);
                }
            });
            if (failedSymbols.length > 0) {
                 showError('api-error', `Could not fetch a real-time price for: ${failedSymbols.join(', ')}. Displaying last known values.`);
            }
            this.save();
            renderUI();
            portfolioElements.refreshBtn.disabled = false;
        },
        
        reset() {
            localStorage.clear();
            this.availableCash = 0.0;
            this.holdings = [];
            this.isFirstLaunch = true;
            this.initialFunds = 0.0;
            this.totalDeposited = 0.0;
            renderUI(); 
        }
    };

    const apiService = {
        async fetchLatestPrice(symbol) {
            const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${API_KEY}`;
            try {
                const response = await fetch(url);
                const data = await response.json();
                if (data.Note) console.warn("API Note:", data.Note);

                if (data["Global Quote"] && data["Global Quote"]["05. price"]) {
                    // *** SIMPLIFIED: No conversion. Return the raw value from the API. ***
                    return parseFloat(data["Global Quote"]["05. price"]);
                }
                return null;
            } catch (error) {
                return null;
            }
        },
        async searchSymbols(query) { /* ... no changes ... */
            if (!query) return [];
            const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${query}&apikey=${API_KEY}`;
            try {
                const response = await fetch(url);
                const data = await response.json();
                return data.bestMatches ? data.bestMatches.map(match => match["1. symbol"]) : [];
            } catch (error) {
                console.error("Search error:", error);
                return [];
            }
         },
        async fetchGBPtoUSDExchangeRate() { /* ... no changes ... */
            const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=GBP&to_currency=USD&apikey=${API_KEY}`;
            try {
                 const response = await fetch(url);
                 const data = await response.json();
                 if (data["Realtime Currency Exchange Rate"] && data["Realtime Currency Exchange Rate"]["5. Exchange Rate"]) {
                     return parseFloat(data["Realtime Currency Exchange Rate"]["5. Exchange Rate"]);
                 }
                 return null;
            } catch (error) {
                console.error("Exchange rate fetch error:", error);
                return null;
            }
         }
    };

    function formatCurrency(value, currency = 'USD') {
        if (currency === 'GBX') {
            return `${(value || 0).toFixed(2)}p`;
        }
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
    }
    
    function renderUI() {
        if (portfolio.isFirstLaunch) {
            welcomeView.style.display = 'flex';
            mainContent.style.display = 'none';
        } else {
            welcomeView.style.display = 'none';
            mainContent.style.display = 'block';

            // *** NEW: Total value calculation now contains the conversion logic ***
            const holdingsValueInUsd = portfolio.holdings.reduce((total, holding) => {
                const isUkStock = holding.ticker.toUpperCase().endsWith('.L') || holding.ticker.toUpperCase().endsWith('.LON');
                let valueInUsd;
                if (isUkStock) {
                    // Convert stored GBX value to USD for the total sum
                    const gbpValue = (holding.shares * holding.currentPrice) / 100.0;
                    valueInUsd = gbpValue * portfolio.gbpToUsdRate;
                } else {
                    valueInUsd = holding.shares * holding.currentPrice;
                }
                return total + (valueInUsd || 0);
            }, 0);

            const totalValue = portfolio.availableCash + holdingsValueInUsd;

            portfolioElements.totalValue.textContent = formatCurrency(totalValue);
            portfolioElements.availableCash.textContent = formatCurrency(portfolio.availableCash);

            const difference = totalValue - portfolio.totalDeposited;
            portfolioElements.totalValue.style.color = 'var(--primary-text)';
            if (portfolio.totalDeposited > 0) {
                if (difference > 0.001) portfolioElements.totalValue.style.color = 'var(--green-color)';
                else if (difference < -0.001) portfolioElements.totalValue.style.color = 'var(--red-color)';
            }

            portfolioElements.holdingsList.innerHTML = '';
            if (portfolio.holdings.length === 0) {
                portfolioElements.holdingsList.innerHTML = `<li class="holding-item">You have no holdings. Tap '+' to add a transaction.</li>`;
            } else {
                portfolio.holdings.forEach(h => {
                    const item = document.createElement('li');
                    item.className = 'holding-item';
                    const isUkStock = h.ticker.toUpperCase().endsWith('.L') || h.ticker.toUpperCase().endsWith('.LON');

                    // SIMPLIFIED: Display is now direct
                    const displayPriceText = isUkStock 
                        ? formatCurrency(h.currentPrice, 'GBX')
                        : formatCurrency(h.currentPrice, 'USD');

                    // Convert to USD for this line item's total value display
                    let holdingValueInUsd;
                    if (isUkStock) {
                        const gbpValue = (h.shares * h.currentPrice) / 100.0;
                        holdingValueInUsd = gbpValue * portfolio.gbpToUsdRate;
                    } else {
                        holdingValueInUsd = h.shares * h.currentPrice;
                    }
                    const holdingValueText = formatCurrency(holdingValueInUsd);

                    item.innerHTML = `
                        <div class="holding-info">
                            <div class="ticker-symbol">${h.ticker}</div>
                            <div class="shares-count">${h.shares.toFixed(2)} Shares</div>
                        </div>
                        <div class="holding-value">
                            <div class="current-value">${holdingValueText}</div>
                            <div class="current-price ${h.currentPrice > 0 ? 'positive' : ''}">${displayPriceText}</div>
                        </div>
                    `;
                    portfolioElements.holdingsList.appendChild(item);
                });
            }
        }
    }

    // --- Event Listeners and Init --- (No changes below this line)
    function showModal(modalName) { if(views[modalName]) views[modalName].classList.add('active'); }
    function closeModal() { views.addTransaction.classList.remove('active'); views.depositFunds.classList.remove('active'); }
    function showError(elementId, message) { const errorEl = document.getElementById(elementId); errorEl.textContent = message; errorEl.style.display = 'block'; setTimeout(() => { errorEl.style.display = 'none'; }, 4000); }
    welcomeElements.form.addEventListener('submit', (e) => { e.preventDefault(); const amount = parseFloat(welcomeElements.amountInput.value) || 0; portfolio.setInitialFunds(amount); });
    document.getElementById('add-transaction-btn').addEventListener('click', () => showModal('addTransaction'));
    document.getElementById('cancel-transaction-btn').addEventListener('click', closeModal);
    document.getElementById('deposit-funds-btn').addEventListener('click', () => showModal('depositFunds'));
    document.getElementById('cancel-deposit-btn').addEventListener('click', closeModal);
    document.getElementById('reset-btn').addEventListener('click', () => { if (confirm("Are you sure you want to reset all portfolio data? This will bring you back to the welcome screen.")) { portfolio.reset(); } });
    portfolioElements.refreshBtn.addEventListener('click', () => portfolio.refreshPrices());
    let searchTimeout;
    transactionElements.ticker.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            const query = transactionElements.ticker.value;
            if (query.length > 0) {
                const results = await apiService.searchSymbols(query);
                transactionElements.suggestions.innerHTML = '';
                results.slice(0, 5).forEach(symbol => {
                    const item = document.createElement('div');
                    item.className = 'suggestion-item';
                    item.textContent = symbol;
                    item.onclick = () => {
                        transactionElements.ticker.value = symbol;
                        transactionElements.suggestions.style.display = 'none';
                        transactionElements.suggestions.innerHTML = '';
                    };
                    transactionElements.suggestions.appendChild(item);
                });
                transactionElements.suggestions.style.display = results.length > 0 ? 'block' : 'none';
            } else {
                transactionElements.suggestions.style.display = 'none';
            }
        }, 300);
    });
    const validateTransactionForm = () => {
        const isValid = transactionElements.ticker.value.trim() !== '' &&
                        parseFloat(transactionElements.shares.value) > 0 &&
                        parseFloat(transactionElements.price.value) > 0 &&
                        transactionElements.commission.value.trim() !== '' &&
                        isFinite(transactionElements.commission.value);
        transactionElements.saveBtn.disabled = !isValid;
    };
    ['input', 'change'].forEach(evt => { transactionElements.form.addEventListener(evt, validateTransactionForm); });
    transactionElements.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const type = document.querySelector('input[name="transactionType"]:checked').value;
        const success = (type === 'Buy') ?
            portfolio.buy(transactionElements.ticker.value, parseFloat(transactionElements.shares.value), parseFloat(transactionElements.price.value), parseFloat(transactionElements.commission.value)) :
            portfolio.sell(transactionElements.ticker.value, parseFloat(transactionElements.shares.value), parseFloat(transactionElements.price.value), parseFloat(transactionElements.commission.value));
        if (success) { closeModal(); }
    });
    depositElements.form.addEventListener('input', () => { depositElements.addBtn.disabled = !(parseFloat(depositElements.amountInput.value) > 0); });
    depositElements.form.addEventListener('submit', e => { e.preventDefault(); const amount = parseFloat(depositElements.amountInput.value); if (amount > 0) { portfolio.depositCash(amount); closeModal(); }});
    function init() {
        portfolio.load();
        renderUI();
        if (!portfolio.isFirstLaunch) {
            portfolio.refreshPrices();
        }
    }
    init();
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').then(reg => { console.log('Service worker registered.', reg); });
        });
    }
});