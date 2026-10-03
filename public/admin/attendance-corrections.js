const API = ''; // same-origin
let token = localStorage.getItem('acr_token') || '';
let currentUser = JSON.parse(localStorage.getItem('acr_user') || 'null');

const el = (id) => document.getElementById(id);

function statusBadge(status) {
    const cls = { present: 'badge-present', half_day: 'badge-half_day', absent: 'badge-absent' }[status] || 'badge-default';
    const label = (status || '-').replace('_', ' ');
    return `<span class="badge ${cls}">${label}</span>`;
}

function fmtDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString();
}
function fmtTime(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}
// Local "HH:mm" from a stored ISO time, for prefilling <input type="time">.
function toTimeInput(d) {

    if (!d) return '';
    const dt = new Date(d);
    return String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');

}

async function api(path, opts = {}) {

    const res = await fetch(API + path, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(opts.headers || {})
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `Request failed (${res.status})`);
    return json;
}

function showApp() {
    el('loginCard').classList.add('hidden');
    el('appHeader').classList.remove('hidden');
    el('appBody').classList.remove('hidden');
    el('whoami').textContent = `${currentUser.firstName} ${currentUser.lastName} (${currentUser.role})`;
    loadPending();
    loadEmployees();
}

function showLogin() {
    el('loginCard').classList.remove('hidden');
    el('appHeader').classList.add('hidden');
    el('appBody').classList.add('hidden');
}

el('loginBtn').addEventListener('click', async () => {
    el('loginMsg').textContent = '';

    try {
        const data = await api('/api/auth/login', {
            method: 'POST',
            body: { email: el('loginEmail').value.trim(), password: el('loginPassword').value }
        });
        if (data.data.user.role !== 'admin') {
            throw new Error('This tool is admin-only.');
        }
        token = data.data.token;
        currentUser = data.data.user;
        localStorage.setItem('acr_token', token);
        localStorage.setItem('acr_user', JSON.stringify(currentUser));
        showApp();
    } catch (err) {
        el('loginMsg').textContent = err.message;
        el('loginMsg').className = 'msg error';
    }

});

el('logoutBtn').addEventListener('click', () => {
    token = '';
    currentUser = null;
    localStorage.removeItem('acr_token');
    localStorage.removeItem('acr_user');
    showLogin();
});

document.querySelectorAll('.tab-btn').forEach((btn) => {

    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('main section.card').forEach((s) => s.classList.add('hidden'));
        el('tab-' + btn.dataset.tab).classList.remove('hidden');
    });

});

// ---- Pending correction requests ----------------------------------------

async function loadPending() {

    el('pendingMsg').textContent = '';
    try {
        const { data } = await api('/api/attendance/corrections?status=pending&limit=100');
        renderPending(data);
    } catch (err) {
        el('pendingMsg').textContent = err.message;
        el('pendingMsg').className = 'msg error';
    }

}

