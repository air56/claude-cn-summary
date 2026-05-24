#!/usr/bin/env node
// preapproval.cjs - Claude Code 中文变更摘要审批 Hook
// 在 PreToolUse 阶段自动生成中文变更报告，帮助用户理解需要批准的内容

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Debug log to verify hook is called
const LOG = path.join(__dirname, 'preapproval.log');
function debug(...args) {
  try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + args.join(' ') + '\n'); } catch (_) {}
}

main();

function main() {
  try {
    // Try stdin first, then fall back to env vars
    let raw = '';
    try {
      raw = fs.readFileSync(0, 'utf-8');
    } catch (_) {}
    debug('STDIN:', raw.slice(0, 500));

    let input;
    if (raw.trim()) {
      input = JSON.parse(raw);
    } else {
      // Fallback: read from environment variables
      const toolName = process.env.CLAUDE_TOOL_NAME || process.env.TOOL_NAME || '';
      const toolInput = process.env.CLAUDE_TOOL_INPUT || process.env.TOOL_INPUT || '{}';
      debug('FALLBACK ENV:', toolName, toolInput.slice(0, 300));
      input = { tool: toolName, arguments: JSON.parse(toolInput) };
    }

    debug('PARSED INPUT:', JSON.stringify(input).slice(0, 300));
    const toolCall = input.tool_call || {};
    const args = toolCall.arguments || input.arguments || {};
    const tool = (toolCall.tool || input.tool || 'unknown').toLowerCase();
    const event = (input.event || 'PreToolUse').toLowerCase();

    const summary = generateSummary(tool, args);

    if (event === 'permissionrequest') {
      // PermissionRequest: print summary text to appear alongside the prompt
      console.log(summary);
    } else {
      // PreToolUse: return JSON with "ask" decision
      console.log(JSON.stringify({
        decision: 'ask',
        output: '\n' + summary + '\n',
        reason: '请查看中文变更摘要后确认'
      }));
    }
  } catch (err) {
    debug('ERROR:', err.message, err.stack);
    console.log(JSON.stringify({ decision: 'allow', reason: '摘要生成异常，已自动放行' }));
  }
}

function generateSummary(tool, args) {
  switch (tool) {
    case 'write':
    case 'filewrite':
      return writeSummary(args);
    case 'edit':
    case 'fileedit':
      return editSummary(args);
    case 'bash':
      return bashSummary(args);
    case 'read':
    case 'fileread':
      return readSummary(args);
    case 'glob':
      return globSummary(args);
    case 'grep':
      return grepSummary(args);
    case 'webfetch':
      return webFetchSummary(args);
    case 'websearch':
      return webSearchSummary(args);
    case 'directorycreate':
      return dirCreateSummary(args);
    case 'filedelete':
      return fileDeleteSummary(args);
    default:
      return defaultSummary(tool, args);
  }
}

