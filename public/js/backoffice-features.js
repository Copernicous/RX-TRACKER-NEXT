/* FortiGate compat: use var instead of literal '' */
var _EMPTY_JOIN = '';

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM SETTINGS JS
// ══════════════════════════════════════════════════════════════════════════
let settingsLoaded = false;

async function loadSettings() {
    try {
        const res  = await apiFetch('/api/admin/settings');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        settingsLoaded = true;
        document.getElementById('sAppName').value        = data.appName || '';
        document.getElementById('sBackupPath').value     = data.backupPath || '';
        document.getElementById('sRetentionDays').value  = data.backupRetentionDays || 30;
        document.getElementById('sSessionTimeout').value = data.sessionTimeoutMinutes || 60;
        document.getElementById('sMaxLogin').value       = data.maxLoginAttempts || 5;
        const cb = document.getElementById('sMaintenanceMode');
        cb.checked = !!data.maintenanceMode;
        document.getElementById('sMaintenanceToggle').style.background = cb.checked ? '#6366f1' : '#334155';
        document.getElementById('sMaintenanceKnob').style.left = cb.checked ? '24px' : '4px';
        cb.addEventListener('change', () => {
            document.getElementById('sMaintenanceToggle').style.background = cb.checked ? '#6366f1' : '#334155';
            document.getElementById('sMaintenanceKnob').style.left = cb.checked ? '24px' : '4px';
        });
    } catch(e) { toast('Failed to load settings: ' + e.message, 'danger'); }
}

async function saveSettings(e) {
    e.preventDefault();
    try {
        const body = {
            appName:               document.getElementById('sAppName').value.trim(),
            backupPath:            document.getElementById('sBackupPath').value.trim(),
            backupRetentionDays:   parseInt(document.getElementById('sRetentionDays').value, 10),
            sessionTimeoutMinutes: parseInt(document.getElementById('sSessionTimeout').value, 10),
            maxLoginAttempts:      parseInt(document.getElementById('sMaxLogin').value, 10),
            maintenanceMode:       document.getElementById('sMaintenanceMode').checked,
        };
        const res  = await apiFetch('/api/admin/settings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        const msg = document.getElementById('settingsSavedMsg');
        msg.textContent = '\u2714 Settings saved'; msg.style.opacity = '1';
        setTimeout(() => msg.style.opacity = '0', 3000);
        toast('\u2713 Settings saved successfully', 'success');
        backupsLoaded = false;
    } catch(e) { toast('Save failed: ' + e.message, 'danger'); }
}

// ══════════════════════════════════════════════════════════════════════════
// BACKUP MANAGER JS
// ══════════════════════════════════════════════════════════════════════════
let backupsLoaded = false;

async function loadBackups() {
    backupsLoaded = false;
    document.getElementById('backupList').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        const res  = await apiFetch('/api/admin/backups');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        backupsLoaded = true;
        document.getElementById('backupPathText').textContent = data.backupPath || '\u2014';
        if (!data.backups.length) {
            document.getElementById('backupList').innerHTML = '<p style="text-align:center;padding:4rem;color:var(--text-muted)"><i class="fas fa-archive" style="display:block;font-size:2rem;opacity:.3;margin-bottom:1rem"></i>No backups yet. Click \u201cCreate Backup Now\u201d.</p>';
            return;
        }
        const fmtSz = b => b<1024 ? b+' B' : b<1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB';
        document.getElementById('backupList').innerHTML = data.backups.map(bk => `
            <div class="schema-card" style="margin-bottom:0.625rem">
                <div style="padding:0.75rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
                    <div style="display:flex;align-items:center;gap:0.75rem">
                        <i class="fas fa-archive" style="color:#6366f1;font-size:1.1rem"></i>
                        <div>
                            <div style="font-weight:600;font-size:0.85rem;font-family:monospace">${bk.name}</div>
                            <div style="font-size:0.7rem;color:var(--text-muted)">${new Date(bk.createdAt).toLocaleString()} &bull; ${bk.fileCount} tables &bull; ${fmtSz(bk.sizeBytes)}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
                        ${(bk.tables||[]).filter(t=>t.rows>0).map(t=>`<a href="/api/admin/backups/${bk.name}/${t.table}.csv" class="btn-bo btn-bo-outline" style="padding:0.25rem 0.5rem;font-size:0.68rem" download><i class="fas fa-download me-1"></i>${t.table}</a>`).join(_EMPTY_JOIN)}
                        <button class="btn-bo btn-bo-danger" style="padding:0.3rem 0.65rem;font-size:0.72rem" onclick="deleteBackup('${bk.name}',this)"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
            </div>`).join(_EMPTY_JOIN);
    } catch(e) { document.getElementById('backupList').innerHTML = `<p style="color:#fca5a5;padding:2rem">${e.message}</p>`; }
}

