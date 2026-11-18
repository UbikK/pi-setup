# Pi-to-OpenCode package mapping

This note records how active Pi packages map to the OpenCode setup. Pi extension packages are not OpenCode plugins unless they explicitly implement OpenCode's V2 plugin API.

| Pi package or feature | OpenCode handling | Parity / limitation |
| --- | --- | --- |
| `gentle-engram` | Already covered by configured Engram MCP plus the local OpenCode Engram adapter. | No second memory plugin added. |
| `pi-openspec` | Use installed OpenSpec CLI; initialize an OpenCode project with `openspec init --tools opencode`. | Pi-only `/opsx-*` wrapper not ported. The advertised third-party `opencode-plugin-openspec` README still shows V1 `plugin` configuration; V2 compatibility was not confirmed, so it was not installed. |
| `pi-caveman` | Preserve default terse style in `opencode/AGENTS.md`. | No dynamic `/caveman` level switch or status indicator. `opencode-caveman` was not installed because compatibility with this OpenCode V2 setup was not verified. |
| `@bukutsu/pi-ping` | Use OpenCode CLI `attention.notifications: true`, with sound off. | Basic completion alerts retained. Pi-specific focus timing and unread tab-title marker are not reproduced; marker is appearance. No third-party notifier installed. |
| `@juicesharp/rpiv-todo` | Enable OpenCode's built-in `experimental.todo` tool. | Tool-based todo support retained; custom Pi `/todos` panel and keybinding intentionally omitted as appearance. OpenCode todo setting is experimental. |
| `@juanibiapina/pi-tokyonight`, `pi-starline` | Not migrated. | Theme and status-bar appearance explicitly out of scope. |

`@ramarivera/coding-buddy`, `pi-powerline-footer`, and `pi-web-access` appear in `npm/package.json` but not in active `settings.json` package entries; treated as inactive and not ported. OpenCode already has native web search/fetch capabilities for basic web access.

No new npm package was installed. Existing OpenCode GAIO and Engram integrations were preserved rather than duplicated.
