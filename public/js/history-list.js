/* Shared controls for archived delivery logs and patient import history. */
(function () {
    'use strict';
    function dateText(date) {
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }
    function dateBoundary(text, nextDay) {
        if (!text) return '';
        const parts = text.split('-').map(Number);
        const date = new Date(parts[0], parts[1] - 1, parts[2]);
        if (dateText(date) !== text) throw new Error('Enter valid From and To dates.');
        // Calendar arithmetic preserves the full local day across DST transitions.
        if (nextDay) date.setDate(date.getDate() + 1);
        return date.toISOString();
    }
    function presetDates(preset, now) {
        const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
        switch (preset) {
        case 'week': return [new Date(y, m, d - (now.getDay() + 6) % 7), new Date(y, m, d - (now.getDay() + 6) % 7 + 6)];
        case 'month': return [new Date(y, m, 1), new Date(y, m + 1, 0)];
        case 'lastMonth': return [new Date(y, m - 1, 1), new Date(y, m, 0)];
        case 'year': return [new Date(y, 0, 1), new Date(y, 11, 31)];
        case 'lastYear': return [new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)];
        default: return null;
        }
    }

    window.RxHistoryList = function (options) {
        const el = suffix => document.getElementById(options.prefix + suffix);
        let page = 1, total = 0, request = 0, busy = false, exporting = false, loaded = false;
        let active = null;
        const perms = typeof getPagePerms === 'function' ? getPagePerms() : {};
        const canExport = !!perms.canExport && options.canRead !== false;
        const status = (text, error) => {
            el('Status').textContent = text;
            el('Status').className = 'small ' + (error ? 'text-danger' : 'text-muted');
        };
        function controls() {
            el('Previous').disabled = busy || !loaded || page <= 1;
            el('Next').disabled = busy || !loaded || page * Number(el('Size').value) >= total;
            el('Export').disabled = !canExport || busy || exporting || !loaded || !total;
            el('Size').disabled = busy;
        }
        function setPreset() {
            if (el('Range').value === 'custom') return;
            const dates = presetDates(el('Range').value, new Date());
            el('From').value = dates ? dateText(dates[0]) : '';
            el('To').value = dates ? dateText(dates[1]) : '';
        }
        function filters() {
            if (!el('From').checkValidity() || !el('To').checkValidity()) throw new Error('Enter valid From and To dates.');
            const start = dateBoundary(el('From').value, false);
            const end = dateBoundary(el('To').value, true);
            if (start && end && start >= end) throw new Error('From date must be on or before To date.');
            return { start, end, search: el('Search').value.trim() };
        }
        function params(values, targetPage) {
            const query = new URLSearchParams(values);
            query.set('page', String(targetPage));
            query.set('pageSize', el('Size').value);
            return query.toString();
        }
        async function load(targetPage, apply) {
            let selected;
            try { selected = apply || !active ? filters() : active; }
            catch (error) { status(error.message, true); return; }
            const current = ++request;
            busy = true;
            loaded = false;
            controls();
            status('Loading history...');
            options.message('Loading history...');
            try {
                const response = await fetchWithAuth(window.rxUrl(options.endpoint + '?' + params(selected, targetPage || 1)));
                if (!response || !response.ok) throw new Error('Unable to load history. Refresh and try again.');
                const data = await response.json();
                if (current !== request) return;
                active = selected;
                page = data.page;
                total = data.total;
                loaded = true;
                const records = data[options.rowsKey];
                if (records.length) options.render(records);
                else options.message('No history matches these filters. Use Show all history to include older records.');
                const first = total ? (page - 1) * data.pageSize + 1 : 0;
                el('Page').textContent = first + '–' + Math.min(page * data.pageSize, total) + ' of ' + total + ' | Page ' + page + ' of ' + Math.max(1, Math.ceil(total / data.pageSize));
                status('');
            } catch (error) {
                if (current !== request) return;
                options.message(error.message);
                el('Page').textContent = '';
                status(error.message, true);
            } finally {
                if (current === request) { busy = false; controls(); }
            }
        }
        async function exportHistory() {
            if (!canExport || exporting || busy || !loaded || !total) return;
            // Export exactly the applied filters, even if the user has started editing the controls.
            exporting = true;
            controls();
            status('Preparing export of all matching history...');
            try {
                const response = await fetchWithAuth(window.rxUrl(options.exportEndpoint + '?' + params(active, 1)));
                if (!response || !response.ok || !(response.headers.get('Content-Type') || '').includes('text/csv')) throw new Error('Unable to export history. Try again.');
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url; link.download = options.filename;
                document.body.appendChild(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                status('History exported.');
            } catch (error) { status(error.message, true); }
            finally { exporting = false; controls(); }
        }
        el('Range').addEventListener('change', () => { setPreset(); if (el('Range').value !== 'custom') load(1, true); });
        ['From', 'To'].forEach(suffix => el(suffix).addEventListener('change', () => { el('Range').value = 'custom'; }));
        el('Apply').addEventListener('click', () => load(1, true));
        el('Search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); load(1, true); } });
        el('All').addEventListener('click', () => { el('Range').value = 'all'; el('Search').value = ''; setPreset(); load(1, true); });
        el('Size').addEventListener('change', () => load(1));
        el('Previous').addEventListener('click', () => load(page - 1));
        el('Next').addEventListener('click', () => load(page + 1));
        el('Export').addEventListener('click', exportHistory);
        setPreset();
        controls();
        return { load: targetPage => load(targetPage || 1, true), refresh: () => load(page) };
    };
    if (window.__RX_HISTORY_TEST_HOOKS__) Object.assign(window.__RX_HISTORY_TEST_HOOKS__, { dateBoundary, presetDates, dateText });
}());