async function createBackup() {
    const btn = document.getElementById('createBackupBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Creating...';
    try {
        const res  = await apiFetch('/api/admin/backups', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        const rows = data.files.reduce((s,f)=>s+(f.rows||0),0);
        toast(`\u2713 Backup created: ${data.backupDir} (${rows.toLocaleString()} rows, ${data.files.length} tables)`, 'success');
        await loadBackups();
    } catch(e) { toast('Backup failed: '+e.message, 'danger'); }
    finally { btn.disabled=false; btn.innerHTML='<i class="fas fa-save me-1"></i>Create Backup Now'; }
}

async function deleteBackup(name, btn) {
    if (!confirm(`Permanently delete backup "${name}"?`)) return;
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    try {
        const res = await apiFetch('/api/admin/backups/'+name, {method:'DELETE'});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        toast('\u2713 Backup deleted','success'); await loadBackups();
    } catch(e) { toast('Delete failed: '+e.message,'danger'); btn.disabled=false; btn.innerHTML='<i class="fas fa-trash-alt"></i>'; }
}

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM HEALTH JS
// ══════════════════════════════════════════════════════════════════════════
let healthLoaded = false;

async function loadHealth() {
    healthLoaded = false;
    document.getElementById('healthCards').innerHTML = '';
    document.getElementById('healthTables').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        const res  = await apiFetch('/api/admin/health');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        healthLoaded = true;
        const fmtB  = b => !b?'0 B':b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(1)+' MB';
        const fmtUp = s => `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
        const n=data.node, d=data.db;
        const heapPct = Math.round((n.heapUsed/n.heapTotal)*100);
        const memPct  = Math.round(((n.totalMemBytes-n.freeMemBytes)/n.totalMemBytes)*100);
        const cards = [
            {icon:'fa-database', color:'#6366f1', label:'Database',    lines:[d?.name||'\u2014', d?.size||'\u2014', `${data.connections} active connections`]},
            {icon:'fa-server',   color:'#10b981', label:'Node.js',     lines:[n.version, `${n.platform} (${n.arch})`, `Uptime: ${fmtUp(n.uptime)}`]},
            {icon:'fa-memory',   color:'#f59e0b', label:'Heap Memory', lines:[`${fmtB(n.heapUsed)} used`, `${fmtB(n.heapTotal)} total`, `${heapPct}% heap used`]},
            {icon:'fa-microchip',color:'#06b6d4', label:'System RAM',  lines:[`${fmtB(n.totalMemBytes-n.freeMemBytes)} used`, `${fmtB(n.totalMemBytes)} total`, `${memPct}% utilization`]},
            {icon:'fa-hdd',      color:'#a78bfa', label:'Process RSS', lines:[fmtB(n.rss), `${n.cpus} CPU cores`, n.hostname]},
        ];
        document.getElementById('healthCards').innerHTML = cards.map(c=>`
            <div class="schema-card" style="padding:1rem">
                <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">
                    <div style="width:36px;height:36px;border-radius:8px;background:${c.color}22;display:flex;align-items:center;justify-content:center"><i class="fas ${c.icon}" style="color:${c.color}"></i></div>
                    <span style="font-weight:700;font-size:0.85rem">${c.label}</span>
                </div>
                ${c.lines.map(l=>`<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.25rem">${l}</div>`).join(_EMPTY_JOIN)}
            </div>`).join(_EMPTY_JOIN);

        const maxSz = Math.max(...data.tableStats.map(t=>parseInt(t.sizeBytes||0,10)),1);
        document.getElementById('healthTables').innerHTML = `
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:0.78rem">
                <thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">
                    ${['Table','Rows (~)','Size','Usage'].map(h=>`<th style="padding:0.5rem 1rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase">${h}</th>`).join(_EMPTY_JOIN)}
                </tr></thead>
                <tbody>${data.tableStats.map(t=>{
                    const pct=Math.round((parseInt(t.sizeBytes||0,10)/maxSz)*100);
                    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background=''">
                        <td style="padding:0.45rem 1rem;font-family:monospace;font-size:0.8rem">${t.table}</td>
                        <td style="padding:0.45rem 1rem;text-align:right;color:var(--text-muted)">${parseInt(t.rowEstimate||0).toLocaleString()}</td>
                        <td style="padding:0.45rem 1rem;text-align:right;color:#a5b4fc;white-space:nowrap">${t.totalSize||'\u2014'}</td>
                        <td style="padding:0.45rem 1rem;min-width:120px"><div style="background:rgba(99,102,241,0.15);border-radius:4px;height:6px;overflow:hidden"><div style="background:#6366f1;height:100%;width:${pct}%;border-radius:4px"></div></div></td>
                    </tr>`;}).join(_EMPTY_JOIN)}</tbody>
            </table></div>`;
    } catch(e) { document.getElementById('healthTables').innerHTML=`<p style="color:#fca5a5;padding:2rem">${e.message}</p>`; }
}

// ══════════════════════════════════════════════════════════════════════════
// LOCK MANAGER JS
// ══════════════════════════════════════════════════════════════════════════
let locksLoaded = false;

async function loadLocks() {
    locksLoaded = false;
    document.getElementById('locksList').innerHTML='<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        const res  = await apiFetch('/api/admin/locks');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        locksLoaded = true;
        document.getElementById('locksStatus').innerHTML = `<div style="display:flex;gap:0.75rem;flex-wrap:wrap">
            <span style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);color:#6ee7b7;border-radius:6px;padding:0.35rem 0.75rem;font-size:0.78rem;font-weight:600">\uD83D\uDD12 ${data.active} Active</span>
            <span style="background:rgba(100,116,139,0.1);border:1px solid rgba(100,116,139,0.25);color:#94a3b8;border-radius:6px;padding:0.35rem 0.75rem;font-size:0.78rem;font-weight:600">\u23F0 ${data.expired} Expired</span>
        </div>`;
        if (!data.locks.length) {
            document.getElementById('locksList').innerHTML='<p style="text-align:center;padding:4rem;color:var(--text-muted)"><i class="fas fa-unlock" style="display:block;font-size:2rem;opacity:.3;margin-bottom:1rem"></i>No locks. All records are free.</p>';
            return;
        }
        document.getElementById('locksList').innerHTML = `
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:0.78rem">
                <thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">
                    ${['Status','Patient','Locked By','Locked At','Expires','Action'].map(h=>`<th style="padding:0.5rem 1rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase">${h}</th>`).join(_EMPTY_JOIN)}
                </tr></thead>
                <tbody>${data.locks.map(l=>{
                    const c=l.isActive?'#10b981':'#64748b';
                    const sl=l.isActive?`(${Math.floor(l.secsRemaining/60)}m ${l.secsRemaining%60}s left)`:'';
                    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background=''">
                        <td style="padding:0.45rem 1rem"><span style="font-size:0.65rem;font-weight:700;border-radius:4px;padding:0.15rem 0.45rem;background:${c}22;color:${c};border:1px solid ${c}44">${l.isActive?'Active':'Expired'}</span></td>
                        <td style="padding:0.45rem 1rem">${l.patientName||'#'+l.patientId}</td>
                        <td style="padding:0.45rem 1rem;color:var(--text-muted)">${l.userName||''} <span style="font-size:0.68rem">(${l.username||''})</span></td>
                        <td style="padding:0.45rem 1rem;color:var(--text-muted);font-size:0.72rem;white-space:nowrap">${new Date(l.lockedAt).toLocaleString()}</td>
                        <td style="padding:0.45rem 1rem;color:var(--text-muted);font-size:0.72rem;white-space:nowrap">${new Date(l.expiresAt).toLocaleString()} ${sl}</td>
                        <td style="padding:0.45rem 1rem"><button class="btn-bo btn-bo-danger" style="padding:0.25rem 0.6rem;font-size:0.7rem" onclick="releaseLock(${l.id},this)"><i class="fas fa-times me-1"></i>Release</button></td>
                    </tr>`;}).join(_EMPTY_JOIN)}</tbody>
            </table></div>`;
    } catch(e) { document.getElementById('locksList').innerHTML=`<p style="color:#fca5a5;padding:2rem">${e.message}</p>`; }
}

async function releaseLock(id, btn) {
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    try {
        const res=await apiFetch('/api/admin/locks/'+id,{method:'DELETE'});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        toast('\u2713 Lock released','success'); await loadLocks();
    } catch(e) { toast('Failed: '+e.message,'danger'); btn.disabled=false; btn.innerHTML='<i class="fas fa-times me-1"></i>Release'; }
}

async function releaseExpiredLocks() {
    try {
        const res=await apiFetch('/api/admin/locks',{method:'DELETE'});
        const data=await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        toast(`\u2713 Released ${data.released} expired lock(s)`,'success'); await loadLocks();
    } catch(e) { toast('Failed: '+e.message,'danger'); }
}

// ══════════════════════════════════════════════════════════════════════════
// USER MANAGER JS
// ══════════════════════════════════════════════════════════════════════════
let usersLoaded = false;
const ROLE_NAMES  = {1:'Administrator',2:'Supervisor',3:'Operator',4:'Read Only'};
const ROLE_COLORS = {1:'#ef4444',2:'#f59e0b',3:'#6366f1',4:'#64748b'};
let pwdResetUserId = null;

async function loadUsers() {
    usersLoaded = false;
    document.getElementById('usersList').innerHTML='<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        const res  = await apiFetch('/api/admin/users');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        usersLoaded = true;
        document.getElementById('usersList').innerHTML = `
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:0.78rem">
                <thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">
                    ${['User','Role','Status','Activity','Actions'].map(h=>`<th style="padding:0.5rem 1rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase">${h}</th>`).join(_EMPTY_JOIN)}
                </tr></thead>
                <tbody>${data.users.map(u=>{
                    const rc=ROLE_COLORS[u.roleId]||'#64748b', ac=u.isActive?'#10b981':'#ef4444';
                    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background=''">
                        <td style="padding:0.55rem 1rem"><div style="font-weight:600">${u.firstName||''} ${u.lastName||''}</div><div style="font-size:0.7rem;color:var(--text-muted)">@${u.username} &bull; ${u.email||'\u2014'}</div></td>
                        <td style="padding:0.55rem 1rem">
                            <select style="background:${rc}22;color:${rc};border:1px solid ${rc}44;border-radius:4px;padding:0.2rem 0.4rem;font-size:0.7rem;font-weight:700;cursor:pointer" onchange="updateUserRole(${u.id},this.value,this)">
                                ${[1,2,3,4].map(r=>`<option value="${r}" ${r==u.roleId?'selected':''}>${ROLE_NAMES[r]}</option>`).join(_EMPTY_JOIN)}
                            </select>
                        </td>
                        <td style="padding:0.55rem 1rem"><span style="font-size:0.65rem;font-weight:700;border-radius:4px;padding:0.15rem 0.45rem;background:${ac}22;color:${ac};border:1px solid ${ac}44">${u.isActive?'Active':'Disabled'}</span></td>
                        <td style="padding:0.55rem 1rem;color:var(--text-muted);font-size:0.72rem">${u.activityCount||0} events<br><span style="font-size:0.68rem">${u.lastActivity?new Date(u.lastActivity).toLocaleDateString():'Never'}</span></td>
                        <td style="padding:0.55rem 1rem">
                            <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
                                <button class="btn-bo" style="padding:0.25rem 0.5rem;font-size:0.68rem;background:${u.isActive?'rgba(239,68,68,0.12)':'rgba(16,185,129,0.12)'};color:${u.isActive?'#fca5a5':'#6ee7b7'};border:1px solid ${u.isActive?'rgba(239,68,68,0.3)':'rgba(16,185,129,0.3)'}" onclick="toggleUserActive(${u.id},${!u.isActive},this)">
                                    ${u.isActive?'<i class="fas fa-ban me-1"></i>Disable':'<i class="fas fa-check me-1"></i>Enable'}
                                </button>
                                <button class="btn-bo btn-bo-outline" style="padding:0.25rem 0.5rem;font-size:0.68rem" onclick="openResetPwd(${u.id},'${(u.firstName||'')+' '+(u.lastName||'')}')">
                                    <i class="fas fa-key me-1"></i>Reset PWD
                                </button>
                            </div>
                        </td>
                    </tr>`;}).join(_EMPTY_JOIN)}</tbody>
            </table></div>
            <div id="pwdModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center">
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.5rem;width:340px;max-width:95vw">
                    <div style="font-weight:700;margin-bottom:0.5rem">Reset Password</div>
                    <div id="pwdModalName" style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1rem"></div>
                    <input type="password" id="pwdModalInput" class="schema-search" style="margin:0 0 0.75rem" placeholder="New password (min 8 chars)">
                    <div style="display:flex;gap:0.5rem;justify-content:flex-end">
                        <button class="btn-bo btn-bo-outline" onclick="closePwdModal()">Cancel</button>
                        <button class="btn-bo btn-bo-primary" onclick="submitResetPwd()"><i class="fas fa-key me-1"></i>Reset</button>
                    </div>
                </div>
            </div>`;
    } catch(e) { document.getElementById('usersList').innerHTML=`<p style="color:#fca5a5;padding:2rem">${e.message}</p>`; }
}

function openResetPwd(id,name) {
    pwdResetUserId=id;
    const m=document.getElementById('pwdModal'); m.style.display='flex';
    document.getElementById('pwdModalName').textContent=name;
    document.getElementById('pwdModalInput').value='';
    setTimeout(()=>document.getElementById('pwdModalInput').focus(),80);
}
function closePwdModal() { document.getElementById('pwdModal').style.display='none'; }

async function submitResetPwd() {
    const pwd=document.getElementById('pwdModalInput').value;
    if (!pwd||pwd.length<8) { toast('Password must be at least 8 characters.','danger'); return; }
    try {
        const res=await apiFetch(`/api/admin/users/${pwdResetUserId}/reset-password`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newPassword:pwd})});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        toast('\u2713 Password reset successfully','success'); closePwdModal();
    } catch(e) { toast('Reset failed: '+e.message,'danger'); }
}

