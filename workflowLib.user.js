// ==UserScript==
// @name         workflowLib
// @namespace    http://tampermonkey.net/
// @version      2025-05-02-v2
// @description  try to take over the world!
// @author       You
// @match        *://*/*
// @grant        none
// ==/UserScript==

// workflowLib.js
// Helper library to build page-automation workflows from a userscript.
// Requires the Userscript Bridge extension (chrome APIs via window.postMessage).

(function (root) {
  'use strict';

  /* ------------------------------------------------- bridge */
  const bridge = (cmd) => new Promise((resolve) => {
    const guid = crypto.randomUUID();
    const listener = (e) => {
      if (e.data?.__FROM_EXTENSION_BRIDGE__ && e.data.guid === guid) {
        window.removeEventListener('message', listener);
        resolve(e.data.response?.result ?? e.data.response);
      }
    };
    window.addEventListener('message', listener);
    window.postMessage({ __FROM_TM_BRIDGE__: true, guid, cmd }, '*');
  });

  /* ------------------------------------------------- dom helpers */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function waitForElement(selector, { visible = true, timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const observer = new MutationObserver(() => {
        const el = $(selector);
        if (el && (!visible || el.offsetParent !== null)) {
          observer.disconnect();
          resolve(el);
        } else if (performance.now() - t0 > timeout) {
          observer.disconnect();
          reject(new Error('waitForElement timeout: ' + selector));
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      });
      // initial check
      const el0 = $(selector);
      if (el0 && (!visible || el0.offsetParent !== null)) {
        observer.disconnect();
        resolve(el0);
      }
    });
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ------------------------------------------------- tab helpers */
  async function openOrFocusTab(url) {
    const tabs = await bridge({ call: 'tabs.query', args: [{ url }] });
    if (tabs && tabs.length) {
      await bridge({ call: 'tabs.update', args: [tabs[0].id, { active: true }] });
      return tabs[0].id;
    }
    const created = await bridge({ call: 'tabs.create', args: [{ url, active: true }] });
    const newId = created?.id ?? created?.tabId;
    if (newId) {
      // guarantee focus in case active:true was ignored
      await bridge({ call: 'tabs.update', args: [newId, { active: true }] });
    }
    return newId;
  }

  // Focus first tab whose URL matches (string or pattern /foo*/ style)
  async function switchToTabUrl(url) {
    const tabs = await bridge({ call: 'tabs.query', args: [{ url }] });
    if (tabs && tabs.length) {
      await bridge({ call: 'tabs.update', args: [tabs[0].id, { active: true }] });
      return tabs[0].id;
    }
    throw new Error('switchToTabUrl: no tab with url ' + url);
  }

  // Focus tab by numeric id
  async function switchToTabId(tabId) {
    await bridge({ call: 'tabs.update', args: [tabId, { active: true }] });
  }

  // Get tab id: if url provided, first matching; else active tab
  async function getTabId(url = null) {
    if (url) {
      const tabs = await bridge({ call: 'tabs.query', args: [{ url }] });
      return tabs?.[0]?.id ?? null;
    }
    const active = await bridge({ call: 'tabs.query', args: [{ active: true, currentWindow: true }] });
    return active?.[0]?.id ?? null;
  }

  /* ------------------------------------------------- workflow executor */
  const ACTIONS = {
    click: async ({ selector }) => {
      const el = await waitForElement(selector, { visible: true });
      el.click();
    },
    waitVisible: async ({ selector }) => {
      await waitForElement(selector, { visible: true });
    },
    waitHidden: async ({ selector }) => {
      await waitForElement(selector, { visible: false });
    },
    wait: async ({ ms }) => delay(ms),
    getText: async ({ selector, varName }, ctx) => {
      const el = await waitForElement(selector, { visible: false });
      ctx.vars[varName] = el.textContent.trim();
    },
    getAttr: async ({ selector, attr, varName }, ctx) => {
      const el = await waitForElement(selector, { visible: false });
      ctx.vars[varName] = el.getAttribute(attr);
    },
    getUrl: async ({ varName }, ctx) => {
      ctx.vars[varName] = location.href;
    },
    alert: async ({ message }, ctx) => {
      alert(renderTemplate(message, ctx.vars));
    },
    openTab: async ({ url }) => {
      await openOrFocusTab(url);
    },
    runScript: async ({ code }, ctx) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('ctx', 'vars', code);
      await fn(ctx, ctx.vars);
    },
  };

  function renderTemplate(str, vars) {
    return str.replace(/\$\{?(\w+)\}?/g, (_, k) => vars[k] ?? '');
  }

  const vars = {};

  async function getUrl(varName) {
    const url = location.href;
    if (varName) vars[varName] = url;
    return url;
  }

  async function openTab(url) {
    return openOrFocusTab(url);
  }

  async function executeWorkflow(steps) {
    const ctx = { vars };
    for (const step of steps) {
      const action = ACTIONS[step.type];
      if (!action) throw new Error('Unknown step type: ' + step.type);
      await action(step, ctx);
    }
    return ctx.vars;
  }

  /* ------------------------------------------------- export */
  root.WF = {
    bridge,
    waitForElement,
    openOrFocusTab,
    switchToTabUrl,
    switchToTabId,
    getTabId,
    getUrl,
    openTab,
    vars,
    delay,
    executeWorkflow,
  };
})(unsafeWindow || window);
