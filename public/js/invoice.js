// =============================================
// BILLING — Invoice Page
// =============================================

let products = [];
let currentInvoiceNo = 'LOADING...';
let isSaved = false;

// --- Initialize ---
async function init() {
    try {
        // Load products
        products = await API.get('/api/products');
        populateDatalist();

        // Get next invoice number
        const inv = await API.get('/api/invoices/next-number');
        currentInvoiceNo = inv.invoice_no;
        document.getElementById('invoiceNoBadge').textContent = currentInvoiceNo;

        // Auto-set the date input to today
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('custDate').value = `${yyyy}-${mm}-${dd}`;

        // Add 3 default rows
        for (let i = 0; i < 3; i++) addProductRow();

        showToast('Billing system ready!', 'success');
    } catch (err) {
        console.error('Init error:', err);
        showToast('Error loading data: ' + err.message, 'error');
        currentInvoiceNo = 'INV-' + new Date().getFullYear() + '-0001';
        document.getElementById('invoiceNoBadge').textContent = currentInvoiceNo;
        for (let i = 0; i < 3; i++) addProductRow();
    }
}

function populateDatalist() {
    const datalist = document.getElementById('inventoryList');
    datalist.innerHTML = '';
    products.forEach(p => {
        datalist.innerHTML += `<option value="${p.name}">`;
    });
}

// --- Product Rows ---
let rowCounter = 0;

function addProductRow() {
    const container = document.getElementById('productRows');
    const emptyState = document.getElementById('emptyProducts');
    emptyState.style.display = 'none';

    const rowId = ++rowCounter;
    const div = document.createElement('div');
    div.className = 'product-row';
    div.id = `row-${rowId}`;
    div.innerHTML = `
        <div style="flex:3;">
            <input list="inventoryList" class="form-input p-name" placeholder="Search product..." 
                   onchange="onProductSelect(${rowId})" oninput="onProductSelect(${rowId})">
        </div>
        <div style="width: 140px; flex: none;">
            <input type="number" class="form-input p-box" placeholder="Boxes" min="0" step="1" 
                   oninput="recalculate()">
        </div>
        <span class="stock-badge" id="stock-${rowId}" style="display:none;"></span>
        <button class="btn-remove-row" onclick="removeRow(${rowId})" title="Remove">✕</button>
    `;
    container.appendChild(div);
}

function removeRow(id) {
    const row = document.getElementById(`row-${id}`);
    if (row) {
        row.style.opacity = '0';
        row.style.transform = 'translateX(20px)';
        row.style.transition = 'all 0.2s';
        setTimeout(() => {
            row.remove();
            recalculate();
            // Show empty state if no rows
            const container = document.getElementById('productRows');
            if (container.children.length === 0) {
                document.getElementById('emptyProducts').style.display = '';
            }
        }, 200);
    }
}

function onProductSelect(rowId) {
    const row = document.getElementById(`row-${rowId}`);
    if (!row) return;

    const name = row.querySelector('.p-name').value;
    const product = products.find(p => p.name === name);
    const badge = document.getElementById(`stock-${rowId}`);

    if (product) {
        // Show stock level
        const stock = product.stock_boxes || 0;
        badge.style.display = '';
        if (stock > 5) {
            badge.className = 'stock-badge in-stock';
            badge.textContent = `${stock} boxes`;
        } else if (stock > 0) {
            badge.className = 'stock-badge low-stock';
            badge.textContent = `${stock} boxes`;
        } else {
            badge.className = 'stock-badge no-stock';
            badge.textContent = 'No stock';
        }
    } else {
        badge.style.display = 'none';
    }

    recalculate();
}

// --- Recalculate Totals ---
function recalculate() {
    let subtotal = 0;

    document.querySelectorAll('.product-row').forEach(row => {
        const name = row.querySelector('.p-name').value;
        const boxes = parseFloat(row.querySelector('.p-box').value) || 0;
        const product = products.find(p => p.name === name);

        if (product && boxes > 0) {
            subtotal += boxes * product.selling_rate;
        }
    });

    const cgst = subtotal * 0.025;
    const sgst = subtotal * 0.025;
    const total = Math.round(subtotal + cgst + sgst);

    document.getElementById('liveSubtotal').textContent = formatCurrency(subtotal);
    document.getElementById('liveCgst').textContent = formatCurrency(cgst);
    document.getElementById('liveSgst').textContent = formatCurrency(sgst);
    document.getElementById('liveTotal').textContent = formatCurrencyRound(total);
}