async function updateUserRole(id,roleId,sel) {
    sel.disabled=true;
    try {
        const res=await apiFetch(`/api/admin/users/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({roleId:parseInt(roleId,10)})});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        const rc=ROLE_COLORS[roleId]||'#64748b';
        sel.style.background=`${rc}22`; sel.style.color=rc; sel.style.borderColor=`${rc}44`;
        toast('\u2713 Role updated','success');
    } catch(e) { toast('Role update failed: '+e.message,'danger'); }
    finally { sel.disabled=false; }
}

async function toggleUserActive(id,newState,btn) {
    btn.disabled=true;
    try {
        const res=await apiFetch(`/api/admin/users/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isActive:newState})});
        if (!res.ok) throw new Error((await res.json()).error||'Failed');
        toast(`\u2713 User ${newState?'enabled':'disabled'}`,'success');
        usersLoaded=false; await loadUsers();
    } catch(e) { toast('Update failed: '+e.message,'danger'); btn.disabled=false; }
}

// --------------------------------------------------------------------------
// ERROR LOG MANAGER JS
// --------------------------------------------------------------------------
let errlogLoaded  = false;
let errlogPage    = 1;
let errlogTotal   = 0;
let errlogPageSz  = 50;
let errDebTimer   = null;
let errSelIds     = new Set();