// ============================================================
// Write tool - 文件创建/修改
// ============================================================
function writeSummary(args) {
  const filePath = args.file_path || '';
  const content = args.content || '';
  const lines = content.split('\n').length;
  const sizeKB = (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1);

  let action = '创建新文件';
  let riskText = '低';
  let oldStats = '';
  let diffSnippet = '';

  if (fs.existsSync(filePath)) {
    action = '修改现有文件';
    riskText = '中';
    const existing = fs.readFileSync(filePath, 'utf-8');
    const oldLines = existing.split('\n').length;
    const oldSizeKB = (Buffer.byteLength(existing, 'utf-8') / 1024).toFixed(1);
    oldStats = `\n旧文件: ${oldSizeKB} KB, ${oldLines} 行\n新文件: ${sizeKB} KB, ${lines} 行`;

    // Try to generate a diff snippet for small/medium files
    if (existing.length < 50000 && content.length < 50000) {
      try {
        const tmpOld = path.join(process.env.TEMP || '/tmp', '_claude_old_' + Date.now());
        const tmpNew = path.join(process.env.TEMP || '/tmp', '_claude_new_' + Date.now());
        fs.writeFileSync(tmpOld, existing, 'utf-8');
        fs.writeFileSync(tmpNew, content, 'utf-8');
        const diff = execSync(`diff -u "${tmpOld}" "${tmpNew}" 2>/dev/null || true`, { encoding: 'utf-8' });
        fs.unlinkSync(tmpOld);
        fs.unlinkSync(tmpNew);
        if (diff.length > 0 && diff.length < 2000) {
          diffSnippet = '\n\n差异对比:\n```diff\n' + diff.slice(0, 1500) + '\n```';
        } else if (diff.length >= 2000) {
          diffSnippet = '\n\n(差异较大, 共 ' + lines + ' 行, 建议批准后查看完整内容)';
        }
      } catch (_) {
        // diff not available or failed, skip snippet
      }
    } else if (content.length >= 50000) {
      diffSnippet = '\n\n(文件较大, 共 ' + lines + ' 行, 建议批准后查看完整内容)';
    }
  } else {
    oldStats = `\n文件大小: ${sizeKB} KB, ${lines} 行`;
    if (lines <= 100 && content.length < 10000) {
      diffSnippet = '\n\n新文件内容:\n```\n' + content.slice(0, 2000) + '\n```';
    }
  }

  const riskIcon = riskText === '高' ? '[高风险]' : riskText === '中' ? '[中风险]' : '[低风险]';
  const shortPath = shortenPath(filePath);

  return [
    '## 变更摘要',
    '',
    '### 操作: 文件写入',
    '',
    `- **文件**: \`${shortPath}\``,
    `- **操作**: ${action}`,
    `- **风险**: ${riskIcon}${oldStats}`,
    `${diffSnippet}`,
    '',
    '---',
    '请确认是否同意以上变更? [yes/no]',
  ].join('\n');
}

// ============================================================
// Edit tool - 文件编辑（替换文本）
// ============================================================
function editSummary(args) {
  const filePath = args.file_path || '';
  const oldStr = args.old_string || '';
  const newStr = args.new_string || '';

  const shortPath = shortenPath(filePath);
  const ext = guessExtension(filePath);
  const oldTruncated = oldStr.length > 800 ? oldStr.slice(0, 800) + '\n... (已截断)' : oldStr;
  const newTruncated = newStr.length > 800 ? newStr.slice(0, 800) + '\n... (已截断)' : newStr;

  return [
    '## 变更摘要',
    '',
    '### 操作: 文件编辑（文本替换）',
    '',
    `- **文件**: \`${shortPath}\``,
    `- **风险**: [中风险]`,
    '',
    '**将删除以下内容:**',
    '```' + ext,
    oldTruncated,
    '```',
    '',
    '**替换为以下内容:**',
    '```' + ext,
    newTruncated,
    '```',
    '',
    '---',
    '请确认是否同意以上编辑? [yes/no]',
  ].join('\n');
}

// ============================================================
// Bash tool - 命令执行
// ============================================================
function bashSummary(args) {
  const command = args.command || '';
  const { risk: riskText, reason } = assessCommandRisk(command);

  const riskIcon = riskText === '高' ? '[高风险]' : riskText === '中' ? '[中风险]' : '[低风险]';
  const warning = riskText === '高'
    ? '\n> **警告**: 此命令可能具有破坏性（' + reason + '），请谨慎确认！\n'
    : riskText === '中'
    ? '\n> *提示*: ' + reason + '\n'
    : '';

  return [
    '## 变更摘要',
    '',
    '### 操作: 命令执行',
    '',
    `- **风险**: ${riskIcon}`,
    `${warning}`,
    '**将执行:**',
    '```bash',
    command,
    '```',
    '',
    '---',
    '请确认是否同意执行此命令? [yes/no]',
  ].join('\n');
}

// ============================================================
// Read tool - 文件读取（低风险）
// ============================================================
function readSummary(args) {
  const filePath = args.file_path || '';
  const shortPath = shortenPath(filePath);

  return [
    '## 变更摘要',
    '',
    '### 操作: 文件读取',
    '',
    `- **文件**: \`${shortPath}\``,
    `- **风险**: [低风险] 只读操作`,
    '',
    '---',
    '请确认是否同意读取此文件? [yes/no]',
  ].join('\n');
}