// --- Prepare Invoice Data ---
function prepareInvoice() {
    const rawDate = document.getElementById('custDate').value;
    let dateStr = new Date().toLocaleDateString('en-GB'); // Fallback DD/MM/YYYY
    if (rawDate) {
        const [y, m, d] = rawDate.split('-');
        dateStr = `${d}/${m}/${y}`;
    }

    const custName = document.getElementById('custName').value.trim().toUpperCase() || 'WALK-IN CUSTOMER';
    const custPhone = document.getElementById('custPhone').value.trim() || 'N/A';
    const custGst = document.getElementById('custGst').value.trim() || 'N/A';

    // Set invoice display
    document.getElementById('disInv').textContent = currentInvoiceNo;
    document.getElementById('disDate').textContent = dateStr;
    document.getElementById('disName').textContent = custName;
    document.getElementById('disPhone').textContent = '📞 ' + custPhone;
    document.getElementById('disGst').textContent = 'GSTIN: ' + custGst;

    const tbody = document.getElementById('invoiceTableBody');
    tbody.innerHTML = '';
    let subtotal = 0;
    const items = [];

    let sno = 0;
    document.querySelectorAll('.product-row').forEach(row => {
        const name = row.querySelector('.p-name').value;
        const boxes = parseFloat(row.querySelector('.p-box').value) || 0;
        const product = products.find(p => p.name === name);

        if (product && boxes > 0) {
            sno++;
            const amount = boxes * product.selling_rate;
            subtotal += amount;

            tbody.innerHTML += `
                <tr>
                    <td>${sno}</td>
                    <td style="text-align:left; font-weight:500;">${name}</td>
                    <td>${product.net_qty}</td>
                    <td>${product.pcs_per_box}</td>
                    <td>${boxes}</td>
                    <td>₹${amount.toFixed(2)}</td>
                </tr>`;

            items.push({
                product_id: product.id,
                product_name: name,
                net_qty: product.net_qty,
                pcs: product.pcs_per_box,
                boxes: boxes,
                rate: product.selling_rate,
                amount: amount
            });
        }
    });

    if (items.length === 0) return null;

    const cgst = subtotal * 0.025;
    const sgst = subtotal * 0.025;
    const total = Math.round(subtotal + cgst + sgst);

    // Update invoice display
    document.getElementById('invSubtotal').textContent = '₹' + subtotal.toFixed(2);
    document.getElementById('invCgst').textContent = '₹' + cgst.toFixed(2);
    document.getElementById('invSgst').textContent = '₹' + sgst.toFixed(2);
    document.getElementById('invTotal').textContent = '₹' + total;

    return {
        invoice_no: currentInvoiceNo,
        date: dateStr,
        customer_name: custName,
        customer_phone: custPhone,
        customer_gstin: custGst,
        subtotal: parseFloat(subtotal.toFixed(2)),
        cgst: parseFloat(cgst.toFixed(2)),
        sgst: parseFloat(sgst.toFixed(2)),
        total: total,
        items: items
    };
}

// --- Save Invoice ---
async function saveInvoice(data) {
    if (isSaved || !data) return;
    try {
        await API.post('/api/invoices', data);
        isSaved = true;
        showToast('Invoice saved & stock updated!', 'success');
    } catch (err) {
        console.error('Save error:', err);
        showToast('Error saving: ' + err.message, 'error');
    }
}

// --- Print Handler ---
async function handlePrint() {
    const data = prepareInvoice();
    if (!data) return showToast('Please add products first!', 'warning');

    // Dynamic filename for PDF
    const originalTitle = document.title;
    document.title = `Invoice_${data.invoice_no}_${data.customer_name}_${data.date.replace(/\//g, '-')}`;

    document.getElementById('invoiceCanvas').style.display = 'block';

    await saveInvoice(data);

    setTimeout(() => {
        window.print();
        document.title = originalTitle;
    }, 300);
}