const SEV_COLORS = { error:'#ef4444', warning:'#f59e0b', info:'#6366f1' };
const SEV_ICONS  = { error:'fa-times-circle', warning:'fa-exclamation-triangle', info:'fa-info-circle' };

function errDebounce() {
    clearTimeout(errDebTimer);
    errDebTimer = setTimeout(() => loadErrorLogs(1), 400);
}

function clearErrFilters() {
    ['errSearch','errDateFrom','errDateTo'].forEach(id => document.getElementById(id).value = '');
    ['errSeverity','errSource','errResolved'].forEach(id => document.getElementById(id).selectedIndex = 0);
    loadErrorLogs(1);
}

async function loadErrorLogs(page) {
    errlogLoaded = false; errlogPage = page;
    document.getElementById('errlogTable').innerHTML = '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    const params = new URLSearchParams({
        page,
        size:     errlogPageSz,
        search:   document.getElementById('errSearch')?.value   || '',
        severity: document.getElementById('errSeverity')?.value || '',
        source:   document.getElementById('errSource')?.value   || '',
        resolved: document.getElementById('errResolved')?.value ?? '',
        dateFrom: document.getElementById('errDateFrom')?.value || '',
        dateTo:   document.getElementById('errDateTo')?.value   || '',
    });
    try {
        const res  = await apiFetch('/api/admin/error-logs?' + params.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        errlogLoaded = true; errlogTotal = data.total;

        // Stat cards
        const s = data.stats;
        const statCards = [
            { label:'Errors',    val: s?.errors   || 0, color:'#ef4444', icon:'fa-times-circle' },
            { label:'Warnings',  val: s?.warnings  || 0, color:'#f59e0b', icon:'fa-exclamation-triangle' },
            { label:'Info',      val: s?.infos     || 0, color:'#6366f1', icon:'fa-info-circle' },
            { label:'Unresolved',val: s?.unresolved|| 0, color:'#e11d48', icon:'fa-bell' },
            { label:'Resolved',  val: s?.resolved  || 0, color:'#10b981', icon:'fa-check-circle' },
            { label:'Frontend',  val: s?.frontend  || 0, color:'#06b6d4', icon:'fa-desktop' },
            { label:'Backend',   val: s?.backend   || 0, color:'#8b5cf6', icon:'fa-server' },
        ];
        document.getElementById('errlogStats').innerHTML = statCards.map(c => `
            <div class="schema-card" style="padding:0.65rem 0.875rem;display:flex;align-items:center;gap:0.5rem">
                <div style="width:28px;height:28px;border-radius:6px;background:${c.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <i class="fas ${c.icon}" style="color:${c.color};font-size:0.75rem"></i>
                </div>
                <div><div style="font-weight:700;font-size:1rem;line-height:1">${parseInt(c.val).toLocaleString()}</div><div style="font-size:0.65rem;color:var(--text-muted)">${c.label}</div></div>
            </div>`).join(_EMPTY_JOIN);

        if (!data.rows.length) {
            document.getElementById('errlogTable').innerHTML = '<p style="text-align:center;padding:4rem;color:var(--text-muted)"><i class="fas fa-bug" style="display:block;font-size:2rem;opacity:.3;margin-bottom:1rem"></i>No error logs match your filters.</p>';
            document.getElementById('errlogPagination').innerHTML = '';
            return;
        }

        // Table
        document.getElementById('errlogTable').innerHTML = `
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:0.76rem">
                <thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">
                    <th style="padding:0.4rem 0.625rem;width:32px"><input type="checkbox" id="errPageChk" onchange="toggleSelectAllErrors(this.checked)"></th>
                    <th style="padding:0.4rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.65rem;text-transform:uppercase">Severity</th>
                    <th style="padding:0.4rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.65rem;text-transform:uppercase">Source</th>
                    <th style="padding:0.4rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.65rem;text-transform:uppercase">Message</th>
                    <th style="padding:0.4rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.65rem;text-transform:uppercase">URL</th>
                    <th style="padding:0.4rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.65rem;text-transform:uppercase">User</th>
                    <th style="padding:0.4rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.65rem;text-transform:uppercase">Time</th>
                    <th style="padding:0.4rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.65rem;text-transform:uppercase">Status</th>
                    <th style="padding:0.4rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.65rem;text-transform:uppercase">Detail</th>
                </tr></thead>
                <tbody>${data.rows.map(r => {
                    const sev = r.severity || 'error';
                    const sc  = SEV_COLORS[sev] || '#6366f1';
                    const si  = SEV_ICONS[sev]  || 'fa-circle';
                    const resC = r.resolved ? '#10b981' : '#64748b';
                    return `<tr id="erow-${r.id}" style="border-bottom:1px solid rgba(255,255,255,0.04)" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background=''">
                        <td style="padding:0.4rem 0.625rem"><input type="checkbox" class="err-chk" value="${r.id}" onchange="onErrCheck(${r.id},this.checked)"></td>
                        <td style="padding:0.4rem 0.75rem">
                            <span style="font-size:0.63rem;font-weight:700;border-radius:4px;padding:0.12rem 0.4rem;background:${sc}22;color:${sc};border:1px solid ${sc}44;white-space:nowrap">
                                <i class="fas ${si} me-1"></i>${sev}
                            </span>
                        </td>
                        <td style="padding:0.4rem 0.75rem;color:var(--text-muted);font-size:0.7rem">${r.source||'\u2014'}</td>
                        <td style="padding:0.4rem 0.75rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${String(r.message||'').replace(/"/g,'&quot;')}">${r.message||'\u2014'}</td>
                        <td style="padding:0.4rem 0.75rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:0.68rem" title="${(r.url||'').replace(/"/g,'&quot;')}">${r.url||'\u2014'}</td>
                        <td style="padding:0.4rem 0.75rem;white-space:nowrap;font-size:0.7rem">${r.username||'<span style="color:var(--text-muted)">System</span>'}</td>
                        <td style="padding:0.4rem 0.75rem;color:var(--text-muted);white-space:nowrap;font-size:0.7rem">${new Date(r.createdAt).toLocaleString()}</td>
                        <td style="padding:0.4rem 0.75rem">
                            <span style="font-size:0.63rem;font-weight:700;border-radius:4px;padding:0.12rem 0.4rem;background:${resC}22;color:${resC};border:1px solid ${resC}44">${r.resolved?'Resolved':'Open'}</span>
                        </td>
                        <td style="padding:0.4rem 0.75rem">
                            <button class="btn-bo btn-bo-outline" style="padding:0.18rem 0.4rem;font-size:0.65rem" onclick="showErrDetail(${r.id})"><i class="fas fa-eye"></i></button>
                        </td>
                    </tr>
                    ${r.stack ? `<tr id="edetail-${r.id}" style="display:none;background:rgba(0,0,0,0.3)"><td colspan="9" style="padding:0.5rem 1rem"><pre style="font-size:0.65rem;color:#fca5a5;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;margin:0">${String(r.stack||'').replace(/</g,'&lt;')}</pre></td></tr>` : ''}`;
                }).join(_EMPTY_JOIN)}</tbody>
            </table></div>`;

        // Pagination
        const pages = data.pages || 1;
        let pg = '';
        for (let i = 1; i <= pages; i++) {
            const active = i === page;
            pg += `<button class="btn-bo ${active?'btn-bo-primary':'btn-bo-outline'}" style="padding:0.25rem 0.6rem;font-size:0.72rem;min-width:32px" onclick="loadErrorLogs(${i})">${i}</button>`;
        }
        document.getElementById('errlogPagination').innerHTML = pg;
        updateErrSelCount();
    } catch(e) { document.getElementById('errlogTable').innerHTML = `<p style="color:#fca5a5;padding:2rem">${e.message}</p>`; }
}