// ============================================================
// Glob tool - 文件搜索
// ============================================================
function globSummary(args) {
  const pattern = args.pattern || args.glob || '';
  const dir = args.path || args.directory || '当前目录';

  return [
    '## 变更摘要',
    '',
    '### 操作: 文件搜索',
    '',
    `- **范围**: \`${shortenPath(dir)}\``,
    `- **模式**: \`${pattern}\``,
    `- **风险**: [低风险] 只读搜索`,
    '',
    '---',
    '请确认是否同意搜索? [yes/no]',
  ].join('\n');
}

// ============================================================
// Grep tool - 内容搜索
// ============================================================
function grepSummary(args) {
  const pattern = args.pattern || '';
  const path_ = args.path || args.directory || '当前目录';
  const glob = args.glob || args.include || '所有文件';

  return [
    '## 变更摘要',
    '',
    '### 操作: 内容搜索',
    '',
    `- **范围**: \`${shortenPath(path_)}\``,
    `- **关键词**: \`${pattern.length > 120 ? pattern.slice(0, 120) + '...' : pattern}\``,
    `- **文件过滤**: \`${glob}\``,
    `- **风险**: [低风险] 只读搜索`,
    '',
    '---',
    '请确认是否同意搜索? [yes/no]',
  ].join('\n');
}

// ============================================================
// WebFetch tool - 网页抓取
// ============================================================
function webFetchSummary(args) {
  const url = args.url || '';
  const prompt = args.prompt || '';

  return [
    '## 变更摘要',
    '',
    '### 操作: 网页抓取',
    '',
    `- **目标**: \`${url}\``,
    ...(prompt ? [`- **查询内容**: \`${prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt}\``] : []),
    `- **风险**: [低风险] 只读网络请求`,
    '',
    '---',
    '请确认是否同意抓取? [yes/no]',
  ].join('\n');
}

// ============================================================
// WebSearch tool - 网络搜索
// ============================================================
function webSearchSummary(args) {
  const query = args.query || '';

  return [
    '## 变更摘要',
    '',
    '### 操作: 网络搜索',
    '',
    `- **搜索词**: \`${query.length > 150 ? query.slice(0, 150) + '...' : query}\``,
    `- **风险**: [低风险] 只读网络请求`,
    '',
    '---',
    '请确认是否同意搜索? [yes/no]',
  ].join('\n');
}

// ============================================================
// DirectoryCreate tool - 创建目录
// ============================================================
function dirCreateSummary(args) {
  const filePath = args.file_path || args.path || '';

  return [
    '## 变更摘要',
    '',
    '### 操作: 创建目录',
    '',
    `- **路径**: \`${shortenPath(filePath)}\``,
    `- **风险**: [低风险]`,
    '',
    '---',
    '请确认是否同意创建? [yes/no]',
  ].join('\n');
}

// ============================================================
// FileDelete tool - 删除文件
// ============================================================
function fileDeleteSummary(args) {
  const filePath = args.file_path || args.path || '';

  return [
    '## 变更摘要',
    '',
    '### 操作: 删除文件',
    '',
    `- **路径**: \`${shortenPath(filePath)}\``,
    `- **风险**: [中风险] 删除操作不可撤销`,
    '',
    '---',
    '请确认是否同意删除? [yes/no]',
  ].join('\n');
}

// ============================================================
// Default - 其他工具
// ============================================================
function defaultSummary(tool, args) {
  const keys = Object.keys(args).slice(0, 3);
  const argText = keys.map(k => {
    const v = String(args[k]);
    return `  \`${k}\`: ${v.length > 100 ? v.slice(0, 100) + '...' : v}`;
  }).join('\n');

  return [
    '## 变更摘要',
    '',
    `### 操作: ${tool}`,
    `- **风险**: [低风险]`,
    '',
    ...(argText ? ['**参数**:', argText, ''] : []),
    '---',
    '请确认是否同意此操作? [yes/no]',
  ].join('\n');
}

// ============================================================
// 辅助函数
// ============================================================

function shortenPath(p) {
  if (!p) return '未知';
  // Try to show path relative to a meaningful parent
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && p.startsWith(home)) {
    return '~' + p.slice(home.length);
  }
  // Truncate long paths
  if (p.length > 90) {
    return '...' + p.slice(-87);
  }
  return p;
}

