(function () {
    'use strict';

    var DATA_PAGE_SIZE = 24;
    var SIGNATURE_PAGE_SIZE = 12;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatDate(value, includeTime) {
        if (!value) return '';
        var parsed = new Date(value);
        if (isNaN(parsed.getTime())) return '';
        var options = { month: '2-digit', day: '2-digit', year: 'numeric' };
        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }
        return parsed.toLocaleString([], options);
    }

    function findReceiptAction() {
        var actions = Array.isArray(window.allWorkflowActions) ? window.allWorkflowActions : [];
        var acceptedNames = [
            'mark as received to print log',
            'driver receipt obtained',
            'rx delivered'
        ];
        for (var index = 0; index < acceptedNames.length; index += 1) {
            var match = actions.find(function (action) {
                return String(action.name || '').trim().toLowerCase() === acceptedNames[index];
            });
            if (match) return match;
        }
        return actions.find(function (action) {
            var name = String(action.name || '').toLowerCase();
            return name.indexOf('print log') >= 0 && name.indexOf('received') >= 0;
        }) || null;
    }

    function normalizeRows(records) {
        var receiptAction = findReceiptAction();
        return records.map(function (rx, index) {
            var patient = rx.Patient || {};
            var transport = rx.PharmacyTransportCompany || {};
            var trackings = Array.isArray(rx.RXWorkflowTrackings) ? rx.RXWorkflowTrackings : [];
            var receiptTracking = receiptAction ? trackings.find(function (tracking) {
                return Number(tracking.workflowActionId) === Number(receiptAction.id);
            }) : null;
            var returnedToPharmacy = rx.deliveryOutcome === 'returned_to_pharmacy';
            var status = returnedToPharmacy
                ? 'RETURNED'
                : receiptTracking && receiptTracking.completionDate ? 'RECEIVED' : 'PENDING';
            return {
                number: index + 1,
                receivedDate: formatDate(returnedToPharmacy ? rx.deliveryOutcomeDate : (receiptTracking && receiptTracking.completionDate), false),
                receivedAt: formatDate(returnedToPharmacy ? rx.deliveryOutcomeDate : (receiptTracking && receiptTracking.completionDate), true),
                reference: 'RX-' + String(rx.id || '').padStart(6, '0'),
                patient: [patient.firstName, patient.lastName].filter(Boolean).join(' '),
                dob: formatDate(patient.dob, false),
                pharmacy: rx.Pharmacy && rx.Pharmacy.name ? rx.Pharmacy.name : '',
                driver: transport.contactPerson || transport.companyName || '',
                status: status,
                notes: status === 'RETURNED'
                    ? ('Package returned to pharmacy' + (rx.deliveryOutcomeNote ? ': ' + rx.deliveryOutcomeNote : ''))
                    : (status === 'PENDING' ? 'Pending delivery receipt' : ''),
                initials: ''
            };
        });
    }

    function groupRowsByPharmacy(rows) {
        var groupsByName = {};
        rows.forEach(function (row) {
            var pharmacyName = row.pharmacy || 'Unassigned Pharmacy';
            if (!groupsByName[pharmacyName]) groupsByName[pharmacyName] = [];
            groupsByName[pharmacyName].push(row);
        });
        return Object.keys(groupsByName).sort().map(function (pharmacyName) {
            return { pharmacy: pharmacyName, rows: groupsByName[pharmacyName] };
        });
    }

    function paginatePharmacyRows(rows) {
        var remaining = rows.slice();
        var pages = [];

        if (remaining.length <= SIGNATURE_PAGE_SIZE) return [remaining];

        while (remaining.length > DATA_PAGE_SIZE) {
            pages.push(remaining.splice(0, DATA_PAGE_SIZE));
        }

        if (remaining.length > SIGNATURE_PAGE_SIZE) {
            pages.push(remaining);
            pages.push([]);
        } else {
            pages.push(remaining);
        }

        return pages;
    }
    function pharmacyMetadata(baseMetadata, pharmacyName, groupIndex) {
        return {
            reference: baseMetadata.reference + '-P' + String(groupIndex + 1).padStart(2, '0'),
            verification: baseMetadata.verification + '-P' + String(groupIndex + 1).padStart(2, '0'),
            generated: baseMetadata.generated,
            period: baseMetadata.period,
            filters: baseMetadata.filters,
            location: pharmacyName
        };
    }

    function reportCounts(rows) {
        return {
            received: rows.filter(function (row) { return row.status === 'RECEIVED'; }).length,
            returned: rows.filter(function (row) { return row.status === 'RETURNED'; }).length,
            pending: rows.filter(function (row) { return row.status === 'PENDING'; }).length
        };
    }

    function filterSummary() {
        var descriptions = [];
        [
            ['rxFilterDateFrom', 'From'],
            ['rxFilterDateTo', 'To'],
            ['rxFilterPharmacy', 'Pharmacy'],
            ['rxFilterWorkflowStatus', 'Workflow'],
            ['rxFilterCurrentWorkflowStage', 'Current Stage']
        ].forEach(function (definition) {
            var element = document.getElementById(definition[0]);
            if (!element || !element.value) return;
            var value = element.tagName === 'SELECT'
                ? element.options[element.selectedIndex].text
                : element.value;
            descriptions.push(definition[1] + ': ' + value);
        });
        return descriptions.length ? descriptions.join(' | ') : 'All visible RX records';
    }

    function reportMetadata(total) {
        var now = new Date();
        var dateFrom = document.getElementById('rxFilterDateFrom');
        var dateTo = document.getElementById('rxFilterDateTo');
        var dateToken = now.toISOString().slice(0, 10).replace(/-/g, '');
        var reference = 'RX-LOG-' + dateToken + '-' + String(total).padStart(4, '0');
        return {
            reference: reference,
            verification: dateToken.slice(-4) + '-' + String(total).padStart(4, '0'),
            generated: now.toLocaleString(),
            period: (dateFrom && dateFrom.value ? formatDate(dateFrom.value, false) : 'All dates') +
                ' - ' + (dateTo && dateTo.value ? formatDate(dateTo.value, false) : 'Current'),
            filters: filterSummary()
        };
    }

    function metricCards(rows) {
        var counts = reportCounts(rows);
        return '<section class="metrics">' +
            '<div class="metric metric-total"><i>T</i><span>Total Records</span><strong>' + rows.length + '</strong></div>' +
            '<div class="metric metric-received"><i>R</i><span>Received</span><strong>' + counts.received + '</strong></div>' +
            '<div class="metric metric-returned"><i>X</i><span>Returned</span><strong>' + counts.returned + '</strong></div>' +
            '<div class="metric metric-pending"><i>P</i><span>Pending</span><strong>' + counts.pending + '</strong></div>' +
        '</section>';
    }

    function statusClass(status) {
        if (status === 'RECEIVED') return 'status-received';
        if (status === 'RETURNED') return 'status-returned';
        return 'status-pending';
    }

    function tableRows(rows) {
        return rows.map(function (row) {
            return '<tr>' +
                '<td>' + escapeHtml(row.receivedDate || '-') + '</td>' +
                '<td class="patient">' + escapeHtml(row.patient) + '</td>' +
                '<td>' + escapeHtml(row.dob) + '</td>' +
                '<td>' + escapeHtml(row.notes) + '</td>' +
            '</tr>';
        }).join('');
    }

    function logTable(rows, heading, returnedSection) {
        if (!rows.length) return '';
        return (heading ? '<h2 class="log-section-title ' + (returnedSection ? 'returned-section-title' : '') + '">' + escapeHtml(heading) + '</h2>' : '') +
            '<table class="log-table ' + (returnedSection ? 'returned-log-table' : '') + '">' +
                '<thead><tr><th>Date</th><th>Patient Full Name</th><th>DOB</th><th>Notes</th></tr></thead>' +
                '<tbody>' + tableRows(rows) + '</tbody>' +
            '</table>';
    }

    function preparedSignature() {
        return '<section class="signature signature-prepared">' +
            '<h2>Chain of Custody &amp; Acknowledgment</h2>' +
            '<div class="signature-grid three">' +
                '<label>Prepared By (Print Name)<b></b></label>' +
                '<label>Prepared By Signature<b></b></label>' +
                '<label>Released Date / Time<b></b></label>' +
            '</div>' +
        '</section>';
    }

    function receivedSignature() {
        return '<section class="signature signature-received">' +
            '<h2>Receipt Acknowledgment</h2>' +
            '<div class="signature-grid three">' +
                '<label>Received By (Print Name)<b></b></label>' +
                '<label>Recipient Signature<b></b></label>' +
                '<label>Date / Time Received<b></b></label>' +
            '</div>' +            '<div class="signature-grid two">' +
                '<label>Pharmacy Representative Signature<b></b></label>' +
                '<label>Exception Reference / Notes<b></b></label>' +
            '</div>' +

            '<div class="checks">&#9744; Complete &nbsp;&nbsp;&nbsp; &#9744; Partial &nbsp;&nbsp;&nbsp; &#9744; Returned Items Attached</div>' +
        '</section>';
    }

    function reportPage(pageRows, pageIndex, pageCount, allRows, metadata) {
        var isFirst = pageIndex === 0;
        var isLast = pageIndex === pageCount - 1;
        return '<article class="report-page">' +
            '<div class="company-masthead">RB &amp; DC SOLUTIONS LLC - ORIGINAL RECEIPTS DELIVERY LOG</div>' +
            '<header class="report-header">' +
                '<div class="title-block"><h1>Print &amp; Delivery Log</h1><label class="driver-header">Driver: <input class="driver-header-field" type="text" aria-label="Driver for pharmacy"></label></div>' +
                '<dl>' +
                    '<dt>Report Reference:</dt><dd>' + escapeHtml(metadata.reference) + '</dd>' +
                    '<dt>Reporting Period:</dt><dd>' + escapeHtml(metadata.period) + '</dd>' +
                    '<dt>Generated:</dt><dd>' + escapeHtml(metadata.generated) + '</dd>' +
                    '<dt>Pharmacy:</dt><dd class="pharmacy-name">' + escapeHtml(metadata.location || 'Unassigned Pharmacy') + '</dd>' +
                '</dl>' +
            '</header>' +
            (isFirst ? metricCards(allRows) : (pageRows.length ? '<div class="continuation"><span>CONTINUATION</span></div>' : '')) +
            logTable(pageRows.filter(function (row) { return row.status !== 'RETURNED'; }), pageRows.some(function (row) { return row.status === 'RETURNED'; }) ? 'Delivery / Receipt Packages' : '', false) +
            logTable(pageRows.filter(function (row) { return row.status === 'RETURNED'; }), 'Returned Packages to Pharmacy - Patient Not Accepted', true) +
            (isLast ? '<div class="signature-stack">' + preparedSignature() + receivedSignature() + '</div>' : '') +
            '<div class="audit-strip">' +
                '<span><i>F</i> Export Format: PDF / XLSX</span>' +
                '<span><i>S</i> Source: RX Tracker NEXT</span>' +
                '<span><i>V</i> Verification: ' + escapeHtml(metadata.verification) + '</span>' +
            '</div>' +
            '<footer class="report-footer">' +
                '<span>' + escapeHtml(metadata.reference) + ' &bull; Controlled Copy</span>' +
                '<span>Confidential - Handle per pharmacy policy</span>' +
                '<span>Page ' + (pageIndex + 1) + ' of ' + pageCount + '</span>' +
            '</footer>' +
        '</article>';
    }

    function reportStyles() {
        return '@page{size:letter landscape;margin:7mm}' +
            '*{box-sizing:border-box}' +
            'body{margin:0;background:#edf1f5;color:#14233d;font-family:Arial,Helvetica,sans-serif}' +
            '.report-page{position:relative;width:10.4in;min-height:7.86in;margin:18px auto;padding:.25in .3in .5in;background:#fff;box-shadow:0 7px 24px #2639522e;page-break-after:always;overflow:hidden}' +
            '.report-page:last-child{page-break-after:auto}' +
            '.company-masthead{text-align:center;margin:-2px 0 8px;padding-bottom:7px;border-bottom:1px solid #aebbc9;color:#101b2d;font-size:14px;font-weight:800;letter-spacing:.035em}' +
            '.report-header{display:flex;justify-content:space-between;align-items:flex-start;border-top:5px solid #123b70;border-bottom:1px solid #c6d0dc;padding:13px 14px 11px;margin-bottom:10px;background:linear-gradient(90deg,#fff,#f7fafc)}' +
            '.title-block{padding-top:7px}' +
            'h1{margin:0;color:#123b70;font-size:22px;line-height:1;text-transform:uppercase;letter-spacing:.035em}' +
            'dl{display:grid;grid-template-columns:auto auto;gap:4px 13px;margin:0;font-size:8px;min-width:270px}' +
            'dt{font-weight:bold;color:#233753}dd{margin:0;color:#087c78;font-weight:600}' +
            '.metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #bcc8d5;border-radius:7px;overflow:hidden;margin:0 0 11px;box-shadow:0 2px 8px #123b7017}' +
            '.metric{display:grid;grid-template-columns:30px 1fr auto;align-items:center;gap:8px;padding:10px 12px;border-right:1px solid #d2dbe5}' +
            '.metric:last-child{border-right:0}.metric i{display:flex;align-items:center;justify-content:center;width:27px;height:27px;border-radius:50%;color:#fff;font-size:11px;font-style:normal;font-weight:bold}' +
            '.metric span{font-size:8px;font-weight:600;color:#34445b}.metric strong{font-size:18px;color:#123b70}' +
            '.metric-total i{background:#123b70}.metric-received i{background:#087c78}.metric-returned i{background:#d85b08}.metric-pending i{background:#687386}' +
            '.continuation{display:flex;align-items:center;gap:9px;margin:0 0 9px;padding:6px 9px;border:1px solid #d3dce6;border-left:4px solid #087c78;background:#f4f7fa;font-size:7px}' +
            '.continuation span{padding:3px 8px;border-radius:10px;background:#087c78;color:#fff;font-weight:bold;letter-spacing:.08em}' +
            '.log-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:7px}' +
            '.log-table th{padding:5px 4px;background:#123b70;color:#fff;border:1px solid #0d315e;text-align:left;line-height:1.15}' +
            '.log-table td{height:25px;padding:4px;border:1px solid #c1ccd8;vertical-align:middle;overflow-wrap:anywhere}' +
            '.log-table tbody tr:nth-child(even) td{background:#f5f7fa}.log-table .patient{font-weight:700}.center{text-align:center}' +
            '.log-table th:nth-child(1){width:15%}.log-table th:nth-child(2){width:30%}.log-table th:nth-child(3){width:15%}.log-table th:nth-child(4){width:20%}.log-table th:nth-child(5){width:20%}' +
            '.status{display:inline-block;padding:2px 5px;border-radius:8px;color:#fff;font-size:6px;font-weight:bold;letter-spacing:.02em}.status-received{background:#087c78}.status-returned{background:#d85b08}.status-pending{background:#687386}' +
            '.signature{margin-top:10px;border-top:2px solid #123b70;padding:7px 7px 0}.signature h2{margin:0 0 7px;font-size:9px;text-transform:uppercase;letter-spacing:.035em;color:#123b70}' +
            '.signature-grid{display:grid;gap:8px 18px}.signature-grid.three{grid-template-columns:repeat(3,1fr)}.signature-grid.two{grid-template-columns:1fr 1fr;margin-top:8px}' +
            '.signature label{font-size:6.5px;font-weight:bold;color:#263952}.signature label b{display:block;height:16px;border-bottom:1px solid #647184}' +
            '.checks{text-align:center;margin-top:8px;padding:5px;border:1px solid #d4dce5;border-radius:4px;font-size:6.5px}' +
            '.audit-strip{position:absolute;left:.3in;right:.3in;bottom:.29in;display:flex;justify-content:space-between;align-items:center;border:1px solid #d2dbe4;padding:4px 8px;background:#fafbfd;color:#536174;font-size:6.3px}' +
            '.audit-strip i{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;border:1px solid #123b70;border-radius:50%;color:#123b70;font-size:6px;font-style:normal;font-weight:bold}' +
            '.report-footer{position:absolute;left:0;right:0;bottom:0;height:.22in;display:flex;justify-content:space-between;align-items:center;padding:0 .3in;background:#123b70;color:#fff;font-size:6.5px}' +
            '@media print{body{background:#fff}.report-page{width:auto;min-height:7.82in;margin:0;box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
    }

    function fetchRows() {
        var params = window.buildRxQueryParams({ exportAll: true });
        return window.fetchWithAuth(window.rxUrl('/api/rx-records') + '?' + params.toString())
            .then(function (response) {
                if (!response || !response.ok) throw new Error('Could not load RX records.');
                return response.json();
            })
            .then(function (data) {
                return Array.isArray(data.rows) ? data.rows : (Array.isArray(data) ? data : []);
            });
    }

    function openPdfReport() {
        var reportWindow = window.open('', '_blank', 'width=1200,height=850');
        if (!reportWindow) {
            window.showToast('Popup blocked. Allow popups to create the delivery log PDF.', 'warning');
            return;
        }
        fetchRows().then(function (records) {
            if (!records.length) throw new Error('No RX records match the current filters.');
            var rows = normalizeRows(records);
            var baseMetadata = reportMetadata(rows.length);
            var pharmacyGroups = groupRowsByPharmacy(rows);
            var pages = '';
            pharmacyGroups.forEach(function (group, groupIndex) {
                group.rows = group.rows.filter(function (row) { return row.status !== 'RETURNED'; }).concat(group.rows.filter(function (row) { return row.status === 'RETURNED'; }));
                var metadata = pharmacyMetadata(baseMetadata, group.pharmacy, groupIndex);
                var pharmacyPages = paginatePharmacyRows(group.rows);
                var pageCount = pharmacyPages.length;
                pharmacyPages.forEach(function (pageRows, pageIndex) {
                    pages += reportPage(
                        pageRows,
                        pageIndex,
                        pageCount,
                        group.rows,
                        metadata
                    );
                });
            });
            var metadata = baseMetadata;
            var documentHtml = '<!doctype html><html><head><meta charset="UTF-8"><title>' + escapeHtml(metadata.reference) + '</title><link rel="stylesheet" href="/css/rx-delivery-log.css?v=20260729-3"></head><body>' + pages + '<div class="report-actions"><button id="printReportBtn" type="button">Print / Save PDF</button></div></body></html>';
            reportWindow.document.open();
            reportWindow.document.write(documentHtml);
            reportWindow.document.close();
            reportWindow.onload = function () { var printButton = reportWindow.document.getElementById('printReportBtn'); if (printButton) printButton.addEventListener('click', function () { reportWindow.focus(); reportWindow.print(); }); };
        }).catch(function (error) {
            reportWindow.close();
            window.showToast(error.message || 'Could not generate delivery log.', 'danger');
        });
    }

    function xmlCell(value, style) {
        return '<Cell' + (style ? ' ss:StyleID="' + style + '"' : '') + '><Data ss:Type="String">' + escapeHtml(value) + '</Data></Cell>';
    }

    function downloadExcelReport() {
        fetchRows().then(function (records) {
            if (!records.length) throw new Error('No RX records match the current filters.');
            var rows = normalizeRows(records);
            var metadata = reportMetadata(rows.length);
            var pharmacyGroups = groupRowsByPharmacy(rows);
            var sheets = pharmacyGroups.map(function (group) {
                var groupCounts = reportCounts(group.rows);
                var rowsXml = group.rows.map(function (row) {
                    return '<Row>' + [row.receivedDate, row.patient, row.dob, row.driver, row.notes].map(function (value) { return xmlCell(value); }).join('') + '</Row>';
                }).join('');
                return '<Worksheet ss:Name="' + escapeHtml(group.pharmacy).slice(0, 31) + '"><Table>' +
                    '<Row>' + xmlCell('RB & DC SOLUTIONS LLC - ORIGINAL RECEIPTS DELIVERY LOG', 'Title') + '</Row>' +
                    '<Row>' + xmlCell('Print & Delivery Log', 'Title') + '</Row>' +
                    '<Row>' + xmlCell('Pharmacy: ' + group.pharmacy, 'Pharmacy') + '</Row>' +
                    '<Row>' + xmlCell('Report Reference: ' + metadata.reference) + xmlCell('Generated: ' + metadata.generated) + '</Row>' +
                    '<Row>' + xmlCell('Total Records: ' + group.rows.length, 'Metric') + xmlCell('Received: ' + groupCounts.received, 'Metric') + xmlCell('Returned: ' + groupCounts.returned, 'Metric') + xmlCell('Pending: ' + groupCounts.pending, 'Metric') + '</Row>' +
                    '<Row>' + ['Date Delivered','Patient Full Name','DOB','Driver','Notes'].map(function (heading) { return xmlCell(heading, 'Header'); }).join('') + '</Row>' + rowsXml +
                    '<Row></Row><Row>' + xmlCell('Prepared By (Print Name)') + xmlCell('Prepared By Signature') + xmlCell('Released Date / Time') + '</Row>' +
                    '<Row>' + xmlCell('Received By (Print Name)') + xmlCell('Recipient Signature') + xmlCell('Date / Time Received') + '</Row>' +
                    '<Row>' + xmlCell('Pharmacy Representative Signature') + xmlCell('Exception Reference / Notes') + '</Row>' +
                    '</Table></Worksheet>';
            }).join('');
            var xml = '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Title"><Font ss:Bold="1" ss:Size="16" ss:Color="#123B70"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#123B70" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style><Style ss:ID="Metric"><Font ss:Bold="1" ss:Color="#123B70" ss:Size="12"/><Interior ss:Color="#EAF3F4" ss:Pattern="Solid"/></Style><Style ss:ID="Pharmacy"><Font ss:Bold="1" ss:Color="#123B70"/></Style></Styles>' + sheets + '</Workbook>';
            var filename = String(metadata.reference || 'print-delivery-log')
                .replace(/[^a-z0-9._-]+/gi, '_')
                .replace(/^_+|_+$/g, '')
                .toLowerCase() + '.xls';
            var blob = new Blob(['\uFEFF', xml], { type: 'application/vnd.ms-excel' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            setTimeout(function () {
                link.remove();
                URL.revokeObjectURL(url);
            }, 10000);
        }).catch(function (error) {
            window.showToast(error.message || 'Could not generate delivery log.', 'danger');
        });
    }
    document.addEventListener('DOMContentLoaded', function () {
        var pdfButton = document.getElementById('rxDeliveryLogPdfBtn');
        var excelButton = document.getElementById('rxDeliveryLogExcelBtn');
        var permissions = typeof window.getPagePerms === 'function' ? window.getPagePerms() : {};
        if (pdfButton) {
            if (typeof window.setRoleActionDisabled === 'function') {
                window.setRoleActionDisabled(pdfButton, !permissions.canPrint, 'Print disabled for this role.');
            }
            pdfButton.addEventListener('click', openPdfReport);
        }
        if (excelButton) {
            if (typeof window.setRoleActionDisabled === 'function') {
                window.setRoleActionDisabled(excelButton, !permissions.canExport, 'Export disabled for this role.');
            }
            excelButton.addEventListener('click', downloadExcelReport);
        }
    });
}());
