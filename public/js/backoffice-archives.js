'use strict';
document.addEventListener('DOMContentLoaded', () => {
    if (!window.BACKOFFICE_USER?.isMaster) return;
    if (new URLSearchParams(window.location.search).get('tab') === 'backups') switchTab('backups');
    window.addEventListener('historyarchived', () => {
        loadStats(); loadAuditLogs(1); errSelIds.clear(); loadErrorLogs(1);
        backupsLoaded = false; loadBackups(); loadDeliveryLogArchiveManager();
    });
    const panel = document.getElementById('historyArchivePanel');
    panel.style.padding = '1rem'; panel.style.border = '1px solid var(--border)'; panel.style.borderRadius = '10px';
    const notice = document.createElement('p'); notice.className = 'small';
    notice.textContent = 'File retention compresses older delivery logs and CSV snapshot files. Downloads and printing read the verified original content. Copies stay here until explicitly deleted; include these folders and checksum receipts in protected backups.';
    document.getElementById('backupsContent').prepend(notice);
});
