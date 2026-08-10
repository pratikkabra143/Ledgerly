// =============================================
// BILLING — Shared Utilities
// =============================================

const CACHE_TTL = 60000; // 60 seconds cache for instant feel

const API = {
    async get(url, bypassCache = false) {
        const cacheKey = `api_cache_${url}`;
        if (!bypassCache) {
            const cachedStr = sessionStorage.getItem(cacheKey);
            if (cachedStr) {
                try {
                    const { timestamp, data } = JSON.parse(cachedStr);
                    if (data && Date.now() - timestamp < CACHE_TTL) {
                        return data;
                    }
                } catch (e) {
                    sessionStorage.removeItem(cacheKey);
                }
            }
        }

        const res = await fetch(url);
        if (!res.ok) {
            sessionStorage.removeItem(cacheKey);
            const err = await res.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(err.error || 'Request failed');
        }
        const data = await res.json();
        
        if (data) {
            sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data }));
        }
        return data;
    },
    
    clearCache() {
        Object.keys(sessionStorage).forEach(key => {
            if (key.startsWith('api_cache_')) sessionStorage.removeItem(key);
        });
    },

    async post(url, data) {
        this.clearCache(); // Invalidate on write
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(err.error || 'Request failed');
        }
        return res.json();
    },
    async put(url, data) {
        this.clearCache(); // Invalidate on write
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(err.error || 'Request failed');
        }
        return res.json();
    },
    async delete(url) {
        this.clearCache(); // Invalidate on write
        const res = await fetch(url, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(err.error || 'Request failed');
        }
        return res.json();
    }
};

