# Mac Bridge

`apps/bridge` は、G2 WebSocket client、Claude Code / cmux の HTTP hook、whisper.cpp、cmux CLI を接続します。

## Endpoint

- `GET /health`: client 数と pending permission 数
- `POST /hooks/permission`: Claude PermissionRequest hook（決定まで待機）
- `POST /hooks/claude`: Claude 用 alias
- `GET /ws`: G2 WebSocket（接続後の`client.hello`で認証）

POST endpointは`Authorization: Bearer <BRIDGE_HOOK_TOKEN>`または`X-Bridge-Token`が必須です。WebSocketは別の`BRIDGE_CLIENT_TOKEN`を使います。hook bodyはClaude Codeのsnake_caseとアプリ側のcamelCaseを正規化します。G2の決定は同じHTTP要求へ返し、cmux paneへのキー入力は行いません。

WebSocketのJSON型は`packages/protocol`にあり、認証済み`client.hello`の後、`audio.start`と`audio.stop`の間だけbinary PCM frameを受理します。録音はメモリ上に保持し、停止時にWAV化してwhisper-serverへ送ります。接続数、保留中permission数、同時文字起こし数には設定可能な上限があります。

設定値は [.env.example](./.env.example) を参照してください。Bridge 起動・whisper.cpp・hook の具体的な設定はルート [README](../../README.md) にあります。
