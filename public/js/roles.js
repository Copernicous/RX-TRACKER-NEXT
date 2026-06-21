// roles.js — Extracted from inline script for FortiGate proxy compatibility.

// ── Module definitions ────────────────────────────────────────────────────────
const MODULE_DEFS = [
    { key: 'dashboard',          label: 'Dashboard',             group: 'Core',      hasUndo: false, visibleLocked: true },
    { key: 'patients',           label: 'Patients',              group: 'Core',      hasUndo: false },
    { key: 'rx_records',         label: 'RX Records',            group: 'Core',      hasWorkflow: true  },
    { key: 'reports',            label: 'Reports',               group: 'Core',      hasUndo: false },
    { key: 'patient_notes',      label: 'Patient Notes',         group: 'Core',      hasUndo: false, notesOnly: true },
    { key: 'audit_log',          label: 'Audit Log',             group: 'Admin',     hasUndo: false, visibleOnly: true },
    { key: 'import',             label: 'Data Import',           group: 'Admin',     hasUndo: false },
    { key: 'pharmacies',         label: 'Pharmacies',            group: 'Settings',  hasUndo: false },
    { key: 'patient_transport',  label: 'Patient Transport',     group: 'Settings',  hasUndo: false },
    { key: 'pharmacy_transport', label: 'Pharmacy Transport',    group: 'Settings',  hasUndo: false },
    { key: 'workflow_actions',   label: 'Workflow Actions',      group: 'Settings',  hasUndo: false },
    { key: 'clinics',            label: 'Clinics',               group: 'Settings',  hasUndo: false },
    { key: 'medication_catalog', label: 'RX Actions Catalog',    group: 'Settings',  hasUndo: false },
    { key: 'users',              label: 'User Management',       group: 'Admin-Only', hasUndo: false },
    { key: 'backups',            label: 'Backups',               group: 'Admin-Only', hasUndo: false, visibleOnly: true },
    { key: 'system_settings',    label: 'System Settings',       group: 'Admin-Only', hasUndo: false, visibleOnly: true }
];

const GROUP_COLORS = { Core: '#0d6efd', Admin: '#fd7e14', Settings: '#6c757d', 'Admin-Only': '#dc3545' };

// ── State ─────────────────────────────────────────────────────────────────────
let allRoles    = [];
let editingId   = null;  // null = new role
let deletingId  = null;
let roleDefaults = {};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initApp();
    await Promise.all([loadRoles(), loadDefaults()]);
});

async function loadRoles() {
    const res = await fetchWithAuth('/api/roles');
    if (!res || !res.ok) { showToast('Failed to load roles.', 'danger'); return; }
    allRoles = await res.json();
    renderRolesTable();
}

async function loadDefaults() {
    const res = await fetchWithAuth('/api/roles/permission-defaults', { silent: true });
    if (res && res.ok) roleDefaults = await res.json();
    renderMatrix();
}