function assessCommandRisk(command) {
  const cmd = command.trim();

  // 高风险模式
  const highRiskPatterns = [
    { pattern: /^rm\s+-rf\s+\/$/i, desc: '删除根目录' },
    { pattern: /^rm\s+-rf\s+\/\s+/i, desc: '删除根目录下文件' },
    { pattern: /^dd\s+if=.*of=\/dev\/(sda|sdb|sdc|nvme|mmc)/i, desc: '直接写入磁盘设备' },
    { pattern: /^mkfs\./i, desc: '格式化文件系统' },
    { pattern: /^fdisk\s+\/dev\/(sda|sdb|sdc)/i, desc: '修改磁盘分区' },
    { pattern: /^>\/dev\/sda/i, desc: '直接写入磁盘设备' },
    { pattern: /^chmod\s+777\s+\//i, desc: '修改根目录权限' },
    { pattern: /^sudo\s+rm\s+-rf\s+\//i, desc: '以 root 权限删除根目录' },
  ];
  for (const hp of highRiskPatterns) {
    if (hp.pattern.test(cmd)) return { risk: '高', reason: hp.desc };
  }

  // 中风险模式
  const mediumRiskPatterns = [
    { pattern: /^git\s+(push|merge|rebase|reset|checkout\s+-b)/i, desc: 'Git 写入操作' },
    { pattern: /^git\s+commit/i, desc: 'Git 提交' },
    { pattern: /^npm\s+(publish|unpublish|deprecate)/i, desc: 'NPM 发布/撤销操作' },
    { pattern: /^yarn\s+(publish)/i, desc: 'Yarn 发布操作' },
    { pattern: /^gh\s+pr\s+merge/i, desc: 'GitHub PR 合并' },
    { pattern: /^docker\s+(rm|rmi|system\s+prune)/i, desc: 'Docker 删除操作' },
    { pattern: /^pip\s+uninstall/i, desc: 'Pip 卸载包' },
    { pattern: /^cargo\s+clean/i, desc: 'Cargo 清理' },
    { pattern: /^rm\s+/i, desc: '删除文件/目录' },
    { pattern: /^mv\s+/i, desc: '移动/重命名文件' },
    { pattern: /^cp\s+.*\s+\//i, desc: '复制文件到系统目录' },
    { pattern: /^sudo\s+/i, desc: '使用 sudo 提权执行' },
    { pattern: /^\s*>/i, desc: '重定向写入文件' },
    { pattern: /^chmod\s+777/i, desc: '设置开放权限' },
    { pattern: /^chown/i, desc: '修改文件所有者' },
  ];
  for (const mp of mediumRiskPatterns) {
    if (mp.pattern.test(cmd)) return { risk: '中', reason: mp.desc };
  }

  // 常见的只读/安全命令
  const safePatterns = [
    /^(ls|cat|head|tail|less|more|echo|pwd|which|whoami|date|env|printenv|df|du|ps|top|htop|uname|id|type|command)\b/i,
    /^git\s+(status|diff|log|branch|show|stash\s+list|config)/i,
    /^npm\s+(list|ls|view|search|pack)/i,
    /^yarn\s+(list|info|why)/i,
    /^gh\s+(pr\s+(list|view|checkout)|issue\s+(list|view)|status)/i,
    /^docker\s+(ps|images|logs|inspect|stats)/i,
    /^npx\s/i,
    /^node\s/i,
    /^python3?\s/i,
    /^cargo\s+(check|build|test|doc)/i,
    /^pip\s+(list|show|search)/i,
  ];
  for (const sp of safePatterns) {
    if (sp.test(cmd)) return { risk: '低', reason: '' };
  }

  // 短命令且不匹配任何已知安全模式
  if (cmd.length < 100) return { risk: '中', reason: '未知命令，请确认' };
  return { risk: '低', reason: '' };
}

function guessExtension(filePath) {
  if (!filePath) return '';
  const ext = filePath.split('.').pop().toLowerCase();
  const known = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp',
    'html', 'htm', 'css', 'scss', 'less', 'json', 'xml', 'yaml', 'yml',
    'md', 'sh', 'bash', 'zsh', 'go', 'rs', 'rb', 'php', 'swift', 'kt',
    'sql', 'graphql', 'proto', 'toml', 'ini', 'cfg', 'conf', 'env'];
  return known.includes(ext) ? ext : '';
}
