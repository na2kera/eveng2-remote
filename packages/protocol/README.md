# Shared protocol

Glass → Bridge の制御メッセージは JSON text frame、PCM は `audio.start` と `audio.stop` の間の binary frame です。

主な message:

- Glass → Bridge: tokenを含む`client.hello`、`permission.response`、`audio.start`、`audio.stop`、`audio.cancel`、`transcript.action`
- Bridge → Glass: `server.hello`、`permission.request`、`audio.started`、`transcription.started`、`transcript.result`、`action.completed`、`error`

TypeScript の union 型だけでなく runtime validator も export し、不正 JSON や protocol version 不一致を境界で拒否します。

音声送信先はclientから指定できず、Bridgeが認証済みhookのtargetから解決します。
