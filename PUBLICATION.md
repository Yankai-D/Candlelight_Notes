# 公开源码与发行包 / Public source and distribution

本仓库提供 Candlelight Notes 0.1.32 对外源码。Windows x64 安装包、源码 ZIP 和 SHA-256 校验文件见 [v0.1.32](https://github.com/Yankai-D/Candlelight_Notes/releases/tag/v0.1.32)。

This repository provides Candlelight Notes 0.1.32 public source. The Windows x64 installer, source ZIP and SHA-256 checksums are available under [v0.1.32](https://github.com/Yankai-D/Candlelight_Notes/releases/tag/v0.1.32).

应用代码、依赖和测试来自已验证构建快照 `c29de1ddcab9ec47c582562dca32598d0804da45`。公开时更新双语发行文档和版本证据，应用运行文件逐一核对不变；保留既有公开 Git 历史，不上传自用开发历史。安装包内记录原构建快照，公开提交记录文档与发行整理，两者通过 PUBLIC-SOURCE.json 对应。

Application code, dependencies and tests come from verified build snapshot `c29de1ddcab9ec47c582562dca32598d0804da45`. Publication updates bilingual documentation and release evidence, while checking every application runtime file remains unchanged. Existing public Git history is preserved; private development history is excluded. The installer identifies the original build snapshot and the public commit records distribution preparation; PUBLIC-SOURCE.json binds them together.

本机通过 517 项测试、15 个工程检查阶段、桌面启动与 0.1.31 → 0.1.32 数据兼容检查。全部 36 个安装器文件与受测程序一致，12,098 个内部文件通过审计。六项隔离安装事务复测通过；首次并行测试中的错误日志缺少文件名问题保留为诊断限制，不计作成功。细节见 [版本记录](docs/releases/v0.1.32.json)。

Local verification passed 517 tests, 15 engineering stages, desktop launch and data compatibility from 0.1.31. All 36 installer files match the tested application, and 12,098 internal files passed auditing. All six isolated installation transactions passed in the serial rerun; the initial parallel-run missing-filename diagnostic remains recorded as a limitation, not a passing result. See the [release record](docs/releases/v0.1.32.json).

发布包不含个人资料、画像、笔记、API Key、.env、运行记录或缓存。仅包含三份附署名和许可的 OpenIntro 描述性统计选编，以及用于测试与演示的原创或注明来源的工程材料。历史 JSON 的自用记录已移除。详见 [致谢与材料许可](ACKNOWLEDGEMENTS.md)。

The distribution excludes personal materials, profiles, notes, API keys, .env, runtime records and caches. It includes three attributed and licensed OpenIntro descriptive-statistics selections, plus authored or attributed engineering fixtures for testing and demonstration. Historical personal-runtime JSON records are removed. See [acknowledgements and material licensing](ACKNOWLEDGEMENTS.md).

源码入口为 `npm ci`、`npm run dev:public`；完整检查为 `npm run check`。Windows x64 构建先运行 `npm run prepare:materials` 再运行 `npm run package:desktop`。打包要求干净 Git 工作区，源码 ZIP 用户应先初始化 Git 并提交。

Run `npm ci` and `npm run dev:public` from source; use `npm run check` for full verification. Build the Windows x64 installer with `npm run prepare:materials` followed by `npm run package:desktop`. Packaging requires a clean Git worktree; initialize Git and commit first when starting from the source ZIP.

本轮取消额度没有新增真实模型调用。旧版本真实实验、离线回放与本轮合成测试分别记录，不能据此承诺模型总能修好错误或知识绝对正确。用户取消、认证失败、外部问题和重复无进展仍是停止条件；独立评测显式授权的限额仍受执行器约束。安装包未签名，未完成空白 Windows VM 全面验收，远程 CI 状态以 GitHub 为准。

Quota removal adds no live model calls. Historical live experiments, offline replays and current synthetic tests are recorded separately; they do not guarantee every error is repairable or every claim is correct. Cancellation, authentication failures, external problems and repeated non-progress remain stopping conditions; explicit evaluation limits remain enforced. The installer is unsigned and has not undergone comprehensive clean-Windows-VM validation. GitHub records remote CI status.

公开 Git 文件按仓库规则统一文本换行为 LF；核对时只允许这项换行转换，其他应用代码必须与受测构建一致。

Public Git files normalize text line endings to LF under repository rules. Verification permits only this line-ending conversion; all other application code must match the tested build.
