# G2 App

公式 [`even-realities/evenhub-templates`](https://github.com/even-realities/evenhub-templates) の ASR template を基礎にした Even Hub アプリです。独自のスマホ native app ではなく、Even companion app 内の WebView で動作します。

- G2 UI: 576×288 の text container 1個を debounce 更新
- 入力: tap、double-tap、scroll を公式 template と同じ envelope 判定で処理
- 音声: G2 PCM を raw WebSocket binary frame として Bridge へ転送
- companion UI: 許可内容、録音状態、文字起こし、エラーを表示し、スマホ側の button でも操作可能
- pairing: client tokenはビルドへ埋め込まず、スマホ画面で入力してsessionStorageだけに保持
- security: 非loopbackのBridge接続は`wss://`のみ許可し、長文のAllow / Sendはスマホ全文確認を必須化

環境設定は [.env.example](./.env.example)、起動・QR sideload・manifest whitelist はルート [README](../../README.md) を参照してください。
