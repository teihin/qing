#!/usr/bin/env python3
"""Initialize project memory or check its structure. Python 3 standard library only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from urllib.parse import unquote, urlsplit

POLICY = "docs/memory/memory-policy.json"
CORE_DOCS = ("AGENTS.md", "docs/memory/CURRENT.md", "docs/memory/DECISIONS.md")
REQUIRED_FILES = (*CORE_DOCS, POLICY, "docs/memory/check_memory.py")
MAX_DOC_BYTES = 2 * 1024 * 1024

AGENTS_TEMPLATE = """# 项目工作与记忆规则

## 启动与恢复
- 开始持续项目工作时，读取 [当前状态](docs/memory/CURRENT.md)、[有效决策](docs/memory/DECISIONS.md)，再按任务读取相关专题或交接；历史按需搜索。
- 沿用已有记忆体系，不重复初始化或覆盖其他入口；目标与技术事实未知时明确标为待确认。
- 核对实际项目目录、当前分支及已有修改（适用时）；长对话恢复后若关键上下文缺失，重新读取相关文件。
- 开始修改前简述当前目标、必须保留的约束和下一步，标明依据，随后继续执行已授权的工作。

## 持续维护
- 用户确认方案、纠正要求或完成可验收阶段后，在已有授权范围内更新相关项目文档；不得将凭据或其他项目的私人数据写入记忆。
- CURRENT 维护最新有效状态，不持续堆叠流水；重要决策记录适用范围、依据和替代关系。专题与任务交接按实际需要增加并加入入口索引。
- 区分计划、已实现、已验证、已发布；记录验证时间、方法、结果及未验证项。历史报告不得写成今天重新验证过的事实。
- 用户最新明确要求决定目标；代码、测试及实际运行结果用于确认实现状态。文档与事实冲突时说明差异，证据不足时标为待核实。
- 入口过大、内容重复或索引失效时，保留可追溯历史并按需归档，修复当前结论和索引；不要清空或覆盖不明来源的记录。
- 并行任务分别维护交接；更新公共状态前重新读取并合并有效改动，不覆盖他人工作。

## 收尾检查
- 回复完成前更新本次状态、验证结果和下一步，运行 `python3 docs/memory/check_memory.py check --root <项目绝对路径>`。
- 新增活动文档时同步 [检查配置](docs/memory/memory-policy.json) 中的 active_docs、必要标题及预算。
- 检查脚本仅检查文档结构、链接与归档完整性；内容准确性仍须结合代码和验证证据核对。
- 这些是任务执行时的维护规则，不是后台定时自动化；每次应实际读取、维护并按需运行检查。
- 简要说明更新了哪些文档和未验证事项。未经明确授权不提交、推送或发布。
"""

CURRENT_TEMPLATE = """# 当前状态

## 当前目标
待确认；首次实际任务明确后填写，不从目录名推断项目目标。

## 当前基线
待确认：项目根目录、技术栈、版本、工作分支（如适用）和核对日期。

## 当前方案与约束
待确认；重要取舍在 [决策记录](DECISIONS.md) 中维护。

## 已完成与验证依据
尚无已记录的项目实现或验证结果。记忆目录初始化不代表项目功能已完成。

## 未完成与未验证
待确认。

## 下一步
根据用户首次实际项目任务核实基线、范围及验收要求。

## 相关专题与交接
暂未建立；需要时新增并在此链接，随后更新 [检查配置](memory-policy.json)。
"""

DECISIONS_TEMPLATE = """# 决策记录

## 有效决策
尚无已确认的项目技术或业务决策。
新增时记录：决策内容、适用范围、生效日期、依据、替代关系和当前状态。

## 已否决或被替代
暂无。旧结论被替代时保留原因和来源，不与有效决策混写。