function showErrDetail(id) {
    const row = document.getElementById(`edetail-${id}`);
    if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

function onErrCheck(id, checked) {
    checked ? errSelIds.add(id) : errSelIds.delete(id);
    updateErrSelCount();
}

function toggleSelectAllErrors(checked) {
    document.querySelectorAll('.err-chk').forEach(chk => {
        chk.checked = checked;
        onErrCheck(parseInt(chk.value, 10), checked);
    });
}

function updateErrSelCount() {
    const el = document.getElementById('errSelCount');
    if (el) el.textContent = errSelIds.size ? `${errSelIds.size} selected` : '';
}

async function resolveSelectedErrors() {
    if (!errSelIds.size) { toast('Select at least one error first.','danger'); return; }
    try {
        const res = await apiFetch('/api/admin/error-logs/resolve', {
            method:'PATCH', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ ids: [...errSelIds] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        toast(`\u2713 ${errSelIds.size} error(s) marked resolved`, 'success');
        errSelIds.clear(); errlogLoaded = false; await loadErrorLogs(errlogPage);
    } catch(e) { toast('Failed: '+e.message,'danger'); }
}

// -- Purge Modal ------------------------------------------------
function openPurgeModal() {
    document.getElementById('purgeModal').style.display = 'flex';
    document.querySelectorAll('input[name="purgeMode"]').forEach(r => r.checked = false);
    ['purgeAgeOpts','purgeFilterOpts','purgeConfirmAll'].forEach(id => document.getElementById(id).style.display='none');
}
function closePurgeModal() { document.getElementById('purgeModal').style.display='none'; }

function onPurgeModeChange() {
    const mode = document.querySelector('input[name="purgeMode"]:checked')?.value;
    document.getElementById('purgeAgeOpts').style.display    = mode==='age'    ? '' : 'none';
    document.getElementById('purgeFilterOpts').style.display = mode==='filter' ? '' : 'none';
    document.getElementById('purgeConfirmAll').style.display = mode==='all'    ? '' : 'none';
    // Highlight selected
    ['pmOpt1','pmOpt2','pmOpt3','pmOpt4'].forEach(id => {
        document.getElementById(id).style.borderColor = 'var(--border)';
        document.getElementById(id).style.background  = '';
    });
    const map = {age:'pmOpt1',filter:'pmOpt2',resolved:'pmOpt3',all:'pmOpt4'};
    if (map[mode]) {
        document.getElementById(map[mode]).style.borderColor = '#6366f1';
        document.getElementById(map[mode]).style.background  = 'rgba(99,102,241,0.06)';
    }
}

async function doPurge() {
    const mode = document.querySelector('input[name="purgeMode"]:checked')?.value;
    if (!mode) { toast('Select a purge mode.','danger'); return; }
    if (mode === 'all') {
        if (document.getElementById('purgeConfirmInput').value.trim() !== 'CONFIRM') {
            toast('Type CONFIRM to purge all error logs.','danger'); return;
        }
    }

    let body = {};
    if (mode === 'age') {
        body = {
            mode: 'age',
            olderThanDays: parseInt(document.getElementById('purgeAgeDays').value,10)||30,
            severity:      document.getElementById('purgeAgeSev').value,
            source:        document.getElementById('purgeAgeSrc').value,
            resolvedOnly:  document.getElementById('purgeAgeResOnly').checked,
        };
    } else if (mode === 'filter') {
        body = {
            mode: 'filter',
            severity:     document.getElementById('purgeFilterSev').value,
            source:       document.getElementById('purgeFilterSrc').value,
            resolvedOnly: document.getElementById('purgeFilterResOnly').checked,
        };
    } else if (mode === 'resolved') {
        body = { mode: 'filter', resolvedOnly: true };
    } else {
        body = { mode: 'all' };
    }

    const btn = document.getElementById('doPurgeBtn');
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin me-1"></i>Purging...';
    try {
        const res  = await apiFetch('/api/admin/error-logs', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        toast(`\u2713 Purged ${data.deleted} error log(s)`, 'success');
        closePurgeModal();
        errlogLoaded = false; await loadErrorLogs(1);
    } catch(e) { toast('Purge failed: '+e.message,'danger'); }
    finally { btn.disabled=false; btn.innerHTML='<i class="fas fa-fire me-1"></i>Purge'; }
}

// --------------------------------------------------------------------------
// ANALYTICS � DAILY SNAPSHOTS
// --------------------------------------------------------------------------
let analyticsLoaded = false;
let anlCharts       = {};   // stores Chart instances so we can destroy/redraw

// Chart.js global defaults for dark theme
function anlChartDefaults() {
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';
    Chart.defaults.font.family = 'Inter, sans-serif';
    Chart.defaults.font.size   = 11;
}

async function loadAnalytics() {
    analyticsLoaded = false;
    const from = document.getElementById('anlFrom')?.value || '';
    const to   = document.getElementById('anlTo')?.value   || '';
    const params = new URLSearchParams({ limit: 365 });
    if (from) params.set('from', from);
    if (to)   params.set('to',   to);

    document.getElementById('anlTableWrap').innerHTML =
        '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading snapshots...</p>';

    try {
        const res  = await apiFetch('/api/admin/snapshots?' + params.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        analyticsLoaded = true;

        const rows   = data.rows   || [];
        const latest = data.latest || null;
        const prev   = data.prev   || null;

        // --- KPI Cards ------------------------------------------------
        const delta = (key) => {
            if (!latest || !prev) return '';
            const d = (latest[key] || 0) - (prev[key] || 0);
            if (d === 0) return '<span style="color:#64748b;font-size:.65rem"> -</span>';
            const c = d > 0 ? '#10b981' : '#ef4444';
            const arrow = d > 0 ? '?' : '?';
            return `<span style="color:${c};font-size:.65rem"> ${arrow}${Math.abs(d)}</span>`;
        };
        const pctDelta = (key) => {
            if (!latest || !prev) return '';
            const d = ((latest[key] || 0) - (prev[key] || 0)).toFixed(1);
            if (d == 0) return '';
            const c = d > 0 ? '#10b981' : '#ef4444';
            return `<span style="color:${c};font-size:.65rem"> ${d > 0 ? '?' : '?'}${Math.abs(d)}%</span>`;
        };

        const kpis = latest ? [
            { label:'Total Patients',   val: latest.totalPatients,          delta: delta('totalPatients'),          color:'#6366f1', icon:'fa-users' },
            { label:'Active Patients',  val: latest.activePatients,         delta: delta('activePatients'),         color:'#10b981', icon:'fa-user-check' },
            { label:'New Today',        val: latest.newPatientsToday,       delta: delta('newPatientsToday'),       color:'#06b6d4', icon:'fa-user-plus' },
            { label:'Total RX',         val: latest.totalRX,                delta: delta('totalRX'),                color:'#f59e0b', icon:'fa-prescription-bottle-alt' },
            { label:'Pending RX',       val: latest.pendingRX,              delta: delta('pendingRX'),              color:'#e11d48', icon:'fa-clock' },
            { label:'Completed RX',     val: latest.completedRX,            delta: delta('completedRX'),            color:'#10b981', icon:'fa-check-circle' },
            { label:'Workflow Rate',    val: (latest.workflowCompletionRate||0).toFixed(1)+'%', delta: pctDelta('workflowCompletionRate'), color:'#8b5cf6', icon:'fa-tasks' },
            { label:'Error Logs Today', val: latest.errorLogsToday,         delta: delta('errorLogsToday'),         color:'#ef4444', icon:'fa-bug' },
            { label:'Audit Events',     val: latest.auditEventsToday,       delta: delta('auditEventsToday'),       color:'#64748b', icon:'fa-clipboard-list' },
        ] : [];

        document.getElementById('anlKpiCards').innerHTML = kpis.length
            ? kpis.map(k => `
                <div class="schema-card" style="padding:0.75rem 0.875rem">
                    <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem">
                        <div style="width:24px;height:24px;border-radius:5px;background:${k.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <i class="fas ${k.icon}" style="color:${k.color};font-size:0.65rem"></i>
                        </div>
                        <div style="font-size:0.65rem;color:var(--text-muted)">${k.label}</div>
                    </div>
                    <div style="font-size:1.25rem;font-weight:700;line-height:1">${k.val}${k.delta}</div>
                    ${prev ? '<div style="font-size:0.6rem;color:var(--text-muted)">vs yesterday</div>' : ''}
                </div>`).join(_EMPTY_JOIN)
            : '<p style="color:var(--text-muted);padding:1rem">No snapshot data yet. Click <strong>Capture Now</strong> to record today\'s metrics.</p>';

        if (!rows.length) {
            // Clear any existing charts
            Object.values(anlCharts).forEach(c => c.destroy());
            anlCharts = {};
            document.getElementById('anlTableWrap').innerHTML =
                '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-chart-bar" style="display:block;font-size:2rem;opacity:.3;margin-bottom:1rem"></i>No snapshots in this date range.</p>';
            return;
        }

        const labels = rows.map(r => r.snapshotDate);
        anlChartDefaults();

        // --- Chart 1: Patients ----------------------------------------
        anlMakeChart('chartPatients', {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label:'Active',   data: rows.map(r=>r.activePatients),   borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.08)',  tension:.4, fill:true, pointRadius:3 },
                    { label:'Inactive', data: rows.map(r=>r.inactivePatients), borderColor:'#64748b', backgroundColor:'rgba(100,116,139,.05)', tension:.4, fill:false, pointRadius:2 },
                    { label:'New/Day',  data: rows.map(r=>r.newPatientsToday), borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.08)',  tension:.4, fill:false, pointRadius:3, borderDash:[4,3] },
                ]
            },
            options: anlLineOpts('Patients'),
        });

        // --- Chart 2: RX Activity -------------------------------------
        anlMakeChart('chartRX', {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label:'New RX/Day', data: rows.map(r=>r.newRXToday),   borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,.08)', tension:.4, fill:true,  pointRadius:3 },
                    { label:'Pending',    data: rows.map(r=>r.pendingRX),     borderColor:'#e11d48', backgroundColor:'rgba(225,29,72,.06)',  tension:.4, fill:false, pointRadius:2 },
                    { label:'Completed',  data: rows.map(r=>r.completedRX),   borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.06)', tension:.4, fill:false, pointRadius:2 },
                    { label:'Returned',   data: rows.map(r=>r.returnedToWarehouseRX), borderColor:'#8b5cf6', backgroundColor:'transparent', tension:.4, fill:false, pointRadius:2, borderDash:[3,3] },
                ]
            },
            options: anlLineOpts('RX Records'),
        });

        // --- Chart 3: Workflow Rate -----------------------------------
        anlMakeChart('chartWorkflow', {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label:'Completion %', data: rows.map(r=>r.workflowCompletionRate), borderColor:'#8b5cf6', backgroundColor:'rgba(139,92,246,.12)', tension:.4, fill:true, pointRadius:3 },
                ]
            },
            options: { ...anlLineOpts('Workflow %'), scales: { ...anlLineOpts('Workflow %').scales, y: { ...anlLineOpts('Workflow %').scales?.y, min:0, max:100, ticks:{ callback: v=>v+'%', color:'#64748b' }, grid:{ color:'rgba(255,255,255,0.05)' } } } },
        });

        // --- Chart 4: Errors & Audit ----------------------------------
        anlMakeChart('chartActivity', {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label:'Errors',       data: rows.map(r=>r.errorLogsToday),   backgroundColor:'rgba(239,68,68,.6)',  borderRadius:3 },
                    { label:'Audit Events', data: rows.map(r=>r.auditEventsToday), backgroundColor:'rgba(100,116,139,.4)',borderRadius:3 },
                ]
            },
            options: { ...anlLineOpts('Events/Day'), plugins: { ...anlLineOpts('Events/Day').plugins, legend:{ display:true, labels:{ color:'#64748b', boxWidth:10, font:{size:10} } } } },
        });

        // --- Raw Data Table -------------------------------------------
        const COLS = [
            ['snapshotDate','Date'],['totalPatients','Patients'],['activePatients','Active'],
            ['newPatientsToday','New Pts'],['totalRX','Total RX'],['newRXToday','New RX'],
            ['pendingRX','Pending'],['completedRX','Done'],['workflowCompletionRate','WF %'],
            ['auditEventsToday','Audit'],['errorLogsToday','Errors'],['unresolvedErrors','Open Errs'],
        ];
        const allRows = [...rows].reverse(); // newest first in table
        document.getElementById('anlTableWrap').innerHTML = `
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.72rem;white-space:nowrap">
                <thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">
                    ${COLS.map(([,h])=>`<th style="padding:.4rem .75rem;color:var(--text-muted);font-size:.63rem;text-transform:uppercase;text-align:right;font-weight:600">${h}</th>`).join(_EMPTY_JOIN)}
                    <th style="padding:.4rem .75rem;color:var(--text-muted);font-size:.63rem;text-transform:uppercase"></th>
                </tr></thead>
                <tbody>${allRows.map(r => `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.03)" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background=''">
                        ${COLS.map(([k])=>{
                            const v = r[k];
                            const isDate = k==='snapshotDate';
                            const isRate = k==='workflowCompletionRate';
                            const disp   = isRate ? (parseFloat(v)||0).toFixed(1)+'%' : (v ?? '�');
                            return `<td style="padding:.35rem .75rem;text-align:${isDate?'left':'right'};${isDate?'font-weight:600':'color:var(--text-muted)'}">${disp}</td>`;
                        }).join(_EMPTY_JOIN)}
                        <td style="padding:.35rem .625rem;text-align:center">
                            <button class="btn-bo btn-bo-danger" style="padding:.15rem .4rem;font-size:.62rem" onclick="deleteSnapshot('${r.snapshotDate}')"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>`).join(_EMPTY_JOIN)}
                </tbody>
            </table></div>
            <div style="font-size:0.68rem;color:var(--text-muted);margin-top:.5rem;text-align:right">${rows.length} snapshot(s) in range</div>`;

    } catch(e) {
        document.getElementById('anlTableWrap').innerHTML = `<p style="color:#fca5a5;padding:2rem">${e.message}</p>`;
    }
}