// Toast notification system
function showToast(message, type = 'info', duration = 3000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Format currency
function formatCurrency(amount) {
    return '₹' + parseFloat(amount || 0).toFixed(2);
}

function formatCurrencyRound(amount) {
    return '₹' + Math.round(parseFloat(amount || 0)).toLocaleString('en-IN');
}

// Active nav link
function setActiveNav() {
    const path = window.location.pathname;
    document.querySelectorAll('.nav-links a').forEach(link => {
        const href = link.getAttribute('href');
        if (href === path || (path === '/' && href === '/') || (path.includes(href) && href !== '/')) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// Global Legal & Compliance Modal Handler
const LEGAL_DOCS = {
    terms: {
        title: '📜 Terms of Service',
        subtitle: 'Enterprise License & Usage Agreement',
        content: `
            <div class="legal-section">
                <h3>1. System Usage & Ownership</h3>
                <p>Ledgerly Enterprise Engine is provided as a sovereign, self-hosted GST invoicing and ledger management system. All data generated—including customer records, inventory ledgers, and financial transactions—remains 100% your exclusive property.</p>
                
                <h3>2. SLA & System Integrity</h3>
                <p>The core billing engine operates with zero runtime third-party dependencies. Local SQLite deployments guarantee offline operational capability during network outages.</p>
                
                <h3>3. Compliance Disclaimer</h3>
                <p>Tax rate calculations (CGST/SGST/IGST) are pre-configured according to statutory GST guidelines. Users remain responsible for final audit submissions on the official GST Portal.</p>
            </div>
        `
    },
    privacy: {
        title: '🔒 Privacy Policy',
        subtitle: 'Data Isolation & Confidentiality Commitment',
        content: `
            <div class="legal-section">
                <h3>1. Zero Telemetry</h3>
                <p>Ledgerly Enterprise operates under a strict Zero External Telemetry policy. We do not track, collect, transmit, or monetize your sales volume, customer contact numbers, or GSTIN records.</p>
                
                <h3>2. Storage Security</h3>
                <p>Local databases (<code>data/ledgerly.db</code>) are stored directly on host machine storage. Cloud PostgreSQL connections are enforced via TLS/SSL encrypted channels.</p>
                
                <h3>3. Information Rights</h3>
                <p>No third-party analytics scripts, tracking cookies, or external ad networks are embedded within any part of the application suite.</p>
            </div>
        `
    },
    security: {
        title: '🛡️ Security Architecture',
        subtitle: 'System Defense & Threat Protection Protocol',
        content: `
            <div class="legal-section">
                <h3>1. Parameterized Query Guarantee</h3>
                <p>All database queries across both SQLite and PostgreSQL engines strictly utilize parameterized prepared statements, eliminating SQL injection vulnerability vectors.</p>
                
                <h3>2. Authentication Standard</h3>
                <p>Session access is protected using JSON Web Tokens (JWT) signed with HMAC-SHA256 algorithms. Administrator passwords are verified against cryptographically secure configuration keys.</p>
                
                <h3>3. Transport Layer Security</h3>
                <p>API endpoints running in production environments enforce HTTPS transport security for all JSON data payloads and GSTR document downloads.</p>
            </div>
        `
    },
    gst: {
        title: '⚖️ GST Compliance Rules',
        subtitle: 'Statutory Tax Specifications & Portal Schema Integrity',
        content: `
            <div class="legal-section">
                <h3>1. Tax Calculation Engine</h3>
                <p>Automatically applies statutory 5% GST breakdown (2.5% CGST + 2.5% SGST) for intra-state supply transactions, formatted with precise rounding rules.</p>
                
                <h3>2. HSN Code Mapping</h3>
                <p>Pre-populated with official 8-digit HSN codes (e.g. <code>21050000</code> for Ice Cream & Edible Ice Products) as mandated by CBIC guidelines.</p>
                
                <h3>3. GSTR Portal JSON Export</h3>
                <p>Built-in GSTR-1 (Sales) and GSTR-2 (Input Tax Credit Purchases) JSON exporters compile ledger entries directly matching the official GST Offline Tool schema structure.</p>
            </div>
        `
    }
};

function openLegalModal(docType = 'terms') {
    let modal = document.getElementById('globalLegalModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'globalLegalModal';
        modal.className = 'modal-overlay';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal" style="max-width: 680px; max-height: 85vh; display: flex; flex-direction: column;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                    <div>
                        <h2 class="modal-title" id="legalModalTitle">Compliance Document</h2>
                        <p style="color: var(--text-muted); font-size: 13px;" id="legalModalSubtitle"></p>
                    </div>
                    <button onclick="closeLegalModal()" style="background: none; border: none; color: var(--text-secondary); font-size: 24px; cursor: pointer; padding: 0 8px;">✕</button>
                </div>
                
                <div class="tabs" style="margin-bottom: 16px;">
                    <button class="tab" id="tab-terms" onclick="switchLegalDoc('terms')">📜 Terms</button>
                    <button class="tab" id="tab-privacy" onclick="switchLegalDoc('privacy')">🔒 Privacy</button>
                    <button class="tab" id="tab-security" onclick="switchLegalDoc('security')">🛡️ Security</button>
                    <button class="tab" id="tab-gst" onclick="switchLegalDoc('gst')">⚖️ GST Rules</button>
                </div>
                
                <div id="legalModalBody" style="flex: 1; overflow-y: auto; padding-right: 8px; color: var(--text-primary); line-height: 1.6; font-size: 14px;"></div>
                
                <div class="modal-actions" style="margin-top: 20px; justify-content: flex-end;">
                    <button class="btn btn-primary" onclick="closeLegalModal()">Close Window</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeLegalModal();
        });
    }

    switchLegalDoc(docType);
    modal.style.display = 'flex';
}

function switchLegalDoc(docType) {
    const doc = LEGAL_DOCS[docType] || LEGAL_DOCS.terms;
    document.getElementById('legalModalTitle').textContent = doc.title;
    document.getElementById('legalModalSubtitle').textContent = doc.subtitle;
    document.getElementById('legalModalBody').innerHTML = doc.content;

    document.querySelectorAll('#globalLegalModal .tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.getElementById(`tab-${docType}`);
    if (activeTab) activeTab.classList.add('active');
}

function closeLegalModal() {
    const modal = document.getElementById('globalLegalModal');
    if (modal) modal.style.display = 'none';
}

// Bind footer links dynamically on page load
document.addEventListener('DOMContentLoaded', () => {
    setActiveNav();

    document.querySelectorAll('.footer-links a').forEach(link => {
        const text = link.textContent.trim().toLowerCase();
        let docType = 'terms';
        if (text.includes('privacy')) docType = 'privacy';
        else if (text.includes('security')) docType = 'security';
        else if (text.includes('gst') || text.includes('compliance')) docType = 'gst';

        link.setAttribute('href', '#');
        link.addEventListener('click', (e) => {
            e.preventDefault();
            openLegalModal(docType);
        });
    });
});

