---
name: pre-approval-report-zh
description: 中文变更摘要审批报告。当用户想要在 Claude Code 每次请求审批（yes/no）时自动生成中文变更摘要时使用。触发场景：用户说"帮我设置中文审批报告"、"每次审批时显示中文摘要"、"安装审批hook"、"pre-approval report Chinese"、"变更预览"、"setup approval hooks with Chinese summary"、"装一个审批报告"、"写文件前给我看中文说明"、"弄一个中文的变更提示"。此技能会在 PreToolUse 阶段 hook 所有文件写入/编辑/命令执行操作，生成包含操作类型、文件路径、变更内容和风险等级的中文摘要，帮助用户快速理解需要批准的内容。注意：不要自己发明 hook 配置格式，严格遵循本技能提供的 JSON 模板。
---

# 中文变更摘要审批报告 Hook 安装指南

## 概述

本技能安装一个 **Claude Code PreToolUse hook**，在每次 Claude Code 请求你审批（yes/no）文件写入、编辑或命令执行时，自动生成一份结构化的中文变更摘要，让你明确知道正在批准什么。

## 工作原理

- 使用 `PermissionRequest` hook在每次审批请求时附加中文变更摘要
- Hook 脚本自动提取变更信息，生成中文 Markdown 报告
- 直接输出文本内容，Claude Code 会自动将其附加到审批弹窗旁

## 安装步骤

### 步骤 1: 创建 hooks 目录

```bash
mkdir -p .claude/hooks
```

### 步骤 2: 复制 hook 脚本

将仓库中的脚本复制到 hooks 目录：

```bash
# 从克隆的仓库复制
cp preapproval.cjs .claude/hooks/preapproval.cjs
# 或直接下载
curl -o .claude/hooks/preapproval.cjs https://raw.githubusercontent.com/air56/claude-cn-summary/main/preapproval.cjs
```

确认脚本已复制成功：

```bash
ls -la .claude/hooks/preapproval.cjs
```

### 步骤 3: 配置 settings.json

**重要：请先读取 `settings.json` 的当前内容**，然后在保留所有现有字段的基础上，添加 `hooks` 字段。

目标文件路径：`.claude/settings.json`

以下是添加 hooks 后的完整示例（保留原有字段不变，仅新增 hooks）：

```json
{
  "env": { ... },
  "...": "... (原有字段保持不动)",
  "hooks": {
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/preapproval.cjs"
          }
        ]
      }
    ]
  }
}
```

### 步骤 4: 验证安装

运行以下测试确认 hook 正常工作：

```bash
# 测试 hook 脚本是否能处理 PermissionRequest 事件
echo '{"event":"PermissionRequest","tool_call":{"tool":"Write","arguments":{"file_path":"test.js","content":"console.log(\"hello\");\n"}}}' | node .claude/hooks/preapproval.cjs
```

预期输出是包含中文变更摘要的 Markdown 文本，Claude Code 会将其附加到审批弹窗旁。

## 卸载方法

```bash
# 1. 从 settings.json 中删除 hooks 字段
# 2. 删除 hook 脚本
rm -f .claude/hooks/preapproval.cjs
# 3. 如果 hooks 目录为空，可选删除
rmdir .claude/hooks 2>/dev/null || true
```

## 自定义配置

### 使用 PreToolUse（备选方案）

如果希望 hook 拦截工具调用并返回审批决策（而非仅在弹窗旁附加信息），可以使用 `PreToolUse` hook。注意此方式需要通过 `matcher` 指定触发的工具范围：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/preapproval.cjs"
          }
        ]
      }
    ]
  }
}
```

注意: PermissionRequest hook 的输出会附加在已有的权限弹窗旁，推荐优先使用 `PreToolUse` 以获得更好的体验。

## 故障排除

- **Hook 不触发**: 检查 `matcher` 正则是否匹配工具名称；检查 `settings.json` 中 `command` 路径是否正确
- **脚本报错**: 手动运行 `node .claude/hooks/preapproval.cjs` 并输入测试 JSON
- **审批流程异常**: 删除 hooks 配置即可恢复默认行为
- **Windows 路径问题**: 确保 `command` 中使用正斜杠（`node .claude/hooks/preapproval.cjs` 即可）
