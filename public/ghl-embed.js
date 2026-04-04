/**
 * Lead Router — GoHighLevel Embed Script
 *
 * GHL forms are Vue.js based and do not fire a native HTML submit event.
 * This script intercepts the submit button click instead, calls the routing
 * API in parallel with GHL's own submission (so GHL still saves the contact),
 * then redirects to the assigned advisor's calendar URL.
 *
 * SETUP — add a config block BEFORE this script tag:
 *
 *   <script>
 *     window.LeadRouterConfig = {
 *       backendUrl:   'https://your-render-url.onrender.com',
 *       formSelector: '#_builder-form',
 *       fallbackUrl:  'https://yoursite.com/contact',
 *       fields: {
 *         name:  'first_name',
 *         email: 'email',
 *         phone: 'phone',
 *         state: 'your_state_field_name',
 *       },
 *       extraFields: {
 *         last_name: 'last_name',
 *       },
 *     };
 *   <\/script>
 *   <script src="https://your-render-url.onrender.com/ghl-embed.js"><\/script>
 */

(function () {
  const cfg = window.LeadRouterConfig || {};

  const BACKEND_URL   = (cfg.backendUrl  || '').replace(/\/$/, '');
  const FORM_SELECTOR = cfg.formSelector || 'form';
  const FALLBACK_URL  = cfg.fallbackUrl  || '';
  const FIELD_MAP     = Object.assign(
    { name: 'name', email: 'email', phone: 'phone', state: 'state' },
    cfg.fields || {}
  );
  const EXTRA_FIELDS = cfg.extraFields || {};

  if (!BACKEND_URL) {
    console.error('[LeadRouter] backendUrl is not set in window.LeadRouterConfig.');
    return;
  }

  /** Read a field value from the form by name attribute, then by id. */
  function getVal(form, fieldName) {
    if (!fieldName) return '';
    const el = form.querySelector(`[name="${fieldName}"]`) || document.getElementById(fieldName);
    if (!el) return '';

    // GHL multiselect dropdowns — the input is a Vue search box.
    // The selected value lives in the .multiselect__single span.
    if (el.classList.contains('multiselect__input')) {
      const single = el.closest('.multiselect')?.querySelector('.multiselect__single');
      return single ? single.textContent.trim() : '';
    }

    if (el.type === 'checkbox') return el.checked ? 'yes' : 'no';
    if (el.type === 'radio') {
      const checked = form.querySelector(`[name="${fieldName}"]:checked`);
      return checked ? checked.value : '';
    }
    return (el.value || '').trim();
  }

  /** Collect all configured field values from the form into a payload object. */
  function buildPayload(form) {
    const payload = {
      name:  getVal(form, FIELD_MAP.name),
      email: getVal(form, FIELD_MAP.email),
      phone: getVal(form, FIELD_MAP.phone),
      state: getVal(form, FIELD_MAP.state),
    };
    for (const [key, fieldName] of Object.entries(EXTRA_FIELDS)) {
      payload[key] = getVal(form, fieldName);
    }
    return payload;
  }

  /** Call the routing API and redirect to the assigned calendar URL. */
  function routeAndRedirect(payload) {
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
          console.warn('[LeadRouter] No calendar URL returned and no fallbackUrl set.');
        }
      })
      .catch(err => {
        console.error('[LeadRouter] Routing request failed:', err);
        if (FALLBACK_URL) window.location.href = FALLBACK_URL;
      });
  }

  function init() {
    const form = document.querySelector(FORM_SELECTOR);
    if (!form) {
      console.warn('[LeadRouter] No form found matching selector:', FORM_SELECTOR);
      return;
    }

    // GHL uses Vue.js internally — the native form submit event may never fire.
    // We intercept the submit button click in the capture phase (fires before Vue),
    // collect the payload, then let GHL run normally so it still saves the contact.
    // Our fetch call runs in parallel; when it resolves we redirect to the calendar.
    const btn = form.querySelector('[type="submit"]');
    if (btn) {
      btn.addEventListener('click', function () {
        const payload = buildPayload(form);
        console.log('[LeadRouter] Captured payload:', payload);
        routeAndRedirect(payload);
        // Note: we do NOT call preventDefault or stopPropagation here.
        // GHL continues with its own submission so the contact is saved in the CRM.
      }, true); // true = capture phase, fires before Vue's own handlers
      console.log('[LeadRouter] Initialized. Watching submit button on:', form);
    } else {
      // Fallback for non-GHL standard forms
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        routeAndRedirect(buildPayload(form));
      });
      console.log('[LeadRouter] Initialized (submit fallback) on:', form);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
