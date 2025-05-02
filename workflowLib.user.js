// workflowLib.js
// Helper library to build page-automation workflows from a userscript.
// Must run inside Tampermonkey/Violetmonkey; relies on Userscript-Bridge extension.

(function (root) {
  'use strict';

  /* ---------- Bridge wrapper ------------------------------------------------ */
  function bridge(cmd) {
    return new Promise((resolve) => {
      const guid = crypto.randomUUID();
      const listen = (e) => {
        if (e.data?.__FROM_EXTENSION_BRIDGE__ && e.data.guid === guid) {
          window.removeEventListener('message', listen);
          resolve(e.data.response?.result ?? e.data.response);
        }
      };
      window.addEventListener('message', listen);
      window.postMessage({ __FROM_TM_BRIDGE__: true, guid, cmd }, '*');
    });
  }

  /* ---------- DOM helpers --------------------------------------------------- */
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function waitForElement(selector, { visible = true, timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const start = performance.now();

      const test = () => {
        const el = $(selector);
        if (el && (!visible || el.offsetParent !== null)) return el;
        return null;
      };

      const first = test();
      if (first) return resolve(first);

      const mo = new MutationObserver(() => {
        const found = test();
        if (found) {
          mo.disconnect();
          resolve(found);
        } else if (performance.now() - start > timeout) {
          mo.disconnect();
          reject(new Error('waitForElement timeout: ' + selector));
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  }

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  /* ---------- Tab helpers --------------------------------------------------- */
  async function openOrFocusTab(url) {
    const existing = await bridge({ call: 'tabs.query', args: [{ url }] });
    if (existing?.length) {
      await bridge({ call: 'tabs.update', args: [existing[0].id, { active: true }] });
      return existing[0].id;
    }
    const created = await bridge({ call: 'tabs.create', args: [{ url, active: true }] });
    const newId = created?.id ?? created?.tabId;
    if (newId) {
      // Some setups ignore active flag -> ensure focus
      await bridge({ call: 'tabs.update', args: [newId, { active: true }] });
    }
    return newId;
  }

  /* ---------- Workflow executor -------------------------------------------- */
  const ACTIONS = {
    click: async ({ selector }) => {
      (await waitForElement(selector, { visible: true })).click();
    },
    waitVisible: async ({ selector }) => waitForElement(selector, { visible: true }),
    waitHidden: async ({ selector }) => waitForElement(selector, { visible: false }),
    wait: async ({ ms }) => delay(ms),
    getText: async ({ selector, varName }, ctx) => {
      ctx.vars[varName] = (await waitForElement(selector, { visible: false })).textContent.trim();
    },
    getAttr: async ({ selector, attr, varName }, ctx) => {
      ctx.vars[varName] = (await waitForElement(selector, { visible: false })).getAttribute(attr);
    },
    getUrl: ({ varName }, ctx) => { ctx.vars[varName] = location.href; },
    alert: ({ message }, ctx) => alert(render(message, ctx.vars)),
    openTab: async ({ url }) => openOrFocusTab(url),
    runScript: async ({ code }, ctx) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('ctx', 'vars', code);
      return fn(ctx, ctx.vars);
    },
  };

  function render(str, vars) {
    return str.replace(/\$\{?(\w+)\}?/g, (_, k) => vars[k] ?? '');
  }

  async function executeWorkflow(steps) {
    const ctx = { vars: {} };
    for (const step of steps) {
      const act = ACTIONS[step.type];
      if (!act) throw new Error('Unknown step type ' + step.type);
      await act(step, ctx);
    }
    return ctx.vars;
  }

  /* ---------- export -------------------------------------------------------- */
  root.WF = { bridge, waitForElement, delay, openOrFocusTab, executeWorkflow };
})(unsafeWindow || window); 