// ── Roles Table ───────────────────────────────────────────────────────────────
function renderRolesTable() {
    const tbody = document.getElementById('rolesTableBody');
    if (!allRoles.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No roles found.</td></tr>';
        return;
    }
    const roleColors = { Administrator: '#f59e0b', Supervisor: '#60a5fa', Operator: '#34d399', 'Read Only': '#9ca3af' };
    var _rHtml='';
    for(var _ri=0;_ri<allRoles.length;_ri++){ var r=allRoles[_ri];
        const color  = roleColors[r.name] || '#a78bfa';
        const badge  = r.isSystem
            ? '<span class="badge bg-secondary ms-1" style="font-size:.6rem">Built-in</span>'
            : '<span class="badge bg-success ms-1"  style="font-size:.6rem">Custom</span>';
        var delBtn = r.isSystem
            ? '<button class="btn btn-sm btn-outline-secondary" disabled title="Built-in roles cannot be deleted"><i class="fas fa-lock"></i></button>'
            : '<button class="btn btn-sm btn-outline-danger" data-del-role="' + r.id + '" data-del-name="' + r.name.replace(/'/g,"&#39;") + '" title="Delete role"><i class="fas fa-trash-alt"></i></button>';
        _rHtml +=
            '<tr>' +
            '<td><span class="fw-semibold" style="color:' + color + '"><i class="fas fa-shield-alt me-2" style="opacity:.7"></i>' + r.name + '</span>' + badge + '</td>' +
            '<td class="text-muted small">' + (r.description || '<em class="opacity-50">No description</em>') + '</td>' +
            '<td class="text-center"><span class="badge bg-primary">' + r.userCount + ' user' + (r.userCount !== 1 ? 's' : '') + '</span></td>' +
            '<td class="text-center">' + (r.isSystem ? '<span class="badge bg-secondary">System</span>' : '<span class="badge bg-success">Custom</span>') + '</td>' +
            '<td class="text-center"><div class="d-flex justify-content-center gap-1">' +
                '<button class="btn btn-sm btn-outline-primary" data-edit-role="' + r.id + '" title="Edit role"><i class="fas fa-edit"></i></button>' +
                '<button class="btn btn-sm btn-outline-info" data-dup-role="' + r.id + '" data-dup-name="' + r.name.replace(/'/g,"&#39;") + '" title="Duplicate role"><i class="fas fa-copy"></i></button>' +
                delBtn +
            '</div></td>' +
            '</tr>';
    } tbody.innerHTML=_rHtml;
}

// ── Permission Matrix (read-only overview) ────────────────────────────────────
function renderMatrix() {
    const container = document.getElementById('permMatrixContainer');
    if (!Object.keys(roleDefaults).length) {
        container.innerHTML = '<p class="text-muted text-center small">Matrix will appear after roles are loaded.</p>';
        return;
    }
    const roles = allRoles.length ? allRoles : Object.keys(roleDefaults).map(name => ({ name }));

    function badge(val, icon, color) {
        return val
            ? '<span class="badge bg-' + color + ' me-1" style="font-size:.6rem"><i class="fas fa-' + icon + '"></i></span>'
            : '<span class="badge bg-secondary opacity-25 me-1" style="font-size:.6rem"><i class="fas fa-' + icon + '"></i></span>';
    }
    function cellHTML(perm) {
        if (!perm || perm.visible === false) {
            return '<td class="text-center" style="background:rgba(220,53,69,.07)"><span class="badge bg-danger" style="font-size:.62rem"><i class="fas fa-eye-slash me-1"></i>Hidden</span></td>';
        }
        // canAdd fallback: if old data without canAdd, treat canEdit as canAdd
        const hasAdd = perm.canAdd !== undefined ? perm.canAdd : perm.canEdit;
        return '<td class="text-center" style="background:rgba(25,135,84,.05)">' +
            badge(hasAdd,       'plus-circle','success') +
            badge(perm.canEdit, 'edit',       'primary') +
            badge(perm.canDelete,'trash',     'danger')  +
            badge(perm.canExport,'file-csv',  'info')    +
            (perm.canUndo ? badge(true,'undo','warning') : '') +
            '</td>';
    }

    let lastGroup = '';
    var rows='';
    for(var _mi=0;_mi<MODULE_DEFS.length;_mi++){var m=MODULE_DEFS[_mi];
        let groupRow = '';
        if (m.group !== lastGroup) {
            lastGroup = m.group;
            groupRow = '<tr style="background:rgba(255,255,255,.02)">' +
                '<td colspan="' + (roles.length + 1) + '" class="fw-bold py-1 px-3" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:' + (GROUP_COLORS[m.group]||'#aaa') + '">' + m.group + '</td>' +
            '</tr>';
        }
        var _cHtml=''; for(var _ci=0;_ci<roles.length;_ci++){var _r2=roles[_ci]; var _p2=(_r2.permissions||roleDefaults[_r2.name])||{}; _cHtml+=cellHTML(_p2[m.key]);} var cells=_cHtml;
        rows += groupRow + '<tr><td class="ps-3 fw-semibold" style="white-space:nowrap;font-size:.82rem">' + m.label + '</td>' + cells + '</tr>';
    }

    const roleColors = { Administrator: '#f59e0b', Supervisor: '#60a5fa', Operator: '#34d399', 'Read Only': '#9ca3af' };
    const roleIcons  = { Administrator: 'fa-shield-alt', Supervisor: 'fa-user-tie', Operator: 'fa-user-cog', 'Read Only': 'fa-user-lock' };

    var _thHtml='';
    for(var _thi=0;_thi<roles.length;_thi++){var _thr=roles[_thi]; var _thc=roleColors[_thr.name]||'#a78bfa'; var _thic=roleIcons[_thr.name]||'fa-user-shield'; _thHtml+='<th class="text-center" style="width:110px;color:'+_thc+'"><i class="fas '+_thic+' me-1"></i>'+_thr.name+'</th>';}
    container.innerHTML =
        '<div class="table-responsive"><table class="table table-bordered table-sm align-middle mb-0" style="font-size:.8rem"><thead class="table-dark"><tr><th style="min-width:160px">Module</th>'+_thHtml+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
        '<div class="d-flex flex-wrap gap-3 mt-3 small text-muted">'+
        '<span>'+badge(true,'plus-circle','success')+' Add New</span>'+
        '<span>'+badge(true,'edit','primary')+' Edit Existing</span>'+
        '<span>'+badge(true,'trash','danger')+' Delete</span>'+
        '<span>'+badge(true,'file-csv','info')+' Export</span>'+
        '<span>'+badge(true,'undo','warning')+' Undo</span>'+
        '<span><span class="badge bg-danger" style="font-size:.62rem"><i class="fas fa-eye-slash"></i></span> Hidden</span>'+
        '<span><span class="badge bg-secondary opacity-25" style="font-size:.62rem"><i class="fas fa-plus-circle"></i></span> Off</span>'+
        '</div>';
}

// ── Role Modal (create / edit) ────────────────────────────────────────────────
async function openRoleModal(id) {
    editingId = id;
    const isNew = (id === null);
    document.getElementById('roleModalTitle').innerHTML =
        '<i class="fas fa-shield-alt me-2 text-warning"></i>' + (isNew ? 'Create New Role' : 'Edit Role');
    document.getElementById('roleNameError').classList.add('d-none');

    let currentPerms = {};
    let roleName = '';
    let roleDesc = '';
    let isSystem = false;

    if (!isNew) {
        const res = await fetchWithAuth('/api/roles/' + id);
        if (!res || !res.ok) { showToast('Failed to load role.', 'danger'); return; }
        const role = await res.json();
        roleName    = role.name;
        roleDesc    = role.description || '';
        currentPerms = role.permissions || roleDefaults[role.name] || {};
        isSystem    = role.isSystem;
    } else {
        // Default new role to Read Only baseline
        currentPerms = JSON.parse(JSON.stringify(roleDefaults['Read Only'] || {}));
    }

    const nameInput = document.getElementById('roleNameInput');
    nameInput.value = roleName;
    nameInput.disabled = isSystem; // can't rename system roles
    document.getElementById('roleDescInput').value = roleDesc;

    // Template buttons
    const templateDiv = document.getElementById('roleTemplateButtons');
    const templateColors = { Administrator: 'warning', Supervisor: 'primary', Operator: 'success', 'Read Only': 'secondary' };
    var _tplKeys=Object.keys(roleDefaults); var _tplHtml='';
    for(var _ti=0;_ti<_tplKeys.length;_ti++){var rn=_tplKeys[_ti]; _tplHtml+='<button class="btn btn-sm btn-outline-'+(templateColors[rn]||'info')+'" data-tpl="'+rn+'" type="button"><i class="fas fa-magic me-1"></i>'+rn+'</button>';}
    templateDiv.innerHTML=_tplHtml;
    templateDiv.addEventListener('click',function(ev){var _b=ev.target.closest('[data-tpl]');if(_b)applyTemplate(_b.dataset.tpl);});

    buildPermEditor(currentPerms);

    new bootstrap.Modal(document.getElementById('roleModal')).show();
}

function applyTemplate(roleName) {
    const defaults = roleDefaults[roleName];
    if (defaults) buildPermEditor(JSON.parse(JSON.stringify(defaults)));
    showToast(`Loaded ${roleName} defaults. Adjust below.`, 'info');
}

function buildPermEditor(perms) {
    const tbody = document.getElementById('permEditorBody');
    let lastGroup = '';
    var _mHtml='';
    for(var _mi2=0;_mi2<MODULE_DEFS.length;_mi2++){var m=MODULE_DEFS[_mi2];
    const p = perms[m.key] || { visible: false, canAdd: false, canEdit: false, canDelete: false, canExport: false, canUndo: false, canWarehouse: false };
    // Backward compat: if canAdd not stored, treat as canEdit
    if (p.canAdd === undefined) p.canAdd = p.canEdit;
    if (p.canWarehouse === undefined) p.canWarehouse = p.canEdit; // fallback for old data
        let groupRow = '';
        if (m.group !== lastGroup) {
            lastGroup = m.group;
            groupRow = '<tr style="background:rgba(255,255,255,.02)">' + '<td colspan="7" class="fw-bold py-1 px-2" style="font-size:.7rem;text-transform:uppercase;color:' + (GROUP_COLORS[m.group]||'#aaa') + '">' + m.group + '</td>' + '</tr>';
        }

        const dash = '<span class="text-muted">—</span>';

        if (m.visibleLocked) {
            // Dashboard — always visible, no write actions
            return groupRow + '<tr data-module="' + m.key + '"><td class="ps-3 fw-semibold">' + m.label + ' <span class="badge bg-secondary ms-1" style="font-size:.6rem">Always On</span></td><td class="text-center"><input type="checkbox" class="form-check-input perm-visible" checked disabled></td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td></tr>';
        }
        if (m.visibleOnly) {
            return groupRow + '<tr data-module="' + m.key + '"><td class="ps-3 fw-semibold">' + m.label + ' <span class="badge bg-info ms-1" style="font-size:.6rem">View only</span></td><td class="text-center"><input type="checkbox" class="form-check-input perm-visible" ' + (p.visible ? 'checked' : '') + '></td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td></tr>';
        }
        if (m.notesOnly) {
            // Patient notes: canAdd = can add notes, canDelete = can delete notes, no canEdit
            return groupRow + '<tr data-module="' + m.key + '" style="background:rgba(255,193,7,.04)"><td class="ps-3 fw-semibold">' + m.label + ' <span class="badge bg-warning text-dark ms-1" style="font-size:.6rem">Per-patient</span></td><td class="text-center"><span class="text-muted" title="Always visible">—</span></td><td class="text-center" title="Can add new notes"><input type="checkbox" class="form-check-input perm-canadd" ' + (p.canAdd ? 'checked' : '') + '></td><td class="text-center" title="Cannot edit existing notes (notes are immutable)"><span class="text-muted">—</span></td><td class="text-center" title="Can delete notes"><input type="checkbox" class="form-check-input perm-candelete" ' + (p.canDelete ? 'checked' : '') + '></td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td></tr>';
        }

        // RX Records gets 3 workflow columns: Complete (canAdd), Undo (canUndo), Warehouse (canWarehouse)
        const workflowCells = m.hasWorkflow
            ? '<td class="text-center" title="Can complete workflow steps"><input type="checkbox" class="form-check-input perm-canadd" ' + (p.canAdd ? 'checked' : '') + '></td><td class="text-center" title="Can undo last workflow step"><input type="checkbox" class="form-check-input perm-canundo" ' + (p.canUndo ? 'checked' : '') + '></td><td class="text-center" title="Can return to warehouse"><input type="checkbox" class="form-check-input perm-canwarehouse" ' + (p.canWarehouse ? 'checked' : '') + '></td>'
            : '<td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td><td class="text-center">' + dash + '</td>';

        // For rx_records with hasWorkflow, canAdd is shown in workflow column — hide from standard Add column
        const addCell = m.hasWorkflow
            ? '<td class="text-center">' + dash + '</td>'
            : '<td class="text-center"><input type="checkbox" class="form-check-input perm-canadd" ' + (p.canAdd ? 'checked' : '') + '></td>';

        _mHtml += groupRow + '<tr data-module="' + m.key + '"><td class="ps-3 fw-semibold">' + m.label + '</td><td class="text-center"><input type="checkbox" class="form-check-input perm-visible" ' + (p.visible ? 'checked' : '') + '></td>' + addCell + '<td class="text-center"><input type="checkbox" class="form-check-input perm-canedit" ' + (p.canEdit ? 'checked' : '') + '></td><td class="text-center"><input type="checkbox" class="form-check-input perm-candelete" ' + (p.canDelete ? 'checked' : '') + '></td><td class="text-center"><input type="checkbox" class="form-check-input perm-canexport" ' + (p.canExport ? 'checked' : '') + '></td>' + workflowCells + '</tr>';
    } tbody.innerHTML=_mHtml;
}

function readPermEditor() {
    const perms = {};
    document.querySelectorAll('#permEditorBody tr[data-module]').forEach(row => {
        const key = row.getAttribute('data-module');
        const cb  = sel => { const el = row.querySelector(sel); return el ? el.checked : false; };
        const def = m => MODULE_DEFS.find(d => d.key === key) || {};
        const isWorkflow = (MODULE_DEFS.find(d => d.key === key) || {}).hasWorkflow;
        perms[key] = {
            visible:      cb('.perm-visible'),
            canAdd:       cb('.perm-canadd'),
            canEdit:      cb('.perm-canedit'),
            canDelete:    cb('.perm-candelete'),
            canExport:    cb('.perm-canexport'),
            canUndo:      cb('.perm-canundo'),
            canWarehouse: cb('.perm-canwarehouse')
        };
    });
    // Dashboard always visible
    if (perms.dashboard) { perms.dashboard.visible = true; perms.dashboard.canAdd = false; perms.dashboard.canEdit = false; }
    // Patient notes: no canEdit (notes are immutable once written)
    if (perms.patient_notes) perms.patient_notes.canEdit = false;
    // RX Records: canAdd is shown as 'Complete' column in the workflow section
    // (already read from .perm-canadd — no extra action needed)
    return perms;
}

async function saveRole() {
    const name = document.getElementById('roleNameInput').value.trim();
    const errDiv = document.getElementById('roleNameError');

    if (!name && editingId === null) {
        errDiv.textContent = 'Role name is required.';
        errDiv.classList.remove('d-none');
        return;
    }
    errDiv.classList.add('d-none');

    const permissions = readPermEditor();
    const description = document.getElementById('roleDescInput').value.trim();
    const body = { permissions, description };
    if (name) body.name = name;

    const btn = document.getElementById('saveRoleBtn');
    const spinner = document.getElementById('saveRoleSpinner');
    btn.disabled = true;
    spinner.classList.remove('d-none');

    try {
        const url    = editingId ? `/api/roles/${editingId}` : '/api/roles';
        const method = editingId ? 'PUT' : 'POST';
        const res = await fetchWithAuth(url, { method, body: JSON.stringify(body) });
        const data = res ? await res.json() : null;
        if (res && res.ok) {
            showToast(data.message || 'Role saved.', 'success');
            bootstrap.Modal.getInstance(document.getElementById('roleModal')).hide();
            await loadRoles();
            await loadDefaults();
        } else {
            showToast(data?.error || 'Failed to save role.', 'danger');
        }
    } catch(e) { showToast('Network error.', 'danger'); }
    finally {
        btn.disabled = false;
        spinner.classList.add('d-none');
    }
}

async function duplicateRole(id, name) {
    const newName = prompt(`Enter a name for the copy of "${name}":`, name + ' (Copy)');
    if (!newName || !newName.trim()) return;
    const res = await fetchWithAuth(`/api/roles/${id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim() })
    });
    const data = res ? await res.json() : null;
    if (res && res.ok) {
        showToast(data.message || 'Role duplicated.', 'success');
        await loadRoles();
        await loadDefaults();
    } else {
        showToast(data?.error || 'Failed to duplicate role.', 'danger');
    }
}

function promptDelete(id, name) {
    deletingId = id;
    document.getElementById('deleteRoleBody').innerHTML =
        'Delete role <strong>' + name + '</strong>? This cannot be undone. Users with this role must be reassigned first.';
    new bootstrap.Modal(document.getElementById('deleteRoleModal')).show();
}

document.getElementById('confirmDeleteRoleBtn').onclick = async () => {
    const res = await fetchWithAuth(`/api/roles/${deletingId}`, { method: 'DELETE' });
    const data = res ? await res.json() : null;
    bootstrap.Modal.getInstance(document.getElementById('deleteRoleModal')).hide();
    if (res && res.ok) {
        showToast(data.message || 'Role deleted.', 'success');
        await loadRoles();
        await loadDefaults();
    } else {
        showToast(data?.error || 'Delete failed.', 'danger');
    }
};