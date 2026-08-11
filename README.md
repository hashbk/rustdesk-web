# rustdesk-web

Browser-based remote control client for the RustDesk ecosystem.

This project provides in-browser remote desktop viewing and control, designed to
pair with [`rustdesk-console`](https://github.com/databk/rustdesk-console) (device /
user / address-book / audit management). The console manages the fleet; this web
client performs the actual remote assistance from a browser.

## Status

Bootstrapping.

## Setup

This repository uses a git submodule to track upstream proto definitions from
[`rustdesk/hbb_common`](https://github.com/rustdesk/hbb_common). After cloning,
initialize the submodule:

```bash
git submodule update --init
```

The proto files are sourced from `vendor/hbb_common/protos/` via the `@proto`
Vite alias and are not copied into `src/`.