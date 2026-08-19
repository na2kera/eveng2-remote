# Even G2 × cmux Remote Controller

Even Realities G2 から、Mac 上の cmux と AI コーディングエージェントへ許可応答・音声指示を送るローカルリモートコントローラーです。

このリポジトリは npm workspaces のモノレポです。

```text
apps/glass        Even Hub WebView + G2 UI（Vite / TypeScript）
apps/bridge       Mac ローカル Bridge（Node.js / TypeScript）
packages/protocol WebSocket メッセージ型と runtime validator
```

## 実装済みのフロー

- Claude Code / cmux hook の HTTP 通知 → G2 に許可内容を表示 → Allow / Deny を cmux へ送信
- G2 マイクの PCM 16 kHz / mono / 16-bit を WebSocket の binary frame で Bridge へ送信
- 録音停止後、whisper.cpp の `whisper-server` へ WAV を multipart POST
- 認識結果を必ず G2 とスマホ WebView に表示し、Send / Retry の確認後だけ cmux へ送信
- 直近の許可通知の surface/workspace を音声指示の既定送信先として再利用
- WebSocket 再接続、認証、録音時間・hook body・文字起こし長の上限、重複応答の排除

## 必要環境

- Node.js 20.19 以上（または 22.12 以上）
- cmux（この実装は `cmux 0.64.22` で CLI 形状を確認）
- Even Hub companion app または `evenhub-simulator`
- whisper.cpp の `whisper-server`
- Mac とスマホが同じ LAN に接続されていること

## 1. インストール

```bash
npm install
cp apps/bridge/.env.example apps/bridge/.env
cp apps/glass/.env.example apps/glass/.env.local
```

十分に長い共有 token を生成し、`apps/bridge/.env` の `BRIDGE_TOKEN` と `apps/glass/.env.local` の `VITE_BRIDGE_TOKEN` に同じ値を設定します。

```bash
openssl rand -hex 24
```

`apps/glass/.env.local` の `VITE_BRIDGE_URL` は Mac の LAN IP に変更します。

```dotenv
VITE_BRIDGE_URL=ws://192.168.1.100:8787/ws
VITE_BRIDGE_TOKEN=<同じtoken>
```

## 2. whisper.cpp

whisper.cpp 自体はこのリポジトリには含めません。公式リポジトリから build し、日本語対応モデルで HTTP server を起動します。

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build --config Release -j
sh ./models/download-ggml-model.sh large-v3-turbo
./build/bin/whisper-server \
  -m ./models/ggml-large-v3-turbo.bin \
  --host 127.0.0.1 \
  --port 8080 \
  --language ja
```

Bridge は既定で `http://127.0.0.1:8080/inference` に `file`、`language`、`prompt`、`response_format=json` を送ります。技術用語は `WHISPER_PROMPT` で追加できます。

## 3. Mac Bridge

対象の cmux pane 内では `CMUX_SURFACE_ID` と `CMUX_WORKSPACE_ID` が自動設定されます。hook script がこれを HTTP payload に追加します。固定送信先を使う場合は Bridge の `.env` に `CMUX_DEFAULT_SURFACE` を設定してください。

```bash
npm run dev:bridge
```

確認:

```bash
curl http://127.0.0.1:8787/health
```

### Claude Code の許可通知

`PermissionRequest` hook を使います。`PreToolUse` は許可不要の tool にも発火するため、この用途では使用しません。

cmux pane で Claude Code を起動する前に次を設定します。

```bash
export EVENG2_BRIDGE_URL=http://127.0.0.1:8787
export EVENG2_BRIDGE_TOKEN=<BRIDGE_TOKENと同じ値>
```

`~/.claude/settings.json` または対象プロジェクトの `.claude/settings.local.json` に、script のパスを絶対パスで登録します。

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/eveng2-remote/apps/bridge/scripts/post-permission-hook.mjs",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

script は通知を Bridge へ渡した後に exit 0 で戻るため、Claude Code の通常の許可ダイアログは残ります。G2 の選択を Bridge が cmux `send` で応答します。Claude Code 側の選択キーが `y` / `n` でない場合は `CMUX_ALLOW_INPUT` / `CMUX_DENY_INPUT` を調整してください。

cmux のエージェント状態連携も使う場合は別途実行できます。

```bash
cmux hooks setup --agent claude
cmux hooks setup --agent codex
```

### cmux 通知 hook（任意）

`Agent needs input`、`permission`、`approval`、`waiting` を含む cmux 通知も Bridge へ転送できます。`~/.config/cmux/cmux.json` の `notifications.hooks` に次を追加します。script は入力 JSON をそのまま stdout に返すため、cmux 本来の通知効果を変更しません。

```json
{
  "notifications": {
    "hooks": [
      {
        "id": "eveng2-remote",
        "command": "node /absolute/path/to/eveng2-remote/apps/bridge/scripts/post-cmux-notification-hook.mjs",
        "timeoutSeconds": 5
      }
    ]
  }
}
```

## 4. G2 アプリ

開発 server:

```bash
npm run dev:glass
```

別 terminal から simulator を起動します。

```bash
npm run simulate -w @eveng2-remote/glass
```

実機へ QR sideload する場合:

```bash
cd apps/glass
npx evenhub qr --url http://<MacのLAN-IP>:5173
```

G2 操作:

- Idle でタップ: 録音開始
- Recording でタップ: 録音停止・文字起こし
- Permission / Transcript でスワイプ: 選択肢を切り替え
- Permission / Transcript でタップ: 選択を確定
- ダブルタップ: アプリ終了確認

QR sideload 中の WebSocket target は unrestricted ですが、`.ehpk` を配布する場合は `apps/glass/app.json` に Mac の接続先と完全一致する `network` whitelist を追加してください。wildcard は使用できません。

```json
{
  "name": "network",
  "desc": "Connect to the local Mac bridge.",
  "whitelist": ["ws://192.168.1.100:8787"]
}
```

pack:

```bash
npm run pack:glass
```

## セキュリティ

- Bridge は LAN 内利用を前提に `0.0.0.0:8787` で待ち受けます。インターネットへ port forward しないでください。
- WebSocket と hook endpoint は共有 token 必須です。ただし Vite の `VITE_*` 値は client bundle に入るため、token は強固な端末認証ではなく LAN 上の偶発アクセス対策です。
- whisper-server は `127.0.0.1` bind のまま利用してください。
- `ws://` が Even Hub WebView の mixed-content 制約で拒否される場合は、Bridge を TLS 化して `wss://` を使用してください。

## MVP の既知制約

- G2 アプリを開いた状態で WebSocket を維持する設計です。アプリ未起動時の background push は実装していません。
- `ws://<LAN-IP>` の可否は Even companion app の OS・version に依存するため、QR sideload の早い段階で実機確認が必要です。
- 音声認識は streaming ではなく、録音停止後の batch 処理です。
- G2 から送信先 pane を一覧選択する UI は未実装です。直近の permission target または `.env` の固定 target を使用します。

## 開発コマンド

```bash
npm run typecheck
npm test
npm run build
```

## 参考

- [Even Hub templates](https://github.com/even-realities/evenhub-templates)
- [Even Hub](https://hub.evenrealities.com/)
- [cmux](https://github.com/manaflow-ai/cmux)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
