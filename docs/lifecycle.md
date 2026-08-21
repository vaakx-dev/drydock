---
layout: default
title: Lifecycle
description: Activation and cleanup are one continuous lifecycle.
---

Drydock treats activation and cleanup as one lifecycle. An activation becomes active only after setup succeeds and its dependencies remain valid.

1. A plugin waits until its required services are available.
2. Drydock creates an activation scope and runs setup.
3. The plugin remains active while its dependencies and configuration stay valid.
4. Dependency changes, restart requests, or configuration updates stop the current activation before starting the next one.
5. Disposal closes effects in reverse order and releases the plugin from its context.

Failed setup is cleaned up before the failure is reported. A loader replacement can restore the previous generation when the new generation does not activate.

State and registry subscriptions observe this process. They do not control it.