// --- WhatsApp Handler ---
async function handleWhatsApp() {
    const phone = document.getElementById('custPhone').value.trim();
    if (!phone) return showToast('Please enter a WhatsApp number!', 'warning');

    const data = prepareInvoice();
    if (!data) return showToast('Invoice is empty!', 'warning');

    await saveInvoice(data);

    const items = data.items.map(i => `• ${i.product_name} × ${i.boxes} box = ₹${i.amount.toFixed(2)}`).join('%0A');
    const msg = `*🧾 TAX INVOICE*%0A━━━━━━━━━━━━━━━━━%0AInvoice: *${data.invoice_no}*%0ADate: ${data.date}%0ACustomer: *${data.customer_name}*%0A%0A📦 *Items:*%0A${items}%0A%0A━━━━━━━━━━━━━━━━━%0ASubtotal: ₹${data.subtotal}%0ACGST (2.5%%): ₹${data.cgst}%0ASGST (2.5%%): ₹${data.sgst}%0A*TOTAL: ₹${data.total}*%0A━━━━━━━━━━━━━━━━━%0A%0AThank you for your business! 🙏`;

    window.open(`https://wa.me/91${phone}?text=${msg}`);
}

// --- Load products with stock info ---
async function loadProductsWithStock() {
    try {
        const inventory = await API.get('/api/inventory');
        products = inventory.map(item => ({
            id: item.id,
            name: item.name,
            net_qty: item.net_qty,
            pcs_per_box: item.pcs_per_box,
            selling_rate: item.selling_rate,
            purchase_rate: item.purchase_rate,
            category: item.category,
            stock_boxes: item.stock_boxes || 0
        }));
        populateDatalist();
    } catch (err) {
        console.error('Failed to load inventory:', err);
    }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', async () => {
    await loadProductsWithStock();

    // Auto-set the date input to today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateInput = document.getElementById('custDate');
    if (dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;

    try {
        const inv = await API.get('/api/invoices/next-number');
        currentInvoiceNo = inv.invoice_no;
        document.getElementById('invoiceNoBadge').textContent = currentInvoiceNo;
    } catch (err) {
        currentInvoiceNo = 'INV-' + new Date().getFullYear() + '-0001';
        document.getElementById('invoiceNoBadge').textContent = currentInvoiceNo;
    }

    for (let i = 0; i < 3; i++) addProductRow();
    // showToast('Billing system ready!', 'success');
});

// --- New Invoice Handler ---
async function handleNewInvoice() {
    // Warn if unsaved
    const hasItems = document.querySelectorAll('.product-row').length > 0 &&
        Array.from(document.querySelectorAll('.p-name')).some(el => el.value);

    if (hasItems && !isSaved) {
        if (!confirm('You have an unsaved invoice. Are you sure you want to discard it and start a new one?')) {
            return;
        }
    }

    // Reset customer details
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById('custDate').value = `${yyyy}-${mm}-${dd}`;
    
    document.getElementById('custName').value = '';
    document.getElementById('custPhone').value = '';
    document.getElementById('custGst').value = '';

    // Reset products list
    document.getElementById('productRows').innerHTML = '';
    rowCounter = 0;
    for (let i = 0; i < 3; i++) addProductRow();

    // Reset summaries
    document.getElementById('liveSubtotal').textContent = '₹0.00';
    document.getElementById('liveCgst').textContent = '₹0.00';
    document.getElementById('liveSgst').textContent = '₹0.00';
    document.getElementById('liveTotal').textContent = '₹0';

    // Hide the print preview canvas if it's currently showing
    document.getElementById('invoiceCanvas').style.display = 'none';

    // Fetch next invoice number
    isSaved = false;
    document.getElementById('invoiceNoBadge').textContent = 'Loading...';
    try {
        const inv = await API.get('/api/invoices/next-number');
        currentInvoiceNo = inv.invoice_no;
        document.getElementById('invoiceNoBadge').textContent = currentInvoiceNo;

        // Refresh product stock list to ensure accurate counts for the new invoice
        await loadProductsWithStock();

        showToast('Started new invoice', 'success');
    } catch (err) {
        console.error('Error fetching new invoice no:', err);
        showToast('Error starting new invoice', 'error');
    }

    // Focus on first field
    document.getElementById('custName').focus();
}
