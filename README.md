# Grepolis Trade Limiter

A userscript that limits automatic updates from multiple open trade windows in Grepolis.

## Purpose

This script is especially useful when you want to fill many cities with resources, for example:

- Filling rock cities
- Supplying the next cities involved in a World Wonder
- Sending resources to many different target cities
- Keeping several trade windows open at the same time

Normally, opening many trade windows can cause the game to send a large number of requests. This may eventually result in response errors or other problems.

The Trade Limiter allows you to keep multiple trade windows open while only the most recently opened windows continue to update automatically.

## How It Works

By default, only the **three most recently opened trade windows** remain active.

Older trade windows stay open, but their automatic trading requests are temporarily suppressed. This reduces the number of simultaneous requests sent by the game.

When you open another trade window, it becomes one of the active windows. The oldest active window is then automatically moved into the inactive group.

The initial request required to open a trade window is always allowed, so new windows can still be opened normally.

## Benefits

- Open many trade windows simultaneously
- Reduce unnecessary trading requests
- Lower the risk of response errors
- Keep important trade windows active
- Useful for large-scale resource distribution
- Compatible with trade windows modified by tools such as DIO and GRCRT

## Default Configuration

```javascript
var ACTIVE_WINDOW_COUNT = 3;
var LIMITER_ENABLED = true;
var DEBUG_ENABLED = false;
```
