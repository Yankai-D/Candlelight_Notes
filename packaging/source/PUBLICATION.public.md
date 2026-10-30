# 公开源码与发行包 / Public source and distribution

本仓库提供 Candlelight Notes 0.1.42 对外源码。Windows x64 安装包、源码 ZIP 和 SHA-256 校验文件见 [v0.1.42](https://github.com/Yankai-D/Candlelight_Notes/releases/tag/v0.1.42)。

This repository provides Candlelight Notes 0.1.42 public source. The Windows x64 installer, source ZIP and SHA-256 checksums are under [v0.1.42](https://github.com/Yankai-D/Candlelight_Notes/releases/tag/v0.1.42).

应用代码、依赖和测试来自已验收构建快照 `54099a9d412ad483abd2d99a85fa7c81717d5fd9`。保留公开 Git 历史，不上传自用开发历史；公开整理只更换双语发行说明、补充验收记录并统一文本换行为 LF。运行文件逐一核对，其他应用内容与受测构建相同。安装包内的构建快照与公开提交通过 PUBLIC-SOURCE.json 对应。

Application code, dependencies and tests come from verified build snapshot `54099a9d412ad483abd2d99a85fa7c81717d5fd9`. Public Git history is retained and private development history is excluded. Publication changes bilingual distribution documentation, adds verification evidence and normalizes text line endings to LF. Runtime files are individually checked against the tested build; no other application changes are permitted. PUBLIC-SOURCE.json binds the installer snapshot to the public source.

本机通过 615 项测试、16 个工程阶段、打包应用运行、0.1.32 与 0.1.41 到本版的数据兼容、六项隔离安装事务及十项进程检测场景。最终安装器中的 36 个文件与受测程序一致，12,119 个内部文件通过审计。详见 [版本记录](docs/releases/v0.1.42.json)。

Local verification passed 615 tests, 16 engineering stages, packaged application checks, data compatibility from 0.1.32 and 0.1.41, six isolated installation transactions and ten process-detection scenarios. All 36 installer files match the tested application, and 12,119 internal files passed auditing. See the [release record](docs/releases/v0.1.42.json).

发布包不含个人资料、画像、笔记、API Key、.env、私人运行记录或缓存。仅包含三份附署名许可的 OpenIntro 描述性统计选编，以及原创或注明来源的开发夹具。公开历史 JSON 中的 selfUse 记录被移除，历史模型试验保留事实与局限，不改写成新版本的成功证据。详见 [致谢与材料许可](ACKNOWLEDGEMENTS.md)。

The distribution excludes personal materials, profiles, notes, API keys, .env, private runtime records and caches. It includes three attributed OpenIntro descriptive-statistics selections and authored or attributed development fixtures. Historical selfUse JSON entries are removed. Earlier model trials retain their actual findings and limitations, without being rewritten as evidence of current success. See [acknowledgements and material licensing](ACKNOWLEDGEMENTS.md).

源码入口为 `npm ci`、`npm run dev:public`，完整检查为 `npm run check`。Windows x64 构建先运行 `npm run prepare:materials`，再运行 `npm run package:desktop`。打包要求干净 Git 工作区；从源码 ZIP 开始时先初始化 Git 并提交。源码 ZIP 不含 Git 历史。

Run `npm ci` and `npm run dev:public` from source, and `npm run check` for full verification. Build the Windows x64 installer with `npm run prepare:materials` followed by `npm run package:desktop`. Packaging requires a clean Git worktree; initialize Git and commit first when starting from the source ZIP. The ZIP excludes Git history.

本轮规划重置与发行验收未调用真实模型，不据此宣称教学优势或费用下降。新增独立取舍规划也有成本。模型审查可能与生成共享认知错误；异常恢复不保证总能成功。安装包未签名，未完成空白 Windows VM 验收；远程 CI 状态以 GitHub 为准。

The planning reset and release verification made no live model calls and establish neither teaching superiority nor lower cost. Independent selection adds overhead. Review and generation may share reasoning errors, and recovery is not guaranteed. The installer is unsigned and has not undergone clean-Windows-VM acceptance; GitHub records remote CI status.
