<div align="center">

<h1>secret-mod</h1>

<p><strong>Claude Code 用得到、看不到的账号密码：prompt 上方的表单、macOS keychain、遮罩后的输出。</strong></p>

[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文**

</div>

Claude 需要密码或 token 时，用 tool 向你要。你在 prompt 上方的表单填值，值存进 login keychain，Claude 只拿到名称。

## 功能

- **prompt 上方的表单**：retro 双线对话框，标题是用途描述，每栏一行，按钮是 `< Save >` `< Cancel >`，按 Enter 跳下一栏。
- **存进 keychain**：每个 secret 是一条 `kilo/<name>` generic password，值经 stdin 送给 `security`，不经 argv。
- **不含值的索引**：`list` 从 keychain 读名称、账号与注释。
- **用而不看**：`run` 把 secret 设成环境变量再执行命令，输出里的值全部遮掉。
- **改与删**：同名再调用 `ask` 就是更新，账号保留；`delete` 会先问你。

## 安装

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

```
/plugin marketplace add zyx1121/secret-mod
/plugin install secret-mod@secret-mod
```

## 限制

- 遮罩只挡值本身，挡不住由值算出的东西，例如哈希或长度。
- Claude 仍可用 Bash 读 keychain，要挡就在 `settings.json` 加 deny 规则。
- 表单输入是明文显示。
- 只支持 macOS。

## 许可

[MIT](LICENSE)
