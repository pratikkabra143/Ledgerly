// =============================================
// BILLING — Inventory Management
// =============================================

let inventoryData = [];
let allCategories = [];

// --- Initialize ---
window.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    // showToast('Inventory loaded!', 'success');
});

async function loadData() {
    await Promise.all([loadInventory(), loadSummary(), loadCategories()]);
}

async function loadInventory() {
    try {
        inventoryData = await API.get('/api/inventory');
        renderStockTable(inventoryData);
        renderProductTable(inventoryData);
    } catch (err) {
        showToast('Error loading inventory: ' + err.message, 'error');
        const tbody = document.getElementById('stockTableBody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding:40px; color:var(--red);">Failed to load stock data (${err.message})</td></tr>`;
    }
}

async function loadSummary() {
    try {
        const s = await API.get('/api/inventory/summary');
        document.getElementById('statProducts').textContent = s.total_products;
        document.getElementById('statBoxes').textContent = parseFloat(s.total_boxes).toFixed(1);
        document.getElementById('statPurchase').textContent = formatCurrencyRound(s.total_purchase_cost);
        document.getElementById('statSelling').textContent = formatCurrencyRound(s.total_selling_value_incl_gst);
        document.getElementById('statProfit').textContent = formatCurrencyRound(s.estimated_profit);
        document.getElementById('statLowStock').textContent = s.low_stock_count;
    } catch (err) {
        console.error('Summary error:', err);
    }
}

async function loadCategories() {
    try {
        allCategories = await API.get('/api/products/categories');
        const select = document.getElementById('categoryFilter');
        // Keep first option
        select.innerHTML = '<option value="">All Categories</option>';
        allCategories.forEach(cat => {
            select.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
    } catch (err) {
        console.error('Categories error:', err);
    }
}

async function loadTransactions() {
    try {
        const txns = await API.get('/api/inventory/transactions?limit=100');
        const tbody = document.getElementById('transactionTableBody');

        if (txns.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:40px;">No transactions yet</td></tr>';
            return;
        }

        tbody.innerHTML = txns.map(t => {
            const typeClass = t.type === 'IN' ? 'badge-green' : t.type === 'OUT' ? 'badge-red' : 'badge-orange';
            const typeLabel = t.type === 'IN' ? '📥 IN' : t.type === 'OUT' ? '📤 OUT' : '🔧 ADJUST';
            return `
                <tr>
                    <td>${new Date(t.created_at).toLocaleString('en-IN')}</td>
                    <td>${t.product_name}</td>
                    <td><span class="badge ${typeClass}">${typeLabel}</span></td>
                    <td>${t.boxes > 0 ? '+' : ''}${t.boxes}</td>
                    <td>${t.purchase_rate ? '₹' + t.purchase_rate.toFixed(2) : '—'}</td>
                    <td style="color:var(--text-secondary);">${t.reference || '—'}</td>
                    <td><button class="btn btn-ghost" id="del-txn-${t.id}" onclick="deleteTransaction(${t.id})" title="Revert this adjustment from stock" style="font-size:14px; padding:4px 8px;">🗑️</button></td>
                </tr>`;
        }).join('');
    } catch (err) {
        showToast('Error loading transactions', 'error');
    }
}

// --- Safe name escaping for inline handlers ---
function escName(name) {
    return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\(/g, '&#40;').replace(/\)/g, '&#41;');
}

function unescName(name) {
    return name.replace(/&#40;/g, '(').replace(/&#41;/g, ')');
}

// --- Render Tables ---
function renderStockTable(data) {
    const tbody = document.getElementById('stockTableBody');

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:40px;">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(item => {
        const stock = item.stock_boxes || 0;
        let stockBadge;
        if (stock > 5) {
            stockBadge = `<span class="badge badge-green">${stock}</span>`;
        } else if (stock > 0) {
            stockBadge = `<span class="badge badge-orange">${stock}</span>`;
        } else {
            stockBadge = `<span class="badge badge-red">0</span>`;
        }

        const stockValue = stock * (item.purchase_rate || 0);
        const safeName = escName(item.name);

        return `
            <tr>
                <td style="text-align:left; font-weight:500; max-width:280px;">${item.name}</td>
                <td><span class="badge badge-accent">${item.category}</span></td>
                <td>${item.net_qty}</td>
                <td>${item.pcs_per_box}</td>
                <td>${stockBadge}</td>
                <td>${item.purchase_rate ? '₹' + item.purchase_rate.toFixed(2) : '<span style="color:var(--text-muted);">Not set</span>'}</td>
                <td>₹${item.selling_rate.toFixed(2)}</td>
                <td>${stockValue > 0 ? '₹' + stockValue.toFixed(2) : '—'}</td>
                <td>
                    <div class="flex gap-4">
                        <button class="btn btn-ghost" data-action="adjust-stock" data-id="${item.id}" data-name="${safeName}" data-stock="${stock}" title="Update Stock">📦</button>
                        <button class="btn btn-ghost" data-action="edit-product" data-id="${item.id}" title="Edit Product">✏️</button>
                        <button class="btn btn-ghost" data-action="delete-product" data-id="${item.id}" data-name="${safeName}" title="Delete Product" style="color:var(--red);">🗑️</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

function renderProductTable(data) {
    const tbody = document.getElementById('productTableBody');

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:40px;">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(item => {
        const safeName = escName(item.name);
        return `
        <tr>
            <td>${item.id}</td>
            <td style="text-align:left; font-weight:500;">${item.name}</td>
            <td>${item.net_qty}</td>
            <td>${item.pcs_per_box}</td>
            <td>₹${item.selling_rate.toFixed(2)}</td>
            <td>${item.purchase_rate ? '₹' + item.purchase_rate.toFixed(2) : '—'}</td>
            <td><span class="badge badge-accent">${item.category}</span></td>
            <td><span class="badge" style="background:var(--bg-secondary); color:var(--text-color);">${item.hsn_code || '21050000'}</span></td>
            <td>
                <div class="flex gap-4">
                    <button class="btn btn-ghost" data-action="edit-product" data-id="${item.id}" title="Edit">✏️</button>
                    <button class="btn btn-ghost" data-action="delete-product" data-id="${item.id}" data-name="${safeName}" title="Delete" style="color:var(--red);">🗑️</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// --- Tabs ---
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');

    document.getElementById('tab-stock').style.display = tab === 'stock' ? '' : 'none';
    document.getElementById('tab-products').style.display = tab === 'products' ? '' : 'none';
    document.getElementById('tab-transactions').style.display = tab === 'transactions' ? '' : 'none';

    if (tab === 'transactions') loadTransactions();
}

// --- Filter ---
function filterInventory() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const category = document.getElementById('categoryFilter').value;
    const stockFilter = document.getElementById('stockFilter').value;

    let filtered = inventoryData.filter(item => {
        if (search && !item.name.toLowerCase().includes(search)) return false;
        if (category && item.category !== category) return false;

        const stock = item.stock_boxes || 0;
        if (stockFilter === 'in' && stock <= 5) return false;
        if (stockFilter === 'low' && (stock <= 0 || stock > 5)) return false;
        if (stockFilter === 'out' && stock > 0) return false;

        return true;
    });

    renderStockTable(filtered);
    renderProductTable(filtered);
}

// --- Product Modal ---
function openAddProductModal() {
    document.getElementById('modalTitle').textContent = 'Add New Product';
    document.getElementById('editProductId').value = '';
    document.getElementById('modalName').value = '';
    document.getElementById('modalNetQty').value = '';
    document.getElementById('modalPcs').value = '';
    document.getElementById('modalSellingRate').value = '';
    document.getElementById('modalPurchaseRate').value = '';
    document.getElementById('modalCategory').value = '';
    document.getElementById('modalHsnCode').value = '21050000';
    document.getElementById('productModal').style.display = '';
}

function openEditProductModal(id) {
    const item = inventoryData.find(i => i.id === id);
    if (!item) return;

    document.getElementById('modalTitle').textContent = 'Edit Product';
    document.getElementById('editProductId').value = id;
    document.getElementById('modalName').value = item.name;
    document.getElementById('modalNetQty').value = item.net_qty;
    document.getElementById('modalPcs').value = item.pcs_per_box;
    document.getElementById('modalSellingRate').value = item.selling_rate;
    document.getElementById('modalPurchaseRate').value = item.purchase_rate || '';
    document.getElementById('modalCategory').value = item.category;
    document.getElementById('modalHsnCode').value = item.hsn_code || '21050000';
    document.getElementById('productModal').style.display = '';
}

function closeModal() {
    document.getElementById('productModal').style.display = 'none';
}

async function saveProduct() {
    const id = document.getElementById('editProductId').value;
    const data = {
        name: document.getElementById('modalName').value.trim(),
        net_qty: document.getElementById('modalNetQty').value.trim(),
        pcs_per_box: parseInt(document.getElementById('modalPcs').value) || 1,
        selling_rate: parseFloat(document.getElementById('modalSellingRate').value) || 0,
        purchase_rate: parseFloat(document.getElementById('modalPurchaseRate').value) || 0,
        category: document.getElementById('modalCategory').value.trim() || 'General',
        hsn_code: document.getElementById('modalHsnCode').value.trim() || '21050000'
    };

    if (!data.name || !data.net_qty) {
        return showToast('Product name and Net QTY are required!', 'warning');
    }

    try {
        if (id) {
            await API.put(`/api/products/${id}`, data);
            showToast('Product updated!', 'success');
        } else {
            await API.post('/api/products', data);
            showToast('Product added!', 'success');
        }
        closeModal();
        await loadData();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function deleteProduct(id, name) {
    if (!confirm(`Are you sure you want to remove "${name}"?`)) return;

    try {
        await API.delete(`/api/products/${id}`);
        showToast('Product removed!', 'success');
        await loadData();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// --- Stock Modal ---
function promptAdjustStock(id, name, currentStock) {
    document.getElementById('adjustStockProductId').value = id;
    document.getElementById('adjustStockProductName').textContent = name;
    document.getElementById('adjustStockCurrent').textContent = currentStock;
    document.getElementById('adjustStockBoxes').value = currentStock;
    document.getElementById('adjustStockRelative').value = '';
    document.getElementById('adjustStockBoxes').dataset.current = currentStock;
    document.getElementById('adjustStockModal').style.display = 'flex';
}

function calculateAbsoluteStock() {
    const current = parseFloat(document.getElementById('adjustStockBoxes').dataset.current) || 0;
    const rel = parseFloat(document.getElementById('adjustStockRelative').value) || 0;
    const newStock = current + rel;
    document.getElementById('adjustStockBoxes').value = newStock >= 0 ? newStock : 0;
}

function calculateRelativeStock() {
    const current = parseFloat(document.getElementById('adjustStockBoxes').dataset.current) || 0;
    const abs = parseFloat(document.getElementById('adjustStockBoxes').value) || 0;
    document.getElementById('adjustStockRelative').value = abs - current;
}

function closeAdjustModal() {
    document.getElementById('adjustStockModal').style.display = 'none';
}

async function submitAdjustStock() {
    const productId = parseInt(document.getElementById('adjustStockProductId').value);
    const newStock = parseFloat(document.getElementById('adjustStockBoxes').value);

    if (isNaN(newStock) || newStock < 0) {
        return showToast('Enter a valid stock count!', 'warning');
    }

    try {
        await API.put(`/api/inventory/${productId}`, { stock_boxes: newStock });
        showToast('Stock adjusted!', 'success');
        closeAdjustModal();
        await loadData();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// --- Event Delegation for all table action buttons ---
document.addEventListener('click', (e) => {
    // Close modals on overlay click
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
        return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id);
    const name = btn.dataset.name ? unescName(btn.dataset.name) : '';

    switch (action) {
        case 'adjust-stock':
            promptAdjustStock(id, name, parseFloat(btn.dataset.stock) || 0);
            break;
        case 'edit-product':
            openEditProductModal(id);
            break;
        case 'delete-product':
            deleteProduct(id, name);
            break;
    }
});

// --- Two-Step Reversion UI ---
async function deleteTransaction(id) {
    const btn = document.getElementById(`del-txn-${id}`);
    if (btn.dataset.confirming !== 'true') {
        btn.dataset.confirming = 'true';
        btn.innerHTML = '⚠️ Confirm?';
        btn.style.color = '#ef4444';
        setTimeout(() => {
            if (btn) {
                btn.dataset.confirming = 'false';
                btn.innerHTML = '🗑️';
                btn.style.color = '';
            }
        }, 3000);
        return;
    }
    
    btn.innerHTML = '⏳...';
    btn.disabled = true;
    try {
        await API.delete(`/api/inventory/transaction/${id}`);
        showToast('Transaction successfully reverted from Stock!', 'success');
        // Reload all data so stock badges update
        loadData();
    } catch (err) {
        showToast(err.message || 'Failed to revert transaction', 'error');
        btn.innerHTML = '🗑️';
        btn.disabled = false;
        btn.dataset.confirming = 'false';
        btn.style.color = '';
    }
}
