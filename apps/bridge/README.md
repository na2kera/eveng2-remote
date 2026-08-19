# Mac Bridge

`apps/bridge` は、G2 WebSocket client、Claude Code / cmux の HTTP hook、whisper.cpp、cmux CLI を接続します。

## Endpoint

- `GET /health`: client 数と pending permission 数
- `POST /hooks/permission`: 共通 permission hook
- `POST /hooks/claude`: Claude 用 alias
- `POST /hooks/cmux`: cmux 用 alias
- `GET /ws?token=...`: G2 WebSocket

POST endpoint は `Authorization: Bearer <BRIDGE_TOKEN>` または `X-Bridge-Token` が必須です。hook body は Claude Code の snake_case、アプリ側の camelCase、cmux の nested `notification` / `payload` を正規化します。

WebSocket の JSON 型は `packages/protocol` にあり、`audio.start` と `audio.stop` の間だけ binary PCM frame を受理します。録音はメモリ上に保持し、停止時に WAV 化して whisper-server へ送ります。

設定値は [.env.example](./.env.example) を参照してください。Bridge 起動・whisper.cpp・hook の具体的な設定はルート [README](../../README.md) にあります。
