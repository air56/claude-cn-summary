# claude-cn-summary
 Chinese Approval Summary Hook for Claude Code — automatically shows structured Chinese change summaries with diff preview and risk assessment in   every approval prompt.
# 中文审批摘要 Hook / Chinese Approval Summary Hook

[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-6B3FE7)](https://claude.ai/code)

> **在 Claude Code 每次请求审批时，自动显示结构化的中文变更摘要。**  
> *Automatically display structured Chinese change summaries every time Claude Code asks for approval.*

当你使用 Claude Code 写文件、改代码或执行命令时，审批弹窗默认是英文的。这个 Hook 会拦截审批请求，生成一份包含操作类型、文件路径、变更内容和风险等级的中文摘要，让你清楚知道自己在批准什么。

---

## 效果预览 / Preview

```
╔════════════════════════════════════════════════════╗
║  ## 变更摘要                                     ║
║                                                  ║
║  ### 操作: 文件写入                              ║
║                                                  ║
║  - **文件**: `src/api/user.ts`                   ║
║  - **操作**: 修改现有文件                        ║
║  - **风险**: [中风险]                            ║
║  旧文件: 2.3 KB, 84 行                          ║
║  新文件: 3.1 KB, 112 行                         ║
║                                                  ║
║  差异对比:                                       ║
║  ```diff                                         ║
║  +新增用户注册接口                               ║
║  -移除旧的验证逻辑                               ║
║  ```                                             ║
║                                                  ║
║  请确认是否同意以上变更? [yes/no]                ║
╚════════════════════════════════════════════════════╝
```

---

## 特性 / Features

| 中文 | English |
|------|---------|
| 文件写入时显示 diff 对比和大小变化 | File write — show diff preview and size change |
| 文件编辑时显示新旧内容对比 | File edit — show old vs new content |
| 命令执行时自动评估风险等级 | Bash command — auto risk assessment |
| 搜索操作标注低风险只读 | Search ops — low-risk read-only marker |
| 自动处理大文件截断 | Auto-truncate large files |
| 同时兼容两种 Hook 模式 | Dual-mode: PreToolUse + PermissionRequest |

### 风险分级 / Risk Levels

| 等级 | 示例 | 颜色 |
|------|------|------|
| **高风险** 🔴 | `rm -rf /`, `mkfs.ext4`, `dd` to disk device | 破坏性操作，需谨慎确认 |
| **中风险** 🟡 | `git push`, `git merge`, `rm`, `sudo`, `chmod 777` | Git 写入/删除/提权操作 |
| **低风险** 🟢 | `ls`, `cat`, `git diff`, `node`, `npm list` | 只读或安全命令 |

---

## 安装 / Installation

### 方式一：自动安装（推荐）

在 Claude Code 中直接输入：

> "帮我设置中文审批报告"
> "setup approval hooks with Chinese summary"
> "每次审批时显示中文变更摘要"

### 方式二：手动安装

#### 1. 创建 hooks 目录

```bash
mkdir -p .claude/hooks
```

#### 2. 复制脚本

```bash
cp .claude/skills/pre-approval-report-zh/scripts/preapproval.cjs .claude/hooks/preapproval.cjs
```

#### 3. 配置 settings.json

在 `.claude/settings.json` 中添加：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|Bash|Glob|Grep|Read|WebFetch|WebSearch",
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

#### 4. 验证安装

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"test.js","content":"console.log(\"hello\");\n"}}' | node .claude/hooks/preapproval.cjs
```

---

## 工作原理 / How It Works

```
┌─────────────────────────────────────────────────────┐
│  用户发出指令 → Claude Code 准备调用工具             │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  PreToolUse Hook 触发                                │
│  ↓                                                  │
│  脚本解析工具名称和参数                               │
│  ↓                                                  │
│  生成中文摘要（含风险等级 + diff）                     │
│  ↓                                                  │
│  返回 JSON { decision: "ask", reason: summary }      │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  审批弹窗显示中文摘要                                 │
│  ┌─────────────────────────────────────────────┐    │
│  │  ## 变更摘要                                 │    │
│  │  ### 操作: Bash                              │    │
│  │  - **风险**: [高风险] 🔴                     │    │
│  │  **将执行:**                                 │    │
│  │  rm -rf /                                    │    │
│  └─────────────────────────────────────────────┘    │
│  Allow this tool call? [yes/no]                     │
└─────────────────────────────────────────────────────┘
```

### 事件模式说明

此脚本兼容两种 Hook 事件：

- **PreToolUse**（推荐）— 拦截工具调用，通过 JSON 的 `reason` 字段将摘要嵌入审批弹窗。支持 matcher 过滤。
- **PermissionRequest** — 在弹窗旁附加纯文本摘要。不需 matcher，不需返回 JSON。

---

## 支持的工单类型 / Supported Tools

| 工具 | 摘要内容 | 风险等级 |
|------|---------|---------|
| `Write` | 文件路径、大小、行数、diff 对比 | 低/中 |
| `Edit` | 文件路径、新旧文本对比 | 中 |
| `Bash` | 命令内容、风险等级评估 | 低/中/高 |
| `Read` | 文件路径 | 低 |
| `Glob` | 搜索范围和模式 | 低 |
| `Grep` | 搜索范围和关键词 | 低 |
| `WebFetch` | 目标 URL 和查询内容 | 低 |
| `WebSearch` | 搜索词 | 低 |
| `DirectoryCreate` | 目录路径 | 低 |
| `FileDelete` | 文件路径 | 中 |

---

## 卸载 / Uninstall

```bash
# 从 settings.json 删除 hooks 字段
# 删除脚本
rm -f .claude/hooks/preapproval.cjs
# 可选: 删除空目录
rmdir .claude/hooks 2>/dev/null || true
```

或在 Claude Code 中说："帮我把中文审批报告卸载掉"

---

## 评估结果 / Evaluation

此技能附带 3 个自动化评估场景，测试 AI 是否能正确安装/重装/卸载：

| 场景 | 描述 | 有技能指导 | 无技能指导 |
|------|------|-----------|-----------|
| Install | 首次安装 hook | ~90% | ~40% |
| Reinstall | 重新配置已损坏的 hook | ~85% | ~35% |
| Uninstall | 干净卸载 | ~90% | ~50% |

有技能指导时成功率约 **90%**，无技能时约 **40%**。差距主要在配置格式和路径引用。

---

## 踩坑记录 / Lessons Learned

开发过程中踩过的坑，记录在此供参考：

1. **JSON 字段名** — Claude Code 实际传的是 `tool_name`/`tool_input`，不是文档中常见的 `tool_call.tool`/`tool_call.arguments`
2. **事件类型选择** — 一开始用 `PreToolUse` 但只关注了 `output` 字段，忽略了 `reason` 字段（`reason` 的内容会嵌入审批弹窗）
3. **PermissionRequest** — 能显示摘要但不能控制审批流程，不如 PreToolUse 灵活
4. **调试优先** — Hook 的 stdout 不直接展示给用户，出问题时完全黑盒。**第一件事就是加 debug log**

---

## License

MIT