function anlMakeChart(id, config) {
    if (anlCharts[id]) { anlCharts[id].destroy(); delete anlCharts[id]; }
    const ctx = document.getElementById(id);
    if (!ctx) return;
    anlCharts[id] = new Chart(ctx, config);
}

function anlLineOpts(label) {
    return {
        responsive: true,
        animation: { duration: 500 },
        interaction: { mode:'index', intersect:false },
        plugins: {
            legend: { display: true, labels: { color:'#64748b', boxWidth:10, font:{size:10} } },
            tooltip: { backgroundColor:'rgba(15,23,42,.95)', titleColor:'#e2e8f0', bodyColor:'#94a3b8', borderColor:'rgba(255,255,255,0.1)', borderWidth:1 },
        },
        scales: {
            x: { ticks:{ color:'#64748b', maxTicksLimit:10 }, grid:{ color:'rgba(255,255,255,0.05)' } },
            y: { ticks:{ color:'#64748b' }, grid:{ color:'rgba(255,255,255,0.05)' }, beginAtZero:true },
        }
    };
}

async function captureNowSnapshot() {
    try {
        const res  = await apiFetch('/api/admin/snapshots/capture', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error||'Failed');
        toast(`? Snapshot captured for ${data.snapshot?.snapshotDate || 'today'}`, 'success');
        analyticsLoaded = false;
        await loadAnalytics();
    } catch(e) { toast('Capture failed: '+e.message, 'danger'); }
}

