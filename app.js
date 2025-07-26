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
            const cost = shares * price;
            const totalCost = cost + (cost * (commission / 100.0));
            if (totalCost > this.availableCash) {
                showError('transaction-error', "Not enough cash to complete this purchase.");
                return false;
            }
            this.availableCash -= totalCost;
            const existingHolding = this.holdings.find(h => h.ticker === ticker.toUpperCase());
            if (existingHolding) {
                existingHolding.shares += shares;
            } else {
                this.holdings.push({ ticker: ticker.toUpperCase(), shares, currentPrice: price });
            }
            this.save();
            renderUI();
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
            const proceeds = shares * price;
            const netProceeds = proceeds - (proceeds * (commission / 100.0));
            this.availableCash += netProceeds;
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
            let failedSymbols = [];
            const pricePromises = this.holdings.map(holding => 
                apiService.fetchLatestPrice(holding.ticker).then(price => ({ ticker: holding.ticker, price }))
            );
            const results = await Promise.all(pricePromises);
            results.forEach(({ ticker, price }) => {
                const holding = this.holdings.find(h => h.ticker === ticker);
                if (price !== null && holding) {
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
        // *** THIS ENTIRE FUNCTION IS NOW CORRECTED ***
        async fetchLatestPrice(symbol) {
            const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${API_KEY}`;
            try {
                const response = await fetch(url);
                const data = await response.json();

                if (data.Note) {
                    console.warn("Alpha Vantage API Note:", data.Note);
                    // This can indicate hitting the API limit, which is not a fatal error for this function.
                }

                if (data["Global Quote"] && data["Global Quote"]["05. price"]) {
                    let price = parseFloat(data["Global Quote"]["05. price"]);
                    
                    // ***************************************************************
                    // ***** THIS IS THE CORRECTED CURRENCY CONVERSION LOGIC *****
                    // It checks for London Stock Exchange tickers.
                    // ***************************************************************
                    if (symbol.toUpperCase().endsWith('.L') || symbol.toUpperCase().endsWith('.LON')) {
                        // 1. Convert from Pence (GBX) to Pounds (GBP)
                        price = price / 100.0; 
                        
                        // 2. Fetch the GBP to USD exchange rate
                        const gbpToUsdRate = await this.fetchGBPtoUSDExchangeRate();

                        // 3. If the rate is available, convert price to USD
                        if (gbpToUsdRate) {
                            price = price * gbpToUsdRate;
                        } else {
                            // If the exchange rate fails, we can't determine the price in USD.
                            console.error(`Could not fetch GBP to USD exchange rate for ${symbol}.`);
                            return null;
                        }
                    }
                    // ***************************************************************
                    // ***************** END OF CORRECTION *****************************
                    // ***************************************************************

                    return price;
                }
                
                console.error("Could not find 'Global Quote' in API Response for " + symbol + ":", data);
                return null; // Return null if the quote is missing.

            } catch (error) {
                console.error("Fetch price network error for " + symbol + ":", error);
                return null;
            }
        },
        async searchSymbols(query) {
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
        async fetchGBPtoUSDExchangeRate() {
            const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=GBP&to_currency=USD&apikey=${API_KEY}`;
            try {
                 const response = await fetch(url);
                 const data = await response.json();
                 if (data["Realtime Currency Exchange Rate"] && data["Realtime Currency Exchange Rate"]["5. Exchange Rate"]) {
                     return parseFloat(data["Realtime Currency Exchange Rate"]["5. Exchange Rate"]);
                 }
                 console.error("Could not find exchange rate in API response:", data);
                 return null;
            } catch (error) {
                console.error("Exchange rate fetch error:", error);
                return null;
            }
        }
    };

    function formatCurrency(value) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
    }
    
    function renderUI() {
        if (portfolio.isFirstLaunch) {
            welcomeView.style.display = 'flex';
            mainContent.style.display = 'none';
        } else {
            welcomeView.style.display = 'none';
            mainContent.style.display = 'block';

            const holdingsValue = portfolio.holdings.reduce((total, holding) => total + (holding.shares * holding.currentPrice), 0);
            const totalValue = portfolio.availableCash + holdingsValue;

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
                    item.innerHTML = `
                        <div class="holding-info">
                            <div class="ticker-symbol">${h.ticker}</div>
                            <div class="shares-count">${h.shares.toFixed(2)} Shares</div>
                        </div>
                        <div class="holding-value">
                            <div class="current-value">${formatCurrency(h.shares * h.currentPrice)}</div>
                            <div class="current-price ${h.currentPrice > 0 ? 'positive' : ''}">@ ${formatCurrency(h.currentPrice)}</div>
                        </div>
                    `;
                    portfolioElements.holdingsList.appendChild(item);
                });
            }
        }
    }

    function showModal(modalName) {
        if(views[modalName]) views[modalName].classList.add('active');
    }
    function closeModal() {
         views.addTransaction.classList.remove('active');
         views.depositFunds.classList.remove('active');
    }
    function showError(elementId, message) {
        const errorEl = document.getElementById(elementId);
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        setTimeout(() => { errorEl.style.display = 'none'; }, 4000);
    }

    // --- Event Listeners ---
    welcomeElements.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = parseFloat(welcomeElements.amountInput.value) || 0;
        portfolio.setInitialFunds(amount);
    });

    document.getElementById('add-transaction-btn').addEventListener('click', () => showModal('addTransaction'));
    document.getElementById('cancel-transaction-btn').addEventListener('click', closeModal);
    document.getElementById('deposit-funds-btn').addEventListener('click', () => showModal('depositFunds'));
    document.getElementById('cancel-deposit-btn').addEventListener('click', closeModal);
    document.getElementById('reset-btn').addEventListener('click', () => {
        if (confirm("Are you sure you want to reset all portfolio data? This will bring you back to the welcome screen.")) {
            portfolio.reset();
        }
    });

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
    
    depositElements.form.addEventListener('input', () => {
        depositElements.addBtn.disabled = !(parseFloat(depositElements.amountInput.value) > 0);
    });
    depositElements.form.addEventListener('submit', e => {
        e.preventDefault();
        const amount = parseFloat(depositElements.amountInput.value);
        if (amount > 0) { portfolio.depositCash(amount); closeModal(); }
    });

    // --- App Initialization ---
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