// ==UserScript==
// @name         Grepolis Trade Limiter
// @version      1.0.0
// @author       JonnySa
// @description  Aktualisiert nur die drei zuletzt geöffneten Handelsfenster
// @match        https://*.grepolis.com/game/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // EINSTELLUNGEN:
    // TradeLimiter.disable()
    // TradeLimiter.enable()
    // TradeLimiter.setCount(2)
    // TradeLimiter.status()
    // TradeLimiter.debugOn()
    // TradeLimiter.debugOff()
    // ============================================================

    var ACTIVE_WINDOW_COUNT = 3;
    var LIMITER_ENABLED = true;
    var DEBUG_ENABLED = false;

    // ============================================================
    // INTERNER ZUSTAND
    // ============================================================

    var openingCounter = 0;
    var openingOrder = Object.create(null);

    var installedJQuery = null;
    var originalAjax = null;
    var limitedAjax = null;

    var observer = null;
    var observerUpdatePending = false;

    // ============================================================
    // PROTOKOLLIERUNG
    // ============================================================

    function log() {
        if (!DEBUG_ENABLED) {
            return;
        }

        var args = Array.prototype.slice.call(arguments);
        args.unshift('[TradeLimiter]');

        console.log.apply(console, args);
    }

    // ============================================================
    // HANDELSFENSTER ERKENNEN
    // ============================================================

    function getTargetIdFromElement(element) {
        if (!element) {
            return null;
        }

        if (element.jquery) {
            element = element[0];
        }

        if (!element || !element.querySelector) {
            return null;
        }

        var tradeTab = element.querySelector(
            '[id="trade_tab"][class*="trade_tab_target_"]'
        );

        if (!tradeTab) {
            return null;
        }

        for (var i = 0; i < tradeTab.classList.length; i++) {
            var className = tradeTab.classList[i];

            var match = /^trade_tab_target_(\d+)$/.exec(
                className
            );

            if (match) {
                return String(match[1]);
            }
        }

        return null;
    }

    function getWindowTitle(dialog) {
        if (!dialog || !dialog.querySelector) {
            return '';
        }

        var title = dialog.querySelector(
            '.ui-dialog-title'
        );

        return title
            ? title.textContent.trim()
            : '';
    }

    function getOpenTradeWindows() {
        var dialogs = document.querySelectorAll(
            '.ui-dialog.js-window-main-container'
        );

        var windows = [];
        var currentlyOpenIds = Object.create(null);

        for (var i = 0; i < dialogs.length; i++) {
            var dialog = dialogs[i];
            var targetId = getTargetIdFromElement(dialog);

            if (!targetId) {
                continue;
            }

            currentlyOpenIds[targetId] = true;

            if (!openingOrder[targetId]) {
                openingCounter += 1;
                openingOrder[targetId] = openingCounter;

                log(
                    'Registriert:',
                    getWindowTitle(dialog),
                    '| Ziel:',
                    targetId,
                    '| Nummer:',
                    openingCounter
                );
            }

            windows.push({
                dialog: dialog,
                title: getWindowTitle(dialog),
                targetId: targetId,
                openingNumber: openingOrder[targetId]
            });
        }

        /*
         * Geschlossene Fenster aus dem Speicher entfernen.
         */
        Object.keys(openingOrder).forEach(function (
            targetId
        ) {
            if (!currentlyOpenIds[targetId]) {
                delete openingOrder[targetId];
            }
        });

        /*
         * Zuletzt geöffnetes Fenster zuerst.
         *
         * Bei zehn Fenstern:
         * 10, 9, 8, 7, ... 2, 1
         */
        windows.sort(function (a, b) {
            return b.openingNumber - a.openingNumber;
        });

        /*
         * Sind alle Handelsfenster geschlossen, beginnt die
         * Nummerierung beim nächsten Öffnen wieder sauber bei 1.
         */
        if (windows.length === 0) {
            openingOrder = Object.create(null);
            openingCounter = 0;
        }

        return windows;
    }

    function getActiveTargetIds() {
        return getOpenTradeWindows()
            .slice(0, ACTIVE_WINDOW_COUNT)
            .map(function (entry) {
                return entry.targetId;
            });
    }

    // ============================================================
    // AJAX-DATEN AUSWERTEN
    // ============================================================

    function copyAjaxOptions(
        urlOrOptions,
        possibleOptions
    ) {
        var result = {};

        if (typeof urlOrOptions === 'string') {
            if (
                possibleOptions &&
                typeof possibleOptions === 'object'
            ) {
                Object.keys(possibleOptions).forEach(
                    function (key) {
                        result[key] =
                            possibleOptions[key];
                    }
                );
            }

            result.url = urlOrOptions;

            return result;
        }

        if (
            urlOrOptions &&
            typeof urlOrOptions === 'object'
        ) {
            Object.keys(urlOrOptions).forEach(
                function (key) {
                    result[key] = urlOrOptions[key];
                }
            );
        }

        return result;
    }

    function parseJsonValue(value) {
        if (!value) {
            return null;
        }

        if (typeof value === 'object') {
            return value;
        }

        try {
            return JSON.parse(value);
        } catch (firstError) {
            try {
                return JSON.parse(
                    decodeURIComponent(value)
                );
            } catch (secondError) {
                return null;
            }
        }
    }

    function getJsonFromAjaxData(data) {
        if (!data) {
            return null;
        }

        if (typeof data === 'object') {
            return data.json || null;
        }

        if (typeof data === 'string') {
            try {
                return new URLSearchParams(data).get(
                    'json'
                );
            } catch (error) {
                return null;
            }
        }

        return null;
    }

    function parseTradingRequest(options) {
        try {
            if (!options) {
                return null;
            }

            var rawUrl = options.url || '';

            var url = new URL(
                String(rawUrl),
                window.location.origin
            );

            if (
                url.pathname.indexOf(
                    '/game/town_info'
                ) === -1
            ) {
                return null;
            }

            var action = url.searchParams.get(
                'action'
            );

            if (
                action !== 'trading' &&
                (
                    !options.data ||
                    typeof options.data !== 'object' ||
                    options.data.action !== 'trading'
                )
            ) {
                return null;
            }

            var jsonValue =
                url.searchParams.get('json') ||
                getJsonFromAjaxData(options.data);

            var requestData =
                parseJsonValue(jsonValue);

            if (
                !requestData ||
                requestData.id === undefined ||
                requestData.id === null
            ) {
                return null;
            }

            return {
                targetId: String(requestData.id),

                sourceId: String(
                    requestData.town_id ||
                    url.searchParams.get('town_id') ||
                    ''
                )
            };
        } catch (error) {
            log(
                'Request konnte nicht gelesen werden:',
                error
            );

            return null;
        }
    }

    // ============================================================
    // ENTSCHEIDEN, OB BLOCKIERT WIRD
    // ============================================================

    function shouldSuppressRequest(request) {
        if (!LIMITER_ENABLED || !request) {
            return false;
        }

        var openWindows = getOpenTradeWindows();

        /*
         * Keine Handelsfenster geöffnet:
         * nichts blockieren.
         */
        if (openWindows.length === 0) {
            return false;
        }

        var openIds = openWindows.map(function (
            entry
        ) {
            return entry.targetId;
        });

        /*
         * Das Ziel existiert noch nicht als Handelsfenster.
         *
         * Das ist der initiale Request zum Öffnen eines neuen
         * Fensters. Dieser muss immer zugelassen werden, damit
         * Grepolis und DIO das Fenster normal aufbauen können.
         */
        if (
            openIds.indexOf(request.targetId) === -1
        ) {
            return false;
        }

        /*
         * Bei höchstens drei offenen Fenstern sind automatisch
         * alle aktiv.
         */
        if (
            openWindows.length <=
            ACTIVE_WINDOW_COUNT
        ) {
            return false;
        }

        var activeIds = openWindows
            .slice(0, ACTIVE_WINDOW_COUNT)
            .map(function (entry) {
                return entry.targetId;
            });

        /*
         * Alle bereits geöffneten Handelsfenster außerhalb der
         * letzten drei werden unterdrückt.
         */
        return (
            activeIds.indexOf(request.targetId) === -1
        );
    }

    // ============================================================
    // BLOCKIERTEN AJAX-AUFRUF DARSTELLEN
    // ============================================================

    function createSuppressedJqXHR(
        $,
        context
    ) {
        var deferred = $.Deferred();
        var jqXHR = deferred.promise();

        jqXHR.readyState = 0;
        jqXHR.status = 0;
        jqXHR.statusText = 'abort';
        jqXHR.responseText = '';
        jqXHR.responseJSON = null;

        jqXHR.abort = function () {
            return jqXHR;
        };

        jqXHR.getResponseHeader = function () {
            return null;
        };

        jqXHR.getAllResponseHeaders = function () {
            return '';
        };

        jqXHR.setRequestHeader = function () {
            return jqXHR;
        };

        jqXHR.overrideMimeType = function () {
            return jqXHR;
        };

        jqXHR.statusCode = function () {
            return jqXHR;
        };

        /*
         * Der künstliche Request wird asynchron als "abort"
         * beendet.
         *
         * Weil das originale $.ajax nicht aufgerufen wird,
         * entstehen keine globalen ajaxComplete-Ereignisse.
         * DIO und GRCRT bearbeiten das eingefrorene Fenster
         * daher nicht erneut.
         */
        Promise.resolve().then(function () {
            deferred.rejectWith(
                context || window,
                [jqXHR, 'abort', 'TradeLimiter']
            );
        });

        return jqXHR;
    }


    function installAjaxHook() {
        var $ = window.jQuery || window.$;

        if (!$ || typeof $.ajax !== 'function') {
            window.setTimeout(
                installAjaxHook,
                25
            );

            return;
        }

        /*
         * Bereits korrekt installiert.
         */
        if (
            $.ajax &&
            $.ajax.__jonnySaTradeLimiterV5
        ) {
            installedJQuery = $;
            limitedAjax = $.ajax;

            return;
        }


        if (
            $.ajax &&
            typeof $.ajax.__originalAjax ===
                'function'
        ) {
            $.ajax = $.ajax.__originalAjax;
        }

        installedJQuery = $;
        originalAjax = $.ajax;

        limitedAjax = function (
            urlOrOptions,
            possibleOptions
        ) {
            var options = copyAjaxOptions(
                urlOrOptions,
                possibleOptions
            );

            var request =
                parseTradingRequest(options);

            if (
                request &&
                shouldSuppressRequest(request)
            ) {
                log(
                    'Unterdrückt:',
                    request.targetId,
                    '| Quelle:',
                    request.sourceId,
                    '| Aktiv:',
                    getActiveTargetIds()
                );

                return createSuppressedJqXHR(
                    $,
                    options.context || this
                );
            }

            /*
             * Initiales Öffnen und die letzten drei Fenster
             * laufen vollständig über das echte jQuery-AJAX.
             *
             * DIO und GRCRT erhalten dort normale Antworten und
             * globale AJAX-Ereignisse.
             */
            return originalAjax.apply(
                this,
                arguments
            );
        };

        /*
         * Vorhandene Eigenschaften von $.ajax übernehmen.
         */
        Object.keys(originalAjax).forEach(function (
            key
        ) {
            try {
                limitedAjax[key] =
                    originalAjax[key];
            } catch (error) {

            }
        });

        limitedAjax.__jonnySaTradeLimiter =
            true;

        limitedAjax.__originalAjax =
            originalAjax;

        $.ajax = limitedAjax;

        log('AJAX-Hook installiert');
    }

    function uninstallAjaxHook() {
        var $ =
            installedJQuery ||
            window.jQuery ||
            window.$;

        if (!$ || typeof $.ajax !== 'function') {
            return false;
        }

        if (
            $.ajax.__jonnySaTradeLimiterV5 &&
            typeof $.ajax.__originalAjax ===
                'function'
        ) {
            $.ajax = $.ajax.__originalAjax;

            limitedAjax = null;

            log('AJAX-Hook entfernt');

            return true;
        }

        return false;
    }

    // ============================================================
    // FENSTERBEOBACHTUNG
    // ============================================================

    function startWindowObserver() {
        if (!document.documentElement) {
            window.setTimeout(
                startWindowObserver,
                20
            );

            return;
        }

        if (observer) {
            return;
        }

        observer = new MutationObserver(function () {
            if (observerUpdatePending) {
                return;
            }

            observerUpdatePending = true;

            window.requestAnimationFrame(
                function () {
                    observerUpdatePending = false;
                    getOpenTradeWindows();
                }
            );
        });

        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );

        getOpenTradeWindows();
    }

    // ============================================================
    // STEUERUNG ÜBER DIE KONSOLE
    // ============================================================

    window.TradeLimiter = {
        status: function () {
            var windows = getOpenTradeWindows();

            var rows = windows.map(function (
                entry,
                index
            ) {
                return {
                    prioritaet: index + 1,

                    aktiv:
                        LIMITER_ENABLED &&
                        index <
                            ACTIVE_WINDOW_COUNT,

                    zielstadt: entry.title,

                    zielstadtId:
                        entry.targetId,

                    geoeffnetAls:
                        entry.openingNumber
                };
            });

            console.table(rows);

            console.info(
                '[TradeLimiter]',
                LIMITER_ENABLED
                    ? 'eingeschaltet'
                    : 'ausgeschaltet',
                '| AJAX-Hook:',
                Boolean(
                    window.jQuery &&
                    window.jQuery.ajax &&
                    window.jQuery.ajax
                        .__jonnySaTradeLimiterV5
                )
            );

            return rows;
        },

        active: function () {
            var activeWindows =
                getOpenTradeWindows().slice(
                    0,
                    ACTIVE_WINDOW_COUNT
                );

            console.table(
                activeWindows.map(function (
                    entry,
                    index
                ) {
                    return {
                        prioritaet: index + 1,
                        zielstadt: entry.title,
                        zielstadtId:
                            entry.targetId,
                        geoeffnetAls:
                            entry.openingNumber
                    };
                })
            );

            return activeWindows;
        },

        disable: function () {
            LIMITER_ENABLED = false;

            var removed = uninstallAjaxHook();

            console.info(
                '[TradeLimiter] vollständig ausgeschaltet.',
                'AJAX-Hook entfernt:',
                removed
            );
            return removed;
        },

        enable: function () {
            LIMITER_ENABLED = true;

            installAjaxHook();

            console.info(
                '[TradeLimiter] eingeschaltet'
            );

            return true;
        },

        isEnabled: function () {
            var hookInstalled = Boolean(
                window.jQuery &&
                window.jQuery.ajax &&
                window.jQuery.ajax
                    .__jonnySaTradeLimiterV5
            );

            console.info(
                '[TradeLimiter]',
                LIMITER_ENABLED
                    ? 'eingeschaltet'
                    : 'ausgeschaltet',
                '| AJAX-Hook:',
                hookInstalled
            );

            return {
                enabled: LIMITER_ENABLED,
                hookInstalled: hookInstalled
            };
        },

        setCount: function (count) {
            var parsed = parseInt(count, 10);

            if (isNaN(parsed) || parsed < 1) {
                console.warn(
                    '[TradeLimiter] Ungültige Anzahl:',
                    count
                );

                return false;
            }

            ACTIVE_WINDOW_COUNT = parsed;

            console.info(
                '[TradeLimiter] Aktive Fenster:',
                ACTIVE_WINDOW_COUNT
            );

            return true;
        },

        resetOrder: function () {
            openingOrder = Object.create(null);
            openingCounter = 0;

            getOpenTradeWindows();

            console.info(
                '[TradeLimiter] Reihenfolge zurückgesetzt'
            );
        },

        debugOn: function () {
            DEBUG_ENABLED = true;

            console.info(
                '[TradeLimiter] Debug eingeschaltet'
            );
        },

        debugOff: function () {
            DEBUG_ENABLED = false;

            console.info(
                '[TradeLimiter] Debug ausgeschaltet'
            );
        }
    };

    installAjaxHook();
    startWindowObserver();
})();