async function deleteSnapshot(date) {
    if (!confirm(`Delete snapshot for ${date}?`)) return;
    try {
        const res = await apiFetch(`/api/admin/snapshots/${date}`, { method:'DELETE' });
        if (!res.ok) { const d=await res.json(); throw new Error(d.error||'Failed'); }
        toast(`? Snapshot ${date} deleted`, 'success');
        analyticsLoaded = false;
        await loadAnalytics();
    } catch(e) { toast('Delete failed: '+e.message, 'danger'); }
}

function exportAnalyticsCSV() {
    const from = document.getElementById('anlFrom')?.value || '';
    const to   = document.getElementById('anlTo')?.value   || '';
    const token = localStorage.getItem('token') || '';
    let url = '/api/admin/snapshots/export';
    const p = [];
    if (from) p.push('from='+encodeURIComponent(from));
    if (to)   p.push('to='+encodeURIComponent(to));
    if (p.length) url += '?' + p.join('&');
    // Open in same tab � browser will trigger download due to Content-Disposition header
    // We need auth, so fetch and create blob
    apiFetch(url).then(async r => {
        if (!r.ok) { const d=await r.json(); toast('Export failed: '+(d.error||r.status),'danger'); return; }
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `daily-snapshots-${from||'all'}-to-${to||'today'}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }).catch(e => toast('Export error: '+e.message,'danger'));
}
