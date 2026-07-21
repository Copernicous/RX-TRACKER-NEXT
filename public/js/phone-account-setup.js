'use strict';

(function() {
    function field(id) {
        return document.getElementById(id);
    }

    function setMessage(message, type) {
        var element = field('phoneSetupMessage');
        if (!element) return;
        element.className = 'alert alert-' + (type || 'secondary');
        element.textContent = message;
    }

    async function responseBody(response) {
        return response ? response.json().catch(function() { return {}; }) : {};
    }

    function setupPath() {
        return window.rxUrl ? window.rxUrl('/api/phone-account/setup') : '/api/phone-account/setup';
    }

    async function loadSetup() {
        try {
            var response = await fetchWithAuth(setupPath(), { silent: true });
            var data = await responseBody(response);
            if (!response || !response.ok) throw new Error(data.error || data.message || 'Could not load phone-account setup.');
            if (data.configured) {
                setMessage('Phone-account setup is already complete. Redirecting...', 'success');
                var form = field('phoneAccountSetupForm');
                var redirect = form ? form.getAttribute('data-success-path') : '/dashboard';
                setTimeout(function() { window.rxNav(redirect || '/dashboard'); }, 500);
                return;
            }
            field('phoneSetupServer').value = data.server || '192.168.15.200';
            field('phoneSetupPort').value = data.port || 5060;
            field('phoneSetupUsername').value = data.username || '';
            field('phoneSetupDisplayName').value = data.displayName || data.username || '';
            field('phoneSetupLocalPort').value = data.localSipPort === undefined ? 0 : data.localSipPort;
            setMessage(data.reconfiguration
                ? 'Your administrator reopened setup. Enter the complete SIP account and save it to enable registration again.'
                : 'Setup is authorized for your user. Enter the SIP account and save it once.', 'info');
        } catch (err) {
            setMessage((err && err.message) || 'Could not load phone-account setup.', 'danger');
        }
    }

    async function saveSetup(event) {
        event.preventDefault();
        var form = event.currentTarget;
        if (!form.reportValidity()) return;
        var password = field('phoneSetupPassword').value;
        var confirmation = field('phoneSetupPasswordConfirm').value;
        if (password !== confirmation) {
            field('phoneSetupPasswordConfirm').setCustomValidity('The SIP passwords do not match.');
            field('phoneSetupPasswordConfirm').reportValidity();
            return;
        }
        field('phoneSetupPasswordConfirm').setCustomValidity('');

        var payload = {
            server: field('phoneSetupServer').value.trim(),
            port: Number(field('phoneSetupPort').value),
            username: field('phoneSetupUsername').value.trim(),
            displayName: field('phoneSetupDisplayName').value.trim(),
            password: password,
            localSipPort: Number(field('phoneSetupLocalPort').value || 0)
        };
        var button = field('phoneSetupSaveBtn');
        var original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving';
        setMessage('Encrypting and saving the phone account...', 'secondary');
        try {
            var request = fetchWithAuth(setupPath(), {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            payload.password = '';
            field('phoneSetupPassword').value = '';
            field('phoneSetupPasswordConfirm').value = '';
            var response = await request;
            var data = await responseBody(response);
            if (!response || !response.ok) throw new Error(data.error || data.message || 'Could not save the phone account.');
            setMessage(data.message || 'Phone account configured successfully.', 'success');
            var redirect = form.getAttribute('data-success-path') || '/dashboard';
            setTimeout(function() { window.rxNav(redirect); }, 1200);
        } catch (err) {
            setMessage((err && err.message) || 'Could not save the phone account.', 'danger');
            button.disabled = false;
            button.innerHTML = original;
        } finally {
            payload.password = '';
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        if (typeof initApp === 'function') initApp();
        var form = field('phoneAccountSetupForm');
        var toggle = field('phoneSetupPasswordToggle');
        var confirmation = field('phoneSetupPasswordConfirm');
        if (form) form.addEventListener('submit', saveSetup);
        if (confirmation) confirmation.addEventListener('input', function() { confirmation.setCustomValidity(''); });
        if (toggle) toggle.addEventListener('click', function() {
            var password = field('phoneSetupPassword');
            var show = password.type === 'password';
            password.type = show ? 'text' : 'password';
            toggle.textContent = show ? 'Hide' : 'Show';
        });
        loadSetup();
    });
})();
