// ==UserScript==
// @name         Friends Average for Letterboxd
// @namespace    https://github.com/frozenpandaman
// @version      1.2
// @description  Shows a histogram and ratings average for just the users you follow, in addition to the global one
// @author       eli / frozenpandaman
// @match        https://letterboxd.com/film/*
// @icon         https://letterboxd.com/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @run-at       document-end
// ==/UserScript==

// This userscript is a port of the "Friends Average for Letterboxd" Chrome extension by Klaspas
// Created using https://github.com/Explosion-Scratch/to-userscript

console.log("Script start:",performance.now());const e=!0,t=e=>e,o="passthrough";let s,c={createHTML:t,createScript:t,createScriptURL:t},i=!1;const r=()=>{try{void 0!==window.isSecureContext&&window.isSecureContext&&window.trustedTypes&&window.trustedTypes.createPolicy&&(i=!0,trustedTypes.defaultPolicy?(l("TT Default Policy exists"),c=window.trustedTypes.createPolicy("default",c),s=trustedTypes.defaultPolicy,l(`Created custom passthrough policy, in case the default policy is too restrictive: Use Policy '${o}' in var 'TTP':`,c)):s=c=window.trustedTypes.createPolicy("default",c),l("Trusted-Type Policies: TTP:",c,"TTP_default:",s))}catch(e){l(e)}},l=(...e)=>{console.log(...e)};r();

