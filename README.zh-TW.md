<div align="center">

<h1>secret-mod</h1>

<p><strong>Claude Code 用得到、看不到的帳密：prompt 上方的表單、macOS keychain、遮罩後的輸出。</strong></p>

[English](README.md) | **繁體中文** | [简体中文](README.zh-CN.md)

</div>

Claude 需要密碼或 token 時，用 tool 向你要。你在 prompt 上方的表單填值，值存進 login keychain，Claude 只拿到名稱。

## 功能

- **prompt 上方的表單**：帳號欄加每個 secret 一欄，按 Enter 跳下一欄。
- **存進 keychain**：每個 secret 是一筆 `kilo/<name>` generic password，值經 stdin 送給 `security`，不經 argv。
- **不含值的索引**：`list` 從 keychain 讀名稱、帳號與註解。
- **用而不看**：`run` 把 secret 設成環境變數再執行指令，輸出裡的值全部遮掉。
- **改與刪**：同名再呼叫 `ask` 就是更新，帳號保留；`delete` 會先問你。

## 安裝

function hooks 還在 early access，先在 shell profile 打開：

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

再在 Claude Code 安裝：

```
/plugin marketplace add zyx1121/secret-mod
/plugin install secret-mod@secret-mod
```

## 使用

| Tool | 作用 |
|------|------|
| `ask` | 叫出 `kilo/<name>` 的表單，立刻回傳；存檔或取消時送訊息開下一輪 |
| `run` | 用 `zsh -c` 執行指令，secret 當環境變數，輸出遮罩 |
| `list` | 列出 `kilo/` 項目與對應的環境變數名 |
| `delete` | 你確認後刪除 `kilo/<name>` |

表單要點一下或按 `ctrl+x tab` 才能打字。

## 限制

- 遮罩只擋值本身，擋不住由值算出的東西，例如雜湊或長度。
- Claude 仍可用 Bash 跑 `security find-generic-password -w`，要擋就在 `settings.json` 加 deny 規則。
- 表單輸入是明碼顯示。
- 只支援 macOS。

## 授權

[MIT](LICENSE)