## 待核实
暂无；证据不足的事项在此登记，不编造结论。
"""

DEFAULT_POLICY = {
    "version": 1,
    "active_docs": list(CORE_DOCS),
    "required_headings": {
        "AGENTS.md": ["启动与恢复", "持续维护", "收尾检查"],
        "docs/memory/CURRENT.md": ["当前目标", "当前基线", "当前方案与约束", "已完成与验证依据", "未完成与未验证", "下一步", "相关专题与交接"],
        "docs/memory/DECISIONS.md": ["有效决策", "已否决或被替代", "待核实"],
    },
    "budgets": {
        "AGENTS.md": {"warn_bytes": 6144, "error_bytes": 16384},
        "docs/memory/CURRENT.md": {"warn_bytes": 8192, "error_bytes": 24576},
        "docs/memory/DECISIONS.md": {"warn_bytes": 12288, "error_bytes": 32768},
    },
    "archives": [],
}


class MemoryError(Exception):
    pass


def clean_relative(value: str) -> str:
    """Policy/file-operation paths must already be simple root-relative paths."""
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise MemoryError("路径必须为非空的项目相对路径")
    p = PurePosixPath(value)
    if p.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise MemoryError(f"拒绝绝对路径或不规范路径：{value}")
    return str(p)


class SafeRoot:
    """Use directory fds and O_NOFOLLOW, including every root ancestor."""
    def __init__(self, supplied: str):
        p = Path(supplied)
        if not p.is_absolute() or ".." in p.parts:
            raise MemoryError("--root 必须显式指定已存在的绝对目录，不得包含 ..")
        if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
            raise MemoryError("当前系统缺少安全目录访问能力；本工具支持 macOS / Linux")
        self.path = p
        fd = os.open(p.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in p.parts[1:]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
        except OSError as exc:
            os.close(fd)
            raise MemoryError(f"根目录或祖先不存在、不是目录或含符号链接：{p} ({exc.strerror})") from exc
        self.fd = fd

    def close(self):
        os.close(self.fd)

    def parent(self, relative: str):
        parts = clean_relative(relative).split("/")
        fd = os.dup(self.fd)
        try:
            for part in parts[:-1]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
        except OSError:
            os.close(fd)
            raise
        return fd, parts[-1]

    def info(self, relative: str):
        fd, name = self.parent(relative)
        try:
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode):
                raise MemoryError(f"拒绝符号链接：{relative}")
            return info
        finally:
            os.close(fd)

    def exists(self, relative: str) -> bool:
        try:
            self.info(relative)
            return True
        except FileNotFoundError:
            return False

    def open_read(self, relative: str):
        fd, name = self.parent(relative)
        try:
            child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        finally:
            os.close(fd)
        if not stat.S_ISREG(os.fstat(child).st_mode):
            os.close(child)
            raise MemoryError(f"需要普通文件：{relative}")
        return os.fdopen(child, "rb")

    def read_small(self, relative: str, limit: int = MAX_DOC_BYTES) -> bytes:
        with self.open_read(relative) as stream:
            content = stream.read(limit + 1)
        if len(content) > limit:
            raise MemoryError(f"文件超过读取上限 {limit} 字节，已停止解析：{relative}")
        return content

    def mkdir(self, relative: str, created_dirs: list):
        fd, name = self.parent(relative)
        try:
            try:
                os.mkdir(name, mode=0o755, dir_fd=fd)
            except FileExistsError:
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if not stat.S_ISDIR(info.st_mode):
                    raise MemoryError(f"目标不是普通目录：{relative}")
                return
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            created_dirs.append((relative, info.st_dev, info.st_ino))
        finally:
            os.close(fd)

    def create(self, relative: str, data: bytes, created_files: list):
        fd, name = self.parent(relative)
        try:
            child = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=fd)
        finally:
            os.close(fd)
        info = os.fstat(child)
        created_files.append((relative, info.st_dev, info.st_ino))
        with os.fdopen(child, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())

    def rollback(self, files: list, directories: list) -> list:
        failures = []
        for records, is_dir in ((files, False), (directories, True)):
            for relative, device, inode in reversed(records):
                try:
                    fd, name = self.parent(relative)
                    try:
                        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                        if (info.st_dev, info.st_ino) != (device, inode):
                            failures.append(f"路径已被其他操作替换，未删除：{relative}")
                            continue
                        if is_dir:
                            os.rmdir(name, dir_fd=fd)
                        else:
                            os.unlink(name, dir_fd=fd)
                    finally:
                        os.close(fd)
                except FileNotFoundError:
                    pass
                except (OSError, MemoryError) as exc:
                    failures.append(f"未能回滚 {relative}：{exc}")
        return failures


def without_fences(markdown: str) -> str:
    result, fence_char, fence_len = [], None, 0
    for line in markdown.splitlines():
        match = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence_char:
            if match and match[1][0] == fence_char and len(match[1]) >= fence_len and not match[2].strip():
                fence_char = None
            result.append("")
        elif match:
            fence_char, fence_len = match[1][0], len(match[1])
            result.append("")
        else:
            result.append(line)
    return "\n".join(result)


def headings(markdown: str) -> set:
    return {re.sub(r"\s+#+\s*$", "", m[1]).strip()
            for m in re.finditer(r"^ {0,3}#{1,6}\s+(.+?)\s*$", markdown, re.M)}


def heading_key(value: str) -> str:
    return re.sub(r"^#{1,6}\s+", "", value.strip())


def markdown_links(markdown: str):
    """Ordinary inline links/images and reference destinations; ignore code spans."""
    text = re.sub(r"(`+)[^\n]*?\1", "", markdown)
    # Support angled destinations, escaped characters, and balanced parentheses.
    for match in re.finditer(r"!?\[[^\]\n]*\]\(\s*", text):
        pos = match.end()
        if pos >= len(text):
            continue
        if text[pos] == "<":
            end = text.find(">", pos + 1)
            if end != -1 and "\n" not in text[pos:end]:
                yield text[pos + 1:end]
            continue
        result, depth = [], 0
        while pos < len(text):
            char = text[pos]
            if char == "\\" and pos + 1 < len(text):
                result.append(text[pos:pos + 2])
                pos += 2
                continue
            if char.isspace() or (char == ")" and depth == 0):
                break
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            result.append(char)
            pos += 1
        if result:
            yield "".join(result)
    for match in re.finditer(r"^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))", text, re.M):
        yield match[1] or match[2]


def link_target(source: str, raw: str):
    raw = re.sub(r"\\([\\`*{}\[\]()#+\-.!_<> ])", r"\1", raw)
    if not raw or raw.startswith("#"):
        return None
    parsed = urlsplit(raw)
    if parsed.scheme:
        if parsed.scheme.lower() == "file":
            raise MemoryError(f"拒绝 file URL，请改为项目内相对链接：{raw}")
        return None
    if parsed.netloc:
        return None  # Network URL such as //example.com/path.
    decoded = unquote(parsed.path)
    if not decoded:
        return None
    if decoded.startswith("/") or "\\" in decoded or "\x00" in decoded:
        raise MemoryError(f"拒绝绝对或不安全的本地链接：{raw}")
    parts = list(PurePosixPath(source).parent.parts)
    for component in decoded.split("/"):
        if component in ("", "."):
            continue
        if component == "..":
            if not parts:
                raise MemoryError(f"链接越出项目根目录：{raw}")
            parts.pop()
        else:
            parts.append(component)
    return "/".join(parts) or "."


class Report:
    def __init__(self):
        self.errors = 0
        self.warnings = 0

    def error(self, message):
        self.errors += 1
        print(f"错误：{message}")

    def warn(self, message):
        self.warnings += 1
        print(f"警告：{message}")

    def finish(self, count=0):
        print(f"检查完成：{count} 份活动文档，{self.errors} 个错误，{self.warnings} 个警告。")
        print("本结果仅覆盖结构、UTF-8、文档预算、本地链接及显式归档哈希；不代表内容或项目功能正确。")
        return 1 if self.errors else 0


def check(root: SafeRoot) -> int:
    report = Report()
    for relative in REQUIRED_FILES:
        try:
            if not stat.S_ISREG(root.info(relative).st_mode):
                report.error(f"必要路径不是普通文件：{relative}")
        except (OSError, MemoryError) as exc:
            report.error(f"必要文件不可访问：{relative} ({exc})")
    try:
        policy = json.loads(root.read_small(POLICY).decode("utf-8"))
    except (OSError, MemoryError, UnicodeError, ValueError) as exc:
        report.error(f"配置无法读取或不是 UTF-8 JSON：{exc}")
        return report.finish()
    if not isinstance(policy, dict) or policy.get("version") != 1:
        report.error("memory-policy.json 必须为 version=1 的对象")
        return report.finish()
    active = policy.get("active_docs")
    required = policy.get("required_headings", {})
    budgets = policy.get("budgets", {})
    archives = policy.get("archives", [])
    if (not isinstance(active, list) or not active or
            any(not isinstance(p, str) for p in active) or
            not isinstance(required, dict) or not isinstance(budgets, dict) or not isinstance(archives, list)):
        report.error("配置类型错误：active_docs/archives 应为列表，required_headings/budgets 应为对象")
        return report.finish()
    if len(active) != len(set(active)):
        report.error("active_docs 包含重复路径")
    for relative in CORE_DOCS:
        if relative not in active:
            report.error(f"active_docs 缺少必要文档：{relative}")
    for mapping_name, mapping in (("required_headings", required), ("budgets", budgets)):
        for relative in mapping:
            if relative not in active:
                report.error(f"{mapping_name} 含未列入 active_docs 的路径：{relative}")
    for relative in active:
        try:
            clean_relative(relative)
            if PurePosixPath(relative).suffix.lower() not in (".md", ".markdown"):
                raise MemoryError("active_docs 仅支持 Markdown 文档")
            content = root.read_small(relative)
            text = content.decode("utf-8")
            default = DEFAULT_POLICY["budgets"].get(relative, {"warn_bytes": 16384, "error_bytes": 65536})
            budget = budgets.get(relative, default)
            if not isinstance(budget, dict):
                raise MemoryError("budget 必须是对象")
            warn = budget.get("warn_bytes", default["warn_bytes"])
            error = budget.get("error_bytes", default["error_bytes"])
            if type(warn) is not int or type(error) is not int or not 0 < warn < error:
                raise MemoryError("预算必须是正整数且 warn_bytes < error_bytes")
            if relative == "AGENTS.md" and (warn > 6144 or error > 16384):
                raise MemoryError("AGENTS.md 预算不得高于建议 6144 / 上限 16384 字节")
            if len(content) > error:
                report.error(f"{relative} 为 {len(content)} 字节，超过上限 {error}")
            elif len(content) > warn:
                report.warn(f"{relative} 为 {len(content)} 字节，超过建议 {warn}；请检查是否应拆分或归档")
            wanted = required.get(relative, DEFAULT_POLICY["required_headings"].get(relative, []))
            if not isinstance(wanted, list) or any(not isinstance(h, str) or not h.strip() for h in wanted):
                raise MemoryError("required_headings 每项必须是非空标题字符串列表")
            plain = without_fences(text)
            actual = headings(plain)
            for expected in wanted:
                if heading_key(expected) not in actual:
                    report.error(f"{relative} 缺少标题：{expected}")
            for raw in sorted(set(markdown_links(plain))):
                try:
                    target = link_target(relative, raw)
                    if target and target != ".":
                        info = root.info(target)
                        if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                            raise MemoryError("链接目标不是普通文件或目录")
                except (OSError, MemoryError, ValueError) as exc:
                    report.error(f"{relative} 的本地链接无效：{raw} ({exc})")
        except (OSError, MemoryError, UnicodeError, ValueError) as exc:
            report.error(f"{relative}：{exc}")
    seen_archives = set()
    for archive in archives:
        try:
            if not isinstance(archive, dict):
                raise MemoryError("归档清单项必须是对象")
            relative = clean_relative(archive.get("path"))
            expected = archive.get("sha256")
            if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
                raise MemoryError(f"归档 SHA-256 格式无效：{relative}")
            if relative in seen_archives:
                raise MemoryError(f"重复归档：{relative}")
            seen_archives.add(relative)
            digest = hashlib.sha256()
            with root.open_read(relative) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != expected.lower():
                report.error(f"归档 SHA-256 不匹配：{relative}")
        except (OSError, MemoryError, ValueError) as exc:
            report.error(f"归档检查失败：{exc}")
    return report.finish(len(active))


def initialize(root: SafeRoot) -> int:
    candidates = ("AGENTS.md", "AGENTS.override.md", "PROJECT_MEMORY.md", "CURRENT_STATE.md", "docs/memory")
    existing = [relative for relative in candidates if root.exists(relative)]
    if existing:
        print("已存在项目规则或记忆体系，未创建、未覆盖任何文件：" + "、".join(existing))
        print("请先读取并沿用已有入口；需要迁移时应核实内容，不能重复初始化。")
        return 0
    # Read source before mutation; the copied command remains usable without this installation.
    source = Path(__file__).read_bytes()
    files, directories = [], []
    payloads = {
        "AGENTS.md": AGENTS_TEMPLATE.encode("utf-8"),
        "docs/memory/CURRENT.md": CURRENT_TEMPLATE.encode("utf-8"),
        "docs/memory/DECISIONS.md": DECISIONS_TEMPLATE.encode("utf-8"),
        POLICY: (json.dumps(DEFAULT_POLICY, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        "docs/memory/check_memory.py": source,
    }
    try:
        # Claim the standard entry first with O_EXCL; concurrent initializers cannot overwrite it.
        root.create("AGENTS.md", payloads.pop("AGENTS.md"), files)
        root.mkdir("docs", directories)
        # This directory was absent during preflight; a competing newly created memory tree is a conflict.
        if root.exists("docs/memory"):
            raise MemoryError("初始化期间出现 docs/memory，已停止以避免混合两个体系")
        root.mkdir("docs/memory", directories)
        if not any(item[0] == "docs/memory" for item in directories):
            raise MemoryError("docs/memory 被并行操作创建，已停止初始化")
        for relative, data in payloads.items():
            root.create(relative, data, files)
        late_conflicts = [p for p in candidates[1:4] if root.exists(p)]
        if late_conflicts:
            raise MemoryError("初始化期间出现其他规则入口：" + "、".join(late_conflicts))
        if check(root):
            raise MemoryError("初始结构检查未通过")
    except (OSError, MemoryError) as exc:
        leftovers = root.rollback(files, directories)
        print(f"错误：初始化失败，已尝试只回滚本次创建的文件：{exc}", file=sys.stderr)
        for message in leftovers:
            print(f"需检查：{message}", file=sys.stderr)
        return 1
    print(f"已初始化项目记忆：{root.path}")
    print("已创建 AGENTS.md、CURRENT.md、DECISIONS.md、memory-policy.json 和可移植 check_memory.py。")
    print("项目目标、技术事实及验证结果仍待实际任务确认；未执行 Git 提交或发布。")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="安全初始化项目记忆或只读检查已有记忆")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("init", "仅为无既有记忆体系的新项目初始化"), ("check", "只读检查结构、链接、预算和归档哈希")):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--root", required=True, help="已存在的项目绝对路径；拒绝符号链接路径")
    args = parser.parse_args(argv)
    root = None
    try:
        root = SafeRoot(args.root)
        return initialize(root) if args.command == "init" else check(root)
    except (OSError, MemoryError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    finally:
        if root is not None:
            root.close()


if __name__ == "__main__":
    sys.exit(main())