function renderPending(requests) {
    const tbody = el('pendingRows');
    tbody.innerHTML = '';

    if (!requests.length) {
        tbody.innerHTML = '<tr><td colspan="6">No pending correction requests.</td></tr>';
        return;
    }
    requests.forEach((r) => {
        const tr = document.createElement('tr');
        const employeeName = r.user ? `${r.user.firstName} ${r.user.lastName}` : 'Unknown';
        tr.innerHTML = `
            <td>${employeeName}</td>
            <td>${fmtDate(r.date)}</td>
            <td>${fmtTime(r.requestedCheckIn)}</td>
            <td>${fmtTime(r.requestedCheckOut)}</td>
            <td>${r.reason || ''}</td>
            <td><button class="btn-secondary review-btn">Review</button></td>
        `;
        const formRow = document.createElement('tr');
        formRow.innerHTML = `<td colspan="6">
            <div class="request-form" id="form-${r._id}">
                <div class="row">
                    <div>
                        <label>Exact check-in time</label>
                        <input type="time" step="60" class="ci-input" value="${toTimeInput(r.requestedCheckIn)}">
                    </div>
                    <div>
                        <label>Exact check-out time</label>
                        <input type="time" step="60" class="co-input" value="${toTimeInput(r.requestedCheckOut)}">
                    </div>
                    <div>
                        <label>Force count as (optional)</label>
                        <select class="status-input">
                            <option value="">Auto-calculate from time</option>
                            <option value="present">Full Day (Present)</option>
                            <option value="half_day">Half Day</option>
                            <option value="absent">Absent</option>
                            <option value="wfh">Work From Home</option>
                            <option value="on_leave">On Leave</option>
                        </select>
                    </div>
                </div>
                <div style="margin-top:10px;">
                    <button class="btn-primary approve-btn">Approve</button>
                    <button class="btn-danger reject-btn">Reject</button>
                </div>
                <div class="msg row-msg"></div>
            </div>
        </td>`;

        tr.querySelector('.review-btn').addEventListener('click', () => {
            formRow.querySelector('.request-form').classList.toggle('open');
        });

        formRow.querySelector('.approve-btn').addEventListener('click', async () => {
            const msg = formRow.querySelector('.row-msg');
            const dateStr = r.date.slice(0, 10);
            const ci = formRow.querySelector('.ci-input').value;
            const co = formRow.querySelector('.co-input').value;
            const status = formRow.querySelector('.status-input').value;
            
            try {
                await api(`/api/attendance/corrections/${r._id}`, {
                    method: 'PUT',
                    body: {
                        status: 'approved',
                        ...(ci ? { requestedCheckIn: `${dateStr}T${ci}:00` } : {}),
                        ...(co ? { requestedCheckOut: `${dateStr}T${co}:00` } : {}),
                        ...(status ? { overrideStatus: status } : {})
                    }
                });
                msg.textContent = 'Approved.';
                msg.className = 'msg row-msg success';
                loadPending();
            } catch (err) {
                msg.textContent = err.message;
                msg.className = 'msg row-msg error';
            }
        });

        formRow.querySelector('.reject-btn').addEventListener('click', async () => {

            const msg = formRow.querySelector('.row-msg');
            const rejectionReason = prompt('Reason for rejecting this request:');
            if (rejectionReason === null) return;
            try {
                await api(`/api/attendance/corrections/${r._id}`, {
                    method: 'PUT',
                    body: { status: 'rejected', rejectionReason }
                });
                msg.textContent = 'Rejected.';
                msg.className = 'msg row-msg success';
                loadPending();
            } catch (err) {
                msg.textContent = err.message;
                msg.className = 'msg row-msg error';
            }
        });

        tbody.appendChild(tr);
        tbody.appendChild(formRow);
    });
}

el('refreshPending').addEventListener('click', loadPending);

// ---- Direct correction ----------------------------------------------------

async function loadEmployees() {
    try {
        const { data } = await api('/api/users?limit=500&isActive=true');
        const select = el('directEmployee');
        select.innerHTML = data
            .map((u) => `<option value="${u._id}">${u.firstName} ${u.lastName} (${u.employeeCode || u.email})</option>`)
            .join('');
    } catch (err) {
        el('directMsg').textContent = 'Could not load employee list: ' + err.message;
        el('directMsg').className = 'msg error';
    }
}

el('directSubmit').addEventListener('click', async () => {
    const msg = el('directMsg');
    msg.textContent = '';
    const userId = el('directEmployee').value;
    const date = el('directDate').value;
    const ci = el('directCheckIn').value;
    const co = el('directCheckOut').value;
    const status = el('directStatus').value;
    const reason = el('directReason').value.trim();

    if (!userId || !date) {
        msg.textContent = 'Employee and date are required.';
        msg.className = 'msg error';
        return;
    }
    if (!reason) {
        msg.textContent = 'A reason is required.';
        msg.className = 'msg error';
        return;
    }
    if (!ci && !co && !status) {
        msg.textContent = 'Provide a check-in/check-out time and/or a status to force.';
        msg.className = 'msg error';
        return;
    }

    try {
        const { data } = await api('/api/attendance/correct', {
            method: 'PUT',
            body: {
                userId,
                date,
                ...(ci ? { checkInTime: `${date}T${ci}:00` } : {}),
                ...(co ? { checkOutTime: `${date}T${co}:00` } : {}),
                ...(status ? { status } : {}),
                reason
            }
        });
        msg.innerHTML = `Saved. Working hours: ${data.workingHours ?? 0}h, day counted as ${statusBadge(data.status)}.`;
        msg.className = 'msg success';
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'msg error';
    }
});

if (token && currentUser) {
    showApp();
} else {
    showLogin();
}
