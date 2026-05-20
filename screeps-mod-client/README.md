# screeps-mod-client

Screeps private-server mod that serves [`screeps-client`](../screeps-client) at `/client` on the same server it runs on. The client connects to its own origin, so no separate hosting or CORS setup is required.

## Install

Add the package to your server's `mods.json`:

```json
{
  "mods": [
    "node_modules/screeps-mod-client"
  ]
}
```

## Configuration

Two layers, in order of precedence:

1. Environment variables (highest)
2. `modConfig.client` in `mods.json`
3. Defaults

| Setting | ENV | `modConfig.client.*` | Default |
| --- | --- | --- | --- |
| Mount path | `SCREEPS_MOD_CLIENT_MOUNT_PATH` | `mountPath` | `/client` |
| Redirect `/` → mount path | `SCREEPS_MOD_CLIENT_ROOT_REDIRECT` | `rootRedirect` | `true` |

### Docker example

```sh
docker run -e SCREEPS_MOD_CLIENT_MOUNT_PATH=/play \
           -e SCREEPS_MOD_CLIENT_ROOT_REDIRECT=false \
           screeps/private-server
```

## Build

```sh
pnpm --filter screeps-mod-client build
```

This builds `screeps-client` in embedded mode (`base=/client/`) and copies the artifacts into `dist/`.
