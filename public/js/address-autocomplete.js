(function() {
    var cachePromise = null;
    var loadStarted = false;
    var fields = ['addressLine1', 'city', 'state', 'zipCode'];

    function fetchAddressOptions(refresh) {
        if (!cachePromise) {
            var url = '/api/lookup/patient-addresses' + (refresh ? '?refresh=1' : '');
            cachePromise = fetchWithAuth(window.rxUrl(url), { silent: true })
                .then(function(res) {
                    if (!res || !res.ok) return {};
                    return res.json();
                })
                .catch(function() { return {}; });
        }
        return cachePromise;
    }

    function ensureDatalist(field, values) {
        var id = 'patientAddressOptions_' + field;
        var list = document.getElementById(id);
        if (!list) {
            list = document.createElement('datalist');
            list.id = id;
            document.body.appendChild(list);
        }
        list.innerHTML = (values || []).map(function(value) {
            return '<option value="' + String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"></option>';
        }).join('');
        return id;
    }

    function bind(options) {
        fields.forEach(function(field) {
            var listId = ensureDatalist(field, options[field] || []);
            document.querySelectorAll('[data-address-autocomplete="' + field + '"]').forEach(function(input) {
                input.setAttribute('list', listId);
                input.setAttribute('autocomplete', 'off');
            });
        });
    }

    function init() {
        if (loadStarted) return cachePromise;
        loadStarted = true;
        return fetchAddressOptions(false).then(bind);
    }

    function bindLazyLoad() {
        document.addEventListener('focusin', function(event) {
            if (event.target && event.target.matches('[data-address-autocomplete]')) init();
        });
        document.addEventListener('toggle', function(event) {
            if (
                event.target &&
                event.target.open &&
                event.target.querySelector &&
                event.target.querySelector('[data-address-autocomplete]')
            ) {
                init();
            }
        }, true);
    }

    window.rxAddressAutocomplete = {
        init: init,
        refresh: function() {
            cachePromise = null;
            loadStarted = true;
            return fetchAddressOptions(true).then(bind);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindLazyLoad);
    } else {
        bindLazyLoad();
    }
})();