(function() {
    // #region Logging

      const SCRIPT_NAME = "Friends Average for Letterboxd";
      const _log = (...args) => {};
      const _warn = (...args) => console.warn(`[${typeof SCRIPT_NAME === 'string' ? SCRIPT_NAME : '[USERSCRIPT_CONVERTED]'}]`, ...args);
      const _error = (...args) => {
        let e = args[0];
        console.error(`[${typeof SCRIPT_NAME === 'string' ? SCRIPT_NAME : '[USERSCRIPT_CONVERTED]'}]`, ...args);
      }

    // #endregion
    // #region Unified Polyfill

// #region Messaging implementation

        function createEventBus(
          scopeId,
          type = "page", // "page" or "iframe"
          { allowedOrigin = "*", children = [], parentWindow = null } = {}
        ) {
          if (!scopeId) throw new Error("createEventBus requires a scopeId");

          const handlers = {};

          function handleIncoming(ev) {
            if (allowedOrigin !== "*" && ev.origin !== allowedOrigin) return;

            const msg = ev.data;
            if (!msg || msg.__eventBus !== true || msg.scopeId !== scopeId) return;

            const { event, payload } = msg;

            // PAGE: if it's an INIT from an iframe, adopt it
            if (type === "page" && event === "__INIT__") {
              const win = ev.source;
              if (win && !children.includes(win)) {
                children.push(win);
              }
              return;
            }

            (handlers[event] || []).forEach((fn) =>
              fn(payload, { origin: ev.origin, source: ev.source })
            );
          }

          window.addEventListener("message", handleIncoming);

          function emitTo(win, event, payload) {
            const envelope = {
              __eventBus: true,
              scopeId,
              event,
              payload,
            };
            win.postMessage(envelope, allowedOrigin);
          }

          // IFRAME: announce to page on startup
          if (type === "iframe") {
            setTimeout(() => {
              const pw = parentWindow || window.parent;
              if (pw && pw.postMessage) {
                emitTo(pw, "__INIT__", null);
              }
            }, 0);
          }

          return {
            on(event, fn) {
              handlers[event] = handlers[event] || [];
              handlers[event].push(fn);
            },
            off(event, fn) {
              if (!handlers[event]) return;
              handlers[event] = handlers[event].filter((h) => h !== fn);
            },
            /**
             * Emits an event.
             * @param {string} event - The event name.
             * @param {any} payload - The event payload.
             * @param {object} [options] - Emission options.
             * @param {Window} [options.to] - A specific window to target. If provided, message is ONLY sent to the target.
             */
            emit(event, payload, { to } = {}) {
              // If a specific target window is provided, send only to it and DO NOT dispatch locally.
              // This prevents a port from receiving its own messages.
              if (to) {
                if (to && typeof to.postMessage === "function") {
                  emitTo(to, event, payload);
                }
                return; // Exit after targeted send.
              }

              // For broadcast messages (no 'to' target), dispatch locally first.
              (handlers[event] || []).forEach((fn) =>
                fn(payload, { origin: location.origin, source: window })
              );

              // Then propagate the broadcast to other windows.
              if (type === "page") {
                children.forEach((win) => emitTo(win, event, payload));
              } else {
                const pw = parentWindow || window.parent;
                if (pw && pw.postMessage) {
                  emitTo(pw, event, payload);
                }
              }
            },
          };
        }

        function createRuntime(type = "background", bus) {
          let nextId = 1;
          const pending = {};
          const msgListeners = [];

          let nextPortId = 1;
          const ports = {};
          const onConnectListeners = [];

          function parseArgs(args) {
            let target, message, options, callback;
            const arr = [...args];
            if (arr.length === 0) {
              throw new Error("sendMessage requires at least one argument");
            }
            if (arr.length === 1) {
              return { message: arr[0] };
            }
            // last object could be options
            if (
              arr.length &&
              typeof arr[arr.length - 1] === "object" &&
              !Array.isArray(arr[arr.length - 1])
            ) {
              options = arr.pop();
            }
            // last function is callback
            if (arr.length && typeof arr[arr.length - 1] === "function") {
              callback = arr.pop();
            }
            if (
              arr.length === 2 &&
              (typeof arr[0] === "string" || typeof arr[0] === "number")
            ) {
              [target, message] = arr;
            } else {
              [message] = arr;
            }
            return { target, message, options, callback };
          }

          if (type === "background") {
            bus.on("__REQUEST__", ({ id, message }, { source }) => {
              let responded = false,
                isAsync = false;
              function sendResponse(resp) {
                if (responded) return;
                responded = true;
                // Target the response directly back to the window that sent the request.
                bus.emit("__RESPONSE__", { id, response: resp }, { to: source });
              }
              const results = msgListeners
                .map((fn) => {
                  try {
                    // msg, sender, sendResponse
                    const ret = fn(message, { id, tab: { id: source } }, sendResponse);
                    if (ret === true || (ret && typeof ret.then === "function")) {
                      isAsync = true;
                      return ret;
                    }
                    return ret;
                  } catch (e) {
                    _error(e);
                  }
                })
                .filter((r) => r !== undefined);

              const promises = results.filter((r) => r && typeof r.then === "function");
              if (!isAsync && promises.length === 0) {
                const out = results.length === 1 ? results[0] : results;
                sendResponse(out);
              } else if (promises.length) {
                Promise.all(promises).then((vals) => {
                  if (!responded) {
                    const out = vals.length === 1 ? vals[0] : vals;
                    sendResponse(out);
                  }
                });
              }
            });
          }

          if (type !== "background") {
            bus.on("__RESPONSE__", ({ id, response }) => {
              const entry = pending[id];
              if (!entry) return;
              entry.resolve(response);
              if (entry.callback) entry.callback(response);
              delete pending[id];
            });
          }

          function sendMessage(...args) {
            // Background should be able to send message to itself
            // if (type === "background") {
            //   throw new Error("Background cannot sendMessage to itself");
            // }
            const { target, message, callback } = parseArgs(args);
            const id = nextId++;
            const promise = new Promise((resolve) => {
              pending[id] = { resolve, callback };
              bus.emit("__REQUEST__", { id, message });
            });
            return promise;
          }

          bus.on("__PORT_CONNECT__", ({ portId, name }, { source }) => {
            if (type !== "background") return;
            const backgroundPort = makePort("background", portId, name, source);
            ports[portId] = backgroundPort;

            onConnectListeners.forEach((fn) => fn(backgroundPort));

            // send back a CONNECT_ACK so the client can
            // start listening on its end:
            bus.emit("__PORT_CONNECT_ACK__", { portId, name }, { to: source });
          });

          // Clients handle the ACK and finalize their Port object by learning the remote window.
          bus.on("__PORT_CONNECT_ACK__", ({ portId, name }, { source }) => {
            if (type === "background") return; // ignore
            const p = ports[portId];
            if (!p) return;
            // Call the port's internal finalize method to complete the handshake
            if (p._finalize) {
              p._finalize(source);
            }
          });

          // Any port message travels via "__PORT_MESSAGE__"
          bus.on("__PORT_MESSAGE__", (envelope, { source }) => {
            const { portId } = envelope;
            const p = ports[portId];
            if (!p) return;
            p._receive(envelope, source);
          });

          // Any port disconnect:
          bus.on("__PORT_DISCONNECT__", ({ portId }) => {
            const p = ports[portId];
            if (!p) return;
            p._disconnect();
            delete ports[portId];
          });

          // Refactored makePort to correctly manage internal state and the connection handshake.
          function makePort(side, portId, name, remoteWindow) {
            let onMessageHandlers = [];
            let onDisconnectHandlers = [];
            let buffer = [];
            // Unique instance ID for this port instance
            const instanceId = Math.random().toString(36).slice(2) + Date.now();
            // These state variables are part of the closure and are updated by _finalize
            let _ready = side === "background";

            function _drainBuffer() {
              buffer.forEach((m) => _post(m));
              buffer = [];
            }

            function _post(msg) {
              // Always use the 'to' parameter for port messages, making them directional.
              // Include senderInstanceId
              bus.emit(
                "__PORT_MESSAGE__",
                { portId, msg, senderInstanceId: instanceId },
                { to: remoteWindow }
              );
            }

            function postMessage(msg) {
              if (!_ready) {
                buffer.push(msg);
              } else {
                _post(msg);
              }
            }

            function _receive(envelope, source) {
              // envelope: { msg, senderInstanceId }
              if (envelope.senderInstanceId === instanceId) return; // Don't dispatch to self
              onMessageHandlers.forEach((fn) =>
                fn(envelope.msg, { id: portId, tab: { id: source } })
              );
            }

            function disconnect() {
              // Also use the 'to' parameter for disconnect messages
              bus.emit("__PORT_DISCONNECT__", { portId }, { to: remoteWindow });
              _disconnect();
              delete ports[portId];
            }

            function _disconnect() {
              onDisconnectHandlers.forEach((fn) => fn());
              onMessageHandlers = [];
              onDisconnectHandlers = [];
            }

            // This function is called on the client port when the ACK is received from background.
            // It updates the port's state, completing the connection.
            function _finalize(win) {
              remoteWindow = win; // <-- This is the crucial part: learn the destination
              _ready = true;
              _drainBuffer();
            }

            return {
              name,
              sender: {
                id: portId,
              },
              onMessage: {
                addListener(fn) {
                  onMessageHandlers.push(fn);
                },
                removeListener(fn) {
                  onMessageHandlers = onMessageHandlers.filter((x) => x !== fn);
                },
              },
              onDisconnect: {
                addListener(fn) {
                  onDisconnectHandlers.push(fn);
                },
                removeListener(fn) {
                  onDisconnectHandlers = onDisconnectHandlers.filter((x) => x !== fn);
                },
              },
              postMessage,
              disconnect,
              // Internal methods used by the runtime
              _receive,
              _disconnect,
              _finalize, // Expose the finalizer for the ACK handler
            };
          }

          function connect(connectInfo = {}) {
            if (type === "background") {
              throw new Error("Background must use onConnect, not connect()");
            }
            const name = connectInfo.name || "";
            const portId = nextPortId++;
            // create the client side port
            // remoteWindow is initially null; it will be set by _finalize upon ACK.
            const clientPort = makePort("client", portId, name, null);
            ports[portId] = clientPort;

            // fire the connect event across the bus
            bus.emit("__PORT_CONNECT__", { portId, name });
            return clientPort;
          }

          function onConnect(fn) {
            if (type !== "background") {
              throw new Error("connect event only fires in background");
            }
            onConnectListeners.push(fn);
          }

          return {
            // rpc:
            sendMessage,
            onMessage: {
              addListener(fn) {
                msgListeners.push(fn);
              },
              removeListener(fn) {
                const i = msgListeners.indexOf(fn);
                if (i >= 0) msgListeners.splice(i, 1);
              },
            },

            // port API:
            connect,
            onConnect: {
              addListener(fn) {
                onConnect(fn);
              },
              removeListener(fn) {
                const i = onConnectListeners.indexOf(fn);
                if (i >= 0) onConnectListeners.splice(i, 1);
              },
            },
          };
        }


// #region Abstraction layer Handle postmesage for
            (function () {
              const pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }
              let nextRequestId = 1;

              window.addEventListener("message", async (event) => {
                const { type, requestId, method, args } = event.data;

                if (type === "abstraction-request") {
                  try {
                    let result;

                    switch (method) {
                      case "_storageSet":
                        result = await _storageSet(args[0]);
                        break;
                      case "_storageGet":
                        result = await _storageGet(args[0]);
                        break;
                      case "_storageRemove":
                        result = await _storageRemove(args[0]);
                        break;
                      case "_storageClear":
                        result = await _storageClear();
                        break;
                      case "_cookieList":
                        result = await _cookieList(args[0]);
                        break;
                      case "_cookieSet":
                        result = await _cookieSet(args[0]);
                        break;
                      case "_cookieDelete":
                        result = await _cookieDelete(args[0]);
                        break;
                      case "_fetch":
                        result = await _fetch(args[0], args[1]);
                        break;
                      case "_registerMenuCommand":
                        result = _registerMenuCommand(args[0], args[1]);
                        break;
                      case "_openTab":
                        result = _openTab(args[0], args[1]);
                        break;
                      case "_initStorage":
                        result = await _initStorage();
                        break;
                      default:
                        throw new Error(`Unknown abstraction method: ${method}`);
                    }

                    event.source.postMessage({
                      type: "abstraction-response",
                      requestId,
                      success: true,
                      result,
                    });
                  } catch (error) {
                    event.source.postMessage({
                      type: "abstraction-response",
                      requestId,
                      success: false,
                      error: {
                        message: error.message,
                        stack: error.stack,
                      },
                    });
                  }
                }
              });

              _log("[PostMessage Handler] Abstraction layer message handler initialized");
            })();


// #endregion
// #region Abstraction Layer Userscript Target

            async function _storageSet(items) {
              try {
                for (const key in items) {
                  if (items.hasOwnProperty(key)) {
                    await GM_setValue(key, items[key]);
                  }
                }
                return Promise.resolve();
              } catch (e) {
                _error("GM_setValue error:", e);
                return Promise.reject(e);
              }
            }

            async function _storageGet(keys) {
              if (!keys) {
                keys = null;
              }
              if (
                Array.isArray(keys) &&
                (keys.length === 0 || [null, undefined].includes(keys[0]))
              ) {
                keys = null;
              }
              try {
                const results = {};
                let keyList = [];
                let defaults = {};
                let requestedKeys = [];

                if (keys === null) {
                  keyList = await GM_listValues();
                  requestedKeys = [...keyList];
                } else if (typeof keys === "string") {
                  keyList = [keys];
                  requestedKeys = [keys];
                } else if (Array.isArray(keys)) {
                  keyList = keys;
                  requestedKeys = [...keys];
                } else if (typeof keys === "object" && keys !== null) {
                  keyList = Object.keys(keys);
                  requestedKeys = [...keyList];
                  defaults = keys;
                } else {
                  _error("_storageGet error: Invalid keys format", keys);
                  return Promise.reject(new Error("Invalid keys format for get"));
                }

                for (const key of keyList) {
                  const defaultValue = defaults.hasOwnProperty(key)
                    ? defaults[key]
                    : undefined;
                  const storedValue = await GM_getValue(key, defaultValue);
                  results[key] = storedValue;
                }

                const finalResult = {};
                for (const key of requestedKeys) {
                  if (results.hasOwnProperty(key)) {
                    finalResult[key] = results[key];
                  } else if (defaults.hasOwnProperty(key)) {
                    finalResult[key] = defaults[key];
                  }
                }

                return Promise.resolve(finalResult);
              } catch (e) {
                _error("GM_getValue/GM_listValues error:", e);
                return Promise.reject(e);
              }
            }

            async function _storageRemove(keysToRemove) {
              try {
                let keyList = [];
                if (typeof keysToRemove === "string") {
                  keyList = [keysToRemove];
                } else if (Array.isArray(keysToRemove)) {
                  keyList = keysToRemove;
                } else {
                  _error("_storageRemove error: Invalid keys format", keysToRemove);
                  return Promise.reject(new Error("Invalid keys format for remove"));
                }

                for (const key of keyList) {
                  await GM_deleteValue(key);
                }
                return Promise.resolve();
              } catch (e) {
                _error("GM_deleteValue error:", e);
                return Promise.reject(e);
              }
            }

            async function _storageClear() {
              try {
                const keys = await GM_listValues();
                await Promise.all(keys.map((key) => GM_deleteValue(key)));
                return Promise.resolve();
              } catch (e) {
                _error("GM_listValues/GM_deleteValue error during clear:", e);
                return Promise.reject(e);
              }
            }

            async function _cookieList(details) {
              return new Promise((resolve, reject) => {
                if (typeof GM_cookie === "undefined" || !GM_cookie.list) {
                  return reject(new Error("GM_cookie.list is not available."));
                }
                GM_cookie.list(details, (cookies, error) => {
                  if (error) {
                    return reject(new Error(error));
                  }
                  resolve(cookies);
                });
              });
            }

            async function _cookieSet(details) {
              return new Promise((resolve, reject) => {
                if (typeof GM_cookie === "undefined" || !GM_cookie.set) {
                  return reject(new Error("GM_cookie.set is not available."));
                }
                GM_cookie.set(details, (error) => {
                  if (error) {
                    return reject(new Error(error));
                  }
                  resolve();
                });
              });
            }

            async function _cookieDelete(details) {
              return new Promise((resolve, reject) => {
                if (typeof GM_cookie === "undefined" || !GM_cookie.delete) {
                  return reject(new Error("GM_cookie.delete is not available."));
                }
                GM_cookie.delete(details, (error) => {
                  if (error) {
                    return reject(new Error(error));
                  }
                  resolve();
                });
              });
            }

            async function _fetch(url, options = {}) {
              return new Promise((resolve, reject) => {
                try {
                  GM_xmlhttpRequest({
                    method: options.method || "GET",
                    url: url,
                    headers: options.headers || {},
                    data: options.body,
                    responseType: options.responseType,
                    timeout: options.timeout || 0,
                    binary:
                      options.responseType === "blob" ||
                      options.responseType === "arraybuffer",
                    onload: function (response) {
                      const responseHeaders = {};
                      if (response.responseHeaders) {
                        response.responseHeaders
                          .trim()
                          .split("\\r\\n")
                          .forEach((header) => {
                            const parts = header.match(/^([^:]+):\s*(.*)$/);
                            if (parts && parts.length === 3) {
                              responseHeaders[parts[1].toLowerCase()] = parts[2];
                            }
                          });
                      }

                      const mockResponse = {
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status,
                        statusText:
                          response.statusText ||
                          (response.status >= 200 && response.status < 300 ? "OK" : ""),
                        url: response.finalUrl || url,
                        headers: new Headers(responseHeaders),
                        text: () => Promise.resolve(response.responseText),
                        json: () => {
                          try {
                            return Promise.resolve(JSON.parse(response.responseText));
                          } catch (e) {
                            return Promise.reject(new SyntaxError("Could not parse JSON"));
                          }
                        },
                        blob: () => {
                          if (response.response instanceof Blob) {
                            return Promise.resolve(response.response);
                          }
                          return Promise.reject(
                            new Error("Requires responseType:'blob' in GM_xmlhttpRequest")
                          );
                        },
                        arrayBuffer: () => {
                          if (response.response instanceof ArrayBuffer) {
                            return Promise.resolve(response.response);
                          }
                          return Promise.reject(
                            new Error(
                              "Requires responseType:'arraybuffer' in GM_xmlhttpRequest"
                            )
                          );
                        },
                        clone: function () {
                          const cloned = { ...this };
                          cloned.text = () => Promise.resolve(response.responseText);
                          cloned.json = () => this.json();
                          cloned.blob = () => this.blob();
                          cloned.arrayBuffer = () => this.arrayBuffer();
                          return cloned;
                        },
                      };

                      if (mockResponse.ok) {
                        resolve(mockResponse);
                      } else {
                        const error = new Error(`HTTP error! status: ${response.status}`);
                        error.response = mockResponse;
                        reject(error);
                      }
                    },
                    onerror: function (response) {
                      reject(
                        new Error(
                          `GM_xmlhttpRequest network error: ${
                            response.statusText || "Unknown Error"
                          }`
                        )
                      );
                    },
                    onabort: function () {
                      reject(new Error("GM_xmlhttpRequest aborted"));
                    },
                    ontimeout: function () {
                      reject(new Error("GM_xmlhttpRequest timed out"));
                    },
                  });
                } catch (e) {
                  _error("_fetch (GM_xmlhttpRequest) error:", e);
                  reject(e);
                }
              });
            }

            function _registerMenuCommand(name, func) {
              if (typeof GM_registerMenuCommand === "function") {
                try {
                  GM_registerMenuCommand(name, func);
                } catch (e) {
                  _error("GM_registerMenuCommand failed:", e);
                }
              } else {
                _warn("GM_registerMenuCommand not available.");
              }
            }

            function _openTab(url, active) {
              if (typeof GM_openInTab === "function") {
                try {
                  GM_openInTab(url, { loadInBackground: !active });
                } catch (e) {
                  _error("GM_openInTab failed:", e);
                }
              } else {
                _warn("GM_openInTab not available, using window.open as fallback.");
                try {
                  window.open(url);
                } catch (e) {
                  _error("window.open fallback failed:", e);
                }
              }
            }

            async function _initStorage() {
              return Promise.resolve();
            }


            const EXTENSION_ASSETS_MAP = {};

// #endregion
// #endregion
// #region Polyfill Implementation
        function buildPolyfill({ isBackground = false, isOtherPage = false } = {}) {
          // Generate a unique context ID for this polyfill instance
          const contextType = isBackground
            ? "background"
            : isOtherPage
              ? "options"
              : "content";
          const contextId = `${contextType}_${Math.random()
            .toString(36)
            .substring(2, 15)}`;

          const IS_IFRAME = "false" === "true";
          const BUS = (function () {
            if (globalThis.__BUS) {
              return globalThis.__BUS;
            }
            globalThis.__BUS = createEventBus(
              "friends-average-for-letterboxd",
              IS_IFRAME ? "iframe" : "page",
            );
            return globalThis.__BUS;
          })();
          const RUNTIME = createRuntime(isBackground ? "background" : "tab", BUS);
          const createNoopListeners = () => ({
            addListener: (callback) => {
              _log("addListener", callback);
            },
            removeListener: (callback) => {
              _log("removeListener", callback);
            },
          });
          // TODO: Stub
          const storageChangeListeners = new Set();
          function broadcastStorageChange(changes, areaName) {
            storageChangeListeners.forEach((listener) => {
              listener(changes, areaName);
            });
          }

          let REQ_PERMS = [];

  // #region Chrome polyfill
              let chrome = {
                extension: {
                  isAllowedIncognitoAccess: () => Promise.resolve(true),
                  sendMessage: (...args) => _messagingHandler.sendMessage(...args),
                },
                permissions: {
                  // TODO: Remove origin permission means exclude from origin in startup (when checking for content scripts)
                  request: (permissions, callback) => {
                    _log("permissions.request", permissions, callback);
                    if (Array.isArray(permissions)) {
                      REQ_PERMS = [...REQ_PERMS, ...permissions];
                    }
                    if (typeof callback === "function") {
                      callback(permissions);
                    }
                    return Promise.resolve(permissions);
                  },
                  contains: (permissions, callback) => {
                    if (typeof callback === "function") {
                      callback(true);
                    }
                    return Promise.resolve(true);
                  },
                  getAll: () => {
                    return Promise.resolve({
                      permissions: EXTENSION_PERMISSIONS,
                      origins: ORIGIN_PERMISSIONS,
                    });
                  },
                  onAdded: createNoopListeners(),
                  onRemoved: createNoopListeners(),
                },
                i18n: {
                  getUILanguage: () => {
                    return USED_LOCALE || "en";
                  },
                  getMessage: (key, substitutions = []) => {
                    if (typeof substitutions === "string") {
                      substitutions = [substitutions];
                    }
                    if (typeof LOCALE_KEYS !== "undefined" && LOCALE_KEYS[key]) {
                      return LOCALE_KEYS[key].message?.replace(
                        /\$(\d+)/g,
                        (match, p1) => substitutions[p1 - 1] || match,
                      );
                    }
                    return key;
                  },
                },
                alarms: {
                  onAlarm: createNoopListeners(),
                  create: () => {
                    _log("alarms.create", arguments);
                  },
                  get: () => {
                    _log("alarms.get", arguments);
                  },
                },
                runtime: {
                  ...RUNTIME,
                  onInstalled: createNoopListeners(),
                  onStartup: createNoopListeners(),
                  // TODO: Postmessage to parent to open options page or call openOptionsPage
                  openOptionsPage: () => {
                    // const url = chrome.runtime.getURL(OPTIONS_PAGE_PATH);
                    // console.log("openOptionsPage", _openTab, url, EXTENSION_ASSETS_MAP);
                    // _openTab(url);
                    if (typeof openOptionsPage === "function") {
                      openOptionsPage();
                    } else if (window.parent) {
                      window.parent.postMessage({ type: "openOptionsPage" }, "*");
                    } else {
                      _warn("openOptionsPage not available.");
                    }
                  },
                  getManifest: () => {
                    // The manifest object will be injected into the scope where buildPolyfill is called
                    if (typeof INJECTED_MANIFEST !== "undefined") {
                      return JSON.parse(JSON.stringify(INJECTED_MANIFEST)); // Return deep copy
                    }
                    _warn("INJECTED_MANIFEST not found for chrome.runtime.getManifest");
                    return { name: "Unknown", version: "0.0", manifest_version: 2 };
                  },
                  getURL: (path) => {
                    if (!path) return "";
                    if (path.startsWith("/")) {
                      path = path.substring(1);
                    }

                    if (typeof _createAssetUrl === "function") {
                      return _createAssetUrl(path);
                    }

                    _warn(
                      `chrome.runtime.getURL fallback for '${path}'. Assets may not be available.`,
                    );
                    // Attempt a relative path resolution (highly context-dependent and likely wrong)
                    try {
                      if (window.location.protocol.startsWith("http")) {
                        return new URL(path, window.location.href).toString();
                      }
                    } catch (e) {
                      /* ignore error, fallback */
                    }
                    return path;
                  },
                  id: "polyfilled-extension-" + Math.random().toString(36).substring(2, 15),
                  lastError: null,
                  setUninstallURL: () => {},
                  setUpdateURL: () => {},
                  getPlatformInfo: async () => {
                    const platform = {
                      os: "unknown",
                      arch: "unknown",
                      nacl_arch: "unknown",
                    };

                    if (typeof navigator !== "undefined") {
                      const userAgent = navigator.userAgent.toLowerCase();
                      if (userAgent.includes("mac")) platform.os = "mac";
                      else if (userAgent.includes("win")) platform.os = "win";
                      else if (userAgent.includes("linux")) platform.os = "linux";
                      else if (userAgent.includes("android")) platform.os = "android";
                      else if (userAgent.includes("ios")) platform.os = "ios";

                      if (userAgent.includes("x86_64") || userAgent.includes("amd64")) {
                        platform.arch = "x86-64";
                      } else if (userAgent.includes("i386") || userAgent.includes("i686")) {
                        platform.arch = "x86-32";
                      } else if (userAgent.includes("arm")) {
                        platform.arch = "arm";
                      }
                    }

                    return platform;
                  },
                  getBrowserInfo: async () => {
                    const info = {
                      name: "unknown",
                      version: "unknown",
                      buildID: "unknown",
                    };

                    if (typeof navigator !== "undefined") {
                      const userAgent = navigator.userAgent;
                      if (userAgent.includes("Chrome")) {
                        info.name = "Chrome";
                        const match = userAgent.match(/Chrome\/([0-9.]+)/);
                        if (match) info.version = match[1];
                      } else if (userAgent.includes("Firefox")) {
                        info.name = "Firefox";
                        const match = userAgent.match(/Firefox\/([0-9.]+)/);
                        if (match) info.version = match[1];
                      } else if (userAgent.includes("Safari")) {
                        info.name = "Safari";
                        const match = userAgent.match(/Version\/([0-9.]+)/);
                        if (match) info.version = match[1];
                      }
                    }

                    return info;
                  },
                },
                storage: {
                  local: {
                    get: function (keys, callback) {
                      if (typeof _storageGet !== "function")
                        throw new Error("_storageGet not defined");

                      const promise = _storageGet(keys);

                      if (typeof callback === "function") {
                        promise
                          .then((result) => {
                            try {
                              callback(result);
                            } catch (e) {
                              _error("Error in storage.get callback:", e);
                            }
                          })
                          .catch((error) => {
                            _error("Storage.get error:", error);
                            callback({});
                          });
                        return;
                      }

                      return promise;
                    },
                    set: function (items, callback) {
                      if (typeof _storageSet !== "function")
                        throw new Error("_storageSet not defined");

                      const promise = _storageSet(items).then((result) => {
                        broadcastStorageChange(items, "local");
                        return result;
                      });

                      if (typeof callback === "function") {
                        promise
                          .then((result) => {
                            try {
                              callback(result);
                            } catch (e) {
                              _error("Error in storage.set callback:", e);
                            }
                          })
                          .catch((error) => {
                            _error("Storage.set error:", error);
                            callback();
                          });
                        return;
                      }

                      return promise;
                    },
                    remove: function (keys, callback) {
                      if (typeof _storageRemove !== "function")
                        throw new Error("_storageRemove not defined");

                      const promise = _storageRemove(keys).then((result) => {
                        const changes = {};
                        const keyList = Array.isArray(keys) ? keys : [keys];
                        keyList.forEach((key) => {
                          changes[key] = { oldValue: undefined, newValue: undefined };
                        });
                        broadcastStorageChange(changes, "local");
                        return result;
                      });

                      if (typeof callback === "function") {
                        promise
                          .then((result) => {
                            try {
                              callback(result);
                            } catch (e) {
                              _error("Error in storage.remove callback:", e);
                            }
                          })
                          .catch((error) => {
                            _error("Storage.remove error:", error);
                            callback();
                          });
                        return;
                      }

                      return promise;
                    },
                    clear: function (callback) {
                      if (typeof _storageClear !== "function")
                        throw new Error("_storageClear not defined");

                      const promise = _storageClear().then((result) => {
                        broadcastStorageChange({}, "local");
                        return result;
                      });

                      if (typeof callback === "function") {
                        promise
                          .then((result) => {
                            try {
                              callback(result);
                            } catch (e) {
                              _error("Error in storage.clear callback:", e);
                            }
                          })
                          .catch((error) => {
                            _error("Storage.clear error:", error);
                            callback();
                          });
                        return;
                      }

                      return promise;
                    },
                    onChanged: {
                      addListener: (callback) => {
                        storageChangeListeners.add(callback);
                      },
                      removeListener: (callback) => {
                        storageChangeListeners.delete(callback);
                      },
                    },
                  },
                  sync: {
                    get: function (keys, callback) {
                      _warn("chrome.storage.sync polyfill maps to local");
                      return chrome.storage.local.get(keys, callback);
                    },
                    set: function (items, callback) {
                      _warn("chrome.storage.sync polyfill maps to local");

                      const promise = chrome.storage.local.set(items).then((result) => {
                        broadcastStorageChange(items, "sync");
                        return result;
                      });

                      if (typeof callback === "function") {
                        promise
                          .then((result) => {
                            try {
                              callback(result);
                            } catch (e) {
                              _error("Error in storage.sync.set callback:", e);
                            }
                          })
                          .catch((error) => {
                            _error("Storage.sync.set error:", error);
                            callback();
                          });
                        return;
                      }

                      return promise;
                    },
                    remove: function (keys, callback) {
                      _warn("chrome.storage.sync polyfill maps to local");

                      const promise = chrome.storage.local.remove(keys).then((result) => {
                        const changes = {};
                        const keyList = Array.isArray(keys) ? keys : [keys];
                        keyList.forEach((key) => {
                          changes[key] = { oldValue: undefined, newValue: undefined };
                        });
                        broadcastStorageChange(changes, "sync");
                        return result;
                      });

                      if (typeof callback === "function") {
                        promise
                          .then((result) => {
                            try {
                              callback(result);
                            } catch (e) {
                              _error("Error in storage.sync.remove callback:", e);
                            }
                          })
                          .catch((error) => {
                            _error("Storage.sync.remove error:", error);
                            callback();
                          });
                        return;
                      }

                      return promise;
                    },
                    clear: function (callback) {
                      _warn("chrome.storage.sync polyfill maps to local");

                      const promise = chrome.storage.local.clear().then((result) => {
                        broadcastStorageChange({}, "sync");
                        return result;
                      });

                      if (typeof callback === "function") {
                        promise
                          .then((result) => {
                            try {
                              callback(result);
                            } catch (e) {
                              _error("Error in storage.sync.clear callback:", e);
                            }
                          })
                          .catch((error) => {
                            _error("Storage.sync.clear error:", error);
                            callback();
                          });
                        return;
                      }

                      return promise;
                    },
                    onChanged: {
                      addListener: (callback) => {
                        storageChangeListeners.add(callback);
                      },
                      removeListener: (callback) => {
                        storageChangeListeners.delete(callback);
                      },
                    },
                  },
                  onChanged: {
                    addListener: (callback) => {
                      storageChangeListeners.add(callback);
                    },
                    removeListener: (callback) => {
                      storageChangeListeners.delete(callback);
                    },
                  },
                  managed: {
                    get: function (keys, callback) {
                      _warn("chrome.storage.managed polyfill is read-only empty.");

                      const promise = Promise.resolve({});

                      if (typeof callback === "function") {
                        promise.then((result) => {
                          try {
                            callback(result);
                          } catch (e) {
                            _error("Error in storage.managed.get callback:", e);
                          }
                        });
                        return;
                      }

                      return promise;
                    },
                  },
                },
                cookies: (function () {
                  const cookieChangeListeners = new Set();
                  function broadcastCookieChange(changeInfo) {
                    cookieChangeListeners.forEach((listener) => {
                      try {
                        listener(changeInfo);
                      } catch (e) {
                        _error("Error in cookies.onChanged listener:", e);
                      }
                    });
                  }

                  function handlePromiseCallback(promise, callback) {
                    if (typeof callback === "function") {
                      promise
                        .then((result) => callback(result))
                        .catch((error) => {
                          // chrome.runtime.lastError = { message: error.message }; // TODO: Implement lastError
                          _error(error);
                          callback(); // Call with undefined on error
                        });
                      return;
                    }
                    return promise;
                  }

                  return {
                    get: function (details, callback) {
                      if (typeof _cookieList !== "function") {
                        return handlePromiseCallback(
                          Promise.reject(new Error("_cookieList not defined")),
                          callback,
                        );
                      }
                      const promise = _cookieList({
                        url: details.url,
                        name: details.name,
                        storeId: details.storeId,
                        partitionKey: details.partitionKey,
                      }).then((cookies) => {
                        if (!cookies || cookies.length === 0) {
                          return null;
                        }
                        // Sort by path length (longest first), then creation time (earliest first, if available)
                        cookies.sort((a, b) => {
                          const pathLenDiff = (b.path || "").length - (a.path || "").length;
                          if (pathLenDiff !== 0) return pathLenDiff;
                          return (a.creationTime || 0) - (b.creationTime || 0);
                        });
                        return cookies[0];
                      });
                      return handlePromiseCallback(promise, callback);
                    },

                    getAll: function (details, callback) {
                      if (typeof _cookieList !== "function") {
                        return handlePromiseCallback(
                          Promise.reject(new Error("_cookieList not defined")),
                          callback,
                        );
                      }
                      if (details.partitionKey) {
                        _warn(
                          "cookies.getAll: partitionKey is not fully supported in this environment.",
                        );
                      }
                      const promise = _cookieList(details);
                      return handlePromiseCallback(promise, callback);
                    },

                    set: function (details, callback) {
                      const promise = (async () => {
                        if (
                          typeof _cookieSet !== "function" ||
                          typeof _cookieList !== "function"
                        ) {
                          throw new Error("_cookieSet or _cookieList not defined");
                        }
                        if (details.partitionKey) {
                          _warn(
                            "cookies.set: partitionKey is not fully supported in this environment.",
                          );
                        }

                        const getDetails = {
                          url: details.url,
                          name: details.name,
                          storeId: details.storeId,
                        };
                        const oldCookies = await _cookieList(getDetails);
                        const oldCookie = oldCookies && oldCookies[0];

                        if (oldCookie) {
                          broadcastCookieChange({
                            cause: "overwrite",
                            cookie: oldCookie,
                            removed: true,
                          });
                        }

                        await _cookieSet(details);
                        const newCookies = await _cookieList(getDetails);
                        const newCookie = newCookies && newCookies[0];

                        if (newCookie) {
                          broadcastCookieChange({
                            cause: "explicit",
                            cookie: newCookie,
                            removed: false,
                          });
                        }
                        return newCookie || null;
                      })();
                      return handlePromiseCallback(promise, callback);
                    },

                    remove: function (details, callback) {
                      const promise = (async () => {
                        if (
                          typeof _cookieDelete !== "function" ||
                          typeof _cookieList !== "function"
                        ) {
                          throw new Error("_cookieDelete or _cookieList not defined");
                        }
                        const oldCookies = await _cookieList(details);
                        const oldCookie = oldCookies && oldCookies[0];

                        if (!oldCookie) return null; // Nothing to remove

                        await _cookieDelete(details);

                        broadcastCookieChange({
                          cause: "explicit",
                          cookie: oldCookie,
                          removed: true,
                        });

                        return {
                          url: details.url,
                          name: details.name,
                          storeId: details.storeId || "0",
                          partitionKey: details.partitionKey,
                        };
                      })();
                      return handlePromiseCallback(promise, callback);
                    },

                    getAllCookieStores: function (callback) {
                      const promise = Promise.resolve([
                        { id: "0", tabIds: [1] }, // Mock store for the current context
                      ]);
                      return handlePromiseCallback(promise, callback);
                    },

                    getPartitionKey: function (details, callback) {
                      _warn(
                        "chrome.cookies.getPartitionKey is not supported in this environment.",
                      );
                      const promise = Promise.resolve({ partitionKey: {} }); // Return empty partition key
                      return handlePromiseCallback(promise, callback);
                    },

                    onChanged: {
                      addListener: (callback) => {
                        if (typeof callback === "function") {
                          cookieChangeListeners.add(callback);
                        }
                      },
                      removeListener: (callback) => {
                        cookieChangeListeners.delete(callback);
                      },
                    },
                  };
                })(),
                tabs: {
                  query: async (queryInfo) => {
                    _warn("chrome.tabs.query polyfill only returns current tab info.");
                    const dummyId = Math.floor(Math.random() * 1000) + 1;
                    return [
                      {
                        id: dummyId,
                        url: CURRENT_LOCATION,
                        active: true,
                        windowId: 1,
                        status: "complete",
                      },
                    ];
                  },
                  create: async ({ url, active = true }) => {
                    _log(`[Polyfill tabs.create] URL: ${url}`);
                    if (typeof _openTab !== "function")
                      throw new Error("_openTab not defined");
                    _openTab(url, active);
                    const dummyId = Math.floor(Math.random() * 1000) + 1001;
                    return Promise.resolve({
                      id: dummyId,
                      url: url,
                      active,
                      windowId: 1,
                    });
                  },
                  sendMessage: async (tabId, message) => {
                    _warn(
                      `chrome.tabs.sendMessage polyfill (to tab ${tabId}) redirects to runtime.sendMessage (current context).`,
                    );
                    return chrome.runtime.sendMessage(message);
                  },
                  onActivated: createNoopListeners(),
                  onUpdated: createNoopListeners(),
                  onRemoved: createNoopListeners(),
                  onReplaced: createNoopListeners(),
                  onCreated: createNoopListeners(),
                  onMoved: createNoopListeners(),
                  onDetached: createNoopListeners(),
                  onAttached: createNoopListeners(),
                },
                windows: {
                  onFocusChanged: createNoopListeners(),
                  onCreated: createNoopListeners(),
                  onRemoved: createNoopListeners(),
                  onFocused: createNoopListeners(),
                  onFocus: createNoopListeners(),
                  onBlur: createNoopListeners(),
                  onFocused: createNoopListeners(),
                },
                notifications: {
                  create: async (notificationId, options) => {
                    try {
                      let id = notificationId;
                      let notificationOptions = options;

                      if (typeof notificationId === "object" && notificationId !== null) {
                        notificationOptions = notificationId;
                        id = "notification_" + Math.random().toString(36).substring(2, 15);
                      } else if (typeof notificationId === "string" && options) {
                        id = notificationId;
                        notificationOptions = options;
                      } else {
                        throw new Error("Invalid parameters for notifications.create");
                      }

                      if (!notificationOptions || typeof notificationOptions !== "object") {
                        throw new Error("Notification options must be an object");
                      }

                      const {
                        title,
                        message,
                        iconUrl,
                        type = "basic",
                      } = notificationOptions;

                      if (!title || !message) {
                        throw new Error("Notification must have title and message");
                      }

                      if ("Notification" in window) {
                        if (Notification.permission === "granted") {
                          const notification = new Notification(title, {
                            body: message,
                            icon: iconUrl,
                            tag: id,
                          });

                          _log(`[Notifications] Created notification: ${id}`);
                          return id;
                        } else if (Notification.permission === "default") {
                          const permission = await Notification.requestPermission();
                          if (permission === "granted") {
                            const notification = new Notification(title, {
                              body: message,
                              icon: iconUrl,
                              tag: id,
                            });
                            _log(
                              `[Notifications] Created notification after permission: ${id}`,
                            );
                            return id;
                          } else {
                            _warn("[Notifications] Permission denied for notifications");
                            return id;
                          }
                        } else {
                          _warn("[Notifications] Notifications are blocked");
                          return id;
                        }
                      } else {
                        _warn(
                          "[Notifications] Native notifications not supported, using console fallback",
                        );
                        _log(`[Notification] ${title}: ${message}`);
                        return id;
                      }
                    } catch (error) {
                      _error("[Notifications] Error creating notification:", error.message);
                      throw error;
                    }
                  },
                  clear: async (notificationId) => {
                    _log(`[Notifications] Clear notification: ${notificationId}`);
                    // For native notifications, there's no direct way to clear by ID
                    // This is a limitation of the Web Notifications API
                    return true;
                  },
                  getAll: async () => {
                    _warn("[Notifications] getAll not fully supported in polyfill");
                    return {};
                  },
                  getPermissionLevel: async () => {
                    if ("Notification" in window) {
                      const permission = Notification.permission;
                      return { level: permission === "granted" ? "granted" : "denied" };
                    }
                    return { level: "denied" };
                  },
                },
                contextMenus: {
                  create: (createProperties, callback) => {
                    try {
                      if (!createProperties || typeof createProperties !== "object") {
                        throw new Error("Context menu create properties must be an object");
                      }

                      const { id, title, contexts = ["page"], onclick } = createProperties;
                      const menuId =
                        id || `menu_${Math.random().toString(36).substring(2, 15)}`;

                      if (!title || typeof title !== "string") {
                        throw new Error("Context menu must have a title");
                      }

                      // Store menu items for potential use
                      if (!window._polyfillContextMenus) {
                        window._polyfillContextMenus = new Map();
                      }

                      window._polyfillContextMenus.set(menuId, {
                        id: menuId,
                        title,
                        contexts,
                        onclick,
                        enabled: createProperties.enabled !== false,
                      });

                      _log(
                        `[ContextMenus] Created context menu item: ${title} (${menuId})`,
                      );

                      // Try to register a menu command as fallback
                      if (typeof _registerMenuCommand === "function") {
                        try {
                          _registerMenuCommand(
                            title,
                            onclick ||
                              (() => {
                                _log(`Context menu clicked: ${title}`);
                              }),
                          );
                        } catch (e) {
                          _warn(
                            "[ContextMenus] Failed to register as menu command:",
                            e.message,
                          );
                        }
                      }

                      if (callback && typeof callback === "function") {
                        setTimeout(() => callback(), 0);
                      }

                      return menuId;
                    } catch (error) {
                      _error("[ContextMenus] Error creating context menu:", error.message);
                      if (callback && typeof callback === "function") {
                        setTimeout(() => callback(), 0);
                      }
                      throw error;
                    }
                  },
                  update: (id, updateProperties, callback) => {
                    try {
                      if (
                        !window._polyfillContextMenus ||
                        !window._polyfillContextMenus.has(id)
                      ) {
                        throw new Error(`Context menu item not found: ${id}`);
                      }

                      const menuItem = window._polyfillContextMenus.get(id);
                      Object.assign(menuItem, updateProperties);

                      _log(`[ContextMenus] Updated context menu item: ${id}`);

                      if (callback && typeof callback === "function") {
                        setTimeout(() => callback(), 0);
                      }
                    } catch (error) {
                      _error("[ContextMenus] Error updating context menu:", error.message);
                      if (callback && typeof callback === "function") {
                        setTimeout(() => callback(), 0);
                      }
                    }
                  },
                  remove: (menuItemId, callback) => {
                    try {
                      if (
                        window._polyfillContextMenus &&
                        window._polyfillContextMenus.has(menuItemId)
                      ) {
                        window._polyfillContextMenus.delete(menuItemId);
                        _log(`[ContextMenus] Removed context menu item: ${menuItemId}`);
                      } else {
                        _warn(
                          `[ContextMenus] Context menu item not found for removal: ${menuItemId}`,
                        );
                      }

                      if (callback && typeof callback === "function") {
                        setTimeout(() => callback(), 0);
                      }
                    } catch (error) {
                      _error("[ContextMenus] Error removing context menu:", error.message);
                      if (callback && typeof callback === "function") {
                        setTimeout(() => callback(), 0);
                      }
                    }
                  },
                  removeAll: (callback) => {
                    try {
                      if (window._polyfillContextMenus) {
                        const count = window._polyfillContextMenus.size;
                        window._polyfillContextMenus.clear();
                        _log(`[ContextMenus] Removed all ${count} context menu items`);
                      }

                      if (callback && typeof callback === "function") {
                        setTimeout(() => callback(), 0);
                      }
                    } catch (error) {
                      _error(
                        "[ContextMenus] Error removing all context menus:",
                        error.message,
                      );
                      if (callback && typeof callback === "function") {
                        setTimeout(() => callback(), 0);
                      }
                    }
                  },
                  onClicked: {
                    addListener: (callback) => {
                      if (!window._polyfillContextMenuListeners) {
                        window._polyfillContextMenuListeners = new Set();
                      }
                      window._polyfillContextMenuListeners.add(callback);
                      _log("[ContextMenus] Added click listener");
                    },
                    removeListener: (callback) => {
                      if (window._polyfillContextMenuListeners) {
                        window._polyfillContextMenuListeners.delete(callback);
                        _log("[ContextMenus] Removed click listener");
                      }
                    },
                  },
                },
              };

              const tc = (fn) => {
                try {
                  fn();
                } catch (e) {}
              };
              const loggingProxyHandler = (_key) => ({
                get(target, key, receiver) {
                  tc(() => _log(`[${contextType}] [CHROME - ${_key}] Getting ${key}`));
                  return Reflect.get(target, key, receiver);
                },
                set(target, key, value, receiver) {
                  tc(() =>
                    _log(`[${contextType}] [CHROME - ${_key}] Setting ${key} to ${value}`),
                  );
                  return Reflect.set(target, key, value, receiver);
                },
                has(target, key) {
                  tc(() =>
                    _log(`[${contextType}] [CHROME - ${_key}] Checking if ${key} exists`),
                  );
                  return Reflect.has(target, key);
                },
              });
              chrome = Object.fromEntries(
                Object.entries(chrome).map(([key, value]) => [
                  key,
                  new Proxy(value, loggingProxyHandler(key)),
                ]),
              );

              // Alias browser to chrome for common Firefox pattern
              const browser = new Proxy(chrome, loggingProxyHandler);

              const oldGlobalThis = globalThis;
              const oldWindow = window;
              const oldSelf = self;
              const oldGlobal = globalThis;
              const __globalsStorage = {};

              const TO_MODIFY = [oldGlobalThis, oldWindow, oldSelf, oldGlobal];
              const set = (k, v) => {
                __globalsStorage[k] = v;
                TO_MODIFY.forEach((target) => {
                  target[k] = v;
                });
              };
              const proxyHandler = {
                get(target, key, receiver) {
                  const fns = [
                    () => __globalsStorage[key],
                    () => Reflect.get(target, key, target),
                    () => target[key],
                  ];
                  const out = fns
                    .map((f) => {
                      try {
                        let out = f();
                        return out;
                      } catch (e) {
                        return undefined;
                      }
                    })
                    .find((f) => f !== undefined);
                  if (typeof out === "function") {
                    return out.bind(target);
                  }
                  return out;
                },
                set(target, key, value, receiver) {
                  try {
                    tc(() => _log(`[${contextType}] Setting ${key} to ${value}`));
                    set(key, value);
                    return Reflect.set(target, key, value, receiver);
                  } catch (e) {
                    _error("Error setting", key, value, e);
                    try {
                      target[key] = value;
                      return true;
                    } catch (e) {
                      _error("Error setting", key, value, e);
                    }
                    return false;
                  }
                },
                has(target, key) {
                  try {
                    return key in __globalsStorage || key in target;
                  } catch (e) {
                    _error("Error has", key, e);
                    try {
                      return key in __globalsStorage || key in target;
                    } catch (e) {
                      _error("Error has", key, e);
                    }
                    return false;
                  }
                },
                getOwnPropertyDescriptor(target, key) {
                  try {
                    if (key in __globalsStorage) {
                      return {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: __globalsStorage[key],
                      };
                    }
                    // fall back to the real globalThis
                    const desc = Reflect.getOwnPropertyDescriptor(target, key);
                    // ensure it's configurable so the with‑scope binding logic can override it
                    if (desc && !desc.configurable) {
                      desc.configurable = true;
                    }
                    return desc;
                  } catch (e) {
                    _error("Error getOwnPropertyDescriptor", key, e);
                    return {
                      configurable: true,
                      enumerable: true,
                      writable: true,
                      value: undefined,
                    };
                  }
                },

                defineProperty(target, key, descriptor) {
                  try {
                    // Normalize descriptor to avoid mixed accessor & data attributes
                    const hasAccessor = "get" in descriptor || "set" in descriptor;

                    if (hasAccessor) {
                      // Build a clean descriptor without value/writable when accessors present
                      const normalized = {
                        configurable:
                          "configurable" in descriptor ? descriptor.configurable : true,
                        enumerable:
                          "enumerable" in descriptor ? descriptor.enumerable : false,
                      };
                      if ("get" in descriptor) normalized.get = descriptor.get;
                      if ("set" in descriptor) normalized.set = descriptor.set;

                      // Store accessor references for inspection but avoid breaking invariants
                      set(key, {
                        get: descriptor.get,
                        set: descriptor.set,
                      });

                      return Reflect.defineProperty(target, key, normalized);
                    }

                    // Data descriptor path
                    set(key, descriptor.value);
                    return Reflect.defineProperty(target, key, descriptor);
                  } catch (e) {
                    _error("Error defineProperty", key, descriptor, e);
                    return false;
                  }
                },
              };

              // Create proxies once proxyHandler is defined
              const proxyWindow = new Proxy(oldWindow, proxyHandler);
              const proxyGlobalThis = new Proxy(oldGlobalThis, proxyHandler);
              const proxyGlobal = new Proxy(oldGlobal, proxyHandler);
              const proxySelf = new Proxy(oldSelf, proxyHandler);

              // Seed storage with core globals so lookups succeed inside `with` blocks
              Object.assign(__globalsStorage, {
                chrome,
                browser,
                window: proxyWindow,
                globalThis: proxyGlobalThis,
                global: proxyGlobal,
                self: proxySelf,
                document: oldWindow.document,
              });

              const __globals = {
                chrome,
                browser,
                window: proxyWindow,
                globalThis: proxyGlobalThis,
                global: proxyGlobal,
                self: proxySelf,
                __globals: __globalsStorage,
              };

              __globals.contextId = contextId;
              __globals.contextType = contextType;
              __globals.module = undefined;
              __globals.amd = undefined;
              __globals.define = undefined;
              __globals.importScripts = (...args) => {
                _log("importScripts", args);
              };

              return __globals;
            }


            if (typeof window !== 'undefined') {
                window.buildPolyfill = buildPolyfill;
            }

  // #endregion
// #endregion
    // #endregion
   // #region Background Script Environment

    const START_BACKGROUND_SCRIPT = (function(){
      const backgroundPolyfill = buildPolyfill({ isBackground: true });
      const scriptName = "Friends Average for Letterboxd";
      const debug = "[Friends Average for Letterboxd]";
      _log(debug + ' Executing background scripts...');

      function executeBackgroundScripts(){
        with(backgroundPolyfill){
          // BG: background.js
    chrome.runtime.onMessage.addListener(
      function (request) {
        console.log(request.content);
      }
    );
        }
      }

      executeBackgroundScripts.call(backgroundPolyfill);

      _log(debug + ' Background scripts execution complete.');
    });

    setTimeout(() => {
      // Wait for things to be defined
      START_BACKGROUND_SCRIPT();
    }, 10);
    _log("START_BACKGROUND_SCRIPT", START_BACKGROUND_SCRIPT);
    // End background script environment


   // #endregion
    // #region Orchestration Logic
    // Other globals currently defined at this spot: SCRIPT_NAME, _log, _warn, _error
    const INJECTED_MANIFEST = {"manifest_version":3,"name":"Friends Average for Letterboxd","version":"1.2","description":"Shows a extra Histogram for your friends","permissions":[],"optional_permissions":[],"content_scripts":[{"js":["jquery/jquery-3.5.0.min.js","main.js"],"matches":["https://letterboxd.com/film/*"],"run_at":"document_end","all_frames":true,"css":[]}],"options_ui":{},"browser_action":{},"page_action":{},"action":{},"icons":{"128":"icon.png"},"web_accessible_resources":[],"background":{"service_worker":"background.js"},"_id":"friends-average-for-letterboxd"};
    const CONTENT_SCRIPT_CONFIGS_FOR_MATCHING = [
      {
        "matches": [
          "https://letterboxd.com/film/*"
        ]
      }
    ];
    const OPTIONS_PAGE_PATH = null;
    const POPUP_PAGE_PATH = null;
    const EXTENSION_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAeGVYSWZNTQAqAAAACAAEARIAAwAAAAEAAQAAARoABQAAAAEAAAA+ARsABQAAAAEAAABGh2kABAAAAAEAAABOAAAAAAAAAEgAAAABAAAASAAAAAEAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAgKADAAQAAAABAAAAgAAAAACnEKrAAAAACXBIWXMAAAsTAAALEwEAmpwYAAACMmlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNS40LjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgICAgICAgICAgeG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iPgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICAgICA8ZXhpZjpDb2xvclNwYWNlPjE8L2V4aWY6Q29sb3JTcGFjZT4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjEyODwvZXhpZjpQaXhlbFhEaW1lbnNpb24+CiAgICAgICAgIDxleGlmOlBpeGVsWURpbWVuc2lvbj4xMjg8L2V4aWY6UGl4ZWxZRGltZW5zaW9uPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KrBRLLwAAGKFJREFUeAHtXVlsHdd5/ubuG1eJFCWSoiRqtTYvkuu4tlMbddzkwYGNAEkKBGiBoA/uS9HHoijQl770LQ9t4aZN2qBAmqaui8KtAbuODTe2I8uGbVkSJWujuIr75d3X6ffPvUPxkveSc4cz9KVnjnR4Zz3n/P//nf/85z/LKACeZvwtxiHGPKNdIcyEI4x+xiJjhjHFKHmqjBKUys+6v5vdX/cCL8g7enprj+V5/Z4c62H1c/q1jX7XPr/2vNG78pwEKUOAMcoo/PExFhjTjMIfu4Lkc4/xqhwMMT7F+CCjnZl6mb5EIVoYUKrGMn+dHDwkvhFv7OJLkAnfYFQEAJ2Mhxj3MrrBWRy4LOiTmmin6ncWS3cOtTkWtSgAcIODOeACwMHCF9JdALgAcDgHHE6+qwFcADicAw4n39UALgAczgGHk+9qABcADueAw8l3NYALAIdzwOHkuxrABYDDOeBw8l0N4ALA4RxwOPmuBnAB4HAOOJx8VwO4AHA4BxxOvqsBXAA4nAMOJ180QIxR1ge4wVkckMUoYQFAG+OOAYDPt2OKqsHJ6xU+t2SQgkWEm7JMaMfYAsViEf39/Th//jyefPJJhEIhlMuttbpMURRcuHABb775JiYnJ1tS+iyULNHzCwBkMWJrcZAF2igMDAzg6aefxksvvYRW1Qi9vb24du1aKwNA1mdqK4OScrARw1vtnqqqWq0vFAS7rRlEK7WaZlrDKVkSmBHVH2fcUQAQQgQErRxavXzknQAgJQCQRYI7qglged2wdQ6IzPM7xvjbOr1uCnU4oLoAqMMVB11SXADYJm3aKMWsbalblfCX7lU5wf1JBtrpjQrRIUHXhNh2OZony+TdBM3TkeX1pJZb2/7TCqz4AvB1D9DPmkXbA8PwhCNQPH6opRLKuRQKy4vI37mCcqYOgetJtu3KtgLgTDf3omHso++xkwLvDCno5NZI7UEVIb+CQBUABZonmYKqgWCJQFjkzkVLjNPssF64SQ8GXRjibGnlEOwZRPdTL0I5mUN/Rwc8AfrbFBIo3UNqhlImjWIyjkJyiZG/8QVkZieQuzuCcnxm20jbNgA8sht47piCJ4YUnNpTxu6owhqvVLfqWi9MlXf0q1l2UkX4n98r4xD5eCusICSOzBYO0cMPYSB4CmfjJXSSzoZBLaOUTSE9cQfx6x9j/uO3sfjOLxs+bvUNSwEgZK7Vzj88Azx/AjjWo6CLggtzk7iQzwP+rzgjG1C0mmUhvtPPZmJ3xIPHCJ5EhweZQQ/8Ji2YglpEQs0iyXgfZg0KIm0StZGao1rKlqEU+SvXKDiP1wdvOApPiOqdxxKk3KKcEiUFRZpYPgFqw3JK7h6m0Ybo0FGE9g6h52vfRP77f4q5i29j/NWXUZq7wwTsC5YBQEBeWiX9P34Y+O0h4IE9wGCHgm4KX9sMTZ5ZHQ3QJkwNsKQBAqGNvz3UJpkuJic3TITJ4gI+zl7D7fwoR8E2USUibBKmau1SCcoyAbCgMO/98EX3wx8OU73zuofXq0GKdS2lYp6ACQqxQm/dwHTlOoHiJYi8kTYNQIGOXUy7HZ2nHkX86oeYfP2fkR+9uioFyaFhoque2/zQMgCI8AX5zw0Bjw0CzwwrON3Hdl62QFR5Q8orviezQd5nVJmGoqjUJHLBXJguLeIXmd/g54kfsXb2MpGGVbSSgWZv8BlFMmd7VOQIuvc7tFb5m+bel+JRVwmkVUU6xdMuD+2aKukbl5RAEMuW9oEkIQZkdPCIFkO798If68DC57/B4kdvozw3yidWZbRxwpvetQwAktO3Doq6V/B7R1Xsa1Mq6m8rQq9TfPKzQv8WeOCjMbZLoeC8p8ht/mr1rk5may/JHqe7GKmBUP4IXdkcepMPoTM7jEC+C15VHqgNporJ5qUsTQ1DpH8Ywe49bCJOwBsMYfa//wmqhd3LLQFA6o2u+L53XMHvn2Xt389az2kGXrlpinohu8WD0KWkEQ9eRtG7jLRvFj2pBxHN7YW3zJ1fqaGsCmq5xCYmhPbDpwmEXoT3DGL07/98VfJSJcznZxoAPuZbrOb7h6cVfPc08HA/2+eYVke3UqZVxDU6VNiqbGq+NXrZousckfTEkfCnkY4leJxDj+chtGWGCAJqgiobtpyZ2CBMTGyE8J792PPkt2k0xnDrR39STbpy3yzDTQFAaBPhd5HOF6jyXzyp4NyAil3S3kuoAqNyYvFfpl3gLJsczWv2JC3jc/OlFC6QfQq7cYFRTChxgpLGIO2JWHagogmaT7TBGxUbQSHd0YFh2oxeFP7gLzD11i9RvHuF75hnuCjqpoOe3XPDNPqOVIw+6eJp4tBvNp2qsRfE3loKBTEZCYI9rRYILIQYgL44JqMfYLLtPWQCMygrMlfB2gKq1ZlPod5+9D/7Pew+9wyUoMzoMx9MAUCyE6/eUweBR+nt7KBXjwbvVoBokAIVS3QEXe+M4XJXjACwlsEGC1HnMSkHWelZxmJoBJOx95H1L1TnLFhbRgGB+BwCNAz7nnoBPc9+v055jF8yCQAFL5zkRwYo/IF26RMbz3ArT2a9Kq71AG/3tmEiyrmALQMAoYpMYBcx75vBTOQSFqMjyAUWaQ+aZPFGjKKW9fiCaD9yFl1nvgZf/6GNnt7wnuHS6TKOUdu9eBh4fL+C4V3s6pmyIjYsU92bRRZgKuLHxcF9+I/eGLIy21YvVN03voyLAoIciv4JNlEXkQzdpYvAjhFBIoBZ+egf6HzgPAae/yPTxBoGgN60H+bo3TPDKl27VP3S7ktZbBZEmd2qJF2Bl+gUebdvEJ+1h+ATx4leKNPkW/1ilRFs/1PsIi6FriPjn7E6k5X0yoWc5ifoPvskfAPHaQ/QX95kMAwASXcXrf6TdO2Ke1dG87alBrIbJPOWpmNR/N/+fvx7NIJTFH7LyX6F8QICFpignQ1eRTz8BX0l9B7aFBS6kQMdu9H/zR/A17Ov6VwMAUCv4CfpNX10EDhMb1jUmI+z6QKtf0FFgoMA1zraMbKbAwBcB+BrXenfLz67hDn/JJuBMfYKZmmvsIsoLnGLgziKAp092P3o78JPw7DZYAgAOr8Pkv9H6QbtjlTdvPqNZnM1+jzTl9o/09aJ9/p6cCPMLoDHQ8Vjd8ZGC7jJc94MwTtOLXCTAJCPstgBgDKdRGGEewfQRm+hp7u5L/8YAoBO5oFORbP6A1qfT79q4y/Vf5pG5gRr/7/u6cZVybfqGdtKrgIfzsthWhQKh4Y51McrjPKrH2vrZarXN7wn6l13iK8uVUXYKdoAc+GrKHnThK19wJUBpI5jDyN6lMOwTQTDAHiGXb4D1AC7Wfu3S/7SjiY46D8Vi2C0jSNvrP0VADRBYZ1HRTSiR7RvZsksHYkyLLz6eOVDXpvdExZWhF2blaTP4npSNATvsUsYp7u4YFMzoGpzEzqGTyPKwaNmguFO3BCF399B9y+ncIkcbATzSvk1469tF64QANrokkUVaNjfh5fav4XvRh6njCr/KplKBvWEuVKkmgMPDbB0OYtXshfwRvZT3CjyU3yKfAawGkRbcfy6SBAkAmMI5rrpIpbhRIuHSDl6KM6hyL5DCO7iGHwTwTAA+jjIs4vdviB7AtshfKEhx8o3096Oi21EnSYYaxDQ4YkiwhG2A4HVVrMIXk+/HgjWg8NHACRKaXxYvIs2ZYTvS3OwCgBamTlW4MlgyT/GqWFHoOR7tDEDPmhtkEklnJ0UaKeLtolgGADdlEF0NW1NZGL2UdEAC+z+vRVl5lrbbzal2vekzgf4yUTO2629YebMEwb7JeyZiFqsE9iMlekcivunaAeIU6geuOq8Z+KSQFRmEoVOPIbs1Q8MpdCg1Gvepacnxpm7QV89Y2fNsxae5sirJKdcgYM/rRrKVL9i3NU38KrC9uTpImZXkEPGVgK5licUPyuJTCsL9Q3V3trgzBAATnaoBIBM2zb0+AbZGb8laJYmIOun2vFLu7NTg1DCiqNkNLdwiYagfUGlBmijHSDT3IyFTSUqGO5gJZRFG9pMXmPpbvmpElVnmtsXpGRa7bZ1O7Zc7AYJCAjEGKyAwM5mwBMIa7OMGxRk3eVNASBvRLhowy9y8Agh9getzrDZSftCSDHfr0RgTZKBoTKbA2LbnsB0PT4/vDRwjQZDAPBR8B6WutqiGU17S8+VmVmeI35k15bSaZmXNWOwwB4Aewo2kiSzhWS9gtFgCAAyJV4bfLMLuXVKq2kBEtMas37qFLDZSxrvqsaijXyUsYFySbqjxoIhAORot8gs5e3sA0gl8ZIY41g2RvCX9hQJkvmCEm0LwrQitUxe9vwwFjYtjYBVFmdmC1zqZLEDa6MiirkRKuUREtXzVQgcCfSqAXhUH5sB+wgq5WhoppYNZ7ApACSly0vsj+c5Lr9NANBqP+UekQkP2kTIrwIICIBy0OLZwmvlrKBA4WcXptfeaHhuCADydoIDZ7Juf7uCaIAIjY9ogZlWZ8NuV9625MOZw/4y1/+VxUK3D9DFTBKZmTHDJBgGgKzPT1MLaJ4s+8q/UnDRAgEaHeE8DZC8caNmJYEGB1YXPeQJwk+3sgwMNRQs1T7KXEVM4UsTYE8gx9h1FvWfu2LMDSzlMFya6QQwl6YWoCxkIwcbm7EV/ggA2lPMNE0fejuHgy0IUu75UgLjhXtYKi5VhoVNUuOtjgaO5G5jsZxiyms9lgI3jjyw7Y8W++AtSe23iXN0SRfTae48ssA8jAfDALjNdMfjNAgpix6uANKmgltdndaUO0gA7Eom8WIyjVc6uADCogGhu8VZvJx8E3+X/jfmSGCZntVKBmgWHd3VPPRyKHhdK8n7SjmMzjxXC2kAsKEvRSCqxRyy06PIzhtv/4XdhpuAX00AdxaB2aSKkg00rJG9dspl9+hJLONMkqizEGxce0uLnETQKIOs6JW1fKaiCJ7vasAkX9YRIYXmMK0aQSy/D75SmHixkJBqfrJdTpndv6XrnyI9fnNdKTa6YBgAksgYNcB00kOfQIUI60mpLaqfMtqTXMSxBA0QEmhf0CmRX/1Yz00/r3dPf2aDX7b5Xrb/scIA/KUYU7eh9hAAKgGduPEpUl98skFh1t8yBAC91brFZmCE09znuPtFkTtCmNac68vR4IqCNm7P0s9m4OtLCURF9WiZ6kJp8FrTl3UK5Vc/1hPRz+vd05+p9ytl5OTZMhdv5PYjUOBGUaItLNYACqdnlTLcY2jyNpZvX0Z5YaJeYRpeMwQAnd2XKfwL4yoECCmZ5Gp3oLBDogWWl/GNe3M4tuKJ0oVidwG2kj65xq6fGH/dmaOaD2ArqTV6V/H4kF+e5+ZS7yA3NdrosYbXDQFAf3uOWvjihIrL9yreQdGWFtlleha1v5SzzEHpTSzhselZDGfo4qRPQAdk7cMteEbV31boR0f2UNUDaLH6JyPE759buIexX/w1SvOTTTOhKQBI6tIVfOsWN0Gaq4BA6/42nW0zLyiIcDOCA8kUTsww00wWuZafHyA1w0NH1iCiWVH/ndT8Mq5tLXQVzpVIT9zE0qUPUF6c58x22kpNBsPdQD3dBWqBV74Azu5T0cvuYDsNaa+dAmEz4KfR2Ut/wO+MTWA8thf/2M6a1LKtgAiZhaPB15s9ic7MEdZ+rw3WP3sd2QyWb3yGqf+V7iyDCXXcFACE57oSe+0auBEUdwXhjO197VTV4hiwFuAaTfJHJnFG6BI+OTOFpzrTuNdxrvKlo5UnWuVAGMCazn5/d/Y0OtNH6cmUWcDWMkbr9hXySNz6HAufvIvs9QumGdAUAHQyBAgX6G8YvC6bQyh4+pDKfQDZ47WxWyBjA900PB+8G0eqIwFv3/pet2kuWPaiOH0iiOT70Zd6hOp/L1U/nTSyvZxVgTyWPn9u/h7GuWPY7Gv/sKWUmwKAnpMOhP+8Ibt+qohyythj3C+gm9rALi0gefs4TehgnJMq5lOYpG/Aw8mqrRNYFqr6YJELNdNnafgdRqDUbq3wSazM+MnM38Xd//ox4lc+3DL5pgCg5yqTRH5Fg9DP6ilmwLkBLh0Tl724R+2QDdEf44DUwXgSXUsp+GiHbLbRp15We38rxHoL+9CTfhB9yfMIFNkuWho4lYRT5JKjI7j3/v/g3hs/R3le7/OLTjbHcNMA0LOcpJf2p5+LDaBCpo6d65exAjpAmu5fGOOWNAXt2SzCHCCyKQtjBdGeEqYL2LnEhMIfSJ/H7sRDbPc5LZu3VO4gtuUgzSqNu1Ihi9TdUcx+8DpGX/6z+8lW79+/0NyRaQCsxduPPxUPIecNsKv++H6Vu4FzKJepe6WAghargpZcmUPFZO7aQliVh+F0OAxcjiFU6ENP5owm/LbMIHuAbPMtollley9j/NnZSYy99lPMvPo3ldLpgjdh+a8mzzQAVieiH79Km2CWIBhhd/354yr3EqArl+MlmhFsEUO0vLQmxsoEdQoM/krWshSs1EaDbwi96TPcMvZBAmF3RfgGk9noMZk+qrD7m1+aw+LIRdx55W+Ru3P1/itbFLyekGUA0HjCVH89RTcx/ffTnJb2xAHuHsp2+lCXbO7MCZGazKpqUy9Bs7+SBqPY1eJa2ZZQzVPLSzJOsjvCgbGuzHH0qefR5X0AAbVL6wWtKH1NOxlUURXGaMlLF0+r9fyIxDIHdpauXtRi9tN3VpEqBTKY9qq36h1aBgApjrTJwoBPqAEkjsyqePYw+IEI8RWoGODy8l2y1E/2eNEacBKi0cE/QtOK3uS51HLtkvaAdp6lR3CG8xPnOBDlH1RxgrdMEyDJC+NXMb+SoZZpTVG0OfEyNS3DuEjh36H0x3IoLHVw+5cu+NtLCPXuQ4BLsmRpluzbI+lutJKiSt1KllKhi6m45tbNzo5T5U9h/pN3sPDGv6w8c/+gypP7F0wfmeZfvRxX0F+9+S5d0xKFmz84peIbBMNxNgudYVWbVaR9A4AOpAD55aV1p8tCProoPYwiFwXIPMQ8BZ7lPnFLWRWfjfLLIZwqdLRfxWE+Y4oA4R/T1CY2rHXSyD2ZKyC/QpAUJEX35yKNm2m6WkcTUISoN+aQxMeMP4O3ux/7vv1D7tDxCMI9/fBwPaN8Ikbhr+zcIdY7/1TAJpLmdHfIt4PYvpfp0JHdvsSnn50Z12r75Os/QWmKhOpB3pV3bAim+Nd8OVT8jD0FibLK6Im9dCXvVXCEYNjfya4jDcaY9s0gModVI0dhJ3L84ALtibvs91+bBT6aVPF+dbLLI+eBITYzpgO7K2qSQo1TqBSQ1ofVBEMQks+q1HZBHj/4IFatMpYk6rjz5/scBbuSWad8SxyCHfvJX2KMBfL2HkTb8YcR4/bukX0HuVCzj/v5tcPHzZ65bqv60ajK94JyizNIT91G8vYVxD9/j906rbasJ8sm4UtG2wSA+zRJhfo16ZzmzKKPKVTZbk72HZB5hvri4xKNH5l7mKaQZTLqDIFwbfm+wNeqz/upGzxa4lYtl2mk3LjJqcd9rKVUQQSAmicwshT8MtU8a7zCqC5Volb7bxAwm4TSDMflOTc/PX4L/g7uCBKJaWv1FK7Zky+DiHaRNr6Ulw9HJbWvhxXnJlFeam4q1ybFMHx72wEgJZPKO8JmVKKZsOWxpzgF/Akzf/0u/ctZzuoi+gRf2neBqBkWKOib3NSJE1/MhHJ8GnmJZl7e5ne+FABsM43rsxPVPk4P1vtya2b9fQddoU5yYJA2RDa6dEMLeFNdIXyZHBB3lhsczAFtQhft8J2nCcRjJtFM8Mh2sybfNZNfi74jlV9cMZBxyx1lDIqjqERHSj6fRzAYRLHIPqPB4OeGU/KevO/wwK4PoiJ4GcHfUQBIcw3c7Owsbt26hUgk0pQwBQBjY2NYXOQyJ2cHAYAM2GorGneULTA1NYX33uPHmTIZBAIB+nCM99dF/U9MTODSpUvOFr/mc4V8/Q9/xfgdxiM7gSMiwLLMBbAgeOmjd3BTME4WviM1nwu/bfykhQWCWp2EVcKXNB0sfI18/kkLADjSsXMAICV3gyUcECs4s6PafkvIdhOp4YALgBp2OO/EBYDzZF5DsQuAGnY478QFgPNkXkOxC4AadjjvxAWA82ReQ7ELgBp2OO/EBYDzZF5DsQuAGnY478QFgPNkXkOxC4AadjjvxAWA82ReQ7ELgBp2OO/EBYDzZF5DsQuAGnY478QFgPNkXkOxC4AadjjvxAWA82ReQ7ELgBp2OO/EBYDzZF5DsQuAGnY470QAIKuDuHeXGxzGAZG5tjhUtsj4jFHWV3HbDNuCAE2igE6W9siKTonWLPNhQjs06JWwHm/sIom7MuEW46gsDTvHeIyRG9zaukBEFqHy43/gJybAjXi0BSnylWM7QcfkWz7I8nxZoS384U5SkJ2oZLWWLNixK8jCUO64iNH/B+YByoeNJypsAAAAAElFTkSuQmCC";
    const extensionCssData = {};

    const LOCALE_KEYS = {};
    const USED_LOCALE = "en";
    const CURRENT_LOCATION = window.location.href;

    const convertMatchPatternToRegExp = function convertMatchPatternToRegExp(pattern) {
      if (pattern === "<all_urls>") {
        return new RegExp(".*");
      }
      try {
        const singleEscapedPattern = convertMatchPatternToRegExpString(
          pattern
        ).replace(/\\\\/g, "\\");
        return new RegExp(singleEscapedPattern);
      } catch (error) {
        debug(
          "Error converting match pattern to RegExp: %s, Error: %s",
          pattern,
          error.message
        );
        return new RegExp("$."); // Matches nothing on error
      }
    };
    const convertMatchPatternToRegExpString = function convertMatchPatternToRegExpString(pattern) {
      function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
      }

      if (typeof pattern !== "string" || !pattern) {
        return "$."; // Matches nothing
      }

      const schemeMatch = pattern.match(/^(\*|https?|file|ftp):\/\//);
      if (!schemeMatch) return "$."; // Invalid pattern
      const scheme = schemeMatch[1];
      pattern = pattern.substring(schemeMatch[0].length);
      const schemeRegex = scheme === "*" ? "https?|file|ftp" : scheme;

      const hostMatch = pattern.match(/^([^\/]+)/);
      if (!hostMatch) return "$."; // Invalid pattern
      const host = hostMatch[1];
      pattern = pattern.substring(host.length); // Remainder is path

      let hostRegex;
      if (host === "*") {
        hostRegex = "[^/]+"; // Matches any sequence of non-slash characters
      } else if (host.startsWith("*.")) {
        // Match any subdomain or the main domain
        hostRegex = "(?:[^\\/]+\\.)?" + escapeRegex(host.substring(2));
      } else {
        hostRegex = escapeRegex(host); // Exact host match
      }

      let pathRegex = pattern;
      if (!pathRegex.startsWith("/")) {
        pathRegex = "/" + pathRegex; // Ensure path starts with /
      }
      // Convert glob (*) to regex (.*) and escape other special chars
      pathRegex = pathRegex.split("*").map(escapeRegex).join(".*");

      // Ensure the pattern covers the entire path segment correctly
      if (pathRegex === "/.*") {
        // Equivalent to /* in manifest, matches the root and anything after
        pathRegex = "(?:/.*)?";
      } else {
        // Match the specific path and optionally query/hash or end of string
        pathRegex = pathRegex + "(?:[?#]|$)";
      }

      // Combine and return the pattern string
      // Needs double escaping for direct embedding in generated JS strings
      const finalRegexString = `^${schemeRegex}:\\/\\/${hostRegex}${pathRegex}`;
      return finalRegexString;
    };
    const ALL_PERMISSIONS = [
      ...(INJECTED_MANIFEST.permissions || []),
      ...(INJECTED_MANIFEST.optional_permissions || []),
      ...(INJECTED_MANIFEST.host_permissions || []),
      ...(INJECTED_MANIFEST.content_scripts
        ?.map((cs) => cs.matches || [])
        ?.flat() || []),
    ];

    const isOrigin = (perm) => {
      if (
        perm.startsWith("*://") ||
        perm.startsWith("http://") ||
        perm.startsWith("https://")
      ) {
        return true;
      }
      return false;
    };
    const ORIGIN_PERMISSIONS = ALL_PERMISSIONS.filter(isOrigin);
    const EXTENSION_PERMISSIONS = ALL_PERMISSIONS.filter((perm) => !isOrigin(perm));

    function _testBlobCSP() {
      try {
        const code = `console.log("Blob CSP test");`;
        const blob = new Blob([code], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);

        const script = document.createElement("script");
        script.src = blobUrl;

        let blocked = false;
        script.onerror = () => {
          blocked = true;
        };

        document.head.appendChild(script);

        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(!blocked);
            document.head.removeChild(script);
            URL.revokeObjectURL(blobUrl);
          }, 100);
        });
      } catch (e) {
        return Promise.resolve(false);
      }
    }

    let CAN_USE_BLOB_CSP = false;

    const waitForDOMEnd = () => {
      if (document.readyState === "loading") {
        return new Promise((resolve) =>
          document.addEventListener("DOMContentLoaded", resolve, { once: true })
        );
      }
      return Promise.resolve();
    };

    waitForDOMEnd().then(() => {
      _testBlobCSP().then((result) => {
        CAN_USE_BLOB_CSP = result;
      });
    });

    function _base64ToBlob(base64, mimeType = "application/octet-stream") {
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mimeType });
    }

    function _getMimeTypeFromPath(p) {
      const ext = (p.split(".").pop() || "").toLowerCase();
      const map = {
        html: "text/html",
        htm: "text/html",
        js: "text/javascript",
        css: "text/css",
        json: "application/json",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        svg: "image/svg+xml",
        webp: "image/webp",
        ico: "image/x-icon",
        woff: "font/woff",
        woff2: "font/woff2",
        ttf: "font/ttf",
        otf: "font/otf",
        eot: "application/vnd.ms-fontobject",
      };
      return map[ext] || "application/octet-stream";
    }

    function _isTextAsset(ext) {
      return ["html", "htm", "js", "css", "json", "svg", "txt", "xml"].includes(
        ext
      );
    }

    function _createAssetUrl(path = "") {
      if (path.startsWith("/")) path = path.slice(1);
      const assetData = EXTENSION_ASSETS_MAP[path];
      if (typeof assetData === "undefined") {
        _warn("[runtime.getURL] Asset not found for", path);
        return path;
      }

      const mime = _getMimeTypeFromPath(path);
      const ext = (path.split(".").pop() || "").toLowerCase();

      if (CAN_USE_BLOB_CSP) {
        let blob;
        if (_isTextAsset(ext)) {
          blob = new Blob([assetData], { type: mime });
        } else {
          blob = _base64ToBlob(assetData, mime);
        }

        return URL.createObjectURL(blob);
      } else {
        if (_isTextAsset(ext)) {
          return `data:${mime};base64,${btoa(assetData)}`;
        } else {
          return `data:${mime};base64,${assetData}`;
        }
      }
    }

    function _matchGlobPattern(pattern, path) {
      if (!pattern || !path) return false;

      pattern = pattern.replace(/\\/g, "/");
      path = path.replace(/\\/g, "/");

      if (pattern === path) return true;

      let regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex chars
        .replace(/\*\*/g, "__DOUBLESTAR__") // Temporarily replace **
        .replace(/\*/g, "[^/]*") // * matches any chars except /
        .replace(/__DOUBLESTAR__/g, ".*"); // ** matches any chars including /

      regexPattern = "^" + regexPattern + "$";

      try {
        const regex = new RegExp(regexPattern);
        return regex.test(path);
      } catch (e) {
        _error(`Invalid glob pattern: ${pattern}`, e);
        return false;
      }
    }

    function _isWebAccessibleResource(resourcePath, webAccessibleResources) {
      if (
        !Array.isArray(webAccessibleResources) ||
        webAccessibleResources.length === 0
      ) {
        return false;
      }

      // Normalize the resource path
      const normalizedPath = resourcePath.replace(/\\/g, "/").replace(/^\/+/, "");

      for (const webAccessibleResource of webAccessibleResources) {
        let patterns = [];

        // Handle both manifest v2 and v3 formats
        if (typeof webAccessibleResource === "string") {
          // Manifest v2 format: array of strings
          patterns = [webAccessibleResource];
        } else if (
          webAccessibleResource &&
          Array.isArray(webAccessibleResource.resources)
        ) {
          // Manifest v3 format: objects with resources array
          patterns = webAccessibleResource.resources;
        }

        // Check if the path matches any pattern
        for (const pattern of patterns) {
          if (_matchGlobPattern(pattern, normalizedPath)) {
            return true;
          }
        }
      }

      return false;
    }

    window._matchGlobPattern = _matchGlobPattern;
    window._isWebAccessibleResource = _isWebAccessibleResource;

    // This function contains all the CSS injection and JS execution,
    // ordered by run_at timing internally using await.

  // #region Script Execution Logic
        async function executeAllScripts(globalThis, extensionCssData) {
          const {chrome, browser, global, window, self} = globalThis;
          const scriptName = "Friends Average for Letterboxd";
          _log(`Starting execution phases...`);

  // #region Document Start
              if (typeof document !== 'undefined') {
                _log(`Executing document-start phase...`);

                const scriptPaths = [];
               _log(`  Executing JS (start): ${scriptPaths}`);

               try {
                   // Keep variables from being redeclared for global scope, but also make them apply to global scope. (Theoretically)
                  with (globalThis){;

            ;}
               } catch(e) { _error(`  Error executing scripts ${scriptPaths}`, e); }

              } else {
                  _log(`Skipping document-start phase (no document).`);
              }


  // #endregion
  // #region Wait for Document End DOMContentLoaded ---
              if (typeof document !== 'undefined' && document.readyState === 'loading') {
                _log(`Waiting for DOMContentLoaded...`);
                await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
                _log(`DOMContentLoaded fired.`);
              } else if (typeof document !== 'undefined') {
                _log(`DOMContentLoaded already passed or not applicable.`);
              }


  // #endregion
  // #region Document End
               if (typeof document !== 'undefined') {
                _log(`Executing document-end phase...`);

                const scriptPaths = ["jquery/jquery-3.5.0.min.js","main.js"];
               _log(`  Executing JS (end): ${scriptPaths}`);

               try {
                   // Keep variables from being redeclared for global scope, but also make them apply to global scope. (Theoretically)
                  with (globalThis){;
            // START: jquery/jquery-3.5.0.min.js
            /*! jQuery v3.5.0 | (c) JS Foundation and other contributors | jquery.org/license */
            !function (e, t) { "use strict"; "object" == typeof module && "object" == typeof module.exports ? module.exports = e.document ? t(e, !0) : function (e) { if (!e.document) throw new Error("jQuery requires a window with a document"); return t(e) } : t(e) }("undefined" != typeof window ? window : this, function (C, e) { "use strict"; var t = [], r = Object.getPrototypeOf, s = t.slice, g = t.flat ? function (e) { return t.flat.call(e) } : function (e) { return t.concat.apply([], e) }, u = t.push, i = t.indexOf, n = {}, o = n.toString, v = n.hasOwnProperty, a = v.toString, l = a.call(Object), y = {}, m = function (e) { return "function" == typeof e && "number" != typeof e.nodeType }, x = function (e) { return null != e && e === e.window }, E = C.document, c = { type: !0, src: !0, nonce: !0, noModule: !0 }; function b(e, t, n) { var r, i, o = (n = n || E).createElement("script"); if (o.text = e, t) for (r in c) (i = t[r] || t.getAttribute && t.getAttribute(r)) && o.setAttribute(r, i); n.head.appendChild(o).parentNode.removeChild(o) } function w(e) { return null == e ? e + "" : "object" == typeof e || "function" == typeof e ? n[o.call(e)] || "object" : typeof e } var f = "3.5.0", S = function (e, t) { return new S.fn.init(e, t) }; function p(e) { var t = !!e && "length" in e && e.length, n = w(e); return !m(e) && !x(e) && ("array" === n || 0 === t || "number" == typeof t && 0 < t && t - 1 in e) } S.fn = S.prototype = { jquery: f, constructor: S, length: 0, toArray: function () { return s.call(this) }, get: function (e) { return null == e ? s.call(this) : e < 0 ? this[e + this.length] : this[e] }, pushStack: function (e) { var t = S.merge(this.constructor(), e); return t.prevObject = this, t }, each: function (e) { return S.each(this, e) }, map: function (n) { return this.pushStack(S.map(this, function (e, t) { return n.call(e, t, e) })) }, slice: function () { return this.pushStack(s.apply(this, arguments)) }, first: function () { return this.eq(0) }, last: function () { return this.eq(-1) }, even: function () { return this.pushStack(S.grep(this, function (e, t) { return (t + 1) % 2 })) }, odd: function () { return this.pushStack(S.grep(this, function (e, t) { return t % 2 })) }, eq: function (e) { var t = this.length, n = +e + (e < 0 ? t : 0); return this.pushStack(0 <= n && n < t ? [this[n]] : []) }, end: function () { return this.prevObject || this.constructor() }, push: u, sort: t.sort, splice: t.splice }, S.extend = S.fn.extend = function () { var e, t, n, r, i, o, a = arguments[0] || {}, s = 1, u = arguments.length, l = !1; for ("boolean" == typeof a && (l = a, a = arguments[s] || {}, s++), "object" == typeof a || m(a) || (a = {}), s === u && (a = this, s--); s < u; s++)if (null != (e = arguments[s])) for (t in e) r = e[t], "__proto__" !== t && a !== r && (l && r && (S.isPlainObject(r) || (i = Array.isArray(r))) ? (n = a[t], o = i && !Array.isArray(n) ? [] : i || S.isPlainObject(n) ? n : {}, i = !1, a[t] = S.extend(l, o, r)) : void 0 !== r && (a[t] = r)); return a }, S.extend({ expando: "jQuery" + (f + Math.random()).replace(/\D/g, ""), isReady: !0, error: function (e) { throw new Error(e) }, noop: function () { }, isPlainObject: function (e) { var t, n; return !(!e || "[object Object]" !== o.call(e)) && (!(t = r(e)) || "function" == typeof (n = v.call(t, "constructor") && t.constructor) && a.call(n) === l) }, isEmptyObject: function (e) { var t; for (t in e) return !1; return !0 }, globalEval: function (e, t, n) { b(e, { nonce: t && t.nonce }, n) }, each: function (e, t) { var n, r = 0; if (p(e)) { for (n = e.length; r < n; r++)if (!1 === t.call(e[r], r, e[r])) break } else for (r in e) if (!1 === t.call(e[r], r, e[r])) break; return e }, makeArray: function (e, t) { var n = t || []; return null != e && (p(Object(e)) ? S.merge(n, "string" == typeof e ? [e] : e) : u.call(n, e)), n }, inArray: function (e, t, n) { return null == t ? -1 : i.call(t, e, n) }, merge: function (e, t) { for (var n = +t.length, r = 0, i = e.length; r < n; r++)e[i++] = t[r]; return e.length = i, e }, grep: function (e, t, n) { for (var r = [], i = 0, o = e.length, a = !n; i < o; i++)!t(e[i], i) !== a && r.push(e[i]); return r }, map: function (e, t, n) { var r, i, o = 0, a = []; if (p(e)) for (r = e.length; o < r; o++)null != (i = t(e[o], o, n)) && a.push(i); else for (o in e) null != (i = t(e[o], o, n)) && a.push(i); return g(a) }, guid: 1, support: y }), "function" == typeof Symbol && (S.fn[Symbol.iterator] = t[Symbol.iterator]), S.each("Boolean Number String Function Array Date RegExp Object Error Symbol".split(" "), function (e, t) { n["[object " + t + "]"] = t.toLowerCase() }); var d = function (n) { var e, d, b, o, i, h, f, g, w, u, l, T, C, a, E, v, s, c, y, S = "sizzle" + 1 * new Date, p = n.document, k = 0, r = 0, m = ue(), x = ue(), A = ue(), N = ue(), D = function (e, t) { return e === t && (l = !0), 0 }, j = {}.hasOwnProperty, t = [], q = t.pop, L = t.push, H = t.push, O = t.slice, P = function (e, t) { for (var n = 0, r = e.length; n < r; n++)if (e[n] === t) return n; return -1 }, R = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped", M = "[\\x20\\t\\r\\n\\f]", I = "(?:\\\\[\\da-fA-F]{1,6}" + M + "?|\\\\[^\\r\\n\\f]|[\\w-]|[^\0-\\x7f])+", W = "\\[" + M + "*(" + I + ")(?:" + M + "*([*^$|!~]?=)" + M + "*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|(" + I + "))|)" + M + "*\\]", F = ":(" + I + ")(?:\\((('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|((?:\\\\.|[^\\\\()[\\]]|" + W + ")*)|.*)\\)|)", B = new RegExp(M + "+", "g"), $ = new RegExp("^" + M + "+|((?:^|[^\\\\])(?:\\\\.)*)" + M + "+$", "g"), _ = new RegExp("^" + M + "*," + M + "*"), z = new RegExp("^" + M + "*([>+~]|" + M + ")" + M + "*"), U = new RegExp(M + "|>"), X = new RegExp(F), V = new RegExp("^" + I + "$"), G = { ID: new RegExp("^#(" + I + ")"), CLASS: new RegExp("^\\.(" + I + ")"), TAG: new RegExp("^(" + I + "|[*])"), ATTR: new RegExp("^" + W), PSEUDO: new RegExp("^" + F), CHILD: new RegExp("^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + M + "*(even|odd|(([+-]|)(\\d*)n|)" + M + "*(?:([+-]|)" + M + "*(\\d+)|))" + M + "*\\)|)", "i"), bool: new RegExp("^(?:" + R + ")$", "i"), needsContext: new RegExp("^" + M + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" + M + "*((?:-\\d)?\\d*)" + M + "*\\)|)(?=[^-]|$)", "i") }, Y = /HTML$/i, Q = /^(?:input|select|textarea|button)$/i, J = /^h\d$/i, K = /^[^{]+\{\s*\[native \w/, Z = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/, ee = /[+~]/, te = new RegExp("\\\\[\\da-fA-F]{1,6}" + M + "?|\\\\([^\\r\\n\\f])", "g"), ne = function (e, t) { var n = "0x" + e.slice(1) - 65536; return t || (n < 0 ? String.fromCharCode(n + 65536) : String.fromCharCode(n >> 10 | 55296, 1023 & n | 56320)) }, re = /([\0-\x1f\x7f]|^-?\d)|^-$|[^\0-\x1f\x7f-\uFFFF\w-]/g, ie = function (e, t) { return t ? "\0" === e ? "\ufffd" : e.slice(0, -1) + "\\" + e.charCodeAt(e.length - 1).toString(16) + " " : "\\" + e }, oe = function () { T() }, ae = be(function (e) { return !0 === e.disabled && "fieldset" === e.nodeName.toLowerCase() }, { dir: "parentNode", next: "legend" }); try { H.apply(t = O.call(p.childNodes), p.childNodes), t[p.childNodes.length].nodeType } catch (e) { H = { apply: t.length ? function (e, t) { L.apply(e, O.call(t)) } : function (e, t) { var n = e.length, r = 0; while (e[n++] = t[r++]); e.length = n - 1 } } } function se(t, e, n, r) { var i, o, a, s, u, l, c, f = e && e.ownerDocument, p = e ? e.nodeType : 9; if (n = n || [], "string" != typeof t || !t || 1 !== p && 9 !== p && 11 !== p) return n; if (!r && (T(e), e = e || C, E)) { if (11 !== p && (u = Z.exec(t))) if (i = u[1]) { if (9 === p) { if (!(a = e.getElementById(i))) return n; if (a.id === i) return n.push(a), n } else if (f && (a = f.getElementById(i)) && y(e, a) && a.id === i) return n.push(a), n } else { if (u[2]) return H.apply(n, e.getElementsByTagName(t)), n; if ((i = u[3]) && d.getElementsByClassName && e.getElementsByClassName) return H.apply(n, e.getElementsByClassName(i)), n } if (d.qsa && !N[t + " "] && (!v || !v.test(t)) && (1 !== p || "object" !== e.nodeName.toLowerCase())) { if (c = t, f = e, 1 === p && (U.test(t) || z.test(t))) { (f = ee.test(t) && ye(e.parentNode) || e) === e && d.scope || ((s = e.getAttribute("id")) ? s = s.replace(re, ie) : e.setAttribute("id", s = S)), o = (l = h(t)).length; while (o--) l[o] = (s ? "#" + s : ":scope") + " " + xe(l[o]); c = l.join(",") } try { return H.apply(n, f.querySelectorAll(c)), n } catch (e) { N(t, !0) } finally { s === S && e.removeAttribute("id") } } } return g(t.replace($, "$1"), e, n, r) } function ue() { var r = []; return function e(t, n) { return r.push(t + " ") > b.cacheLength && delete e[r.shift()], e[t + " "] = n } } function le(e) { return e[S] = !0, e } function ce(e) { var t = C.createElement("fieldset"); try { return !!e(t) } catch (e) { return !1 } finally { t.parentNode && t.parentNode.removeChild(t), t = null } } function fe(e, t) { var n = e.split("|"), r = n.length; while (r--) b.attrHandle[n[r]] = t } function pe(e, t) { var n = t && e, r = n && 1 === e.nodeType && 1 === t.nodeType && e.sourceIndex - t.sourceIndex; if (r) return r; if (n) while (n = n.nextSibling) if (n === t) return -1; return e ? 1 : -1 } function de(t) { return function (e) { return "input" === e.nodeName.toLowerCase() && e.type === t } } function he(n) { return function (e) { var t = e.nodeName.toLowerCase(); return ("input" === t || "button" === t) && e.type === n } } function ge(t) { return function (e) { return "form" in e ? e.parentNode && !1 === e.disabled ? "label" in e ? "label" in e.parentNode ? e.parentNode.disabled === t : e.disabled === t : e.isDisabled === t || e.isDisabled !== !t && ae(e) === t : e.disabled === t : "label" in e && e.disabled === t } } function ve(a) { return le(function (o) { return o = +o, le(function (e, t) { var n, r = a([], e.length, o), i = r.length; while (i--) e[n = r[i]] && (e[n] = !(t[n] = e[n])) }) }) } function ye(e) { return e && "undefined" != typeof e.getElementsByTagName && e } for (e in d = se.support = {}, i = se.isXML = function (e) { var t = e.namespaceURI, n = (e.ownerDocument || e).documentElement; return !Y.test(t || n && n.nodeName || "HTML") }, T = se.setDocument = function (e) { var t, n, r = e ? e.ownerDocument || e : p; return r != C && 9 === r.nodeType && r.documentElement && (a = (C = r).documentElement, E = !i(C), p != C && (n = C.defaultView) && n.top !== n && (n.addEventListener ? n.addEventListener("unload", oe, !1) : n.attachEvent && n.attachEvent("onunload", oe)), d.scope = ce(function (e) { return a.appendChild(e).appendChild(C.createElement("div")), "undefined" != typeof e.querySelectorAll && !e.querySelectorAll(":scope fieldset div").length }), d.attributes = ce(function (e) { return e.className = "i", !e.getAttribute("className") }), d.getElementsByTagName = ce(function (e) { return e.appendChild(C.createComment("")), !e.getElementsByTagName("*").length }), d.getElementsByClassName = K.test(C.getElementsByClassName), d.getById = ce(function (e) { return a.appendChild(e).id = S, !C.getElementsByName || !C.getElementsByName(S).length }), d.getById ? (b.filter.ID = function (e) { var t = e.replace(te, ne); return function (e) { return e.getAttribute("id") === t } }, b.find.ID = function (e, t) { if ("undefined" != typeof t.getElementById && E) { var n = t.getElementById(e); return n ? [n] : [] } }) : (b.filter.ID = function (e) { var n = e.replace(te, ne); return function (e) { var t = "undefined" != typeof e.getAttributeNode && e.getAttributeNode("id"); return t && t.value === n } }, b.find.ID = function (e, t) { if ("undefined" != typeof t.getElementById && E) { var n, r, i, o = t.getElementById(e); if (o) { if ((n = o.getAttributeNode("id")) && n.value === e) return [o]; i = t.getElementsByName(e), r = 0; while (o = i[r++]) if ((n = o.getAttributeNode("id")) && n.value === e) return [o] } return [] } }), b.find.TAG = d.getElementsByTagName ? function (e, t) { return "undefined" != typeof t.getElementsByTagName ? t.getElementsByTagName(e) : d.qsa ? t.querySelectorAll(e) : void 0 } : function (e, t) { var n, r = [], i = 0, o = t.getElementsByTagName(e); if ("*" === e) { while (n = o[i++]) 1 === n.nodeType && r.push(n); return r } return o }, b.find.CLASS = d.getElementsByClassName && function (e, t) { if ("undefined" != typeof t.getElementsByClassName && E) return t.getElementsByClassName(e) }, s = [], v = [], (d.qsa = K.test(C.querySelectorAll)) && (ce(function (e) { var t; a.appendChild(e).innerHTML = "<a id='" + S + "'></a><select id='" + S + "-\r\\' msallowcapture=''><option selected=''></option></select>", e.querySelectorAll("[msallowcapture^='']").length && v.push("[*^$]=" + M + "*(?:''|\"\")"), e.querySelectorAll("[selected]").length || v.push("\\[" + M + "*(?:value|" + R + ")"), e.querySelectorAll("[id~=" + S + "-]").length || v.push("~="), (t = C.createElement("input")).setAttribute("name", ""), e.appendChild(t), e.querySelectorAll("[name='']").length || v.push("\\[" + M + "*name" + M + "*=" + M + "*(?:''|\"\")"), e.querySelectorAll(":checked").length || v.push(":checked"), e.querySelectorAll("a#" + S + "+*").length || v.push(".#.+[+~]"), e.querySelectorAll("\\\f"), v.push("[\\r\\n\\f]") }), ce(function (e) { e.innerHTML = "<a href='' disabled='disabled'></a><select disabled='disabled'><option/></select>"; var t = C.createElement("input"); t.setAttribute("type", "hidden"), e.appendChild(t).setAttribute("name", "D"), e.querySelectorAll("[name=d]").length && v.push("name" + M + "*[*^$|!~]?="), 2 !== e.querySelectorAll(":enabled").length && v.push(":enabled", ":disabled"), a.appendChild(e).disabled = !0, 2 !== e.querySelectorAll(":disabled").length && v.push(":enabled", ":disabled"), e.querySelectorAll("*,:x"), v.push(",.*:") })), (d.matchesSelector = K.test(c = a.matches || a.webkitMatchesSelector || a.mozMatchesSelector || a.oMatchesSelector || a.msMatchesSelector)) && ce(function (e) { d.disconnectedMatch = c.call(e, "*"), c.call(e, "[s!='']:x"), s.push("!=", F) }), v = v.length && new RegExp(v.join("|")), s = s.length && new RegExp(s.join("|")), t = K.test(a.compareDocumentPosition), y = t || K.test(a.contains) ? function (e, t) { var n = 9 === e.nodeType ? e.documentElement : e, r = t && t.parentNode; return e === r || !(!r || 1 !== r.nodeType || !(n.contains ? n.contains(r) : e.compareDocumentPosition && 16 & e.compareDocumentPosition(r))) } : function (e, t) { if (t) while (t = t.parentNode) if (t === e) return !0; return !1 }, D = t ? function (e, t) { if (e === t) return l = !0, 0; var n = !e.compareDocumentPosition - !t.compareDocumentPosition; return n || (1 & (n = (e.ownerDocument || e) == (t.ownerDocument || t) ? e.compareDocumentPosition(t) : 1) || !d.sortDetached && t.compareDocumentPosition(e) === n ? e == C || e.ownerDocument == p && y(p, e) ? -1 : t == C || t.ownerDocument == p && y(p, t) ? 1 : u ? P(u, e) - P(u, t) : 0 : 4 & n ? -1 : 1) } : function (e, t) { if (e === t) return l = !0, 0; var n, r = 0, i = e.parentNode, o = t.parentNode, a = [e], s = [t]; if (!i || !o) return e == C ? -1 : t == C ? 1 : i ? -1 : o ? 1 : u ? P(u, e) - P(u, t) : 0; if (i === o) return pe(e, t); n = e; while (n = n.parentNode) a.unshift(n); n = t; while (n = n.parentNode) s.unshift(n); while (a[r] === s[r]) r++; return r ? pe(a[r], s[r]) : a[r] == p ? -1 : s[r] == p ? 1 : 0 }), C }, se.matches = function (e, t) { return se(e, null, null, t) }, se.matchesSelector = function (e, t) { if (T(e), d.matchesSelector && E && !N[t + " "] && (!s || !s.test(t)) && (!v || !v.test(t))) try { var n = c.call(e, t); if (n || d.disconnectedMatch || e.document && 11 !== e.document.nodeType) return n } catch (e) { N(t, !0) } return 0 < se(t, C, null, [e]).length }, se.contains = function (e, t) { return (e.ownerDocument || e) != C && T(e), y(e, t) }, se.attr = function (e, t) { (e.ownerDocument || e) != C && T(e); var n = b.attrHandle[t.toLowerCase()], r = n && j.call(b.attrHandle, t.toLowerCase()) ? n(e, t, !E) : void 0; return void 0 !== r ? r : d.attributes || !E ? e.getAttribute(t) : (r = e.getAttributeNode(t)) && r.specified ? r.value : null }, se.escape = function (e) { return (e + "").replace(re, ie) }, se.error = function (e) { throw new Error("Syntax error, unrecognized expression: " + e) }, se.uniqueSort = function (e) { var t, n = [], r = 0, i = 0; if (l = !d.detectDuplicates, u = !d.sortStable && e.slice(0), e.sort(D), l) { while (t = e[i++]) t === e[i] && (r = n.push(i)); while (r--) e.splice(n[r], 1) } return u = null, e }, o = se.getText = function (e) { var t, n = "", r = 0, i = e.nodeType; if (i) { if (1 === i || 9 === i || 11 === i) { if ("string" == typeof e.textContent) return e.textContent; for (e = e.firstChild; e; e = e.nextSibling)n += o(e) } else if (3 === i || 4 === i) return e.nodeValue } else while (t = e[r++]) n += o(t); return n }, (b = se.selectors = { cacheLength: 50, createPseudo: le, match: G, attrHandle: {}, find: {}, relative: { ">": { dir: "parentNode", first: !0 }, " ": { dir: "parentNode" }, "+": { dir: "previousSibling", first: !0 }, "~": { dir: "previousSibling" } }, preFilter: { ATTR: function (e) { return e[1] = e[1].replace(te, ne), e[3] = (e[3] || e[4] || e[5] || "").replace(te, ne), "~=" === e[2] && (e[3] = " " + e[3] + " "), e.slice(0, 4) }, CHILD: function (e) { return e[1] = e[1].toLowerCase(), "nth" === e[1].slice(0, 3) ? (e[3] || se.error(e[0]), e[4] = +(e[4] ? e[5] + (e[6] || 1) : 2 * ("even" === e[3] || "odd" === e[3])), e[5] = +(e[7] + e[8] || "odd" === e[3])) : e[3] && se.error(e[0]), e }, PSEUDO: function (e) { var t, n = !e[6] && e[2]; return G.CHILD.test(e[0]) ? null : (e[3] ? e[2] = e[4] || e[5] || "" : n && X.test(n) && (t = h(n, !0)) && (t = n.indexOf(")", n.length - t) - n.length) && (e[0] = e[0].slice(0, t), e[2] = n.slice(0, t)), e.slice(0, 3)) } }, filter: { TAG: function (e) { var t = e.replace(te, ne).toLowerCase(); return "*" === e ? function () { return !0 } : function (e) { return e.nodeName && e.nodeName.toLowerCase() === t } }, CLASS: function (e) { var t = m[e + " "]; return t || (t = new RegExp("(^|" + M + ")" + e + "(" + M + "|$)")) && m(e, function (e) { return t.test("string" == typeof e.className && e.className || "undefined" != typeof e.getAttribute && e.getAttribute("class") || "") }) }, ATTR: function (n, r, i) { return function (e) { var t = se.attr(e, n); return null == t ? "!=" === r : !r || (t += "", "=" === r ? t === i : "!=" === r ? t !== i : "^=" === r ? i && 0 === t.indexOf(i) : "*=" === r ? i && -1 < t.indexOf(i) : "$=" === r ? i && t.slice(-i.length) === i : "~=" === r ? -1 < (" " + t.replace(B, " ") + " ").indexOf(i) : "|=" === r && (t === i || t.slice(0, i.length + 1) === i + "-")) } }, CHILD: function (h, e, t, g, v) { var y = "nth" !== h.slice(0, 3), m = "last" !== h.slice(-4), x = "of-type" === e; return 1 === g && 0 === v ? function (e) { return !!e.parentNode } : function (e, t, n) { var r, i, o, a, s, u, l = y !== m ? "nextSibling" : "previousSibling", c = e.parentNode, f = x && e.nodeName.toLowerCase(), p = !n && !x, d = !1; if (c) { if (y) { while (l) { a = e; while (a = a[l]) if (x ? a.nodeName.toLowerCase() === f : 1 === a.nodeType) return !1; u = l = "only" === h && !u && "nextSibling" } return !0 } if (u = [m ? c.firstChild : c.lastChild], m && p) { d = (s = (r = (i = (o = (a = c)[S] || (a[S] = {}))[a.uniqueID] || (o[a.uniqueID] = {}))[h] || [])[0] === k && r[1]) && r[2], a = s && c.childNodes[s]; while (a = ++s && a && a[l] || (d = s = 0) || u.pop()) if (1 === a.nodeType && ++d && a === e) { i[h] = [k, s, d]; break } } else if (p && (d = s = (r = (i = (o = (a = e)[S] || (a[S] = {}))[a.uniqueID] || (o[a.uniqueID] = {}))[h] || [])[0] === k && r[1]), !1 === d) while (a = ++s && a && a[l] || (d = s = 0) || u.pop()) if ((x ? a.nodeName.toLowerCase() === f : 1 === a.nodeType) && ++d && (p && ((i = (o = a[S] || (a[S] = {}))[a.uniqueID] || (o[a.uniqueID] = {}))[h] = [k, d]), a === e)) break; return (d -= v) === g || d % g == 0 && 0 <= d / g } } }, PSEUDO: function (e, o) { var t, a = b.pseudos[e] || b.setFilters[e.toLowerCase()] || se.error("unsupported pseudo: " + e); return a[S] ? a(o) : 1 < a.length ? (t = [e, e, "", o], b.setFilters.hasOwnProperty(e.toLowerCase()) ? le(function (e, t) { var n, r = a(e, o), i = r.length; while (i--) e[n = P(e, r[i])] = !(t[n] = r[i]) }) : function (e) { return a(e, 0, t) }) : a } }, pseudos: { not: le(function (e) { var r = [], i = [], s = f(e.replace($, "$1")); return s[S] ? le(function (e, t, n, r) { var i, o = s(e, null, r, []), a = e.length; while (a--) (i = o[a]) && (e[a] = !(t[a] = i)) }) : function (e, t, n) { return r[0] = e, s(r, null, n, i), r[0] = null, !i.pop() } }), has: le(function (t) { return function (e) { return 0 < se(t, e).length } }), contains: le(function (t) { return t = t.replace(te, ne), function (e) { return -1 < (e.textContent || o(e)).indexOf(t) } }), lang: le(function (n) { return V.test(n || "") || se.error("unsupported lang: " + n), n = n.replace(te, ne).toLowerCase(), function (e) { var t; do { if (t = E ? e.lang : e.getAttribute("xml:lang") || e.getAttribute("lang")) return (t = t.toLowerCase()) === n || 0 === t.indexOf(n + "-") } while ((e = e.parentNode) && 1 === e.nodeType); return !1 } }), target: function (e) { var t = n.location && n.location.hash; return t && t.slice(1) === e.id }, root: function (e) { return e === a }, focus: function (e) { return e === C.activeElement && (!C.hasFocus || C.hasFocus()) && !!(e.type || e.href || ~e.tabIndex) }, enabled: ge(!1), disabled: ge(!0), checked: function (e) { var t = e.nodeName.toLowerCase(); return "input" === t && !!e.checked || "option" === t && !!e.selected }, selected: function (e) { return e.parentNode && e.parentNode.selectedIndex, !0 === e.selected }, empty: function (e) { for (e = e.firstChild; e; e = e.nextSibling)if (e.nodeType < 6) return !1; return !0 }, parent: function (e) { return !b.pseudos.empty(e) }, header: function (e) { return J.test(e.nodeName) }, input: function (e) { return Q.test(e.nodeName) }, button: function (e) { var t = e.nodeName.toLowerCase(); return "input" === t && "button" === e.type || "button" === t }, text: function (e) { var t; return "input" === e.nodeName.toLowerCase() && "text" === e.type && (null == (t = e.getAttribute("type")) || "text" === t.toLowerCase()) }, first: ve(function () { return [0] }), last: ve(function (e, t) { return [t - 1] }), eq: ve(function (e, t, n) { return [n < 0 ? n + t : n] }), even: ve(function (e, t) { for (var n = 0; n < t; n += 2)e.push(n); return e }), odd: ve(function (e, t) { for (var n = 1; n < t; n += 2)e.push(n); return e }), lt: ve(function (e, t, n) { for (var r = n < 0 ? n + t : t < n ? t : n; 0 <= --r;)e.push(r); return e }), gt: ve(function (e, t, n) { for (var r = n < 0 ? n + t : n; ++r < t;)e.push(r); return e }) } }).pseudos.nth = b.pseudos.eq, { radio: !0, checkbox: !0, file: !0, password: !0, image: !0 }) b.pseudos[e] = de(e); for (e in { submit: !0, reset: !0 }) b.pseudos[e] = he(e); function me() { } function xe(e) { for (var t = 0, n = e.length, r = ""; t < n; t++)r += e[t].value; return r } function be(s, e, t) { var u = e.dir, l = e.next, c = l || u, f = t && "parentNode" === c, p = r++; return e.first ? function (e, t, n) { while (e = e[u]) if (1 === e.nodeType || f) return s(e, t, n); return !1 } : function (e, t, n) { var r, i, o, a = [k, p]; if (n) { while (e = e[u]) if ((1 === e.nodeType || f) && s(e, t, n)) return !0 } else while (e = e[u]) if (1 === e.nodeType || f) if (i = (o = e[S] || (e[S] = {}))[e.uniqueID] || (o[e.uniqueID] = {}), l && l === e.nodeName.toLowerCase()) e = e[u] || e; else { if ((r = i[c]) && r[0] === k && r[1] === p) return a[2] = r[2]; if ((i[c] = a)[2] = s(e, t, n)) return !0 } return !1 } } function we(i) { return 1 < i.length ? function (e, t, n) { var r = i.length; while (r--) if (!i[r](e, t, n)) return !1; return !0 } : i[0] } function Te(e, t, n, r, i) { for (var o, a = [], s = 0, u = e.length, l = null != t; s < u; s++)(o = e[s]) && (n && !n(o, r, i) || (a.push(o), l && t.push(s))); return a } function Ce(d, h, g, v, y, e) { return v && !v[S] && (v = Ce(v)), y && !y[S] && (y = Ce(y, e)), le(function (e, t, n, r) { var i, o, a, s = [], u = [], l = t.length, c = e || function (e, t, n) { for (var r = 0, i = t.length; r < i; r++)se(e, t[r], n); return n }(h || "*", n.nodeType ? [n] : n, []), f = !d || !e && h ? c : Te(c, s, d, n, r), p = g ? y || (e ? d : l || v) ? [] : t : f; if (g && g(f, p, n, r), v) { i = Te(p, u), v(i, [], n, r), o = i.length; while (o--) (a = i[o]) && (p[u[o]] = !(f[u[o]] = a)) } if (e) { if (y || d) { if (y) { i = [], o = p.length; while (o--) (a = p[o]) && i.push(f[o] = a); y(null, p = [], i, r) } o = p.length; while (o--) (a = p[o]) && -1 < (i = y ? P(e, a) : s[o]) && (e[i] = !(t[i] = a)) } } else p = Te(p === t ? p.splice(l, p.length) : p), y ? y(null, t, p, r) : H.apply(t, p) }) } function Ee(e) { for (var i, t, n, r = e.length, o = b.relative[e[0].type], a = o || b.relative[" "], s = o ? 1 : 0, u = be(function (e) { return e === i }, a, !0), l = be(function (e) { return -1 < P(i, e) }, a, !0), c = [function (e, t, n) { var r = !o && (n || t !== w) || ((i = t).nodeType ? u(e, t, n) : l(e, t, n)); return i = null, r }]; s < r; s++)if (t = b.relative[e[s].type]) c = [be(we(c), t)]; else { if ((t = b.filter[e[s].type].apply(null, e[s].matches))[S]) { for (n = ++s; n < r; n++)if (b.relative[e[n].type]) break; return Ce(1 < s && we(c), 1 < s && xe(e.slice(0, s - 1).concat({ value: " " === e[s - 2].type ? "*" : "" })).replace($, "$1"), t, s < n && Ee(e.slice(s, n)), n < r && Ee(e = e.slice(n)), n < r && xe(e)) } c.push(t) } return we(c) } return me.prototype = b.filters = b.pseudos, b.setFilters = new me, h = se.tokenize = function (e, t) { var n, r, i, o, a, s, u, l = x[e + " "]; if (l) return t ? 0 : l.slice(0); a = e, s = [], u = b.preFilter; while (a) { for (o in n && !(r = _.exec(a)) || (r && (a = a.slice(r[0].length) || a), s.push(i = [])), n = !1, (r = z.exec(a)) && (n = r.shift(), i.push({ value: n, type: r[0].replace($, " ") }), a = a.slice(n.length)), b.filter) !(r = G[o].exec(a)) || u[o] && !(r = u[o](r)) || (n = r.shift(), i.push({ value: n, type: o, matches: r }), a = a.slice(n.length)); if (!n) break } return t ? a.length : a ? se.error(e) : x(e, s).slice(0) }, f = se.compile = function (e, t) { var n, v, y, m, x, r, i = [], o = [], a = A[e + " "]; if (!a) { t || (t = h(e)), n = t.length; while (n--) (a = Ee(t[n]))[S] ? i.push(a) : o.push(a); (a = A(e, (v = o, m = 0 < (y = i).length, x = 0 < v.length, r = function (e, t, n, r, i) { var o, a, s, u = 0, l = "0", c = e && [], f = [], p = w, d = e || x && b.find.TAG("*", i), h = k += null == p ? 1 : Math.random() || .1, g = d.length; for (i && (w = t == C || t || i); l !== g && null != (o = d[l]); l++) { if (x && o) { a = 0, t || o.ownerDocument == C || (T(o), n = !E); while (s = v[a++]) if (s(o, t || C, n)) { r.push(o); break } i && (k = h) } m && ((o = !s && o) && u--, e && c.push(o)) } if (u += l, m && l !== u) { a = 0; while (s = y[a++]) s(c, f, t, n); if (e) { if (0 < u) while (l--) c[l] || f[l] || (f[l] = q.call(r)); f = Te(f) } H.apply(r, f), i && !e && 0 < f.length && 1 < u + y.length && se.uniqueSort(r) } return i && (k = h, w = p), c }, m ? le(r) : r))).selector = e } return a }, g = se.select = function (e, t, n, r) { var i, o, a, s, u, l = "function" == typeof e && e, c = !r && h(e = l.selector || e); if (n = n || [], 1 === c.length) { if (2 < (o = c[0] = c[0].slice(0)).length && "ID" === (a = o[0]).type && 9 === t.nodeType && E && b.relative[o[1].type]) { if (!(t = (b.find.ID(a.matches[0].replace(te, ne), t) || [])[0])) return n; l && (t = t.parentNode), e = e.slice(o.shift().value.length) } i = G.needsContext.test(e) ? 0 : o.length; while (i--) { if (a = o[i], b.relative[s = a.type]) break; if ((u = b.find[s]) && (r = u(a.matches[0].replace(te, ne), ee.test(o[0].type) && ye(t.parentNode) || t))) { if (o.splice(i, 1), !(e = r.length && xe(o))) return H.apply(n, r), n; break } } } return (l || f(e, c))(r, t, !E, n, !t || ee.test(e) && ye(t.parentNode) || t), n }, d.sortStable = S.split("").sort(D).join("") === S, d.detectDuplicates = !!l, T(), d.sortDetached = ce(function (e) { return 1 & e.compareDocumentPosition(C.createElement("fieldset")) }), ce(function (e) { return e.innerHTML = "<a href='#'></a>", "#" === e.firstChild.getAttribute("href") }) || fe("type|href|height|width", function (e, t, n) { if (!n) return e.getAttribute(t, "type" === t.toLowerCase() ? 1 : 2) }), d.attributes && ce(function (e) { return e.innerHTML = "<input/>", e.firstChild.setAttribute("value", ""), "" === e.firstChild.getAttribute("value") }) || fe("value", function (e, t, n) { if (!n && "input" === e.nodeName.toLowerCase()) return e.defaultValue }), ce(function (e) { return null == e.getAttribute("disabled") }) || fe(R, function (e, t, n) { var r; if (!n) return !0 === e[t] ? t.toLowerCase() : (r = e.getAttributeNode(t)) && r.specified ? r.value : null }), se }(C); S.find = d, S.expr = d.selectors, S.expr[":"] = S.expr.pseudos, S.uniqueSort = S.unique = d.uniqueSort, S.text = d.getText, S.isXMLDoc = d.isXML, S.contains = d.contains, S.escapeSelector = d.escape; var h = function (e, t, n) { var r = [], i = void 0 !== n; while ((e = e[t]) && 9 !== e.nodeType) if (1 === e.nodeType) { if (i && S(e).is(n)) break; r.push(e) } return r }, T = function (e, t) { for (var n = []; e; e = e.nextSibling)1 === e.nodeType && e !== t && n.push(e); return n }, k = S.expr.match.needsContext; function A(e, t) { return e.nodeName && e.nodeName.toLowerCase() === t.toLowerCase() } var N = /^<([a-z][^\/\0>:\x20\t\r\n\f]*)[\x20\t\r\n\f]*\/?>(?:<\/\1>|)$/i; function D(e, n, r) { return m(n) ? S.grep(e, function (e, t) { return !!n.call(e, t, e) !== r }) : n.nodeType ? S.grep(e, function (e) { return e === n !== r }) : "string" != typeof n ? S.grep(e, function (e) { return -1 < i.call(n, e) !== r }) : S.filter(n, e, r) } S.filter = function (e, t, n) { var r = t[0]; return n && (e = ":not(" + e + ")"), 1 === t.length && 1 === r.nodeType ? S.find.matchesSelector(r, e) ? [r] : [] : S.find.matches(e, S.grep(t, function (e) { return 1 === e.nodeType })) }, S.fn.extend({ find: function (e) { var t, n, r = this.length, i = this; if ("string" != typeof e) return this.pushStack(S(e).filter(function () { for (t = 0; t < r; t++)if (S.contains(i[t], this)) return !0 })); for (n = this.pushStack([]), t = 0; t < r; t++)S.find(e, i[t], n); return 1 < r ? S.uniqueSort(n) : n }, filter: function (e) { return this.pushStack(D(this, e || [], !1)) }, not: function (e) { return this.pushStack(D(this, e || [], !0)) }, is: function (e) { return !!D(this, "string" == typeof e && k.test(e) ? S(e) : e || [], !1).length } }); var j, q = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]+))$/; (S.fn.init = function (e, t, n) { var r, i; if (!e) return this; if (n = n || j, "string" == typeof e) { if (!(r = "<" === e[0] && ">" === e[e.length - 1] && 3 <= e.length ? [null, e, null] : q.exec(e)) || !r[1] && t) return !t || t.jquery ? (t || n).find(e) : this.constructor(t).find(e); if (r[1]) { if (t = t instanceof S ? t[0] : t, S.merge(this, S.parseHTML(r[1], t && t.nodeType ? t.ownerDocument || t : E, !0)), N.test(r[1]) && S.isPlainObject(t)) for (r in t) m(this[r]) ? this[r](t[r]) : this.attr(r, t[r]); return this } return (i = E.getElementById(r[2])) && (this[0] = i, this.length = 1), this } return e.nodeType ? (this[0] = e, this.length = 1, this) : m(e) ? void 0 !== n.ready ? n.ready(e) : e(S) : S.makeArray(e, this) }).prototype = S.fn, j = S(E); var L = /^(?:parents|prev(?:Until|All))/, H = { children: !0, contents: !0, next: !0, prev: !0 }; function O(e, t) { while ((e = e[t]) && 1 !== e.nodeType); return e } S.fn.extend({ has: function (e) { var t = S(e, this), n = t.length; return this.filter(function () { for (var e = 0; e < n; e++)if (S.contains(this, t[e])) return !0 }) }, closest: function (e, t) { var n, r = 0, i = this.length, o = [], a = "string" != typeof e && S(e); if (!k.test(e)) for (; r < i; r++)for (n = this[r]; n && n !== t; n = n.parentNode)if (n.nodeType < 11 && (a ? -1 < a.index(n) : 1 === n.nodeType && S.find.matchesSelector(n, e))) { o.push(n); break } return this.pushStack(1 < o.length ? S.uniqueSort(o) : o) }, index: function (e) { return e ? "string" == typeof e ? i.call(S(e), this[0]) : i.call(this, e.jquery ? e[0] : e) : this[0] && this[0].parentNode ? this.first().prevAll().length : -1 }, add: function (e, t) { return this.pushStack(S.uniqueSort(S.merge(this.get(), S(e, t)))) }, addBack: function (e) { return this.add(null == e ? this.prevObject : this.prevObject.filter(e)) } }), S.each({ parent: function (e) { var t = e.parentNode; return t && 11 !== t.nodeType ? t : null }, parents: function (e) { return h(e, "parentNode") }, parentsUntil: function (e, t, n) { return h(e, "parentNode", n) }, next: function (e) { return O(e, "nextSibling") }, prev: function (e) { return O(e, "previousSibling") }, nextAll: function (e) { return h(e, "nextSibling") }, prevAll: function (e) { return h(e, "previousSibling") }, nextUntil: function (e, t, n) { return h(e, "nextSibling", n) }, prevUntil: function (e, t, n) { return h(e, "previousSibling", n) }, siblings: function (e) { return T((e.parentNode || {}).firstChild, e) }, children: function (e) { return T(e.firstChild) }, contents: function (e) { return null != e.contentDocument && r(e.contentDocument) ? e.contentDocument : (A(e, "template") && (e = e.content || e), S.merge([], e.childNodes)) } }, function (r, i) { S.fn[r] = function (e, t) { var n = S.map(this, i, e); return "Until" !== r.slice(-5) && (t = e), t && "string" == typeof t && (n = S.filter(t, n)), 1 < this.length && (H[r] || S.uniqueSort(n), L.test(r) && n.reverse()), this.pushStack(n) } }); var P = /[^\x20\t\r\n\f]+/g; function R(e) { return e } function M(e) { throw e } function I(e, t, n, r) { var i; try { e && m(i = e.promise) ? i.call(e).done(t).fail(n) : e && m(i = e.then) ? i.call(e, t, n) : t.apply(void 0, [e].slice(r)) } catch (e) { n.apply(void 0, [e]) } } S.Callbacks = function (r) { var e, n; r = "string" == typeof r ? (e = r, n = {}, S.each(e.match(P) || [], function (e, t) { n[t] = !0 }), n) : S.extend({}, r); var i, t, o, a, s = [], u = [], l = -1, c = function () { for (a = a || r.once, o = i = !0; u.length; l = -1) { t = u.shift(); while (++l < s.length) !1 === s[l].apply(t[0], t[1]) && r.stopOnFalse && (l = s.length, t = !1) } r.memory || (t = !1), i = !1, a && (s = t ? [] : "") }, f = { add: function () { return s && (t && !i && (l = s.length - 1, u.push(t)), function n(e) { S.each(e, function (e, t) { m(t) ? r.unique && f.has(t) || s.push(t) : t && t.length && "string" !== w(t) && n(t) }) }(arguments), t && !i && c()), this }, remove: function () { return S.each(arguments, function (e, t) { var n; while (-1 < (n = S.inArray(t, s, n))) s.splice(n, 1), n <= l && l-- }), this }, has: function (e) { return e ? -1 < S.inArray(e, s) : 0 < s.length }, empty: function () { return s && (s = []), this }, disable: function () { return a = u = [], s = t = "", this }, disabled: function () { return !s }, lock: function () { return a = u = [], t || i || (s = t = ""), this }, locked: function () { return !!a }, fireWith: function (e, t) { return a || (t = [e, (t = t || []).slice ? t.slice() : t], u.push(t), i || c()), this }, fire: function () { return f.fireWith(this, arguments), this }, fired: function () { return !!o } }; return f }, S.extend({ Deferred: function (e) { var o = [["notify", "progress", S.Callbacks("memory"), S.Callbacks("memory"), 2], ["resolve", "done", S.Callbacks("once memory"), S.Callbacks("once memory"), 0, "resolved"], ["reject", "fail", S.Callbacks("once memory"), S.Callbacks("once memory"), 1, "rejected"]], i = "pending", a = { state: function () { return i }, always: function () { return s.done(arguments).fail(arguments), this }, "catch": function (e) { return a.then(null, e) }, pipe: function () { var i = arguments; return S.Deferred(function (r) { S.each(o, function (e, t) { var n = m(i[t[4]]) && i[t[4]]; s[t[1]](function () { var e = n && n.apply(this, arguments); e && m(e.promise) ? e.promise().progress(r.notify).done(r.resolve).fail(r.reject) : r[t[0] + "With"](this, n ? [e] : arguments) }) }), i = null }).promise() }, then: function (t, n, r) { var u = 0; function l(i, o, a, s) { return function () { var n = this, r = arguments, e = function () { var e, t; if (!(i < u)) { if ((e = a.apply(n, r)) === o.promise()) throw new TypeError("Thenable self-resolution"); t = e && ("object" == typeof e || "function" == typeof e) && e.then, m(t) ? s ? t.call(e, l(u, o, R, s), l(u, o, M, s)) : (u++, t.call(e, l(u, o, R, s), l(u, o, M, s), l(u, o, R, o.notifyWith))) : (a !== R && (n = void 0, r = [e]), (s || o.resolveWith)(n, r)) } }, t = s ? e : function () { try { e() } catch (e) { S.Deferred.exceptionHook && S.Deferred.exceptionHook(e, t.stackTrace), u <= i + 1 && (a !== M && (n = void 0, r = [e]), o.rejectWith(n, r)) } }; i ? t() : (S.Deferred.getStackHook && (t.stackTrace = S.Deferred.getStackHook()), C.setTimeout(t)) } } return S.Deferred(function (e) { o[0][3].add(l(0, e, m(r) ? r : R, e.notifyWith)), o[1][3].add(l(0, e, m(t) ? t : R)), o[2][3].add(l(0, e, m(n) ? n : M)) }).promise() }, promise: function (e) { return null != e ? S.extend(e, a) : a } }, s = {}; return S.each(o, function (e, t) { var n = t[2], r = t[5]; a[t[1]] = n.add, r && n.add(function () { i = r }, o[3 - e][2].disable, o[3 - e][3].disable, o[0][2].lock, o[0][3].lock), n.add(t[3].fire), s[t[0]] = function () { return s[t[0] + "With"](this === s ? void 0 : this, arguments), this }, s[t[0] + "With"] = n.fireWith }), a.promise(s), e && e.call(s, s), s }, when: function (e) { var n = arguments.length, t = n, r = Array(t), i = s.call(arguments), o = S.Deferred(), a = function (t) { return function (e) { r[t] = this, i[t] = 1 < arguments.length ? s.call(arguments) : e, --n || o.resolveWith(r, i) } }; if (n <= 1 && (I(e, o.done(a(t)).resolve, o.reject, !n), "pending" === o.state() || m(i[t] && i[t].then))) return o.then(); while (t--) I(i[t], a(t), o.reject); return o.promise() } }); var W = /^(Eval|Internal|Range|Reference|Syntax|Type|URI)Error$/; S.Deferred.exceptionHook = function (e, t) { C.console && C.console.warn && e && W.test(e.name) && C.console.warn("jQuery.Deferred exception: " + e.message, e.stack, t) }, S.readyException = function (e) { C.setTimeout(function () { throw e }) }; var F = S.Deferred(); function B() { E.removeEventListener("DOMContentLoaded", B), C.removeEventListener("load", B), S.ready() } S.fn.ready = function (e) { return F.then(e)["catch"](function (e) { S.readyException(e) }), this }, S.extend({ isReady: !1, readyWait: 1, ready: function (e) { (!0 === e ? --S.readyWait : S.isReady) || (S.isReady = !0) !== e && 0 < --S.readyWait || F.resolveWith(E, [S]) } }), S.ready.then = F.then, "complete" === E.readyState || "loading" !== E.readyState && !E.documentElement.doScroll ? C.setTimeout(S.ready) : (E.addEventListener("DOMContentLoaded", B), C.addEventListener("load", B)); var $ = function (e, t, n, r, i, o, a) { var s = 0, u = e.length, l = null == n; if ("object" === w(n)) for (s in i = !0, n) $(e, t, s, n[s], !0, o, a); else if (void 0 !== r && (i = !0, m(r) || (a = !0), l && (a ? (t.call(e, r), t = null) : (l = t, t = function (e, t, n) { return l.call(S(e), n) })), t)) for (; s < u; s++)t(e[s], n, a ? r : r.call(e[s], s, t(e[s], n))); return i ? e : l ? t.call(e) : u ? t(e[0], n) : o }, _ = /^-ms-/, z = /-([a-z])/g; function U(e, t) { return t.toUpperCase() } function X(e) { return e.replace(_, "ms-").replace(z, U) } var V = function (e) { return 1 === e.nodeType || 9 === e.nodeType || !+e.nodeType }; function G() { this.expando = S.expando + G.uid++ } G.uid = 1, G.prototype = { cache: function (e) { var t = e[this.expando]; return t || (t = Object.create(null), V(e) && (e.nodeType ? e[this.expando] = t : Object.defineProperty(e, this.expando, { value: t, configurable: !0 }))), t }, set: function (e, t, n) { var r, i = this.cache(e); if ("string" == typeof t) i[X(t)] = n; else for (r in t) i[X(r)] = t[r]; return i }, get: function (e, t) { return void 0 === t ? this.cache(e) : e[this.expando] && e[this.expando][X(t)] }, access: function (e, t, n) { return void 0 === t || t && "string" == typeof t && void 0 === n ? this.get(e, t) : (this.set(e, t, n), void 0 !== n ? n : t) }, remove: function (e, t) { var n, r = e[this.expando]; if (void 0 !== r) { if (void 0 !== t) { n = (t = Array.isArray(t) ? t.map(X) : (t = X(t)) in r ? [t] : t.match(P) || []).length; while (n--) delete r[t[n]] } (void 0 === t || S.isEmptyObject(r)) && (e.nodeType ? e[this.expando] = void 0 : delete e[this.expando]) } }, hasData: function (e) { var t = e[this.expando]; return void 0 !== t && !S.isEmptyObject(t) } }; var Y = new G, Q = new G, J = /^(?:\{[\w\W]*\}|\[[\w\W]*\])$/, K = /[A-Z]/g; function Z(e, t, n) { var r, i; if (void 0 === n && 1 === e.nodeType) if (r = "data-" + t.replace(K, "-$&").toLowerCase(), "string" == typeof (n = e.getAttribute(r))) { try { n = "true" === (i = n) || "false" !== i && ("null" === i ? null : i === +i + "" ? +i : J.test(i) ? JSON.parse(i) : i) } catch (e) { } Q.set(e, t, n) } else n = void 0; return n } S.extend({ hasData: function (e) { return Q.hasData(e) || Y.hasData(e) }, data: function (e, t, n) { return Q.access(e, t, n) }, removeData: function (e, t) { Q.remove(e, t) }, _data: function (e, t, n) { return Y.access(e, t, n) }, _removeData: function (e, t) { Y.remove(e, t) } }), S.fn.extend({ data: function (n, e) { var t, r, i, o = this[0], a = o && o.attributes; if (void 0 === n) { if (this.length && (i = Q.get(o), 1 === o.nodeType && !Y.get(o, "hasDataAttrs"))) { t = a.length; while (t--) a[t] && 0 === (r = a[t].name).indexOf("data-") && (r = X(r.slice(5)), Z(o, r, i[r])); Y.set(o, "hasDataAttrs", !0) } return i } return "object" == typeof n ? this.each(function () { Q.set(this, n) }) : $(this, function (e) { var t; if (o && void 0 === e) return void 0 !== (t = Q.get(o, n)) ? t : void 0 !== (t = Z(o, n)) ? t : void 0; this.each(function () { Q.set(this, n, e) }) }, null, e, 1 < arguments.length, null, !0) }, removeData: function (e) { return this.each(function () { Q.remove(this, e) }) } }), S.extend({ queue: function (e, t, n) { var r; if (e) return t = (t || "fx") + "queue", r = Y.get(e, t), n && (!r || Array.isArray(n) ? r = Y.access(e, t, S.makeArray(n)) : r.push(n)), r || [] }, dequeue: function (e, t) { t = t || "fx"; var n = S.queue(e, t), r = n.length, i = n.shift(), o = S._queueHooks(e, t); "inprogress" === i && (i = n.shift(), r--), i && ("fx" === t && n.unshift("inprogress"), delete o.stop, i.call(e, function () { S.dequeue(e, t) }, o)), !r && o && o.empty.fire() }, _queueHooks: function (e, t) { var n = t + "queueHooks"; return Y.get(e, n) || Y.access(e, n, { empty: S.Callbacks("once memory").add(function () { Y.remove(e, [t + "queue", n]) }) }) } }), S.fn.extend({ queue: function (t, n) { var e = 2; return "string" != typeof t && (n = t, t = "fx", e--), arguments.length < e ? S.queue(this[0], t) : void 0 === n ? this : this.each(function () { var e = S.queue(this, t, n); S._queueHooks(this, t), "fx" === t && "inprogress" !== e[0] && S.dequeue(this, t) }) }, dequeue: function (e) { return this.each(function () { S.dequeue(this, e) }) }, clearQueue: function (e) { return this.queue(e || "fx", []) }, promise: function (e, t) { var n, r = 1, i = S.Deferred(), o = this, a = this.length, s = function () { --r || i.resolveWith(o, [o]) }; "string" != typeof e && (t = e, e = void 0), e = e || "fx"; while (a--) (n = Y.get(o[a], e + "queueHooks")) && n.empty && (r++, n.empty.add(s)); return s(), i.promise(t) } }); var ee = /[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source, te = new RegExp("^(?:([+-])=|)(" + ee + ")([a-z%]*)$", "i"), ne = ["Top", "Right", "Bottom", "Left"], re = E.documentElement, ie = function (e) { return S.contains(e.ownerDocument, e) }, oe = { composed: !0 }; re.getRootNode && (ie = function (e) { return S.contains(e.ownerDocument, e) || e.getRootNode(oe) === e.ownerDocument }); var ae = function (e, t) { return "none" === (e = t || e).style.display || "" === e.style.display && ie(e) && "none" === S.css(e, "display") }; function se(e, t, n, r) { var i, o, a = 20, s = r ? function () { return r.cur() } : function () { return S.css(e, t, "") }, u = s(), l = n && n[3] || (S.cssNumber[t] ? "" : "px"), c = e.nodeType && (S.cssNumber[t] || "px" !== l && +u) && te.exec(S.css(e, t)); if (c && c[3] !== l) { u /= 2, l = l || c[3], c = +u || 1; while (a--) S.style(e, t, c + l), (1 - o) * (1 - (o = s() / u || .5)) <= 0 && (a = 0), c /= o; c *= 2, S.style(e, t, c + l), n = n || [] } return n && (c = +c || +u || 0, i = n[1] ? c + (n[1] + 1) * n[2] : +n[2], r && (r.unit = l, r.start = c, r.end = i)), i } var ue = {}; function le(e, t) { for (var n, r, i, o, a, s, u, l = [], c = 0, f = e.length; c < f; c++)(r = e[c]).style && (n = r.style.display, t ? ("none" === n && (l[c] = Y.get(r, "display") || null, l[c] || (r.style.display = "")), "" === r.style.display && ae(r) && (l[c] = (u = a = o = void 0, a = (i = r).ownerDocument, s = i.nodeName, (u = ue[s]) || (o = a.body.appendChild(a.createElement(s)), u = S.css(o, "display"), o.parentNode.removeChild(o), "none" === u && (u = "block"), ue[s] = u)))) : "none" !== n && (l[c] = "none", Y.set(r, "display", n))); for (c = 0; c < f; c++)null != l[c] && (e[c].style.display = l[c]); return e } S.fn.extend({ show: function () { return le(this, !0) }, hide: function () { return le(this) }, toggle: function (e) { return "boolean" == typeof e ? e ? this.show() : this.hide() : this.each(function () { ae(this) ? S(this).show() : S(this).hide() }) } }); var ce, fe, pe = /^(?:checkbox|radio)$/i, de = /<([a-z][^\/\0>\x20\t\r\n\f]*)/i, he = /^$|^module$|\/(?:java|ecma)script/i; ce = E.createDocumentFragment().appendChild(E.createElement("div")), (fe = E.createElement("input")).setAttribute("type", "radio"), fe.setAttribute("checked", "checked"), fe.setAttribute("name", "t"), ce.appendChild(fe), y.checkClone = ce.cloneNode(!0).cloneNode(!0).lastChild.checked, ce.innerHTML = "<textarea>x</textarea>", y.noCloneChecked = !!ce.cloneNode(!0).lastChild.defaultValue, ce.innerHTML = "<option></option>", y.option = !!ce.lastChild; var ge = { thead: [1, "<table>", "</table>"], col: [2, "<table><colgroup>", "</colgroup></table>"], tr: [2, "<table><tbody>", "</tbody></table>"], td: [3, "<table><tbody><tr>", "</tr></tbody></table>"], _default: [0, "", ""] }; function ve(e, t) { var n; return n = "undefined" != typeof e.getElementsByTagName ? e.getElementsByTagName(t || "*") : "undefined" != typeof e.querySelectorAll ? e.querySelectorAll(t || "*") : [], void 0 === t || t && A(e, t) ? S.merge([e], n) : n } function ye(e, t) { for (var n = 0, r = e.length; n < r; n++)Y.set(e[n], "globalEval", !t || Y.get(t[n], "globalEval")) } ge.tbody = ge.tfoot = ge.colgroup = ge.caption = ge.thead, ge.th = ge.td, y.option || (ge.optgroup = ge.option = [1, "<select multiple='multiple'>", "</select>"]); var me = /<|&#?\w+;/; function xe(e, t, n, r, i) { for (var o, a, s, u, l, c, f = t.createDocumentFragment(), p = [], d = 0, h = e.length; d < h; d++)if ((o = e[d]) || 0 === o) if ("object" === w(o)) S.merge(p, o.nodeType ? [o] : o); else if (me.test(o)) { a = a || f.appendChild(t.createElement("div")), s = (de.exec(o) || ["", ""])[1].toLowerCase(), u = ge[s] || ge._default, a.innerHTML = u[1] + S.htmlPrefilter(o) + u[2], c = u[0]; while (c--) a = a.lastChild; S.merge(p, a.childNodes), (a = f.firstChild).textContent = "" } else p.push(t.createTextNode(o)); f.textContent = "", d = 0; while (o = p[d++]) if (r && -1 < S.inArray(o, r)) i && i.push(o); else if (l = ie(o), a = ve(f.appendChild(o), "script"), l && ye(a), n) { c = 0; while (o = a[c++]) he.test(o.type || "") && n.push(o) } return f } var be = /^key/, we = /^(?:mouse|pointer|contextmenu|drag|drop)|click/, Te = /^([^.]*)(?:\.(.+)|)/; function Ce() { return !0 } function Ee() { return !1 } function Se(e, t) { return e === function () { try { return E.activeElement } catch (e) { } }() == ("focus" === t) } function ke(e, t, n, r, i, o) { var a, s; if ("object" == typeof t) { for (s in "string" != typeof n && (r = r || n, n = void 0), t) ke(e, s, n, r, t[s], o); return e } if (null == r && null == i ? (i = n, r = n = void 0) : null == i && ("string" == typeof n ? (i = r, r = void 0) : (i = r, r = n, n = void 0)), !1 === i) i = Ee; else if (!i) return e; return 1 === o && (a = i, (i = function (e) { return S().off(e), a.apply(this, arguments) }).guid = a.guid || (a.guid = S.guid++)), e.each(function () { S.event.add(this, t, i, r, n) }) } function Ae(e, i, o) { o ? (Y.set(e, i, !1), S.event.add(e, i, { namespace: !1, handler: function (e) { var t, n, r = Y.get(this, i); if (1 & e.isTrigger && this[i]) { if (r.length) (S.event.special[i] || {}).delegateType && e.stopPropagation(); else if (r = s.call(arguments), Y.set(this, i, r), t = o(this, i), this[i](), r !== (n = Y.get(this, i)) || t ? Y.set(this, i, !1) : n = {}, r !== n) return e.stopImmediatePropagation(), e.preventDefault(), n.value } else r.length && (Y.set(this, i, { value: S.event.trigger(S.extend(r[0], S.Event.prototype), r.slice(1), this) }), e.stopImmediatePropagation()) } })) : void 0 === Y.get(e, i) && S.event.add(e, i, Ce) } S.event = { global: {}, add: function (t, e, n, r, i) { var o, a, s, u, l, c, f, p, d, h, g, v = Y.get(t); if (V(t)) { n.handler && (n = (o = n).handler, i = o.selector), i && S.find.matchesSelector(re, i), n.guid || (n.guid = S.guid++), (u = v.events) || (u = v.events = Object.create(null)), (a = v.handle) || (a = v.handle = function (e) { return "undefined" != typeof S && S.event.triggered !== e.type ? S.event.dispatch.apply(t, arguments) : void 0 }), l = (e = (e || "").match(P) || [""]).length; while (l--) d = g = (s = Te.exec(e[l]) || [])[1], h = (s[2] || "").split(".").sort(), d && (f = S.event.special[d] || {}, d = (i ? f.delegateType : f.bindType) || d, f = S.event.special[d] || {}, c = S.extend({ type: d, origType: g, data: r, handler: n, guid: n.guid, selector: i, needsContext: i && S.expr.match.needsContext.test(i), namespace: h.join(".") }, o), (p = u[d]) || ((p = u[d] = []).delegateCount = 0, f.setup && !1 !== f.setup.call(t, r, h, a) || t.addEventListener && t.addEventListener(d, a)), f.add && (f.add.call(t, c), c.handler.guid || (c.handler.guid = n.guid)), i ? p.splice(p.delegateCount++, 0, c) : p.push(c), S.event.global[d] = !0) } }, remove: function (e, t, n, r, i) { var o, a, s, u, l, c, f, p, d, h, g, v = Y.hasData(e) && Y.get(e); if (v && (u = v.events)) { l = (t = (t || "").match(P) || [""]).length; while (l--) if (d = g = (s = Te.exec(t[l]) || [])[1], h = (s[2] || "").split(".").sort(), d) { f = S.event.special[d] || {}, p = u[d = (r ? f.delegateType : f.bindType) || d] || [], s = s[2] && new RegExp("(^|\\.)" + h.join("\\.(?:.*\\.|)") + "(\\.|$)"), a = o = p.length; while (o--) c = p[o], !i && g !== c.origType || n && n.guid !== c.guid || s && !s.test(c.namespace) || r && r !== c.selector && ("**" !== r || !c.selector) || (p.splice(o, 1), c.selector && p.delegateCount--, f.remove && f.remove.call(e, c)); a && !p.length && (f.teardown && !1 !== f.teardown.call(e, h, v.handle) || S.removeEvent(e, d, v.handle), delete u[d]) } else for (d in u) S.event.remove(e, d + t[l], n, r, !0); S.isEmptyObject(u) && Y.remove(e, "handle events") } }, dispatch: function (e) { var t, n, r, i, o, a, s = new Array(arguments.length), u = S.event.fix(e), l = (Y.get(this, "events") || Object.create(null))[u.type] || [], c = S.event.special[u.type] || {}; for (s[0] = u, t = 1; t < arguments.length; t++)s[t] = arguments[t]; if (u.delegateTarget = this, !c.preDispatch || !1 !== c.preDispatch.call(this, u)) { a = S.event.handlers.call(this, u, l), t = 0; while ((i = a[t++]) && !u.isPropagationStopped()) { u.currentTarget = i.elem, n = 0; while ((o = i.handlers[n++]) && !u.isImmediatePropagationStopped()) u.rnamespace && !1 !== o.namespace && !u.rnamespace.test(o.namespace) || (u.handleObj = o, u.data = o.data, void 0 !== (r = ((S.event.special[o.origType] || {}).handle || o.handler).apply(i.elem, s)) && !1 === (u.result = r) && (u.preventDefault(), u.stopPropagation())) } return c.postDispatch && c.postDispatch.call(this, u), u.result } }, handlers: function (e, t) { var n, r, i, o, a, s = [], u = t.delegateCount, l = e.target; if (u && l.nodeType && !("click" === e.type && 1 <= e.button)) for (; l !== this; l = l.parentNode || this)if (1 === l.nodeType && ("click" !== e.type || !0 !== l.disabled)) { for (o = [], a = {}, n = 0; n < u; n++)void 0 === a[i = (r = t[n]).selector + " "] && (a[i] = r.needsContext ? -1 < S(i, this).index(l) : S.find(i, this, null, [l]).length), a[i] && o.push(r); o.length && s.push({ elem: l, handlers: o }) } return l = this, u < t.length && s.push({ elem: l, handlers: t.slice(u) }), s }, addProp: function (t, e) { Object.defineProperty(S.Event.prototype, t, { enumerable: !0, configurable: !0, get: m(e) ? function () { if (this.originalEvent) return e(this.originalEvent) } : function () { if (this.originalEvent) return this.originalEvent[t] }, set: function (e) { Object.defineProperty(this, t, { enumerable: !0, configurable: !0, writable: !0, value: e }) } }) }, fix: function (e) { return e[S.expando] ? e : new S.Event(e) }, special: { load: { noBubble: !0 }, click: { setup: function (e) { var t = this || e; return pe.test(t.type) && t.click && A(t, "input") && Ae(t, "click", Ce), !1 }, trigger: function (e) { var t = this || e; return pe.test(t.type) && t.click && A(t, "input") && Ae(t, "click"), !0 }, _default: function (e) { var t = e.target; return pe.test(t.type) && t.click && A(t, "input") && Y.get(t, "click") || A(t, "a") } }, beforeunload: { postDispatch: function (e) { void 0 !== e.result && e.originalEvent && (e.originalEvent.returnValue = e.result) } } } }, S.removeEvent = function (e, t, n) { e.removeEventListener && e.removeEventListener(t, n) }, S.Event = function (e, t) { if (!(this instanceof S.Event)) return new S.Event(e, t); e && e.type ? (this.originalEvent = e, this.type = e.type, this.isDefaultPrevented = e.defaultPrevented || void 0 === e.defaultPrevented && !1 === e.returnValue ? Ce : Ee, this.target = e.target && 3 === e.target.nodeType ? e.target.parentNode : e.target, this.currentTarget = e.currentTarget, this.relatedTarget = e.relatedTarget) : this.type = e, t && S.extend(this, t), this.timeStamp = e && e.timeStamp || Date.now(), this[S.expando] = !0 }, S.Event.prototype = { constructor: S.Event, isDefaultPrevented: Ee, isPropagationStopped: Ee, isImmediatePropagationStopped: Ee, isSimulated: !1, preventDefault: function () { var e = this.originalEvent; this.isDefaultPrevented = Ce, e && !this.isSimulated && e.preventDefault() }, stopPropagation: function () { var e = this.originalEvent; this.isPropagationStopped = Ce, e && !this.isSimulated && e.stopPropagation() }, stopImmediatePropagation: function () { var e = this.originalEvent; this.isImmediatePropagationStopped = Ce, e && !this.isSimulated && e.stopImmediatePropagation(), this.stopPropagation() } }, S.each({ altKey: !0, bubbles: !0, cancelable: !0, changedTouches: !0, ctrlKey: !0, detail: !0, eventPhase: !0, metaKey: !0, pageX: !0, pageY: !0, shiftKey: !0, view: !0, "char": !0, code: !0, charCode: !0, key: !0, keyCode: !0, button: !0, buttons: !0, clientX: !0, clientY: !0, offsetX: !0, offsetY: !0, pointerId: !0, pointerType: !0, screenX: !0, screenY: !0, targetTouches: !0, toElement: !0, touches: !0, which: function (e) { var t = e.button; return null == e.which && be.test(e.type) ? null != e.charCode ? e.charCode : e.keyCode : !e.which && void 0 !== t && we.test(e.type) ? 1 & t ? 1 : 2 & t ? 3 : 4 & t ? 2 : 0 : e.which } }, S.event.addProp), S.each({ focus: "focusin", blur: "focusout" }, function (e, t) { S.event.special[e] = { setup: function () { return Ae(this, e, Se), !1 }, trigger: function () { return Ae(this, e), !0 }, delegateType: t } }), S.each({ mouseenter: "mouseover", mouseleave: "mouseout", pointerenter: "pointerover", pointerleave: "pointerout" }, function (e, i) { S.event.special[e] = { delegateType: i, bindType: i, handle: function (e) { var t, n = e.relatedTarget, r = e.handleObj; return n && (n === this || S.contains(this, n)) || (e.type = r.origType, t = r.handler.apply(this, arguments), e.type = i), t } } }), S.fn.extend({ on: function (e, t, n, r) { return ke(this, e, t, n, r) }, one: function (e, t, n, r) { return ke(this, e, t, n, r, 1) }, off: function (e, t, n) { var r, i; if (e && e.preventDefault && e.handleObj) return r = e.handleObj, S(e.delegateTarget).off(r.namespace ? r.origType + "." + r.namespace : r.origType, r.selector, r.handler), this; if ("object" == typeof e) { for (i in e) this.off(i, t, e[i]); return this } return !1 !== t && "function" != typeof t || (n = t, t = void 0), !1 === n && (n = Ee), this.each(function () { S.event.remove(this, e, n, t) }) } }); var Ne = /<script|<style|<link/i, De = /checked\s*(?:[^=]|=\s*.checked.)/i, je = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g; function qe(e, t) { return A(e, "table") && A(11 !== t.nodeType ? t : t.firstChild, "tr") && S(e).children("tbody")[0] || e } function Le(e) { return e.type = (null !== e.getAttribute("type")) + "/" + e.type, e } function He(e) { return "true/" === (e.type || "").slice(0, 5) ? e.type = e.type.slice(5) : e.removeAttribute("type"), e } function Oe(e, t) { var n, r, i, o, a, s; if (1 === t.nodeType) { if (Y.hasData(e) && (s = Y.get(e).events)) for (i in Y.remove(t, "handle events"), s) for (n = 0, r = s[i].length; n < r; n++)S.event.add(t, i, s[i][n]); Q.hasData(e) && (o = Q.access(e), a = S.extend({}, o), Q.set(t, a)) } } function Pe(n, r, i, o) { r = g(r); var e, t, a, s, u, l, c = 0, f = n.length, p = f - 1, d = r[0], h = m(d); if (h || 1 < f && "string" == typeof d && !y.checkClone && De.test(d)) return n.each(function (e) { var t = n.eq(e); h && (r[0] = d.call(this, e, t.html())), Pe(t, r, i, o) }); if (f && (t = (e = xe(r, n[0].ownerDocument, !1, n, o)).firstChild, 1 === e.childNodes.length && (e = t), t || o)) { for (s = (a = S.map(ve(e, "script"), Le)).length; c < f; c++)u = e, c !== p && (u = S.clone(u, !0, !0), s && S.merge(a, ve(u, "script"))), i.call(n[c], u, c); if (s) for (l = a[a.length - 1].ownerDocument, S.map(a, He), c = 0; c < s; c++)u = a[c], he.test(u.type || "") && !Y.access(u, "globalEval") && S.contains(l, u) && (u.src && "module" !== (u.type || "").toLowerCase() ? S._evalUrl && !u.noModule && S._evalUrl(u.src, { nonce: u.nonce || u.getAttribute("nonce") }, l) : b(u.textContent.replace(je, ""), u, l)) } return n } function Re(e, t, n) { for (var r, i = t ? S.filter(t, e) : e, o = 0; null != (r = i[o]); o++)n || 1 !== r.nodeType || S.cleanData(ve(r)), r.parentNode && (n && ie(r) && ye(ve(r, "script")), r.parentNode.removeChild(r)); return e } S.extend({ htmlPrefilter: function (e) { return e }, clone: function (e, t, n) { var r, i, o, a, s, u, l, c = e.cloneNode(!0), f = ie(e); if (!(y.noCloneChecked || 1 !== e.nodeType && 11 !== e.nodeType || S.isXMLDoc(e))) for (a = ve(c), r = 0, i = (o = ve(e)).length; r < i; r++)s = o[r], u = a[r], void 0, "input" === (l = u.nodeName.toLowerCase()) && pe.test(s.type) ? u.checked = s.checked : "input" !== l && "textarea" !== l || (u.defaultValue = s.defaultValue); if (t) if (n) for (o = o || ve(e), a = a || ve(c), r = 0, i = o.length; r < i; r++)Oe(o[r], a[r]); else Oe(e, c); return 0 < (a = ve(c, "script")).length && ye(a, !f && ve(e, "script")), c }, cleanData: function (e) { for (var t, n, r, i = S.event.special, o = 0; void 0 !== (n = e[o]); o++)if (V(n)) { if (t = n[Y.expando]) { if (t.events) for (r in t.events) i[r] ? S.event.remove(n, r) : S.removeEvent(n, r, t.handle); n[Y.expando] = void 0 } n[Q.expando] && (n[Q.expando] = void 0) } } }), S.fn.extend({ detach: function (e) { return Re(this, e, !0) }, remove: function (e) { return Re(this, e) }, text: function (e) { return $(this, function (e) { return void 0 === e ? S.text(this) : this.empty().each(function () { 1 !== this.nodeType && 11 !== this.nodeType && 9 !== this.nodeType || (this.textContent = e) }) }, null, e, arguments.length) }, append: function () { return Pe(this, arguments, function (e) { 1 !== this.nodeType && 11 !== this.nodeType && 9 !== this.nodeType || qe(this, e).appendChild(e) }) }, prepend: function () { return Pe(this, arguments, function (e) { if (1 === this.nodeType || 11 === this.nodeType || 9 === this.nodeType) { var t = qe(this, e); t.insertBefore(e, t.firstChild) } }) }, before: function () { return Pe(this, arguments, function (e) { this.parentNode && this.parentNode.insertBefore(e, this) }) }, after: function () { return Pe(this, arguments, function (e) { this.parentNode && this.parentNode.insertBefore(e, this.nextSibling) }) }, empty: function () { for (var e, t = 0; null != (e = this[t]); t++)1 === e.nodeType && (S.cleanData(ve(e, !1)), e.textContent = ""); return this }, clone: function (e, t) { return e = null != e && e, t = null == t ? e : t, this.map(function () { return S.clone(this, e, t) }) }, html: function (e) { return $(this, function (e) { var t = this[0] || {}, n = 0, r = this.length; if (void 0 === e && 1 === t.nodeType) return t.innerHTML; if ("string" == typeof e && !Ne.test(e) && !ge[(de.exec(e) || ["", ""])[1].toLowerCase()]) { e = S.htmlPrefilter(e); try { for (; n < r; n++)1 === (t = this[n] || {}).nodeType && (S.cleanData(ve(t, !1)), t.innerHTML = e); t = 0 } catch (e) { } } t && this.empty().append(e) }, null, e, arguments.length) }, replaceWith: function () { var n = []; return Pe(this, arguments, function (e) { var t = this.parentNode; S.inArray(this, n) < 0 && (S.cleanData(ve(this)), t && t.replaceChild(e, this)) }, n) } }), S.each({ appendTo: "append", prependTo: "prepend", insertBefore: "before", insertAfter: "after", replaceAll: "replaceWith" }, function (e, a) { S.fn[e] = function (e) { for (var t, n = [], r = S(e), i = r.length - 1, o = 0; o <= i; o++)t = o === i ? this : this.clone(!0), S(r[o])[a](t), u.apply(n, t.get()); return this.pushStack(n) } }); var Me = new RegExp("^(" + ee + ")(?!px)[a-z%]+$", "i"), Ie = function (e) { var t = e.ownerDocument.defaultView; return t && t.opener || (t = C), t.getComputedStyle(e) }, We = function (e, t, n) { var r, i, o = {}; for (i in t) o[i] = e.style[i], e.style[i] = t[i]; for (i in r = n.call(e), t) e.style[i] = o[i]; return r }, Fe = new RegExp(ne.join("|"), "i"); function Be(e, t, n) { var r, i, o, a, s = e.style; return (n = n || Ie(e)) && ("" !== (a = n.getPropertyValue(t) || n[t]) || ie(e) || (a = S.style(e, t)), !y.pixelBoxStyles() && Me.test(a) && Fe.test(t) && (r = s.width, i = s.minWidth, o = s.maxWidth, s.minWidth = s.maxWidth = s.width = a, a = n.width, s.width = r, s.minWidth = i, s.maxWidth = o)), void 0 !== a ? a + "" : a } function $e(e, t) { return { get: function () { if (!e()) return (this.get = t).apply(this, arguments); delete this.get } } } !function () { function e() { if (l) { u.style.cssText = "position:absolute;left:-11111px;width:60px;margin-top:1px;padding:0;border:0", l.style.cssText = "position:relative;display:block;box-sizing:border-box;overflow:scroll;margin:auto;border:1px;padding:1px;width:60%;top:1%", re.appendChild(u).appendChild(l); var e = C.getComputedStyle(l); n = "1%" !== e.top, s = 12 === t(e.marginLeft), l.style.right = "60%", o = 36 === t(e.right), r = 36 === t(e.width), l.style.position = "absolute", i = 12 === t(l.offsetWidth / 3), re.removeChild(u), l = null } } function t(e) { return Math.round(parseFloat(e)) } var n, r, i, o, a, s, u = E.createElement("div"), l = E.createElement("div"); l.style && (l.style.backgroundClip = "content-box", l.cloneNode(!0).style.backgroundClip = "", y.clearCloneStyle = "content-box" === l.style.backgroundClip, S.extend(y, { boxSizingReliable: function () { return e(), r }, pixelBoxStyles: function () { return e(), o }, pixelPosition: function () { return e(), n }, reliableMarginLeft: function () { return e(), s }, scrollboxSize: function () { return e(), i }, reliableTrDimensions: function () { var e, t, n, r; return null == a && (e = E.createElement("table"), t = E.createElement("tr"), n = E.createElement("div"), e.style.cssText = "position:absolute;left:-11111px", t.style.height = "1px", n.style.height = "9px", re.appendChild(e).appendChild(t).appendChild(n), r = C.getComputedStyle(t), a = 3 < parseInt(r.height), re.removeChild(e)), a } })) }(); var _e = ["Webkit", "Moz", "ms"], ze = E.createElement("div").style, Ue = {}; function Xe(e) { var t = S.cssProps[e] || Ue[e]; return t || (e in ze ? e : Ue[e] = function (e) { var t = e[0].toUpperCase() + e.slice(1), n = _e.length; while (n--) if ((e = _e[n] + t) in ze) return e }(e) || e) } var Ve = /^(none|table(?!-c[ea]).+)/, Ge = /^--/, Ye = { position: "absolute", visibility: "hidden", display: "block" }, Qe = { letterSpacing: "0", fontWeight: "400" }; function Je(e, t, n) { var r = te.exec(t); return r ? Math.max(0, r[2] - (n || 0)) + (r[3] || "px") : t } function Ke(e, t, n, r, i, o) { var a = "width" === t ? 1 : 0, s = 0, u = 0; if (n === (r ? "border" : "content")) return 0; for (; a < 4; a += 2)"margin" === n && (u += S.css(e, n + ne[a], !0, i)), r ? ("content" === n && (u -= S.css(e, "padding" + ne[a], !0, i)), "margin" !== n && (u -= S.css(e, "border" + ne[a] + "Width", !0, i))) : (u += S.css(e, "padding" + ne[a], !0, i), "padding" !== n ? u += S.css(e, "border" + ne[a] + "Width", !0, i) : s += S.css(e, "border" + ne[a] + "Width", !0, i)); return !r && 0 <= o && (u += Math.max(0, Math.ceil(e["offset" + t[0].toUpperCase() + t.slice(1)] - o - u - s - .5)) || 0), u } function Ze(e, t, n) { var r = Ie(e), i = (!y.boxSizingReliable() || n) && "border-box" === S.css(e, "boxSizing", !1, r), o = i, a = Be(e, t, r), s = "offset" + t[0].toUpperCase() + t.slice(1); if (Me.test(a)) { if (!n) return a; a = "auto" } return (!y.boxSizingReliable() && i || !y.reliableTrDimensions() && A(e, "tr") || "auto" === a || !parseFloat(a) && "inline" === S.css(e, "display", !1, r)) && e.getClientRects().length && (i = "border-box" === S.css(e, "boxSizing", !1, r), (o = s in e) && (a = e[s])), (a = parseFloat(a) || 0) + Ke(e, t, n || (i ? "border" : "content"), o, r, a) + "px" } function et(e, t, n, r, i) { return new et.prototype.init(e, t, n, r, i) } S.extend({ cssHooks: { opacity: { get: function (e, t) { if (t) { var n = Be(e, "opacity"); return "" === n ? "1" : n } } } }, cssNumber: { animationIterationCount: !0, columnCount: !0, fillOpacity: !0, flexGrow: !0, flexShrink: !0, fontWeight: !0, gridArea: !0, gridColumn: !0, gridColumnEnd: !0, gridColumnStart: !0, gridRow: !0, gridRowEnd: !0, gridRowStart: !0, lineHeight: !0, opacity: !0, order: !0, orphans: !0, widows: !0, zIndex: !0, zoom: !0 }, cssProps: {}, style: function (e, t, n, r) { if (e && 3 !== e.nodeType && 8 !== e.nodeType && e.style) { var i, o, a, s = X(t), u = Ge.test(t), l = e.style; if (u || (t = Xe(s)), a = S.cssHooks[t] || S.cssHooks[s], void 0 === n) return a && "get" in a && void 0 !== (i = a.get(e, !1, r)) ? i : l[t]; "string" === (o = typeof n) && (i = te.exec(n)) && i[1] && (n = se(e, t, i), o = "number"), null != n && n == n && ("number" !== o || u || (n += i && i[3] || (S.cssNumber[s] ? "" : "px")), y.clearCloneStyle || "" !== n || 0 !== t.indexOf("background") || (l[t] = "inherit"), a && "set" in a && void 0 === (n = a.set(e, n, r)) || (u ? l.setProperty(t, n) : l[t] = n)) } }, css: function (e, t, n, r) { var i, o, a, s = X(t); return Ge.test(t) || (t = Xe(s)), (a = S.cssHooks[t] || S.cssHooks[s]) && "get" in a && (i = a.get(e, !0, n)), void 0 === i && (i = Be(e, t, r)), "normal" === i && t in Qe && (i = Qe[t]), "" === n || n ? (o = parseFloat(i), !0 === n || isFinite(o) ? o || 0 : i) : i } }), S.each(["height", "width"], function (e, u) { S.cssHooks[u] = { get: function (e, t, n) { if (t) return !Ve.test(S.css(e, "display")) || e.getClientRects().length && e.getBoundingClientRect().width ? Ze(e, u, n) : We(e, Ye, function () { return Ze(e, u, n) }) }, set: function (e, t, n) { var r, i = Ie(e), o = !y.scrollboxSize() && "absolute" === i.position, a = (o || n) && "border-box" === S.css(e, "boxSizing", !1, i), s = n ? Ke(e, u, n, a, i) : 0; return a && o && (s -= Math.ceil(e["offset" + u[0].toUpperCase() + u.slice(1)] - parseFloat(i[u]) - Ke(e, u, "border", !1, i) - .5)), s && (r = te.exec(t)) && "px" !== (r[3] || "px") && (e.style[u] = t, t = S.css(e, u)), Je(0, t, s) } } }), S.cssHooks.marginLeft = $e(y.reliableMarginLeft, function (e, t) { if (t) return (parseFloat(Be(e, "marginLeft")) || e.getBoundingClientRect().left - We(e, { marginLeft: 0 }, function () { return e.getBoundingClientRect().left })) + "px" }), S.each({ margin: "", padding: "", border: "Width" }, function (i, o) { S.cssHooks[i + o] = { expand: function (e) { for (var t = 0, n = {}, r = "string" == typeof e ? e.split(" ") : [e]; t < 4; t++)n[i + ne[t] + o] = r[t] || r[t - 2] || r[0]; return n } }, "margin" !== i && (S.cssHooks[i + o].set = Je) }), S.fn.extend({ css: function (e, t) { return $(this, function (e, t, n) { var r, i, o = {}, a = 0; if (Array.isArray(t)) { for (r = Ie(e), i = t.length; a < i; a++)o[t[a]] = S.css(e, t[a], !1, r); return o } return void 0 !== n ? S.style(e, t, n) : S.css(e, t) }, e, t, 1 < arguments.length) } }), ((S.Tween = et).prototype = { constructor: et, init: function (e, t, n, r, i, o) { this.elem = e, this.prop = n, this.easing = i || S.easing._default, this.options = t, this.start = this.now = this.cur(), this.end = r, this.unit = o || (S.cssNumber[n] ? "" : "px") }, cur: function () { var e = et.propHooks[this.prop]; return e && e.get ? e.get(this) : et.propHooks._default.get(this) }, run: function (e) { var t, n = et.propHooks[this.prop]; return this.options.duration ? this.pos = t = S.easing[this.easing](e, this.options.duration * e, 0, 1, this.options.duration) : this.pos = t = e, this.now = (this.end - this.start) * t + this.start, this.options.step && this.options.step.call(this.elem, this.now, this), n && n.set ? n.set(this) : et.propHooks._default.set(this), this } }).init.prototype = et.prototype, (et.propHooks = { _default: { get: function (e) { var t; return 1 !== e.elem.nodeType || null != e.elem[e.prop] && null == e.elem.style[e.prop] ? e.elem[e.prop] : (t = S.css(e.elem, e.prop, "")) && "auto" !== t ? t : 0 }, set: function (e) { S.fx.step[e.prop] ? S.fx.step[e.prop](e) : 1 !== e.elem.nodeType || !S.cssHooks[e.prop] && null == e.elem.style[Xe(e.prop)] ? e.elem[e.prop] = e.now : S.style(e.elem, e.prop, e.now + e.unit) } } }).scrollTop = et.propHooks.scrollLeft = { set: function (e) { e.elem.nodeType && e.elem.parentNode && (e.elem[e.prop] = e.now) } }, S.easing = { linear: function (e) { return e }, swing: function (e) { return .5 - Math.cos(e * Math.PI) / 2 }, _default: "swing" }, S.fx = et.prototype.init, S.fx.step = {}; var tt, nt, rt, it, ot = /^(?:toggle|show|hide)$/, at = /queueHooks$/; function st() { nt && (!1 === E.hidden && C.requestAnimationFrame ? C.requestAnimationFrame(st) : C.setTimeout(st, S.fx.interval), S.fx.tick()) } function ut() { return C.setTimeout(function () { tt = void 0 }), tt = Date.now() } function lt(e, t) { var n, r = 0, i = { height: e }; for (t = t ? 1 : 0; r < 4; r += 2 - t)i["margin" + (n = ne[r])] = i["padding" + n] = e; return t && (i.opacity = i.width = e), i } function ct(e, t, n) { for (var r, i = (ft.tweeners[t] || []).concat(ft.tweeners["*"]), o = 0, a = i.length; o < a; o++)if (r = i[o].call(n, t, e)) return r } function ft(o, e, t) { var n, a, r = 0, i = ft.prefilters.length, s = S.Deferred().always(function () { delete u.elem }), u = function () { if (a) return !1; for (var e = tt || ut(), t = Math.max(0, l.startTime + l.duration - e), n = 1 - (t / l.duration || 0), r = 0, i = l.tweens.length; r < i; r++)l.tweens[r].run(n); return s.notifyWith(o, [l, n, t]), n < 1 && i ? t : (i || s.notifyWith(o, [l, 1, 0]), s.resolveWith(o, [l]), !1) }, l = s.promise({ elem: o, props: S.extend({}, e), opts: S.extend(!0, { specialEasing: {}, easing: S.easing._default }, t), originalProperties: e, originalOptions: t, startTime: tt || ut(), duration: t.duration, tweens: [], createTween: function (e, t) { var n = S.Tween(o, l.opts, e, t, l.opts.specialEasing[e] || l.opts.easing); return l.tweens.push(n), n }, stop: function (e) { var t = 0, n = e ? l.tweens.length : 0; if (a) return this; for (a = !0; t < n; t++)l.tweens[t].run(1); return e ? (s.notifyWith(o, [l, 1, 0]), s.resolveWith(o, [l, e])) : s.rejectWith(o, [l, e]), this } }), c = l.props; for (!function (e, t) { var n, r, i, o, a; for (n in e) if (i = t[r = X(n)], o = e[n], Array.isArray(o) && (i = o[1], o = e[n] = o[0]), n !== r && (e[r] = o, delete e[n]), (a = S.cssHooks[r]) && "expand" in a) for (n in o = a.expand(o), delete e[r], o) n in e || (e[n] = o[n], t[n] = i); else t[r] = i }(c, l.opts.specialEasing); r < i; r++)if (n = ft.prefilters[r].call(l, o, c, l.opts)) return m(n.stop) && (S._queueHooks(l.elem, l.opts.queue).stop = n.stop.bind(n)), n; return S.map(c, ct, l), m(l.opts.start) && l.opts.start.call(o, l), l.progress(l.opts.progress).done(l.opts.done, l.opts.complete).fail(l.opts.fail).always(l.opts.always), S.fx.timer(S.extend(u, { elem: o, anim: l, queue: l.opts.queue })), l } S.Animation = S.extend(ft, { tweeners: { "*": [function (e, t) { var n = this.createTween(e, t); return se(n.elem, e, te.exec(t), n), n }] }, tweener: function (e, t) { m(e) ? (t = e, e = ["*"]) : e = e.match(P); for (var n, r = 0, i = e.length; r < i; r++)n = e[r], ft.tweeners[n] = ft.tweeners[n] || [], ft.tweeners[n].unshift(t) }, prefilters: [function (e, t, n) { var r, i, o, a, s, u, l, c, f = "width" in t || "height" in t, p = this, d = {}, h = e.style, g = e.nodeType && ae(e), v = Y.get(e, "fxshow"); for (r in n.queue || (null == (a = S._queueHooks(e, "fx")).unqueued && (a.unqueued = 0, s = a.empty.fire, a.empty.fire = function () { a.unqueued || s() }), a.unqueued++, p.always(function () { p.always(function () { a.unqueued--, S.queue(e, "fx").length || a.empty.fire() }) })), t) if (i = t[r], ot.test(i)) { if (delete t[r], o = o || "toggle" === i, i === (g ? "hide" : "show")) { if ("show" !== i || !v || void 0 === v[r]) continue; g = !0 } d[r] = v && v[r] || S.style(e, r) } if ((u = !S.isEmptyObject(t)) || !S.isEmptyObject(d)) for (r in f && 1 === e.nodeType && (n.overflow = [h.overflow, h.overflowX, h.overflowY], null == (l = v && v.display) && (l = Y.get(e, "display")), "none" === (c = S.css(e, "display")) && (l ? c = l : (le([e], !0), l = e.style.display || l, c = S.css(e, "display"), le([e]))), ("inline" === c || "inline-block" === c && null != l) && "none" === S.css(e, "float") && (u || (p.done(function () { h.display = l }), null == l && (c = h.display, l = "none" === c ? "" : c)), h.display = "inline-block")), n.overflow && (h.overflow = "hidden", p.always(function () { h.overflow = n.overflow[0], h.overflowX = n.overflow[1], h.overflowY = n.overflow[2] })), u = !1, d) u || (v ? "hidden" in v && (g = v.hidden) : v = Y.access(e, "fxshow", { display: l }), o && (v.hidden = !g), g && le([e], !0), p.done(function () { for (r in g || le([e]), Y.remove(e, "fxshow"), d) S.style(e, r, d[r]) })), u = ct(g ? v[r] : 0, r, p), r in v || (v[r] = u.start, g && (u.end = u.start, u.start = 0)) }], prefilter: function (e, t) { t ? ft.prefilters.unshift(e) : ft.prefilters.push(e) } }), S.speed = function (e, t, n) { var r = e && "object" == typeof e ? S.extend({}, e) : { complete: n || !n && t || m(e) && e, duration: e, easing: n && t || t && !m(t) && t }; return S.fx.off ? r.duration = 0 : "number" != typeof r.duration && (r.duration in S.fx.speeds ? r.duration = S.fx.speeds[r.duration] : r.duration = S.fx.speeds._default), null != r.queue && !0 !== r.queue || (r.queue = "fx"), r.old = r.complete, r.complete = function () { m(r.old) && r.old.call(this), r.queue && S.dequeue(this, r.queue) }, r }, S.fn.extend({ fadeTo: function (e, t, n, r) { return this.filter(ae).css("opacity", 0).show().end().animate({ opacity: t }, e, n, r) }, animate: function (t, e, n, r) { var i = S.isEmptyObject(t), o = S.speed(e, n, r), a = function () { var e = ft(this, S.extend({}, t), o); (i || Y.get(this, "finish")) && e.stop(!0) }; return a.finish = a, i || !1 === o.queue ? this.each(a) : this.queue(o.queue, a) }, stop: function (i, e, o) { var a = function (e) { var t = e.stop; delete e.stop, t(o) }; return "string" != typeof i && (o = e, e = i, i = void 0), e && this.queue(i || "fx", []), this.each(function () { var e = !0, t = null != i && i + "queueHooks", n = S.timers, r = Y.get(this); if (t) r[t] && r[t].stop && a(r[t]); else for (t in r) r[t] && r[t].stop && at.test(t) && a(r[t]); for (t = n.length; t--;)n[t].elem !== this || null != i && n[t].queue !== i || (n[t].anim.stop(o), e = !1, n.splice(t, 1)); !e && o || S.dequeue(this, i) }) }, finish: function (a) { return !1 !== a && (a = a || "fx"), this.each(function () { var e, t = Y.get(this), n = t[a + "queue"], r = t[a + "queueHooks"], i = S.timers, o = n ? n.length : 0; for (t.finish = !0, S.queue(this, a, []), r && r.stop && r.stop.call(this, !0), e = i.length; e--;)i[e].elem === this && i[e].queue === a && (i[e].anim.stop(!0), i.splice(e, 1)); for (e = 0; e < o; e++)n[e] && n[e].finish && n[e].finish.call(this); delete t.finish }) } }), S.each(["toggle", "show", "hide"], function (e, r) { var i = S.fn[r]; S.fn[r] = function (e, t, n) { return null == e || "boolean" == typeof e ? i.apply(this, arguments) : this.animate(lt(r, !0), e, t, n) } }), S.each({ slideDown: lt("show"), slideUp: lt("hide"), slideToggle: lt("toggle"), fadeIn: { opacity: "show" }, fadeOut: { opacity: "hide" }, fadeToggle: { opacity: "toggle" } }, function (e, r) { S.fn[e] = function (e, t, n) { return this.animate(r, e, t, n) } }), S.timers = [], S.fx.tick = function () { var e, t = 0, n = S.timers; for (tt = Date.now(); t < n.length; t++)(e = n[t])() || n[t] !== e || n.splice(t--, 1); n.length || S.fx.stop(), tt = void 0 }, S.fx.timer = function (e) { S.timers.push(e), S.fx.start() }, S.fx.interval = 13, S.fx.start = function () { nt || (nt = !0, st()) }, S.fx.stop = function () { nt = null }, S.fx.speeds = { slow: 600, fast: 200, _default: 400 }, S.fn.delay = function (r, e) { return r = S.fx && S.fx.speeds[r] || r, e = e || "fx", this.queue(e, function (e, t) { var n = C.setTimeout(e, r); t.stop = function () { C.clearTimeout(n) } }) }, rt = E.createElement("input"), it = E.createElement("select").appendChild(E.createElement("option")), rt.type = "checkbox", y.checkOn = "" !== rt.value, y.optSelected = it.selected, (rt = E.createElement("input")).value = "t", rt.type = "radio", y.radioValue = "t" === rt.value; var pt, dt = S.expr.attrHandle; S.fn.extend({ attr: function (e, t) { return $(this, S.attr, e, t, 1 < arguments.length) }, removeAttr: function (e) { return this.each(function () { S.removeAttr(this, e) }) } }), S.extend({ attr: function (e, t, n) { var r, i, o = e.nodeType; if (3 !== o && 8 !== o && 2 !== o) return "undefined" == typeof e.getAttribute ? S.prop(e, t, n) : (1 === o && S.isXMLDoc(e) || (i = S.attrHooks[t.toLowerCase()] || (S.expr.match.bool.test(t) ? pt : void 0)), void 0 !== n ? null === n ? void S.removeAttr(e, t) : i && "set" in i && void 0 !== (r = i.set(e, n, t)) ? r : (e.setAttribute(t, n + ""), n) : i && "get" in i && null !== (r = i.get(e, t)) ? r : null == (r = S.find.attr(e, t)) ? void 0 : r) }, attrHooks: { type: { set: function (e, t) { if (!y.radioValue && "radio" === t && A(e, "input")) { var n = e.value; return e.setAttribute("type", t), n && (e.value = n), t } } } }, removeAttr: function (e, t) { var n, r = 0, i = t && t.match(P); if (i && 1 === e.nodeType) while (n = i[r++]) e.removeAttribute(n) } }), pt = { set: function (e, t, n) { return !1 === t ? S.removeAttr(e, n) : e.setAttribute(n, n), n } }, S.each(S.expr.match.bool.source.match(/\w+/g), function (e, t) { var a = dt[t] || S.find.attr; dt[t] = function (e, t, n) { var r, i, o = t.toLowerCase(); return n || (i = dt[o], dt[o] = r, r = null != a(e, t, n) ? o : null, dt[o] = i), r } }); var ht = /^(?:input|select|textarea|button)$/i, gt = /^(?:a|area)$/i; function vt(e) { return (e.match(P) || []).join(" ") } function yt(e) { return e.getAttribute && e.getAttribute("class") || "" } function mt(e) { return Array.isArray(e) ? e : "string" == typeof e && e.match(P) || [] } S.fn.extend({ prop: function (e, t) { return $(this, S.prop, e, t, 1 < arguments.length) }, removeProp: function (e) { return this.each(function () { delete this[S.propFix[e] || e] }) } }), S.extend({ prop: function (e, t, n) { var r, i, o = e.nodeType; if (3 !== o && 8 !== o && 2 !== o) return 1 === o && S.isXMLDoc(e) || (t = S.propFix[t] || t, i = S.propHooks[t]), void 0 !== n ? i && "set" in i && void 0 !== (r = i.set(e, n, t)) ? r : e[t] = n : i && "get" in i && null !== (r = i.get(e, t)) ? r : e[t] }, propHooks: { tabIndex: { get: function (e) { var t = S.find.attr(e, "tabindex"); return t ? parseInt(t, 10) : ht.test(e.nodeName) || gt.test(e.nodeName) && e.href ? 0 : -1 } } }, propFix: { "for": "htmlFor", "class": "className" } }), y.optSelected || (S.propHooks.selected = { get: function (e) { var t = e.parentNode; return t && t.parentNode && t.parentNode.selectedIndex, null }, set: function (e) { var t = e.parentNode; t && (t.selectedIndex, t.parentNode && t.parentNode.selectedIndex) } }), S.each(["tabIndex", "readOnly", "maxLength", "cellSpacing", "cellPadding", "rowSpan", "colSpan", "useMap", "frameBorder", "contentEditable"], function () { S.propFix[this.toLowerCase()] = this }), S.fn.extend({ addClass: function (t) { var e, n, r, i, o, a, s, u = 0; if (m(t)) return this.each(function (e) { S(this).addClass(t.call(this, e, yt(this))) }); if ((e = mt(t)).length) while (n = this[u++]) if (i = yt(n), r = 1 === n.nodeType && " " + vt(i) + " ") { a = 0; while (o = e[a++]) r.indexOf(" " + o + " ") < 0 && (r += o + " "); i !== (s = vt(r)) && n.setAttribute("class", s) } return this }, removeClass: function (t) { var e, n, r, i, o, a, s, u = 0; if (m(t)) return this.each(function (e) { S(this).removeClass(t.call(this, e, yt(this))) }); if (!arguments.length) return this.attr("class", ""); if ((e = mt(t)).length) while (n = this[u++]) if (i = yt(n), r = 1 === n.nodeType && " " + vt(i) + " ") { a = 0; while (o = e[a++]) while (-1 < r.indexOf(" " + o + " ")) r = r.replace(" " + o + " ", " "); i !== (s = vt(r)) && n.setAttribute("class", s) } return this }, toggleClass: function (i, t) { var o = typeof i, a = "string" === o || Array.isArray(i); return "boolean" == typeof t && a ? t ? this.addClass(i) : this.removeClass(i) : m(i) ? this.each(function (e) { S(this).toggleClass(i.call(this, e, yt(this), t), t) }) : this.each(function () { var e, t, n, r; if (a) { t = 0, n = S(this), r = mt(i); while (e = r[t++]) n.hasClass(e) ? n.removeClass(e) : n.addClass(e) } else void 0 !== i && "boolean" !== o || ((e = yt(this)) && Y.set(this, "__className__", e), this.setAttribute && this.setAttribute("class", e || !1 === i ? "" : Y.get(this, "__className__") || "")) }) }, hasClass: function (e) { var t, n, r = 0; t = " " + e + " "; while (n = this[r++]) if (1 === n.nodeType && -1 < (" " + vt(yt(n)) + " ").indexOf(t)) return !0; return !1 } }); var xt = /\r/g; S.fn.extend({ val: function (n) { var r, e, i, t = this[0]; return arguments.length ? (i = m(n), this.each(function (e) { var t; 1 === this.nodeType && (null == (t = i ? n.call(this, e, S(this).val()) : n) ? t = "" : "number" == typeof t ? t += "" : Array.isArray(t) && (t = S.map(t, function (e) { return null == e ? "" : e + "" })), (r = S.valHooks[this.type] || S.valHooks[this.nodeName.toLowerCase()]) && "set" in r && void 0 !== r.set(this, t, "value") || (this.value = t)) })) : t ? (r = S.valHooks[t.type] || S.valHooks[t.nodeName.toLowerCase()]) && "get" in r && void 0 !== (e = r.get(t, "value")) ? e : "string" == typeof (e = t.value) ? e.replace(xt, "") : null == e ? "" : e : void 0 } }), S.extend({ valHooks: { option: { get: function (e) { var t = S.find.attr(e, "value"); return null != t ? t : vt(S.text(e)) } }, select: { get: function (e) { var t, n, r, i = e.options, o = e.selectedIndex, a = "select-one" === e.type, s = a ? null : [], u = a ? o + 1 : i.length; for (r = o < 0 ? u : a ? o : 0; r < u; r++)if (((n = i[r]).selected || r === o) && !n.disabled && (!n.parentNode.disabled || !A(n.parentNode, "optgroup"))) { if (t = S(n).val(), a) return t; s.push(t) } return s }, set: function (e, t) { var n, r, i = e.options, o = S.makeArray(t), a = i.length; while (a--) ((r = i[a]).selected = -1 < S.inArray(S.valHooks.option.get(r), o)) && (n = !0); return n || (e.selectedIndex = -1), o } } } }), S.each(["radio", "checkbox"], function () { S.valHooks[this] = { set: function (e, t) { if (Array.isArray(t)) return e.checked = -1 < S.inArray(S(e).val(), t) } }, y.checkOn || (S.valHooks[this].get = function (e) { return null === e.getAttribute("value") ? "on" : e.value }) }), y.focusin = "onfocusin" in C; var bt = /^(?:focusinfocus|focusoutblur)$/, wt = function (e) { e.stopPropagation() }; S.extend(S.event, { trigger: function (e, t, n, r) { var i, o, a, s, u, l, c, f, p = [n || E], d = v.call(e, "type") ? e.type : e, h = v.call(e, "namespace") ? e.namespace.split(".") : []; if (o = f = a = n = n || E, 3 !== n.nodeType && 8 !== n.nodeType && !bt.test(d + S.event.triggered) && (-1 < d.indexOf(".") && (d = (h = d.split(".")).shift(), h.sort()), u = d.indexOf(":") < 0 && "on" + d, (e = e[S.expando] ? e : new S.Event(d, "object" == typeof e && e)).isTrigger = r ? 2 : 3, e.namespace = h.join("."), e.rnamespace = e.namespace ? new RegExp("(^|\\.)" + h.join("\\.(?:.*\\.|)") + "(\\.|$)") : null, e.result = void 0, e.target || (e.target = n), t = null == t ? [e] : S.makeArray(t, [e]), c = S.event.special[d] || {}, r || !c.trigger || !1 !== c.trigger.apply(n, t))) { if (!r && !c.noBubble && !x(n)) { for (s = c.delegateType || d, bt.test(s + d) || (o = o.parentNode); o; o = o.parentNode)p.push(o), a = o; a === (n.ownerDocument || E) && p.push(a.defaultView || a.parentWindow || C) } i = 0; while ((o = p[i++]) && !e.isPropagationStopped()) f = o, e.type = 1 < i ? s : c.bindType || d, (l = (Y.get(o, "events") || Object.create(null))[e.type] && Y.get(o, "handle")) && l.apply(o, t), (l = u && o[u]) && l.apply && V(o) && (e.result = l.apply(o, t), !1 === e.result && e.preventDefault()); return e.type = d, r || e.isDefaultPrevented() || c._default && !1 !== c._default.apply(p.pop(), t) || !V(n) || u && m(n[d]) && !x(n) && ((a = n[u]) && (n[u] = null), S.event.triggered = d, e.isPropagationStopped() && f.addEventListener(d, wt), n[d](), e.isPropagationStopped() && f.removeEventListener(d, wt), S.event.triggered = void 0, a && (n[u] = a)), e.result } }, simulate: function (e, t, n) { var r = S.extend(new S.Event, n, { type: e, isSimulated: !0 }); S.event.trigger(r, null, t) } }), S.fn.extend({ trigger: function (e, t) { return this.each(function () { S.event.trigger(e, t, this) }) }, triggerHandler: function (e, t) { var n = this[0]; if (n) return S.event.trigger(e, t, n, !0) } }), y.focusin || S.each({ focus: "focusin", blur: "focusout" }, function (n, r) { var i = function (e) { S.event.simulate(r, e.target, S.event.fix(e)) }; S.event.special[r] = { setup: function () { var e = this.ownerDocument || this.document || this, t = Y.access(e, r); t || e.addEventListener(n, i, !0), Y.access(e, r, (t || 0) + 1) }, teardown: function () { var e = this.ownerDocument || this.document || this, t = Y.access(e, r) - 1; t ? Y.access(e, r, t) : (e.removeEventListener(n, i, !0), Y.remove(e, r)) } } }); var Tt = C.location, Ct = { guid: Date.now() }, Et = /\?/; S.parseXML = function (e) { var t; if (!e || "string" != typeof e) return null; try { t = (new C.DOMParser).parseFromString(e, "text/xml") } catch (e) { t = void 0 } return t && !t.getElementsByTagName("parsererror").length || S.error("Invalid XML: " + e), t }; var St = /\[\]$/, kt = /\r?\n/g, At = /^(?:submit|button|image|reset|file)$/i, Nt = /^(?:input|select|textarea|keygen)/i; function Dt(n, e, r, i) { var t; if (Array.isArray(e)) S.each(e, function (e, t) { r || St.test(n) ? i(n, t) : Dt(n + "[" + ("object" == typeof t && null != t ? e : "") + "]", t, r, i) }); else if (r || "object" !== w(e)) i(n, e); else for (t in e) Dt(n + "[" + t + "]", e[t], r, i) } S.param = function (e, t) { var n, r = [], i = function (e, t) { var n = m(t) ? t() : t; r[r.length] = encodeURIComponent(e) + "=" + encodeURIComponent(null == n ? "" : n) }; if (null == e) return ""; if (Array.isArray(e) || e.jquery && !S.isPlainObject(e)) S.each(e, function () { i(this.name, this.value) }); else for (n in e) Dt(n, e[n], t, i); return r.join("&") }, S.fn.extend({ serialize: function () { return S.param(this.serializeArray()) }, serializeArray: function () { return this.map(function () { var e = S.prop(this, "elements"); return e ? S.makeArray(e) : this }).filter(function () { var e = this.type; return this.name && !S(this).is(":disabled") && Nt.test(this.nodeName) && !At.test(e) && (this.checked || !pe.test(e)) }).map(function (e, t) { var n = S(this).val(); return null == n ? null : Array.isArray(n) ? S.map(n, function (e) { return { name: t.name, value: e.replace(kt, "\r\n") } }) : { name: t.name, value: n.replace(kt, "\r\n") } }).get() } }); var jt = /%20/g, qt = /#.*$/, Lt = /([?&])_=[^&]*/, Ht = /^(.*?):[ \t]*([^\r\n]*)$/gm, Ot = /^(?:GET|HEAD)$/, Pt = /^\/\//, Rt = {}, Mt = {}, It = "*/".concat("*"), Wt = E.createElement("a"); function Ft(o) { return function (e, t) { "string" != typeof e && (t = e, e = "*"); var n, r = 0, i = e.toLowerCase().match(P) || []; if (m(t)) while (n = i[r++]) "+" === n[0] ? (n = n.slice(1) || "*", (o[n] = o[n] || []).unshift(t)) : (o[n] = o[n] || []).push(t) } } function Bt(t, i, o, a) { var s = {}, u = t === Mt; function l(e) { var r; return s[e] = !0, S.each(t[e] || [], function (e, t) { var n = t(i, o, a); return "string" != typeof n || u || s[n] ? u ? !(r = n) : void 0 : (i.dataTypes.unshift(n), l(n), !1) }), r } return l(i.dataTypes[0]) || !s["*"] && l("*") } function $t(e, t) { var n, r, i = S.ajaxSettings.flatOptions || {}; for (n in t) void 0 !== t[n] && ((i[n] ? e : r || (r = {}))[n] = t[n]); return r && S.extend(!0, e, r), e } Wt.href = Tt.href, S.extend({ active: 0, lastModified: {}, etag: {}, ajaxSettings: { url: Tt.href, type: "GET", isLocal: /^(?:about|app|app-storage|.+-extension|file|res|widget):$/.test(Tt.protocol), global: !0, processData: !0, async: !0, contentType: "application/x-www-form-urlencoded; charset=UTF-8", accepts: { "*": It, text: "text/plain", html: "text/html", xml: "application/xml, text/xml", json: "application/json, text/javascript" }, contents: { xml: /\bxml\b/, html: /\bhtml/, json: /\bjson\b/ }, responseFields: { xml: "responseXML", text: "responseText", json: "responseJSON" }, converters: { "* text": String, "text html": !0, "text json": JSON.parse, "text xml": S.parseXML }, flatOptions: { url: !0, context: !0 } }, ajaxSetup: function (e, t) { return t ? $t($t(e, S.ajaxSettings), t) : $t(S.ajaxSettings, e) }, ajaxPrefilter: Ft(Rt), ajaxTransport: Ft(Mt), ajax: function (e, t) { "object" == typeof e && (t = e, e = void 0), t = t || {}; var c, f, p, n, d, r, h, g, i, o, v = S.ajaxSetup({}, t), y = v.context || v, m = v.context && (y.nodeType || y.jquery) ? S(y) : S.event, x = S.Deferred(), b = S.Callbacks("once memory"), w = v.statusCode || {}, a = {}, s = {}, u = "canceled", T = { readyState: 0, getResponseHeader: function (e) { var t; if (h) { if (!n) { n = {}; while (t = Ht.exec(p)) n[t[1].toLowerCase() + " "] = (n[t[1].toLowerCase() + " "] || []).concat(t[2]) } t = n[e.toLowerCase() + " "] } return null == t ? null : t.join(", ") }, getAllResponseHeaders: function () { return h ? p : null }, setRequestHeader: function (e, t) { return null == h && (e = s[e.toLowerCase()] = s[e.toLowerCase()] || e, a[e] = t), this }, overrideMimeType: function (e) { return null == h && (v.mimeType = e), this }, statusCode: function (e) { var t; if (e) if (h) T.always(e[T.status]); else for (t in e) w[t] = [w[t], e[t]]; return this }, abort: function (e) { var t = e || u; return c && c.abort(t), l(0, t), this } }; if (x.promise(T), v.url = ((e || v.url || Tt.href) + "").replace(Pt, Tt.protocol + "//"), v.type = t.method || t.type || v.method || v.type, v.dataTypes = (v.dataType || "*").toLowerCase().match(P) || [""], null == v.crossDomain) { r = E.createElement("a"); try { r.href = v.url, r.href = r.href, v.crossDomain = Wt.protocol + "//" + Wt.host != r.protocol + "//" + r.host } catch (e) { v.crossDomain = !0 } } if (v.data && v.processData && "string" != typeof v.data && (v.data = S.param(v.data, v.traditional)), Bt(Rt, v, t, T), h) return T; for (i in (g = S.event && v.global) && 0 == S.active++ && S.event.trigger("ajaxStart"), v.type = v.type.toUpperCase(), v.hasContent = !Ot.test(v.type), f = v.url.replace(qt, ""), v.hasContent ? v.data && v.processData && 0 === (v.contentType || "").indexOf("application/x-www-form-urlencoded") && (v.data = v.data.replace(jt, "+")) : (o = v.url.slice(f.length), v.data && (v.processData || "string" == typeof v.data) && (f += (Et.test(f) ? "&" : "?") + v.data, delete v.data), !1 === v.cache && (f = f.replace(Lt, "$1"), o = (Et.test(f) ? "&" : "?") + "_=" + Ct.guid++ + o), v.url = f + o), v.ifModified && (S.lastModified[f] && T.setRequestHeader("If-Modified-Since", S.lastModified[f]), S.etag[f] && T.setRequestHeader("If-None-Match", S.etag[f])), (v.data && v.hasContent && !1 !== v.contentType || t.contentType) && T.setRequestHeader("Content-Type", v.contentType), T.setRequestHeader("Accept", v.dataTypes[0] && v.accepts[v.dataTypes[0]] ? v.accepts[v.dataTypes[0]] + ("*" !== v.dataTypes[0] ? ", " + It + "; q=0.01" : "") : v.accepts["*"]), v.headers) T.setRequestHeader(i, v.headers[i]); if (v.beforeSend && (!1 === v.beforeSend.call(y, T, v) || h)) return T.abort(); if (u = "abort", b.add(v.complete), T.done(v.success), T.fail(v.error), c = Bt(Mt, v, t, T)) { if (T.readyState = 1, g && m.trigger("ajaxSend", [T, v]), h) return T; v.async && 0 < v.timeout && (d = C.setTimeout(function () { T.abort("timeout") }, v.timeout)); try { h = !1, c.send(a, l) } catch (e) { if (h) throw e; l(-1, e) } } else l(-1, "No Transport"); function l(e, t, n, r) { var i, o, a, s, u, l = t; h || (h = !0, d && C.clearTimeout(d), c = void 0, p = r || "", T.readyState = 0 < e ? 4 : 0, i = 200 <= e && e < 300 || 304 === e, n && (s = function (e, t, n) { var r, i, o, a, s = e.contents, u = e.dataTypes; while ("*" === u[0]) u.shift(), void 0 === r && (r = e.mimeType || t.getResponseHeader("Content-Type")); if (r) for (i in s) if (s[i] && s[i].test(r)) { u.unshift(i); break } if (u[0] in n) o = u[0]; else { for (i in n) { if (!u[0] || e.converters[i + " " + u[0]]) { o = i; break } a || (a = i) } o = o || a } if (o) return o !== u[0] && u.unshift(o), n[o] }(v, T, n)), !i && -1 < S.inArray("script", v.dataTypes) && (v.converters["text script"] = function () { }), s = function (e, t, n, r) { var i, o, a, s, u, l = {}, c = e.dataTypes.slice(); if (c[1]) for (a in e.converters) l[a.toLowerCase()] = e.converters[a]; o = c.shift(); while (o) if (e.responseFields[o] && (n[e.responseFields[o]] = t), !u && r && e.dataFilter && (t = e.dataFilter(t, e.dataType)), u = o, o = c.shift()) if ("*" === o) o = u; else if ("*" !== u && u !== o) { if (!(a = l[u + " " + o] || l["* " + o])) for (i in l) if ((s = i.split(" "))[1] === o && (a = l[u + " " + s[0]] || l["* " + s[0]])) { !0 === a ? a = l[i] : !0 !== l[i] && (o = s[0], c.unshift(s[1])); break } if (!0 !== a) if (a && e["throws"]) t = a(t); else try { t = a(t) } catch (e) { return { state: "parsererror", error: a ? e : "No conversion from " + u + " to " + o } } } return { state: "success", data: t } }(v, s, T, i), i ? (v.ifModified && ((u = T.getResponseHeader("Last-Modified")) && (S.lastModified[f] = u), (u = T.getResponseHeader("etag")) && (S.etag[f] = u)), 204 === e || "HEAD" === v.type ? l = "nocontent" : 304 === e ? l = "notmodified" : (l = s.state, o = s.data, i = !(a = s.error))) : (a = l, !e && l || (l = "error", e < 0 && (e = 0))), T.status = e, T.statusText = (t || l) + "", i ? x.resolveWith(y, [o, l, T]) : x.rejectWith(y, [T, l, a]), T.statusCode(w), w = void 0, g && m.trigger(i ? "ajaxSuccess" : "ajaxError", [T, v, i ? o : a]), b.fireWith(y, [T, l]), g && (m.trigger("ajaxComplete", [T, v]), --S.active || S.event.trigger("ajaxStop"))) } return T }, getJSON: function (e, t, n) { return S.get(e, t, n, "json") }, getScript: function (e, t) { return S.get(e, void 0, t, "script") } }), S.each(["get", "post"], function (e, i) { S[i] = function (e, t, n, r) { return m(t) && (r = r || n, n = t, t = void 0), S.ajax(S.extend({ url: e, type: i, dataType: r, data: t, success: n }, S.isPlainObject(e) && e)) } }), S.ajaxPrefilter(function (e) { var t; for (t in e.headers) "content-type" === t.toLowerCase() && (e.contentType = e.headers[t] || "") }), S._evalUrl = function (e, t, n) { return S.ajax({ url: e, type: "GET", dataType: "script", cache: !0, async: !1, global: !1, converters: { "text script": function () { } }, dataFilter: function (e) { S.globalEval(e, t, n) } }) }, S.fn.extend({ wrapAll: function (e) { var t; return this[0] && (m(e) && (e = e.call(this[0])), t = S(e, this[0].ownerDocument).eq(0).clone(!0), this[0].parentNode && t.insertBefore(this[0]), t.map(function () { var e = this; while (e.firstElementChild) e = e.firstElementChild; return e }).append(this)), this }, wrapInner: function (n) { return m(n) ? this.each(function (e) { S(this).wrapInner(n.call(this, e)) }) : this.each(function () { var e = S(this), t = e.contents(); t.length ? t.wrapAll(n) : e.append(n) }) }, wrap: function (t) { var n = m(t); return this.each(function (e) { S(this).wrapAll(n ? t.call(this, e) : t) }) }, unwrap: function (e) { return this.parent(e).not("body").each(function () { S(this).replaceWith(this.childNodes) }), this } }), S.expr.pseudos.hidden = function (e) { return !S.expr.pseudos.visible(e) }, S.expr.pseudos.visible = function (e) { return !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) }, S.ajaxSettings.xhr = function () { try { return new C.XMLHttpRequest } catch (e) { } }; var _t = { 0: 200, 1223: 204 }, zt = S.ajaxSettings.xhr(); y.cors = !!zt && "withCredentials" in zt, y.ajax = zt = !!zt, S.ajaxTransport(function (i) { var o, a; if (y.cors || zt && !i.crossDomain) return { send: function (e, t) { var n, r = i.xhr(); if (r.open(i.type, i.url, i.async, i.username, i.password), i.xhrFields) for (n in i.xhrFields) r[n] = i.xhrFields[n]; for (n in i.mimeType && r.overrideMimeType && r.overrideMimeType(i.mimeType), i.crossDomain || e["X-Requested-With"] || (e["X-Requested-With"] = "XMLHttpRequest"), e) r.setRequestHeader(n, e[n]); o = function (e) { return function () { o && (o = a = r.onload = r.onerror = r.onabort = r.ontimeout = r.onreadystatechange = null, "abort" === e ? r.abort() : "error" === e ? "number" != typeof r.status ? t(0, "error") : t(r.status, r.statusText) : t(_t[r.status] || r.status, r.statusText, "text" !== (r.responseType || "text") || "string" != typeof r.responseText ? { binary: r.response } : { text: r.responseText }, r.getAllResponseHeaders())) } }, r.onload = o(), a = r.onerror = r.ontimeout = o("error"), void 0 !== r.onabort ? r.onabort = a : r.onreadystatechange = function () { 4 === r.readyState && C.setTimeout(function () { o && a() }) }, o = o("abort"); try { r.send(i.hasContent && i.data || null) } catch (e) { if (o) throw e } }, abort: function () { o && o() } } }), S.ajaxPrefilter(function (e) { e.crossDomain && (e.contents.script = !1) }), S.ajaxSetup({ accepts: { script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript" }, contents: { script: /\b(?:java|ecma)script\b/ }, converters: { "text script": function (e) { return S.globalEval(e), e } } }), S.ajaxPrefilter("script", function (e) { void 0 === e.cache && (e.cache = !1), e.crossDomain && (e.type = "GET") }), S.ajaxTransport("script", function (n) { var r, i; if (n.crossDomain || n.scriptAttrs) return { send: function (e, t) { r = S("<script>").attr(n.scriptAttrs || {}).prop({ charset: n.scriptCharset, src: n.url }).on("load error", i = function (e) { r.remove(), i = null, e && t("error" === e.type ? 404 : 200, e.type) }), E.head.appendChild(r[0]) }, abort: function () { i && i() } } }); var Ut, Xt = [], Vt = /(=)\?(?=&|$)|\?\?/; S.ajaxSetup({ jsonp: "callback", jsonpCallback: function () { var e = Xt.pop() || S.expando + "_" + Ct.guid++; return this[e] = !0, e } }), S.ajaxPrefilter("json jsonp", function (e, t, n) { var r, i, o, a = !1 !== e.jsonp && (Vt.test(e.url) ? "url" : "string" == typeof e.data && 0 === (e.contentType || "").indexOf("application/x-www-form-urlencoded") && Vt.test(e.data) && "data"); if (a || "jsonp" === e.dataTypes[0]) return r = e.jsonpCallback = m(e.jsonpCallback) ? e.jsonpCallback() : e.jsonpCallback, a ? e[a] = e[a].replace(Vt, "$1" + r) : !1 !== e.jsonp && (e.url += (Et.test(e.url) ? "&" : "?") + e.jsonp + "=" + r), e.converters["script json"] = function () { return o || S.error(r + " was not called"), o[0] }, e.dataTypes[0] = "json", i = C[r], C[r] = function () { o = arguments }, n.always(function () { void 0 === i ? S(C).removeProp(r) : C[r] = i, e[r] && (e.jsonpCallback = t.jsonpCallback, Xt.push(r)), o && m(i) && i(o[0]), o = i = void 0 }), "script" }), y.createHTMLDocument = ((Ut = E.implementation.createHTMLDocument("").body).innerHTML = "<form></form><form></form>", 2 === Ut.childNodes.length), S.parseHTML = function (e, t, n) { return "string" != typeof e ? [] : ("boolean" == typeof t && (n = t, t = !1), t || (y.createHTMLDocument ? ((r = (t = E.implementation.createHTMLDocument("")).createElement("base")).href = E.location.href, t.head.appendChild(r)) : t = E), o = !n && [], (i = N.exec(e)) ? [t.createElement(i[1])] : (i = xe([e], t, o), o && o.length && S(o).remove(), S.merge([], i.childNodes))); var r, i, o }, S.fn.load = function (e, t, n) { var r, i, o, a = this, s = e.indexOf(" "); return -1 < s && (r = vt(e.slice(s)), e = e.slice(0, s)), m(t) ? (n = t, t = void 0) : t && "object" == typeof t && (i = "POST"), 0 < a.length && S.ajax({ url: e, type: i || "GET", dataType: "html", data: t }).done(function (e) { o = arguments, a.html(r ? S("<div>").append(S.parseHTML(e)).find(r) : e) }).always(n && function (e, t) { a.each(function () { n.apply(this, o || [e.responseText, t, e]) }) }), this }, S.expr.pseudos.animated = function (t) { return S.grep(S.timers, function (e) { return t === e.elem }).length }, S.offset = { setOffset: function (e, t, n) { var r, i, o, a, s, u, l = S.css(e, "position"), c = S(e), f = {}; "static" === l && (e.style.position = "relative"), s = c.offset(), o = S.css(e, "top"), u = S.css(e, "left"), ("absolute" === l || "fixed" === l) && -1 < (o + u).indexOf("auto") ? (a = (r = c.position()).top, i = r.left) : (a = parseFloat(o) || 0, i = parseFloat(u) || 0), m(t) && (t = t.call(e, n, S.extend({}, s))), null != t.top && (f.top = t.top - s.top + a), null != t.left && (f.left = t.left - s.left + i), "using" in t ? t.using.call(e, f) : ("number" == typeof f.top && (f.top += "px"), "number" == typeof f.left && (f.left += "px"), c.css(f)) } }, S.fn.extend({ offset: function (t) { if (arguments.length) return void 0 === t ? this : this.each(function (e) { S.offset.setOffset(this, t, e) }); var e, n, r = this[0]; return r ? r.getClientRects().length ? (e = r.getBoundingClientRect(), n = r.ownerDocument.defaultView, { top: e.top + n.pageYOffset, left: e.left + n.pageXOffset }) : { top: 0, left: 0 } : void 0 }, position: function () { if (this[0]) { var e, t, n, r = this[0], i = { top: 0, left: 0 }; if ("fixed" === S.css(r, "position")) t = r.getBoundingClientRect(); else { t = this.offset(), n = r.ownerDocument, e = r.offsetParent || n.documentElement; while (e && (e === n.body || e === n.documentElement) && "static" === S.css(e, "position")) e = e.parentNode; e && e !== r && 1 === e.nodeType && ((i = S(e).offset()).top += S.css(e, "borderTopWidth", !0), i.left += S.css(e, "borderLeftWidth", !0)) } return { top: t.top - i.top - S.css(r, "marginTop", !0), left: t.left - i.left - S.css(r, "marginLeft", !0) } } }, offsetParent: function () { return this.map(function () { var e = this.offsetParent; while (e && "static" === S.css(e, "position")) e = e.offsetParent; return e || re }) } }), S.each({ scrollLeft: "pageXOffset", scrollTop: "pageYOffset" }, function (t, i) { var o = "pageYOffset" === i; S.fn[t] = function (e) { return $(this, function (e, t, n) { var r; if (x(e) ? r = e : 9 === e.nodeType && (r = e.defaultView), void 0 === n) return r ? r[i] : e[t]; r ? r.scrollTo(o ? r.pageXOffset : n, o ? n : r.pageYOffset) : e[t] = n }, t, e, arguments.length) } }), S.each(["top", "left"], function (e, n) { S.cssHooks[n] = $e(y.pixelPosition, function (e, t) { if (t) return t = Be(e, n), Me.test(t) ? S(e).position()[n] + "px" : t }) }), S.each({ Height: "height", Width: "width" }, function (a, s) { S.each({ padding: "inner" + a, content: s, "": "outer" + a }, function (r, o) { S.fn[o] = function (e, t) { var n = arguments.length && (r || "boolean" != typeof e), i = r || (!0 === e || !0 === t ? "margin" : "border"); return $(this, function (e, t, n) { var r; return x(e) ? 0 === o.indexOf("outer") ? e["inner" + a] : e.document.documentElement["client" + a] : 9 === e.nodeType ? (r = e.documentElement, Math.max(e.body["scroll" + a], r["scroll" + a], e.body["offset" + a], r["offset" + a], r["client" + a])) : void 0 === n ? S.css(e, t, i) : S.style(e, t, n, i) }, s, n ? e : void 0, n) } }) }), S.each(["ajaxStart", "ajaxStop", "ajaxComplete", "ajaxError", "ajaxSuccess", "ajaxSend"], function (e, t) { S.fn[t] = function (e) { return this.on(t, e) } }), S.fn.extend({ bind: function (e, t, n) { return this.on(e, null, t, n) }, unbind: function (e, t) { return this.off(e, null, t) }, delegate: function (e, t, n, r) { return this.on(t, e, n, r) }, undelegate: function (e, t, n) { return 1 === arguments.length ? this.off(e, "**") : this.off(t, e || "**", n) }, hover: function (e, t) { return this.mouseenter(e).mouseleave(t || e) } }), S.each("blur focus focusin focusout resize scroll click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup contextmenu".split(" "), function (e, n) { S.fn[n] = function (e, t) { return 0 < arguments.length ? this.on(n, null, e, t) : this.trigger(n) } }); var Gt = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g; S.proxy = function (e, t) { var n, r, i; if ("string" == typeof t && (n = e[t], t = e, e = n), m(e)) return r = s.call(arguments, 2), (i = function () { return e.apply(t || this, r.concat(s.call(arguments))) }).guid = e.guid = e.guid || S.guid++, i }, S.holdReady = function (e) { e ? S.readyWait++ : S.ready(!0) }, S.isArray = Array.isArray, S.parseJSON = JSON.parse, S.nodeName = A, S.isFunction = m, S.isWindow = x, S.camelCase = X, S.type = w, S.now = Date.now, S.isNumeric = function (e) { var t = S.type(e); return ("number" === t || "string" === t) && !isNaN(e - parseFloat(e)) }, S.trim = function (e) { return null == e ? "" : (e + "").replace(Gt, "") }, "function" == typeof define && define.amd && define("jquery", [], function () { return S }); var Yt = C.jQuery, Qt = C.$; return S.noConflict = function (e) { return C.$ === S && (C.$ = Qt), e && C.jQuery === S && (C.jQuery = Yt), S }, "undefined" == typeof e && (C.jQuery = C.$ = S), S });
            // END: jquery/jquery-3.5.0.min.js

            // START: main.js
            let sleep = function (ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            };

            let getHTML = function (url) {
                return fetch(url).then(result => { return result.text() })
            };


            let getinfo = async () => {
                // Gets Username and movie from the current site
                var main_nav = $('.main-nav').html();
                if (typeof main_nav == 'undefined') {
                    await sleep(100);
                    let user_movie = getinfo();
                    return user_movie
                }
                else {
                    let movie_link = $('meta[property="og:url"]').attr('content');
                    url_part = movie_link.split('film/')[1].split('/')[1];
                    let exclude = ['members', 'likes', 'reviews', 'ratings', 'fans', 'lists'];
                    if (!exclude.includes(url_part)) {
                        let movie = movie_link.match('(?<=film\/)(.*?)(?=\/)')[0];
                        let user_link = $('a:contains("Profile")').parent().html();
                        let user = $(user_link).attr('href');
                        if (typeof user !== 'undefined') {
                            return [user, movie];
                        }
                    }
                    return null;
                }
            }

            let getContent = async (url, user_movie) => {
                var rating_list = [];
                var person_count = 0
                var like_count = 0;
                while (true) {
                    if (url !== 'undefined') {
                        let html = getHTML(url);
                        table = await html.then(function (html) {
                            let tbody = $(html).find('tbody').html();
                            if (typeof tbody !== 'undefined') {
                                let table = '<tbody>' + tbody + '</tbody>';
                                $(table).find('tr').each(function () {
                                    person = $(this).find(".name").attr('href');
                                    if (person !== user_movie[0]) {
                                        rating = $(this).find(".rating").attr('class')
                                        person_count += 1;
                                        let like = $(this).find('.icon-liked').html();
                                        if (typeof like !== 'undefined') {
                                            like_count += 1;
                                        }
                                        if (typeof rating !== 'undefined' && rating.length > 18) {
                                            rating = rating.split('rated-')[1];
                                            rating_list.push(Number(rating));
                                        }
                                    }
                                });
                            }
                            let next_page_loc = $(html).find('.next').parent().html();
                            let next_page = $(next_page_loc).attr('href');
                            return [next_page, rating_list, person_count, like_count];

                        })
                        if (typeof table[0] == 'undefined') {
                            if (table[1].length == 0 & table[3] == 0)
                                break;
                            else {
                                prepContent(table, user_movie);
                                return true;
                            }
                        }
                        else {
                            url = 'https://letterboxd.com' + table[0];
                        }
                    }


                }
            };

            let prepContent = function (table, user_movie) {
                rating_list = table[1];
                votes = rating_list.length;
                console.log('Ratings:', rating_list);
                console.log('Person Count:', table[2]);
                console.log('Like Count:', table[3]);
                if (votes == 0) {
                    avg_1 = '–.–';
                    avg_2 = '–.–';
                }
                else {
                    let sum = 0;
                    for (var r of rating_list) {
                        sum += r;
                    }
                    avg = sum / (votes * 2);
                    avg_1 = avg.toFixed(1);
                    avg_2 = avg.toFixed(2);
                }

                console.log('Average Rating:', avg_1);
                href_head = user_movie[0] + 'friends/film/' + user_movie[1];
                href_likes = user_movie[0] + 'friends/film/' + user_movie[1] + '/likes/';
                if (votes == 1)
                    rating = 'rating';
                else {
                    rating = 'ratings';
                }
                data_popup = 'Average of ' + avg_2 + ' based on ' + votes + ' ' + rating;
                let rating_count = [];
                for (let i = 1; i < 11; i++) {
                    count = 0
                    for (rating of rating_list) {
                        if (rating == i) {
                            count += 1;
                        }
                    }
                    rating_count.push(count);
                }

                let max_rating = Math.max(...rating_count);
                let relative_rating = [];
                let percent_rating = [];

                for (rating of rating_count) {
                    let hight = (rating / max_rating) * 44.0;
                    if (hight < 1 || hight == Number.POSITIVE_INFINITY || isNaN(hight)) {
                        hight = 1;
                    }
                    relative_rating.push(hight);
                    let perc = Math.round((rating / votes) * 100);
                    percent_rating.push(perc);
                }

                let rat = [];
                stars = ['half-★', '★', '★½', '★★', '★★½', '★★★', '★★★½', '★★★★', '★★★★½', '★★★★★'];
                for (let i = 1; i < 11; i++) {
                    if (rating_count[i - 1] == 1)
                        rating = 'rating';
                    else {
                        rating = 'ratings';
                    }
                    r_n = rating_count[i - 1] + ' ' + stars[i - 1] + ' ' + rating + ' ' + '(' + percent_rating[i - 1] + '%)';
                    rat.push(r_n);
                };


                str1 = '<section class="section ratings-histogram-chart"><h2 class="section-heading"><a href="" id="aaa" title="">Ratings from Friends</a></h2><a href="" id="aab" class="all-link more-link"></a><span class="average-rating" itemprop="aggregateRating" itemscope="" itemtype="http://schema.org/AggregateRating"><a href="" id="a11" class="tooltip display-rating -highlight" data-popup =""></a></span><div class="rating-histogram clear rating-histogram-exploded">        <span class="rating-green rating-green-tiny rating-1">            <span class="rating rated-2">★</span>        </span>        <ul>';
                str2 = '<li id="li1" class="rating-histogram-bar" style="width: 15px; left: 0px"> <a href="" id="a1" class="ir tooltip"</a> </li><li id="li2" class="rating-histogram-bar" style="width: 15px; left: 16px"><a href="" id="a2" class="ir tooltip"></a></li><li id="li3" class="rating-histogram-bar" style="width: 15px; left: 32px"><a href="" id="a3" class="ir tooltip"></a></li><li id="li4" class="rating-histogram-bar" style="width: 15px; left: 48px"><a href="" id="a4" class="ir tooltip"></a></li><li id="li5" class="rating-histogram-bar" style="width: 15px; left: 64px"><a href="" id="a5" class="ir tooltip"></a></li><li id="li6" class="rating-histogram-bar" style="width: 15px; left: 80px"><a href="" id="a6" class="ir tooltip"></a></li><li id="li7" class="rating-histogram-bar" style="width: 15px; left: 96px"><a href="" id="a7" class="ir tooltip"></a></li><li id="li8" class="rating-histogram-bar" style="width: 15px; left: 112px"><a href="" id="a8" class="ir tooltip"></a></li><li id="li9" class="rating-histogram-bar" style="width: 15px; left: 128px"><a href="" id="a9" class="ir tooltip"></a></li><li id="li10" class="rating-histogram-bar" style="width: 15px; left: 144px"><a href="" id="a10" class="ir tooltip"></a></li></ul><span class="rating-green rating-green-tiny rating-5"><span class="rating rated-10">★★★★★</span></span></div>';
                str3 = '<div class="twipsy fade above in" id="popup1", style="display: none"> <div id="popup2" class="twipsy-arrow" style="left: 50%;"></div> <div id = "aad" class="twipsy-inner"></div> </div> </section>';
                str = str1 + str2 + str3;

                html = $.parseHTML(str)
                $(html).find('#aaa').attr('href', href_head);
                $(html).find('#aab').attr('href', href_likes);
                if (table[3] == 1) {
                    $(html).find('#aab').text('1 like');
                }
                else {
                    $(html).find('#aab').text(table[3] + ' likes');
                }
                $(html).find('#a11').attr('href', href_head);
                $(html).find('#a11').attr('data-popup', data_popup);
                $(html).find('#a11').text(avg_1);

                for (let i = 1; i < 11; i++) {
                    let id = '#a' + i
                    let i_str = '<i id = "i' + i + '" style=" height: ' + relative_rating[i - 1] + 'px;"></i>'
                    $(html).find(id).attr('href', href_head);
                    $(html).find(id).text(rat[i - 1]);
                    $(html).find(id).append($.parseHTML(i_str));
                }

                injectContent(html);
                return true;
            }

            let injectContent = function (html) {

                path = $('.sidebar');
                $(html).appendTo(path);
                return true;
            }

            let getWidths = async () => {
                var ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'];
                var widths = []
                $('#popup1').attr('style', 'display: block; top: -3px; left: -10px;')

                for (a of ids) {
                    id = '#' + a;
                    let text = $(id).text();
                    $('#aad').text(text);
                    let width = $('#aad').width();
                    widths.push(width)
                }

                text = $('#a11').data('popup')
                $('#aad').text(text);
                let width = $('#aad').width();
                widths.push(width);

                $('#popup1').attr('style', 'display: none')
                return widths
            }

            let main = async () => {
                var user_movie = await getinfo();
                if (user_movie !== null && typeof user_movie !== 'undefined') {
                    var user = user_movie[0];
                    var movie = user_movie[1];
                    let newURL = 'https://letterboxd.com' + user + 'friends/film/' + movie;
                    chrome.runtime.sendMessage({ content: newURL });
                    promise = await getContent(newURL, user_movie);
                    widths = await getWidths();
                    return widths
                }
            }

            widths = main();
            var ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11'];

            document.addEventListener('mousemove', function (e) {
                var element = e.srcElement;
                single = $(element).attr('id')
                double = $(element).parent().attr('id')
                if (ids.includes(double) || ids.includes(single)) {
                    if (single == 'a11') {
                        text = $(element).data('popup');
                        li_nr = 11;
                        // let width = $('#aad').width();
                        var position = - (Number(widths[li_nr - 1]) * 3 / 4) + 190;
                        var arrow = "left: 145px"
                    }

                    else {
                        text = $(element).text();
                        if (text == '') {
                            text = $(element).parent().text();
                        }
                        li_nr = Number(single.replace('a', ''));
                        if (isNaN(li_nr)) {
                            li_nr = Number(double.replace('a', ''));
                        }
                        // let width = $('#aad').width();
                        var position = - (Number(widths[li_nr - 1]) / 2) + (li_nr * 16) - 7.5;
                        var arrow = "left: 50%";

                    }

                    $('#popup1').attr('style', 'display: block; top: -3px; left:' + position + 'px;')
                    $('#popup2').attr('style', arrow)
                    $('#aad').text(text);
                }
                else {
                    $('#popup1').attr('style', 'display: none');
                }
            }, false);
            // END: main.js
            ;}
               } catch(e) { _error(`  Error executing scripts ${scriptPaths}`, e); }

              } else {
                  _log(`Skipping document-end phase (no document).`);
              }


  // #endregion
  // #region Wait for Document Idle
              _log(`Waiting for document idle state...`);
              if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
                  await new Promise(resolve => window.requestIdleCallback(resolve, { timeout: 2000 })); // 2-second timeout fallback
                  _log(`requestIdleCallback fired or timed out.`);
              } else {
                  // Fallback: wait a short period after DOMContentLoaded/current execution if requestIdleCallback is unavailable
                  await new Promise(resolve => setTimeout(resolve, 50));
                  _log(`Idle fallback timer completed.`);
              }


  // #endregion
  // #region Document Idle
               if (typeof document !== 'undefined') {
                _log(`Executing document-idle phase...`);

                const scriptPaths = [];
               _log(`  Executing JS (idle): ${scriptPaths}`);

               try {
                   // Keep variables from being redeclared for global scope, but also make them apply to global scope. (Theoretically)
                  with (globalThis){;

            ;}
               } catch(e) { _error(`  Error executing scripts ${scriptPaths}`, e); }

              } else {
                  _log(`Skipping document-idle phase (no document).`);
              }

              _log(`All execution phases complete, re-firing load events.`);
              document.dispatchEvent(new Event("DOMContentLoaded", {
                bubbles: true,
                cancelable: true
              }));
            }

  // #endregion
// #region Event Listener No changes needed here ---
            window.addEventListener("message", (event) => {
              if (event.data.type === "openOptionsPage") {
                openOptionsPage();
              }
              if (event.data.type === "openPopupPage") {
                openPopupPage();
              }
              if (event.data.type === "closeOptionsPage") {
                closeOptionsModal();
              }
              if (event.data.type === "closePopupPage") {
                closePopupModal();
              }
            });

// #endregion
// #region Refactored Modal Closing Functions Promise-based ---

            function closeOptionsModal() {
              return new Promise((resolve) => {
                const DURATION = 100;
                const backdrop = document.getElementById("extension-options-backdrop");
                const modal = document.getElementById("extension-options-modal");

                if (!backdrop || !modal) {
                  return resolve();
                }

                modal.style.animation = `modalCloseAnimation ${DURATION / 1000}s ease-out forwards`;
                backdrop.style.animation = `backdropFadeOut ${DURATION / 1000}s ease-out forwards`;

                setTimeout(() => {
                  if (confirm("Close options and reload the page?")) {
                    window.location.reload(); // Note: This will stop further execution
                  } else {
                    backdrop.remove();
                  }
                  resolve();
                }, DURATION);
              });
            }

            function closePopupModal() {
              return new Promise((resolve) => {
                const DURATION = 100;
                const backdrop = document.getElementById("extension-popup-backdrop");
                const modal = document.getElementById("extension-popup-modal");

                if (!backdrop || !modal) {
                  return resolve();
                }

                modal.style.animation = `modalCloseAnimation ${DURATION / 1000}s ease-out forwards`;
                backdrop.style.animation = `backdropFadeOut ${DURATION / 1000}s ease-out forwards`;

                setTimeout(() => {
                  backdrop.remove();
                  resolve();
                }, DURATION);
              });
            }

// #endregion
// #region Simplified Public API Functions ---

            async function openPopupPage() {
              if (!POPUP_PAGE_PATH || typeof EXTENSION_ASSETS_MAP === "undefined") {
                _warn("No popup page available.");
                return;
              }
              await openModal({
                type: "popup",
                pagePath: POPUP_PAGE_PATH,
                defaultTitle: "Extension Popup",
                closeFn: closePopupModal,
              });
            }

            async function openOptionsPage() {
              if (!OPTIONS_PAGE_PATH || typeof EXTENSION_ASSETS_MAP === "undefined") {
                _warn("No options page available.");
                return;
              }
              await openModal({
                type: "options",
                pagePath: OPTIONS_PAGE_PATH,
                defaultTitle: "Extension Options",
                closeFn: closeOptionsModal,
              });
            }

// #endregion
// #region Generic Modal Logic Style Injection ---

            let stylesInjected = false;
            function injectGlobalStyles() {
              if (stylesInjected) return;
              stylesInjected = true;

              const styles = `
                    .extension-backdrop {
                        position: fixed;
                        top: 0; left: 0;
                        width: 100vw; height: 100vh;
                        background: rgba(0, 0, 0, 0.13);
                        backdrop-filter: blur(3px);
                        z-index: 2147483646;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        animation: backdropFadeIn 0.3s ease-out forwards;
                    }

                    .extension-modal {
                        z-index: 2147483647;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        --background: #ffffff;
                        --rad: 10px;
                        --border: #666;
                        --border-thickness: 2px;
                        display: flex;
                        flex-direction: column;
                        overflow: hidden;
                        animation: modalOpenAnimation 0.3s ease-out forwards;
                    }

                    /* Size specific styles */
                    .extension-modal.popup-size {
                        width: 400px; height: 600px;
                        max-width: calc(100vw - 40px);
                        max-height: calc(100vh - 40px);
                    }
                    .extension-modal.options-size {
                        width: calc(100vw - 80px); height: calc(100vh - 80px);
                        max-width: 1200px;
                        max-height: 800px;
                    }

                    /* Common modal components */
                    .extension-modal .modal-header {
                        display: flex; justify-content: space-between; align-items: flex-end;
                        padding: 0 16px; position: relative; flex-shrink: 0;
                    }
                    .extension-modal .tab {
                        padding: 12px 16px; color: #606266;
                        display: flex; align-items: center; gap: 8px;
                        font-size: 14px; cursor: pointer;
                        border-radius: var(--rad) var(--rad) 0 0;
                        transition: background-color 0.2s ease; user-select: none;
                    }
                    .extension-modal .tab.active, .extension-modal .tab.close-button {
                        background-color: var(--background);
                        border: var(--border-thickness) solid var(--border);
                        border-bottom-color: var(--background);
                        margin-bottom: -1px; z-index: 1;
                        color: #303133; font-weight: 500;
                    }
                    .extension-modal .tab.close-button { padding: 8px; }
                    .extension-modal .tab.close-button:hover { background-color: #f5f7fa; }
                    .extension-modal .tab svg { stroke: currentColor; }
                    .extension-modal .tab.active img { width: 16px; height: 16px; }
                    .extension-modal .tab.close-button svg { width: 20px; height: 20px; }

                    .extension-modal .modal-content {
                        flex-grow: 1; position: relative;
                        border-radius: var(--rad); overflow: hidden;
                        bottom: calc(var(--border-thickness) - 1px);
                        border: var(--border-thickness) solid var(--border);
                    }
                    .extension-modal .modal-content iframe {
                        width: 100%; height: 100%; border: 0; background: white;
                    }

                    /* Animations */
                    @keyframes backdropFadeIn { from { opacity: 0; backdrop-filter: blur(0px); } to { opacity: 1; backdrop-filter: blur(3px); } }
                    @keyframes backdropFadeOut { from { opacity: 1; backdrop-filter: blur(3px); } to { opacity: 0; backdrop-filter: blur(0px); } }
                    @keyframes modalOpenAnimation { from { transform: scaleY(0.8); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }
                    @keyframes modalCloseAnimation { from { transform: scaleY(1); opacity: 1; } to { transform: scaleY(0.8); opacity: 0; } }
                `;
              const styleSheet = document.createElement("style");
              styleSheet.id = "extension-global-styles";
              styleSheet.innerText = styles;
              document.head.appendChild(styleSheet);
            }

            async function openModal(config) {
              injectGlobalStyles();

              const { type, pagePath, defaultTitle, closeFn } = config;
              const html = EXTENSION_ASSETS_MAP[pagePath];
              if (!html) {
                _warn(`${defaultTitle} HTML not found in asset map`);
                return;
              }

              const backdropId = `extension-${type}-backdrop`;
              const modalId = `extension-${type}-modal`;
              const sizeClass = `${type}-size`;

// #endregion
  // #region Smoothly close the other modal if it s open ---
              const otherType = type === "popup" ? "options" : "popup";
              const otherBackdrop = document.getElementById(
                `extension-${otherType}-backdrop`
              );
              if (otherBackdrop) {
                // Await the correct close function
                await (otherType === "popup" ? closePopupModal() : closeOptionsModal());
              }

              let backdrop = document.getElementById(backdropId);
              let modal, iframe;

              if (!backdrop) {
                backdrop = document.createElement("div");
                backdrop.id = backdropId;
                backdrop.className = "extension-backdrop";

                modal = document.createElement("div");
                modal.id = modalId;
                modal.className = `extension-modal ${sizeClass}`;

                const extensionName = INJECTED_MANIFEST.name || defaultTitle;
                const iconSrc =
                  EXTENSION_ICON ||
                  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIHN0cm9rZT0ibm9uZSIgZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik00IDdoM2ExIDEgMCAwIDAgMSAtMXYtMWEyIDIgMCAwIDEgNCAwdjFhMSAxIDAgMCAwIDEgMWgzYTEgMSAwIDAgMSAxIDF2M2ExIDEgMCAwIDAgMSAxaDFhMiAyIDAgMCAxIDAgNGgtMWExIDEgMCAwIDAgLTEgMXYzYTEgMSAwIDAgMSAtMSAxaC0zYTEgMSAwIDAgMSAtMSAtMXYtMWEyIDIgMCAwIDAgLTQgMHYxYTEgMSAwIDAgMSAtMSAxaC0zYTEgMSAwIDAgMSAtMSAtMXYtM2ExIDEgMCAwIDEgMSAtMWgxYTIgMiAwIDAgMCAwIC00aC0xYTEgMSAwIDAgMSAtMSAtMXYtM2ExIDEgMCAwIDEgMSAtMSIgLz48L3N2Zz4=";

                modal.innerHTML = `
                        <div class="modal-header">
                            <div class="tab active">
                                <img src="${iconSrc}" onerror="this.style.display='none'">
                                <span>${extensionName}</span>
                            </div>
                            <div class="tab close-button">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                   <line x1="18" y1="6" x2="6" y2="18"></line>
                                   <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </div>
                        </div>
                        <div class="modal-content">
                            <iframe></iframe>
                        </div>
                    `;

                backdrop.appendChild(modal);

                backdrop.addEventListener("click", (e) => {
                  if (e.target === backdrop) closeFn();
                });
                modal.querySelector(".close-button").addEventListener("click", closeFn);

                document.body.appendChild(backdrop);
                iframe = modal.querySelector("iframe");
              } else {
                // If it already exists, just make sure it's visible
                backdrop.style.display = "flex";
                modal = backdrop.querySelector(".extension-modal");
                iframe = modal.querySelector("iframe");
              }

              // Load content into iframe
              try {
                const polyfillString = generateCompletePolyfillForIframe();
                const doc = new DOMParser().parseFromString(html, "text/html");
                const script = doc.createElement("script");
                script.textContent = polyfillString;
                doc.head.insertAdjacentElement("afterbegin", script);
                iframe.srcdoc = doc.documentElement.outerHTML;
              } catch (e) {
                _error("Error generating complete polyfill for iframe", e);
                iframe.srcdoc = html;
              }
            }

            function generateCompletePolyfillForIframe() {
              const polyfillString = "\n// -- Messaging implementation\n\nfunction createEventBus(\n  scopeId,\n  type = \"page\", // \"page\" or \"iframe\"\n  { allowedOrigin = \"*\", children = [], parentWindow = null } = {}\n) {\n  if (!scopeId) throw new Error(\"createEventBus requires a scopeId\");\n\n  const handlers = {};\n\n  function handleIncoming(ev) {\n    if (allowedOrigin !== \"*\" && ev.origin !== allowedOrigin) return;\n\n    const msg = ev.data;\n    if (!msg || msg.__eventBus !== true || msg.scopeId !== scopeId) return;\n\n    const { event, payload } = msg;\n\n    // PAGE: if it's an INIT from an iframe, adopt it\n    if (type === \"page\" && event === \"__INIT__\") {\n      const win = ev.source;\n      if (win && !children.includes(win)) {\n        children.push(win);\n      }\n      return;\n    }\n\n    (handlers[event] || []).forEach((fn) =>\n      fn(payload, { origin: ev.origin, source: ev.source })\n    );\n  }\n\n  window.addEventListener(\"message\", handleIncoming);\n\n  function emitTo(win, event, payload) {\n    const envelope = {\n      __eventBus: true,\n      scopeId,\n      event,\n      payload,\n    };\n    win.postMessage(envelope, allowedOrigin);\n  }\n\n  // IFRAME: announce to page on startup\n  if (type === \"iframe\") {\n    setTimeout(() => {\n      const pw = parentWindow || window.parent;\n      if (pw && pw.postMessage) {\n        emitTo(pw, \"__INIT__\", null);\n      }\n    }, 0);\n  }\n\n  return {\n    on(event, fn) {\n      handlers[event] = handlers[event] || [];\n      handlers[event].push(fn);\n    },\n    off(event, fn) {\n      if (!handlers[event]) return;\n      handlers[event] = handlers[event].filter((h) => h !== fn);\n    },\n    /**\n     * Emits an event.\n     * @param {string} event - The event name.\n     * @param {any} payload - The event payload.\n     * @param {object} [options] - Emission options.\n     * @param {Window} [options.to] - A specific window to target. If provided, message is ONLY sent to the target.\n     */\n    emit(event, payload, { to } = {}) {\n      // If a specific target window is provided, send only to it and DO NOT dispatch locally.\n      // This prevents a port from receiving its own messages.\n      if (to) {\n        if (to && typeof to.postMessage === \"function\") {\n          emitTo(to, event, payload);\n        }\n        return; // Exit after targeted send.\n      }\n\n      // For broadcast messages (no 'to' target), dispatch locally first.\n      (handlers[event] || []).forEach((fn) =>\n        fn(payload, { origin: location.origin, source: window })\n      );\n\n      // Then propagate the broadcast to other windows.\n      if (type === \"page\") {\n        children.forEach((win) => emitTo(win, event, payload));\n      } else {\n        const pw = parentWindow || window.parent;\n        if (pw && pw.postMessage) {\n          emitTo(pw, event, payload);\n        }\n      }\n    },\n  };\n}\n\nfunction createRuntime(type = \"background\", bus) {\n  let nextId = 1;\n  const pending = {};\n  const msgListeners = [];\n\n  let nextPortId = 1;\n  const ports = {};\n  const onConnectListeners = [];\n\n  function parseArgs(args) {\n    let target, message, options, callback;\n    const arr = [...args];\n    if (arr.length === 0) {\n      throw new Error(\"sendMessage requires at least one argument\");\n    }\n    if (arr.length === 1) {\n      return { message: arr[0] };\n    }\n    // last object could be options\n    if (\n      arr.length &&\n      typeof arr[arr.length - 1] === \"object\" &&\n      !Array.isArray(arr[arr.length - 1])\n    ) {\n      options = arr.pop();\n    }\n    // last function is callback\n    if (arr.length && typeof arr[arr.length - 1] === \"function\") {\n      callback = arr.pop();\n    }\n    if (\n      arr.length === 2 &&\n      (typeof arr[0] === \"string\" || typeof arr[0] === \"number\")\n    ) {\n      [target, message] = arr;\n    } else {\n      [message] = arr;\n    }\n    return { target, message, options, callback };\n  }\n\n  if (type === \"background\") {\n    bus.on(\"__REQUEST__\", ({ id, message }, { source }) => {\n      let responded = false,\n        isAsync = false;\n      function sendResponse(resp) {\n        if (responded) return;\n        responded = true;\n        // Target the response directly back to the window that sent the request.\n        bus.emit(\"__RESPONSE__\", { id, response: resp }, { to: source });\n      }\n      const results = msgListeners\n        .map((fn) => {\n          try {\n            // msg, sender, sendResponse\n            const ret = fn(message, { id, tab: { id: source } }, sendResponse);\n            if (ret === true || (ret && typeof ret.then === \"function\")) {\n              isAsync = true;\n              return ret;\n            }\n            return ret;\n          } catch (e) {\n            _error(e);\n          }\n        })\n        .filter((r) => r !== undefined);\n\n      const promises = results.filter((r) => r && typeof r.then === \"function\");\n      if (!isAsync && promises.length === 0) {\n        const out = results.length === 1 ? results[0] : results;\n        sendResponse(out);\n      } else if (promises.length) {\n        Promise.all(promises).then((vals) => {\n          if (!responded) {\n            const out = vals.length === 1 ? vals[0] : vals;\n            sendResponse(out);\n          }\n        });\n      }\n    });\n  }\n\n  if (type !== \"background\") {\n    bus.on(\"__RESPONSE__\", ({ id, response }) => {\n      const entry = pending[id];\n      if (!entry) return;\n      entry.resolve(response);\n      if (entry.callback) entry.callback(response);\n      delete pending[id];\n    });\n  }\n\n  function sendMessage(...args) {\n    // Background should be able to send message to itself\n    // if (type === \"background\") {\n    //   throw new Error(\"Background cannot sendMessage to itself\");\n    // }\n    const { target, message, callback } = parseArgs(args);\n    const id = nextId++;\n    const promise = new Promise((resolve) => {\n      pending[id] = { resolve, callback };\n      bus.emit(\"__REQUEST__\", { id, message });\n    });\n    return promise;\n  }\n\n  bus.on(\"__PORT_CONNECT__\", ({ portId, name }, { source }) => {\n    if (type !== \"background\") return;\n    const backgroundPort = makePort(\"background\", portId, name, source);\n    ports[portId] = backgroundPort;\n\n    onConnectListeners.forEach((fn) => fn(backgroundPort));\n\n    // send back a CONNECT_ACK so the client can\n    // start listening on its end:\n    bus.emit(\"__PORT_CONNECT_ACK__\", { portId, name }, { to: source });\n  });\n\n  // Clients handle the ACK and finalize their Port object by learning the remote window.\n  bus.on(\"__PORT_CONNECT_ACK__\", ({ portId, name }, { source }) => {\n    if (type === \"background\") return; // ignore\n    const p = ports[portId];\n    if (!p) return;\n    // Call the port's internal finalize method to complete the handshake\n    if (p._finalize) {\n      p._finalize(source);\n    }\n  });\n\n  // Any port message travels via \"__PORT_MESSAGE__\"\n  bus.on(\"__PORT_MESSAGE__\", (envelope, { source }) => {\n    const { portId } = envelope;\n    const p = ports[portId];\n    if (!p) return;\n    p._receive(envelope, source);\n  });\n\n  // Any port disconnect:\n  bus.on(\"__PORT_DISCONNECT__\", ({ portId }) => {\n    const p = ports[portId];\n    if (!p) return;\n    p._disconnect();\n    delete ports[portId];\n  });\n\n  // Refactored makePort to correctly manage internal state and the connection handshake.\n  function makePort(side, portId, name, remoteWindow) {\n    let onMessageHandlers = [];\n    let onDisconnectHandlers = [];\n    let buffer = [];\n    // Unique instance ID for this port instance\n    const instanceId = Math.random().toString(36).slice(2) + Date.now();\n    // These state variables are part of the closure and are updated by _finalize\n    let _ready = side === \"background\";\n\n    function _drainBuffer() {\n      buffer.forEach((m) => _post(m));\n      buffer = [];\n    }\n\n    function _post(msg) {\n      // Always use the 'to' parameter for port messages, making them directional.\n      // Include senderInstanceId\n      bus.emit(\n        \"__PORT_MESSAGE__\",\n        { portId, msg, senderInstanceId: instanceId },\n        { to: remoteWindow }\n      );\n    }\n\n    function postMessage(msg) {\n      if (!_ready) {\n        buffer.push(msg);\n      } else {\n        _post(msg);\n      }\n    }\n\n    function _receive(envelope, source) {\n      // envelope: { msg, senderInstanceId }\n      if (envelope.senderInstanceId === instanceId) return; // Don't dispatch to self\n      onMessageHandlers.forEach((fn) =>\n        fn(envelope.msg, { id: portId, tab: { id: source } })\n      );\n    }\n\n    function disconnect() {\n      // Also use the 'to' parameter for disconnect messages\n      bus.emit(\"__PORT_DISCONNECT__\", { portId }, { to: remoteWindow });\n      _disconnect();\n      delete ports[portId];\n    }\n\n    function _disconnect() {\n      onDisconnectHandlers.forEach((fn) => fn());\n      onMessageHandlers = [];\n      onDisconnectHandlers = [];\n    }\n\n    // This function is called on the client port when the ACK is received from background.\n    // It updates the port's state, completing the connection.\n    function _finalize(win) {\n      remoteWindow = win; // <-- This is the crucial part: learn the destination\n      _ready = true;\n      _drainBuffer();\n    }\n\n    return {\n      name,\n      sender: {\n        id: portId,\n      },\n      onMessage: {\n        addListener(fn) {\n          onMessageHandlers.push(fn);\n        },\n        removeListener(fn) {\n          onMessageHandlers = onMessageHandlers.filter((x) => x !== fn);\n        },\n      },\n      onDisconnect: {\n        addListener(fn) {\n          onDisconnectHandlers.push(fn);\n        },\n        removeListener(fn) {\n          onDisconnectHandlers = onDisconnectHandlers.filter((x) => x !== fn);\n        },\n      },\n      postMessage,\n      disconnect,\n      // Internal methods used by the runtime\n      _receive,\n      _disconnect,\n      _finalize, // Expose the finalizer for the ACK handler\n    };\n  }\n\n  function connect(connectInfo = {}) {\n    if (type === \"background\") {\n      throw new Error(\"Background must use onConnect, not connect()\");\n    }\n    const name = connectInfo.name || \"\";\n    const portId = nextPortId++;\n    // create the client side port\n    // remoteWindow is initially null; it will be set by _finalize upon ACK.\n    const clientPort = makePort(\"client\", portId, name, null);\n    ports[portId] = clientPort;\n\n    // fire the connect event across the bus\n    bus.emit(\"__PORT_CONNECT__\", { portId, name });\n    return clientPort;\n  }\n\n  function onConnect(fn) {\n    if (type !== \"background\") {\n      throw new Error(\"connect event only fires in background\");\n    }\n    onConnectListeners.push(fn);\n  }\n\n  return {\n    // rpc:\n    sendMessage,\n    onMessage: {\n      addListener(fn) {\n        msgListeners.push(fn);\n      },\n      removeListener(fn) {\n        const i = msgListeners.indexOf(fn);\n        if (i >= 0) msgListeners.splice(i, 1);\n      },\n    },\n\n    // port API:\n    connect,\n    onConnect: {\n      addListener(fn) {\n        onConnect(fn);\n      },\n      removeListener(fn) {\n        const i = onConnectListeners.indexOf(fn);\n        if (i >= 0) onConnectListeners.splice(i, 1);\n      },\n    },\n  };\n}\n\n\n// --- Abstraction Layer: PostMessage Target\n\nlet nextRequestId = 1;\nconst pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }\n\nfunction sendAbstractionRequest(method, args = []) {\n  return new Promise((resolve, reject) => {\n    const requestId = nextRequestId++;\n\n    const timeout = setTimeout(() => {\n      pendingRequests.delete(requestId);\n      reject(new Error(`PostMessage request timeout for method: ${method}`));\n    }, 10000);\n\n    pendingRequests.set(requestId, { resolve, reject, timeout });\n\n    window.parent.postMessage({\n      type: \"abstraction-request\",\n      requestId,\n      method,\n      args,\n    });\n  });\n}\n\nwindow.addEventListener(\"message\", (event) => {\n  const { type, requestId, success, result, error } = event.data;\n\n  if (type === \"abstraction-response\") {\n    const pending = pendingRequests.get(requestId);\n    if (pending) {\n      clearTimeout(pending.timeout);\n      pendingRequests.delete(requestId);\n\n      if (success) {\n        pending.resolve(result);\n      } else {\n        const err = new Error(error.message);\n        err.stack = error.stack;\n        pending.reject(err);\n      }\n    }\n  }\n});\n\nasync function _storageSet(items) {\n  return sendAbstractionRequest(\"_storageSet\", [items]);\n}\n\nasync function _storageGet(keys) {\n  return sendAbstractionRequest(\"_storageGet\", [keys]);\n}\n\nasync function _storageRemove(keysToRemove) {\n  return sendAbstractionRequest(\"_storageRemove\", [keysToRemove]);\n}\n\nasync function _storageClear() {\n  return sendAbstractionRequest(\"_storageClear\");\n}\n\nasync function _cookieList(details) {\n  return sendAbstractionRequest(\"_cookieList\", [details]);\n}\n\nasync function _cookieSet(details) {\n  return sendAbstractionRequest(\"_cookieSet\", [details]);\n}\n\nasync function _cookieDelete(details) {\n  return sendAbstractionRequest(\"_cookieDelete\", [details]);\n}\n\nasync function _fetch(url, options) {\n  return sendAbstractionRequest(\"_fetch\", [url, options]);\n}\n\nfunction _registerMenuCommand(name, func) {\n  _warn(\"_registerMenuCommand called from iframe context:\", name);\n  return sendAbstractionRequest(\"_registerMenuCommand\", [\n    name,\n    func.toString(),\n  ]);\n}\n\nfunction _openTab(url, active) {\n  return sendAbstractionRequest(\"_openTab\", [url, active]);\n}\n\nasync function _initStorage() {\n  return sendAbstractionRequest(\"_initStorage\");\n}\n\n\nconst EXTENSION_ASSETS_MAP = {{EXTENSION_ASSETS_MAP}};\n\n// -- Polyfill Implementation\nfunction buildPolyfill({ isBackground = false, isOtherPage = false } = {}) {\n  // Generate a unique context ID for this polyfill instance\n  const contextType = isBackground\n    ? \"background\"\n    : isOtherPage\n      ? \"options\"\n      : \"content\";\n  const contextId = `${contextType}_${Math.random()\n    .toString(36)\n    .substring(2, 15)}`;\n\n  const IS_IFRAME = \"true\" === \"true\";\n  const BUS = (function () {\n    if (globalThis.__BUS) {\n      return globalThis.__BUS;\n    }\n    globalThis.__BUS = createEventBus(\n      \"friends-average-for-letterboxd\",\n      IS_IFRAME ? \"iframe\" : \"page\",\n    );\n    return globalThis.__BUS;\n  })();\n  const RUNTIME = createRuntime(isBackground ? \"background\" : \"tab\", BUS);\n  const createNoopListeners = () => ({\n    addListener: (callback) => {\n      _log(\"addListener\", callback);\n    },\n    removeListener: (callback) => {\n      _log(\"removeListener\", callback);\n    },\n  });\n  // TODO: Stub\n  const storageChangeListeners = new Set();\n  function broadcastStorageChange(changes, areaName) {\n    storageChangeListeners.forEach((listener) => {\n      listener(changes, areaName);\n    });\n  }\n\n  let REQ_PERMS = [];\n\n  // --- Chrome polyfill\n  let chrome = {\n    extension: {\n      isAllowedIncognitoAccess: () => Promise.resolve(true),\n      sendMessage: (...args) => _messagingHandler.sendMessage(...args),\n    },\n    permissions: {\n      // TODO: Remove origin permission means exclude from origin in startup (when checking for content scripts)\n      request: (permissions, callback) => {\n        _log(\"permissions.request\", permissions, callback);\n        if (Array.isArray(permissions)) {\n          REQ_PERMS = [...REQ_PERMS, ...permissions];\n        }\n        if (typeof callback === \"function\") {\n          callback(permissions);\n        }\n        return Promise.resolve(permissions);\n      },\n      contains: (permissions, callback) => {\n        if (typeof callback === \"function\") {\n          callback(true);\n        }\n        return Promise.resolve(true);\n      },\n      getAll: () => {\n        return Promise.resolve({\n          permissions: EXTENSION_PERMISSIONS,\n          origins: ORIGIN_PERMISSIONS,\n        });\n      },\n      onAdded: createNoopListeners(),\n      onRemoved: createNoopListeners(),\n    },\n    i18n: {\n      getUILanguage: () => {\n        return USED_LOCALE || \"en\";\n      },\n      getMessage: (key, substitutions = []) => {\n        if (typeof substitutions === \"string\") {\n          substitutions = [substitutions];\n        }\n        if (typeof LOCALE_KEYS !== \"undefined\" && LOCALE_KEYS[key]) {\n          return LOCALE_KEYS[key].message?.replace(\n            /\\$(\\d+)/g,\n            (match, p1) => substitutions[p1 - 1] || match,\n          );\n        }\n        return key;\n      },\n    },\n    alarms: {\n      onAlarm: createNoopListeners(),\n      create: () => {\n        _log(\"alarms.create\", arguments);\n      },\n      get: () => {\n        _log(\"alarms.get\", arguments);\n      },\n    },\n    runtime: {\n      ...RUNTIME,\n      onInstalled: createNoopListeners(),\n      onStartup: createNoopListeners(),\n      // TODO: Postmessage to parent to open options page or call openOptionsPage\n      openOptionsPage: () => {\n        // const url = chrome.runtime.getURL(OPTIONS_PAGE_PATH);\n        // console.log(\"openOptionsPage\", _openTab, url, EXTENSION_ASSETS_MAP);\n        // _openTab(url);\n        if (typeof openOptionsPage === \"function\") {\n          openOptionsPage();\n        } else if (window.parent) {\n          window.parent.postMessage({ type: \"openOptionsPage\" }, \"*\");\n        } else {\n          _warn(\"openOptionsPage not available.\");\n        }\n      },\n      getManifest: () => {\n        // The manifest object will be injected into the scope where buildPolyfill is called\n        if (typeof INJECTED_MANIFEST !== \"undefined\") {\n          return JSON.parse(JSON.stringify(INJECTED_MANIFEST)); // Return deep copy\n        }\n        _warn(\"INJECTED_MANIFEST not found for chrome.runtime.getManifest\");\n        return { name: \"Unknown\", version: \"0.0\", manifest_version: 2 };\n      },\n      getURL: (path) => {\n        if (!path) return \"\";\n        if (path.startsWith(\"/\")) {\n          path = path.substring(1);\n        }\n\n        if (typeof _createAssetUrl === \"function\") {\n          return _createAssetUrl(path);\n        }\n\n        _warn(\n          `chrome.runtime.getURL fallback for '${path}'. Assets may not be available.`,\n        );\n        // Attempt a relative path resolution (highly context-dependent and likely wrong)\n        try {\n          if (window.location.protocol.startsWith(\"http\")) {\n            return new URL(path, window.location.href).toString();\n          }\n        } catch (e) {\n          /* ignore error, fallback */\n        }\n        return path;\n      },\n      id: \"polyfilled-extension-\" + Math.random().toString(36).substring(2, 15),\n      lastError: null,\n      setUninstallURL: () => {},\n      setUpdateURL: () => {},\n      getPlatformInfo: async () => {\n        const platform = {\n          os: \"unknown\",\n          arch: \"unknown\",\n          nacl_arch: \"unknown\",\n        };\n\n        if (typeof navigator !== \"undefined\") {\n          const userAgent = navigator.userAgent.toLowerCase();\n          if (userAgent.includes(\"mac\")) platform.os = \"mac\";\n          else if (userAgent.includes(\"win\")) platform.os = \"win\";\n          else if (userAgent.includes(\"linux\")) platform.os = \"linux\";\n          else if (userAgent.includes(\"android\")) platform.os = \"android\";\n          else if (userAgent.includes(\"ios\")) platform.os = \"ios\";\n\n          if (userAgent.includes(\"x86_64\") || userAgent.includes(\"amd64\")) {\n            platform.arch = \"x86-64\";\n          } else if (userAgent.includes(\"i386\") || userAgent.includes(\"i686\")) {\n            platform.arch = \"x86-32\";\n          } else if (userAgent.includes(\"arm\")) {\n            platform.arch = \"arm\";\n          }\n        }\n\n        return platform;\n      },\n      getBrowserInfo: async () => {\n        const info = {\n          name: \"unknown\",\n          version: \"unknown\",\n          buildID: \"unknown\",\n        };\n\n        if (typeof navigator !== \"undefined\") {\n          const userAgent = navigator.userAgent;\n          if (userAgent.includes(\"Chrome\")) {\n            info.name = \"Chrome\";\n            const match = userAgent.match(/Chrome\\/([0-9.]+)/);\n            if (match) info.version = match[1];\n          } else if (userAgent.includes(\"Firefox\")) {\n            info.name = \"Firefox\";\n            const match = userAgent.match(/Firefox\\/([0-9.]+)/);\n            if (match) info.version = match[1];\n          } else if (userAgent.includes(\"Safari\")) {\n            info.name = \"Safari\";\n            const match = userAgent.match(/Version\\/([0-9.]+)/);\n            if (match) info.version = match[1];\n          }\n        }\n\n        return info;\n      },\n    },\n    storage: {\n      local: {\n        get: function (keys, callback) {\n          if (typeof _storageGet !== \"function\")\n            throw new Error(\"_storageGet not defined\");\n\n          const promise = _storageGet(keys);\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.get callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.get error:\", error);\n                callback({});\n              });\n            return;\n          }\n\n          return promise;\n        },\n        set: function (items, callback) {\n          if (typeof _storageSet !== \"function\")\n            throw new Error(\"_storageSet not defined\");\n\n          const promise = _storageSet(items).then((result) => {\n            broadcastStorageChange(items, \"local\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.set callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.set error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        remove: function (keys, callback) {\n          if (typeof _storageRemove !== \"function\")\n            throw new Error(\"_storageRemove not defined\");\n\n          const promise = _storageRemove(keys).then((result) => {\n            const changes = {};\n            const keyList = Array.isArray(keys) ? keys : [keys];\n            keyList.forEach((key) => {\n              changes[key] = { oldValue: undefined, newValue: undefined };\n            });\n            broadcastStorageChange(changes, \"local\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.remove callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.remove error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        clear: function (callback) {\n          if (typeof _storageClear !== \"function\")\n            throw new Error(\"_storageClear not defined\");\n\n          const promise = _storageClear().then((result) => {\n            broadcastStorageChange({}, \"local\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.clear callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.clear error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        onChanged: {\n          addListener: (callback) => {\n            storageChangeListeners.add(callback);\n          },\n          removeListener: (callback) => {\n            storageChangeListeners.delete(callback);\n          },\n        },\n      },\n      sync: {\n        get: function (keys, callback) {\n          _warn(\"chrome.storage.sync polyfill maps to local\");\n          return chrome.storage.local.get(keys, callback);\n        },\n        set: function (items, callback) {\n          _warn(\"chrome.storage.sync polyfill maps to local\");\n\n          const promise = chrome.storage.local.set(items).then((result) => {\n            broadcastStorageChange(items, \"sync\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.sync.set callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.sync.set error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        remove: function (keys, callback) {\n          _warn(\"chrome.storage.sync polyfill maps to local\");\n\n          const promise = chrome.storage.local.remove(keys).then((result) => {\n            const changes = {};\n            const keyList = Array.isArray(keys) ? keys : [keys];\n            keyList.forEach((key) => {\n              changes[key] = { oldValue: undefined, newValue: undefined };\n            });\n            broadcastStorageChange(changes, \"sync\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.sync.remove callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.sync.remove error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        clear: function (callback) {\n          _warn(\"chrome.storage.sync polyfill maps to local\");\n\n          const promise = chrome.storage.local.clear().then((result) => {\n            broadcastStorageChange({}, \"sync\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.sync.clear callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.sync.clear error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        onChanged: {\n          addListener: (callback) => {\n            storageChangeListeners.add(callback);\n          },\n          removeListener: (callback) => {\n            storageChangeListeners.delete(callback);\n          },\n        },\n      },\n      onChanged: {\n        addListener: (callback) => {\n          storageChangeListeners.add(callback);\n        },\n        removeListener: (callback) => {\n          storageChangeListeners.delete(callback);\n        },\n      },\n      managed: {\n        get: function (keys, callback) {\n          _warn(\"chrome.storage.managed polyfill is read-only empty.\");\n\n          const promise = Promise.resolve({});\n\n          if (typeof callback === \"function\") {\n            promise.then((result) => {\n              try {\n                callback(result);\n              } catch (e) {\n                _error(\"Error in storage.managed.get callback:\", e);\n              }\n            });\n            return;\n          }\n\n          return promise;\n        },\n      },\n    },\n    cookies: (function () {\n      const cookieChangeListeners = new Set();\n      function broadcastCookieChange(changeInfo) {\n        cookieChangeListeners.forEach((listener) => {\n          try {\n            listener(changeInfo);\n          } catch (e) {\n            _error(\"Error in cookies.onChanged listener:\", e);\n          }\n        });\n      }\n\n      function handlePromiseCallback(promise, callback) {\n        if (typeof callback === \"function\") {\n          promise\n            .then((result) => callback(result))\n            .catch((error) => {\n              // chrome.runtime.lastError = { message: error.message }; // TODO: Implement lastError\n              _error(error);\n              callback(); // Call with undefined on error\n            });\n          return;\n        }\n        return promise;\n      }\n\n      return {\n        get: function (details, callback) {\n          if (typeof _cookieList !== \"function\") {\n            return handlePromiseCallback(\n              Promise.reject(new Error(\"_cookieList not defined\")),\n              callback,\n            );\n          }\n          const promise = _cookieList({\n            url: details.url,\n            name: details.name,\n            storeId: details.storeId,\n            partitionKey: details.partitionKey,\n          }).then((cookies) => {\n            if (!cookies || cookies.length === 0) {\n              return null;\n            }\n            // Sort by path length (longest first), then creation time (earliest first, if available)\n            cookies.sort((a, b) => {\n              const pathLenDiff = (b.path || \"\").length - (a.path || \"\").length;\n              if (pathLenDiff !== 0) return pathLenDiff;\n              return (a.creationTime || 0) - (b.creationTime || 0);\n            });\n            return cookies[0];\n          });\n          return handlePromiseCallback(promise, callback);\n        },\n\n        getAll: function (details, callback) {\n          if (typeof _cookieList !== \"function\") {\n            return handlePromiseCallback(\n              Promise.reject(new Error(\"_cookieList not defined\")),\n              callback,\n            );\n          }\n          if (details.partitionKey) {\n            _warn(\n              \"cookies.getAll: partitionKey is not fully supported in this environment.\",\n            );\n          }\n          const promise = _cookieList(details);\n          return handlePromiseCallback(promise, callback);\n        },\n\n        set: function (details, callback) {\n          const promise = (async () => {\n            if (\n              typeof _cookieSet !== \"function\" ||\n              typeof _cookieList !== \"function\"\n            ) {\n              throw new Error(\"_cookieSet or _cookieList not defined\");\n            }\n            if (details.partitionKey) {\n              _warn(\n                \"cookies.set: partitionKey is not fully supported in this environment.\",\n              );\n            }\n\n            const getDetails = {\n              url: details.url,\n              name: details.name,\n              storeId: details.storeId,\n            };\n            const oldCookies = await _cookieList(getDetails);\n            const oldCookie = oldCookies && oldCookies[0];\n\n            if (oldCookie) {\n              broadcastCookieChange({\n                cause: \"overwrite\",\n                cookie: oldCookie,\n                removed: true,\n              });\n            }\n\n            await _cookieSet(details);\n            const newCookies = await _cookieList(getDetails);\n            const newCookie = newCookies && newCookies[0];\n\n            if (newCookie) {\n              broadcastCookieChange({\n                cause: \"explicit\",\n                cookie: newCookie,\n                removed: false,\n              });\n            }\n            return newCookie || null;\n          })();\n          return handlePromiseCallback(promise, callback);\n        },\n\n        remove: function (details, callback) {\n          const promise = (async () => {\n            if (\n              typeof _cookieDelete !== \"function\" ||\n              typeof _cookieList !== \"function\"\n            ) {\n              throw new Error(\"_cookieDelete or _cookieList not defined\");\n            }\n            const oldCookies = await _cookieList(details);\n            const oldCookie = oldCookies && oldCookies[0];\n\n            if (!oldCookie) return null; // Nothing to remove\n\n            await _cookieDelete(details);\n\n            broadcastCookieChange({\n              cause: \"explicit\",\n              cookie: oldCookie,\n              removed: true,\n            });\n\n            return {\n              url: details.url,\n              name: details.name,\n              storeId: details.storeId || \"0\",\n              partitionKey: details.partitionKey,\n            };\n          })();\n          return handlePromiseCallback(promise, callback);\n        },\n\n        getAllCookieStores: function (callback) {\n          const promise = Promise.resolve([\n            { id: \"0\", tabIds: [1] }, // Mock store for the current context\n          ]);\n          return handlePromiseCallback(promise, callback);\n        },\n\n        getPartitionKey: function (details, callback) {\n          _warn(\n            \"chrome.cookies.getPartitionKey is not supported in this environment.\",\n          );\n          const promise = Promise.resolve({ partitionKey: {} }); // Return empty partition key\n          return handlePromiseCallback(promise, callback);\n        },\n\n        onChanged: {\n          addListener: (callback) => {\n            if (typeof callback === \"function\") {\n              cookieChangeListeners.add(callback);\n            }\n          },\n          removeListener: (callback) => {\n            cookieChangeListeners.delete(callback);\n          },\n        },\n      };\n    })(),\n    tabs: {\n      query: async (queryInfo) => {\n        _warn(\"chrome.tabs.query polyfill only returns current tab info.\");\n        const dummyId = Math.floor(Math.random() * 1000) + 1;\n        return [\n          {\n            id: dummyId,\n            url: CURRENT_LOCATION,\n            active: true,\n            windowId: 1,\n            status: \"complete\",\n          },\n        ];\n      },\n      create: async ({ url, active = true }) => {\n        _log(`[Polyfill tabs.create] URL: ${url}`);\n        if (typeof _openTab !== \"function\")\n          throw new Error(\"_openTab not defined\");\n        _openTab(url, active);\n        const dummyId = Math.floor(Math.random() * 1000) + 1001;\n        return Promise.resolve({\n          id: dummyId,\n          url: url,\n          active,\n          windowId: 1,\n        });\n      },\n      sendMessage: async (tabId, message) => {\n        _warn(\n          `chrome.tabs.sendMessage polyfill (to tab ${tabId}) redirects to runtime.sendMessage (current context).`,\n        );\n        return chrome.runtime.sendMessage(message);\n      },\n      onActivated: createNoopListeners(),\n      onUpdated: createNoopListeners(),\n      onRemoved: createNoopListeners(),\n      onReplaced: createNoopListeners(),\n      onCreated: createNoopListeners(),\n      onMoved: createNoopListeners(),\n      onDetached: createNoopListeners(),\n      onAttached: createNoopListeners(),\n    },\n    windows: {\n      onFocusChanged: createNoopListeners(),\n      onCreated: createNoopListeners(),\n      onRemoved: createNoopListeners(),\n      onFocused: createNoopListeners(),\n      onFocus: createNoopListeners(),\n      onBlur: createNoopListeners(),\n      onFocused: createNoopListeners(),\n    },\n    notifications: {\n      create: async (notificationId, options) => {\n        try {\n          let id = notificationId;\n          let notificationOptions = options;\n\n          if (typeof notificationId === \"object\" && notificationId !== null) {\n            notificationOptions = notificationId;\n            id = \"notification_\" + Math.random().toString(36).substring(2, 15);\n          } else if (typeof notificationId === \"string\" && options) {\n            id = notificationId;\n            notificationOptions = options;\n          } else {\n            throw new Error(\"Invalid parameters for notifications.create\");\n          }\n\n          if (!notificationOptions || typeof notificationOptions !== \"object\") {\n            throw new Error(\"Notification options must be an object\");\n          }\n\n          const {\n            title,\n            message,\n            iconUrl,\n            type = \"basic\",\n          } = notificationOptions;\n\n          if (!title || !message) {\n            throw new Error(\"Notification must have title and message\");\n          }\n\n          if (\"Notification\" in window) {\n            if (Notification.permission === \"granted\") {\n              const notification = new Notification(title, {\n                body: message,\n                icon: iconUrl,\n                tag: id,\n              });\n\n              _log(`[Notifications] Created notification: ${id}`);\n              return id;\n            } else if (Notification.permission === \"default\") {\n              const permission = await Notification.requestPermission();\n              if (permission === \"granted\") {\n                const notification = new Notification(title, {\n                  body: message,\n                  icon: iconUrl,\n                  tag: id,\n                });\n                _log(\n                  `[Notifications] Created notification after permission: ${id}`,\n                );\n                return id;\n              } else {\n                _warn(\"[Notifications] Permission denied for notifications\");\n                return id;\n              }\n            } else {\n              _warn(\"[Notifications] Notifications are blocked\");\n              return id;\n            }\n          } else {\n            _warn(\n              \"[Notifications] Native notifications not supported, using console fallback\",\n            );\n            _log(`[Notification] ${title}: ${message}`);\n            return id;\n          }\n        } catch (error) {\n          _error(\"[Notifications] Error creating notification:\", error.message);\n          throw error;\n        }\n      },\n      clear: async (notificationId) => {\n        _log(`[Notifications] Clear notification: ${notificationId}`);\n        // For native notifications, there's no direct way to clear by ID\n        // This is a limitation of the Web Notifications API\n        return true;\n      },\n      getAll: async () => {\n        _warn(\"[Notifications] getAll not fully supported in polyfill\");\n        return {};\n      },\n      getPermissionLevel: async () => {\n        if (\"Notification\" in window) {\n          const permission = Notification.permission;\n          return { level: permission === \"granted\" ? \"granted\" : \"denied\" };\n        }\n        return { level: \"denied\" };\n      },\n    },\n    contextMenus: {\n      create: (createProperties, callback) => {\n        try {\n          if (!createProperties || typeof createProperties !== \"object\") {\n            throw new Error(\"Context menu create properties must be an object\");\n          }\n\n          const { id, title, contexts = [\"page\"], onclick } = createProperties;\n          const menuId =\n            id || `menu_${Math.random().toString(36).substring(2, 15)}`;\n\n          if (!title || typeof title !== \"string\") {\n            throw new Error(\"Context menu must have a title\");\n          }\n\n          // Store menu items for potential use\n          if (!window._polyfillContextMenus) {\n            window._polyfillContextMenus = new Map();\n          }\n\n          window._polyfillContextMenus.set(menuId, {\n            id: menuId,\n            title,\n            contexts,\n            onclick,\n            enabled: createProperties.enabled !== false,\n          });\n\n          _log(\n            `[ContextMenus] Created context menu item: ${title} (${menuId})`,\n          );\n\n          // Try to register a menu command as fallback\n          if (typeof _registerMenuCommand === \"function\") {\n            try {\n              _registerMenuCommand(\n                title,\n                onclick ||\n                  (() => {\n                    _log(`Context menu clicked: ${title}`);\n                  }),\n              );\n            } catch (e) {\n              _warn(\n                \"[ContextMenus] Failed to register as menu command:\",\n                e.message,\n              );\n            }\n          }\n\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n\n          return menuId;\n        } catch (error) {\n          _error(\"[ContextMenus] Error creating context menu:\", error.message);\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n          throw error;\n        }\n      },\n      update: (id, updateProperties, callback) => {\n        try {\n          if (\n            !window._polyfillContextMenus ||\n            !window._polyfillContextMenus.has(id)\n          ) {\n            throw new Error(`Context menu item not found: ${id}`);\n          }\n\n          const menuItem = window._polyfillContextMenus.get(id);\n          Object.assign(menuItem, updateProperties);\n\n          _log(`[ContextMenus] Updated context menu item: ${id}`);\n\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        } catch (error) {\n          _error(\"[ContextMenus] Error updating context menu:\", error.message);\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        }\n      },\n      remove: (menuItemId, callback) => {\n        try {\n          if (\n            window._polyfillContextMenus &&\n            window._polyfillContextMenus.has(menuItemId)\n          ) {\n            window._polyfillContextMenus.delete(menuItemId);\n            _log(`[ContextMenus] Removed context menu item: ${menuItemId}`);\n          } else {\n            _warn(\n              `[ContextMenus] Context menu item not found for removal: ${menuItemId}`,\n            );\n          }\n\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        } catch (error) {\n          _error(\"[ContextMenus] Error removing context menu:\", error.message);\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        }\n      },\n      removeAll: (callback) => {\n        try {\n          if (window._polyfillContextMenus) {\n            const count = window._polyfillContextMenus.size;\n            window._polyfillContextMenus.clear();\n            _log(`[ContextMenus] Removed all ${count} context menu items`);\n          }\n\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        } catch (error) {\n          _error(\n            \"[ContextMenus] Error removing all context menus:\",\n            error.message,\n          );\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        }\n      },\n      onClicked: {\n        addListener: (callback) => {\n          if (!window._polyfillContextMenuListeners) {\n            window._polyfillContextMenuListeners = new Set();\n          }\n          window._polyfillContextMenuListeners.add(callback);\n          _log(\"[ContextMenus] Added click listener\");\n        },\n        removeListener: (callback) => {\n          if (window._polyfillContextMenuListeners) {\n            window._polyfillContextMenuListeners.delete(callback);\n            _log(\"[ContextMenus] Removed click listener\");\n          }\n        },\n      },\n    },\n  };\n\n  const tc = (fn) => {\n    try {\n      fn();\n    } catch (e) {}\n  };\n  const loggingProxyHandler = (_key) => ({\n    get(target, key, receiver) {\n      tc(() => _log(`[${contextType}] [CHROME - ${_key}] Getting ${key}`));\n      return Reflect.get(target, key, receiver);\n    },\n    set(target, key, value, receiver) {\n      tc(() =>\n        _log(`[${contextType}] [CHROME - ${_key}] Setting ${key} to ${value}`),\n      );\n      return Reflect.set(target, key, value, receiver);\n    },\n    has(target, key) {\n      tc(() =>\n        _log(`[${contextType}] [CHROME - ${_key}] Checking if ${key} exists`),\n      );\n      return Reflect.has(target, key);\n    },\n  });\n  chrome = Object.fromEntries(\n    Object.entries(chrome).map(([key, value]) => [\n      key,\n      new Proxy(value, loggingProxyHandler(key)),\n    ]),\n  );\n\n  // Alias browser to chrome for common Firefox pattern\n  const browser = new Proxy(chrome, loggingProxyHandler);\n\n  const oldGlobalThis = globalThis;\n  const oldWindow = window;\n  const oldSelf = self;\n  const oldGlobal = globalThis;\n  const __globalsStorage = {};\n\n  const TO_MODIFY = [oldGlobalThis, oldWindow, oldSelf, oldGlobal];\n  const set = (k, v) => {\n    __globalsStorage[k] = v;\n    TO_MODIFY.forEach((target) => {\n      target[k] = v;\n    });\n  };\n  const proxyHandler = {\n    get(target, key, receiver) {\n      const fns = [\n        () => __globalsStorage[key],\n        () => Reflect.get(target, key, target),\n        () => target[key],\n      ];\n      const out = fns\n        .map((f) => {\n          try {\n            let out = f();\n            return out;\n          } catch (e) {\n            return undefined;\n          }\n        })\n        .find((f) => f !== undefined);\n      if (typeof out === \"function\") {\n        return out.bind(target);\n      }\n      return out;\n    },\n    set(target, key, value, receiver) {\n      try {\n        tc(() => _log(`[${contextType}] Setting ${key} to ${value}`));\n        set(key, value);\n        return Reflect.set(target, key, value, receiver);\n      } catch (e) {\n        _error(\"Error setting\", key, value, e);\n        try {\n          target[key] = value;\n          return true;\n        } catch (e) {\n          _error(\"Error setting\", key, value, e);\n        }\n        return false;\n      }\n    },\n    has(target, key) {\n      try {\n        return key in __globalsStorage || key in target;\n      } catch (e) {\n        _error(\"Error has\", key, e);\n        try {\n          return key in __globalsStorage || key in target;\n        } catch (e) {\n          _error(\"Error has\", key, e);\n        }\n        return false;\n      }\n    },\n    getOwnPropertyDescriptor(target, key) {\n      try {\n        if (key in __globalsStorage) {\n          return {\n            configurable: true,\n            enumerable: true,\n            writable: true,\n            value: __globalsStorage[key],\n          };\n        }\n        // fall back to the real globalThis\n        const desc = Reflect.getOwnPropertyDescriptor(target, key);\n        // ensure it's configurable so the with‑scope binding logic can override it\n        if (desc && !desc.configurable) {\n          desc.configurable = true;\n        }\n        return desc;\n      } catch (e) {\n        _error(\"Error getOwnPropertyDescriptor\", key, e);\n        return {\n          configurable: true,\n          enumerable: true,\n          writable: true,\n          value: undefined,\n        };\n      }\n    },\n\n    defineProperty(target, key, descriptor) {\n      try {\n        // Normalize descriptor to avoid mixed accessor & data attributes\n        const hasAccessor = \"get\" in descriptor || \"set\" in descriptor;\n\n        if (hasAccessor) {\n          // Build a clean descriptor without value/writable when accessors present\n          const normalized = {\n            configurable:\n              \"configurable\" in descriptor ? descriptor.configurable : true,\n            enumerable:\n              \"enumerable\" in descriptor ? descriptor.enumerable : false,\n          };\n          if (\"get\" in descriptor) normalized.get = descriptor.get;\n          if (\"set\" in descriptor) normalized.set = descriptor.set;\n\n          // Store accessor references for inspection but avoid breaking invariants\n          set(key, {\n            get: descriptor.get,\n            set: descriptor.set,\n          });\n\n          return Reflect.defineProperty(target, key, normalized);\n        }\n\n        // Data descriptor path\n        set(key, descriptor.value);\n        return Reflect.defineProperty(target, key, descriptor);\n      } catch (e) {\n        _error(\"Error defineProperty\", key, descriptor, e);\n        return false;\n      }\n    },\n  };\n\n  // Create proxies once proxyHandler is defined\n  const proxyWindow = new Proxy(oldWindow, proxyHandler);\n  const proxyGlobalThis = new Proxy(oldGlobalThis, proxyHandler);\n  const proxyGlobal = new Proxy(oldGlobal, proxyHandler);\n  const proxySelf = new Proxy(oldSelf, proxyHandler);\n\n  // Seed storage with core globals so lookups succeed inside `with` blocks\n  Object.assign(__globalsStorage, {\n    chrome,\n    browser,\n    window: proxyWindow,\n    globalThis: proxyGlobalThis,\n    global: proxyGlobal,\n    self: proxySelf,\n    document: oldWindow.document,\n  });\n\n  const __globals = {\n    chrome,\n    browser,\n    window: proxyWindow,\n    globalThis: proxyGlobalThis,\n    global: proxyGlobal,\n    self: proxySelf,\n    __globals: __globalsStorage,\n  };\n\n  __globals.contextId = contextId;\n  __globals.contextType = contextType;\n  __globals.module = undefined;\n  __globals.amd = undefined;\n  __globals.define = undefined;\n  __globals.importScripts = (...args) => {\n    _log(\"importScripts\", args);\n  };\n\n  return __globals;\n}\n\n\nif (typeof window !== 'undefined') {\n    window.buildPolyfill = buildPolyfill;\n}\n"
              let newMap = JSON.parse(JSON.stringify(EXTENSION_ASSETS_MAP));
              delete newMap[OPTIONS_PAGE_PATH];
              const PASS_ON = Object.fromEntries(
                Object.entries({
                  LOCALE_KEYS,
                  INJECTED_MANIFEST,
                  USED_LOCALE,
                  EXTENSION_ICON,
                  CURRENT_LOCATION,
                  OPTIONS_PAGE_PATH,
                  CAN_USE_BLOB_CSP,
                  ALL_PERMISSIONS,
                  ORIGIN_PERMISSIONS,
                  EXTENSION_PERMISSIONS,
                  SCRIPT_NAME,
                  _base64ToBlob,
                  _getMimeTypeFromPath,
                  _isTextAsset,
                  _createAssetUrl,
                  _matchGlobPattern,
                  _isWebAccessibleResource,
                  _log,
                  _warn,
                  _error,
                }).map((i) => {
                  let out = [...i];
                  if (typeof i[1] === "function") {
                    out[1] = i[1].toString();
                  } else {
                    out[1] = JSON.stringify(i[1]);
                  }
                  return out;
                })
              );
              _log(PASS_ON);
              return `
                ${Object.entries(PASS_ON)
                  .map(
                    (i) =>
                      `const ${i[0]} = ${i[1]};\nwindow[${JSON.stringify(i[0])}] = ${i[0]}`
                  )
                  .join("\n")}

                    _log("Initialized polyfill", {${Object.keys(PASS_ON).join(", ")}})
                    ${polyfillString.replaceAll("{{EXTENSION_ASSETS_MAP}}", `JSON.parse(unescape(atob("${btoa(encodeURIComponent(JSON.stringify(EXTENSION_ASSETS_MAP)))}")))`)}

                    // Initialize the polyfill context for options page
                    const polyfillCtx = buildPolyfill({ isOtherPage: true });
                    const APPLY_TO = [window, self, globalThis];
                    for (const obj of APPLY_TO) {
                        obj.chrome = polyfillCtx.chrome;
                        obj.browser = polyfillCtx.browser;
                        obj.INJECTED_MANIFEST = ${JSON.stringify(INJECTED_MANIFEST)};
                    }
                `;
            }

            async function main() {
              _log(`Initializing...`, performance.now());

              if (typeof _initStorage === "function") {
                try {
                  _initStorage()
                    .then(() => {
                      _log(`Storage initialized.`);
                    })
                    .catch((e) => {
                      _error("Error during storage initialization:", e);
                    });
                } catch (e) {
                  _error("Error during storage initialization:", e);
                }
              }

              _log(`Starting content scripts...`);

              const currentUrl = window.location.href;
              let shouldRunAnyScript = false;
              _log(`Checking URL: ${currentUrl}`);

              if (
                CONTENT_SCRIPT_CONFIGS_FOR_MATCHING &&
                CONTENT_SCRIPT_CONFIGS_FOR_MATCHING.length > 0
              ) {
                for (const config of CONTENT_SCRIPT_CONFIGS_FOR_MATCHING) {
                  if (
                    config.matches &&
                    config.matches.some((pattern) => {
                      try {
                        const regex = convertMatchPatternToRegExp(pattern);
                        if (regex.test(currentUrl)) {
                          return true;
                        }
                        return false;
                      } catch (e) {
                        _error(`Error testing match pattern "${pattern}":`, e);
                        return false;
                      }
                    })
                  ) {
                    shouldRunAnyScript = true;
                    _log(`URL match found via config:`, config);
                    break;
                  }
                }
              } else {
                _log(`No content script configurations found in manifest data.`);
              }

              if (shouldRunAnyScript) {
                let polyfillContext;
                try {
                  polyfillContext = buildPolyfill({ isBackground: false });
                } catch (e) {
                  _error(`Failed to build polyfill:`, e);
                  return;
                }

                _log(`Polyfill built. Executing combined script logic...`);
                // async function executeAllScripts({chrome, browser, global, window, globalThis, self, __globals}, extensionCssData) {
                await executeAllScripts.call(
                  polyfillContext.globalThis,
                  polyfillContext,
                  extensionCssData
                );
              } else {
                _log(
                  `No matching content script patterns for this URL. No scripts will be executed.`
                );
              }

              if (OPTIONS_PAGE_PATH) {
                if (typeof _registerMenuCommand === "function") {
                  try {
                    _registerMenuCommand("Open Options", openOptionsPage);
                    _log(`Options menu command registered.`);
                  } catch (e) {
                    _error("Failed to register menu command", e);
                  }
                }
              }

              if (POPUP_PAGE_PATH) {
                if (typeof _registerMenuCommand === "function") {
                  try {
                    _registerMenuCommand("Open Popup", openPopupPage);
                    _log(`Popup menu command registered.`);
                  } catch (e) {
                    _error("Failed to register popup menu command", e);
                  }
                }
              }

              _log(`Initialization sequence complete.`);
            }

            main()//.catch((e) => _error(`Error during script initialization:`, e));

            try {
              const fnKey = "OPEN_OPTIONS_PAGE_" + String(SCRIPT_NAME).replace(/\s+/g, "_");
              window[fnKey] = openOptionsPage;
            } catch (e) {}

            try {
              const fnKey = "OPEN_POPUP_PAGE_" + String(SCRIPT_NAME).replace(/\s+/g, "_");
              window[fnKey] = openPopupPage;
            } catch (e) {}


            })();
  // #endregion
  // #endregion
    // #endregion