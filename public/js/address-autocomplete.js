(function() {
    var cachePromise = null;
    var fields = ['addressLine1', 'city', 'state', 'zipCode'];

    function fetchAddressOptions() {
        if (!cachePromise) {
            cachePromise = fetchWithAuth(window.rxUrl('/api/lookup/patient-addresses'), { silent: true })
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
        fetchAddressOptions().then(bind);
    }

    window.rxAddressAutocomplete = {
        init: init,
        refresh: function() {
            cachePromise = null;
            return fetchAddressOptions().then(bind);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
