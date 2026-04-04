/**
 * Lead Router — GoHighLevel Embed Script
 *
 * Drop this on any custom GHL page (or any HTML page) to capture a form,
 * route the lead, and redirect to the assigned advisor's calendar.
 *
 * SETUP — add a config block BEFORE this script tag:
 *
 *   <script>
 *     window.LeadRouterConfig = {
 *       backendUrl:   'https://your-domain.com',   // required: your server URL
 *       formSelector: '#lead-form',                // optional: defaults to 'form'
 *       fallbackUrl:  'https://your-domain.com/thank-you', // optional: redirect if routing fails
 *       fields: {                                  // optional: map to your actual field names
 *         name:  'full_name',   // <input name="full_name">
 *         email: 'email',
 *         phone: 'phone',
 *         state: 'state',
 *       },
 *       extraFields: {                             // optional: pass any extra fields to backend
 *         investableAssets: 'investable_assets',
 *         goal:             'primary_goal',
 *       },
 *       submitButtonText: 'Connecting you…',       // optional: loading text on submit
 *     };
 *   </script>
 *   <script src="https://your-domain.com/ghl-embed.js"></script>
 *
 * HOW IT WORKS:
 *   1. Finds the form using formSelector
 *   2. Intercepts submit (prevents GHL's default handling)
 *   3. POSTs lead data to /route-lead on your backend
 *   4. Redirects the browser to the assigned advisor's calendar URL
 *   5. Falls back to fallbackUrl (or an alert) if routing fails
 */

(function () {
  const cfg = window.LeadRouterConfig || {};

  const BACKEND_URL   = (cfg.backendUrl  || '').replace(/\/$/, ''); // strip trailing slash
  const FORM_SELECTOR = cfg.formSelector || 'form';
  const FALLBACK_URL  = cfg.fallbackUrl  || '';
  const LOADING_TEXT  = cfg.submitButtonText || 'Connecting you with an advisor…';
  const FIELD_MAP     = Object.assign({ name: 'name', email: 'email', phone: 'phone', state: 'state' }, cfg.fields || {});
  const EXTRA_FIELDS  = cfg.extraFields || {};

  if (!BACKEND_URL) {
    console.error('[LeadRouter] backendUrl is not set in window.LeadRouterConfig.');
    return;
  }

  /** Read a field value from the form by name attribute, then by id. */
  function getVal(form, fieldName) {
    if (!fieldName) return '';
    const el = form.querySelector(`[name="${fieldName}"]`) || document.getElementById(fieldName);
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? 'yes' : 'no';
    if (el.type === 'radio') {
      const checked = form.querySelector(`[name="${fieldName}"]:checked`);
      return checked ? checked.value : '';
    }
    return (el.value || '').trim();
  }

  function handleSubmit(e) {
    e.preventDefault();
    e.stopPropagation();

    const form       = e.currentTarget;
    const submitBtn  = form.querySelector('[type="submit"], button:not([type]), button[type="button"]');
    const originalText = submitBtn ? submitBtn.textContent : '';

    // Disable button and show loading state
    if (submitBtn) {
      submitBtn.disabled    = true;
      submitBtn.textContent = LOADING_TEXT;
    }

    // Build the payload from configured field names
    const payload = {
      name:  getVal(form, FIELD_MAP.name),
      email: getVal(form, FIELD_MAP.email),
      phone: getVal(form, FIELD_MAP.phone),
      state: getVal(form, FIELD_MAP.state),
    };

    // Attach any extra fields (qualification questions, etc.)
    for (const [key, fieldName] of Object.entries(EXTRA_FIELDS)) {
      payload[key] = getVal(form, fieldName);
    }

    fetch(`${BACKEND_URL}/route-lead`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
      .then(res => res.json())
      .then(data => {
        if (data.calendarUrl) {
          window.location.href = data.calendarUrl;
        } else if (FALLBACK_URL) {
          window.location.href = FALLBACK_URL;
        } else {
          alert('Thank you! An advisor will be in touch with you shortly.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
        }
      })
      .catch(err => {
        console.error('[LeadRouter] Routing request failed:', err);
        if (FALLBACK_URL) {
          window.location.href = FALLBACK_URL;
        } else {
          alert('Something went wrong. Please try again or call us directly.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
        }
      });
  }

  function init() {
    const form = document.querySelector(FORM_SELECTOR);
    if (!form) {
      console.warn('[LeadRouter] No form found matching selector:', FORM_SELECTOR);
      return;
    }
    form.addEventListener('submit', handleSubmit);
    console.log('[LeadRouter] Initialized. Watching:', form);
  }

  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
