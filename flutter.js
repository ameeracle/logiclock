// Copyright 2013 The Flutter Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

"use strict";

self.flutterWebRenderer = "html";

(function () {
  "use strict";
  var engineInitializer = null;
  var appLoader = null;

  async function loadEngine() {
    if (engineInitializer) {
      return engineInitializer;
    }

    let response = await fetch("main.dart.js");
    if (!response.ok) {
      throw new Error(
        `Failed to load main.dart.js (status: ${response.status})`
      );
    }
    let blob = await response.blob();
    let fileReader = new FileReader();
    return new Promise((resolve, reject) => {
      fileReader.onloadend = () => {
        // Setup the asset map
        self._flutterAssets = self._flutterAssets || [];
        // Add the main bundle
        self._flutterAssets.push({
          url: URL.createObjectURL(blob),
          assets: [],
        });

        // Import and initialize
        import(URL.createObjectURL(blob))
          .then((library) => {
            if (library && library.main) {
              resolve({
                initializeEngine: () => library.main(),
              });
            } else {
              reject(new Error(" main() not found in main.dart.js"));
            }
          })
          .catch((err) => {
            reject(err);
          });
      };
      fileReader.onerror = (error) => {
        reject(error);
      };
      fileReader.readAsArrayBuffer(blob);
    });
  }

  self.loadEntrypoint = (config) => {
    config = config || {};
    var serviceWorkerUrl = "flutter_service_worker.js";
    var entrypointUrl = "index.html";
    var dependencyEntries = {};
    var appModuleName = "main";

    async function loadServiceWorker() {
      if (config.serviceWorker) {
        if (config.serviceWorker.url) {
          serviceWorkerUrl = config.serviceWorker.url;
        }
        if (config.serviceWorker.content && config.serviceWorker.content[appModuleName]) {
          var content = config.serviceWorker.content[appModuleName];
          for (var key in content) {
            dependencyEntries[key] = content[key];
          }
        }
      }

      if (!navigator.serviceWorker) {
        return;
      }

      var registration = await navigator.serviceWorker.register(serviceWorkerUrl);
      registration.active?.skipWaiting();

      registration.addEventListener("updatefound", () => {
        var installing = registration.installing;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            config.onUpdateFound?.();
          }
        });
      });

      var serviceWorker = registration.active;
      if (!serviceWorker) {
        registration.installing?.addEventListener("statechange", (e) => {
          if (e.target.state === "activated") {
            config.onWorkerInitialized?.();
          }
        });
      } else {
        config.onWorkerInitialized?.();
      }
    }

    async function loadEntrypointWithServiceWorker() {
      await loadServiceWorker();

      let response = await fetch(entrypointUrl, {
        headers: { "Service-Worker": "script" },
      });
      let deps = await response.json();
      var moduleUrls = deps.modules;

      var loadedUrls = {};

      async function loadModule(moduleUrl, isResolved) {
        if (loadedUrls[moduleUrl]) {
          return;
        }
        loadedUrls[moduleUrl] = true;
        let response = await fetch(moduleUrl, {
          headers: { "Service-Worker": "script" },
        });
        if (!response.ok) {
          throw new Error(`Failed to load ${moduleUrl} (status: ${response.status})`);
        }
        let blob = await response.blob();
        let url = URL.createObjectURL(blob);

        self._flutterAssets.push({
          url: url,
          assets: [],
        });

        // Import the module
        let exports = await import(url);
        if (exports.main) {
          exports.main();
        }
      }

      for (var moduleUrl of moduleUrls) {
        await loadModule(moduleUrl);
      }
    }

    appLoader = {
      loadEntrypoint: async (options) => {
        options = options || {};
        var onProgress = options.onProgress || (() => { });
        var onError = options.onError || ((e) => console.error(e));

        try {
          // If service worker is used, use a different loading strategy
          if (config.serviceWorker) {
            await loadEntrypointWithServiceWorker();
            return {
              runApp: async () => {
                // App is already running via module imports
              },
            };
          }

          // Standard loading without service worker
          onProgress(0.1);

          let engineInitializer = await loadEngine();
          onProgress(0.3);

          let appRunner = await engineInitializer.initializeEngine();
          onProgress(0.6);

          await appRunner.runApp();
          onProgress(1.0);

          return {
            runApp: async () => {
              // App already started
            },
          };
        } catch (err) {
          onError(err);
          throw err;
        }
      },
    };

    return appLoader;
  };
})();
