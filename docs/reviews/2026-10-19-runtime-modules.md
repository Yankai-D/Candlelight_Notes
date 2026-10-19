# 后端模块版本混用修复

用户报告 `The requested module './folders.mjs' does not provide an export named 'descendantFolderIds'`。开发服务已在源码更新前启动；磁盘中的导出和浏览器收到的模块均正确，新 Node 进程也能加载，但原服务的只读 `ideal-tree/list` 请求返回 HTTP 400 和相同错误。

根因是服务根据 `harness.mjs` 修改时间，以查询参数重新导入顶层模块，Node 仍复用未带参数的共享依赖。新调用方要求的导出不存在于缓存中的旧模块。只刷新页面无法清除服务端模块缓存。

修复：从同一个静态模块实例导入请求 schema、消息构建、模型执行与结果校验，移除按文件时间局部重载 harness 的行为。后端、harness 或共享模块更新后需要完整重启服务。

验证：

- 原服务只读列表请求稳定复现 HTTP 400；重启修复后的服务，相同请求返回 HTTP 200，模型连接仍为已配置。没有调用真实模型，也没有修改用户资料或 `.env`。
- 新增临时源码副本回归：先启动旧模块，再同时为磁盘依赖增加导出、为调用方增加引用。原进程继续正常响应；完整重启后新模块契约正常加载。
- `server-runtime`、`api`、`desktop`、`review-boundaries`、`nested-bundles` 共 17 项测试通过，包含真实浏览器 PDF 导出。日志：`artifacts/runtime-module-fix/regression.log`。
- 首次受限环境执行的 API 测试在浏览器 PDF 导出失败；允许启动测试浏览器后完整重跑通过。未把受限环境失败计为通过。

这是 0.1.9 复核收束后的源代码修复，现有 0.1.9 安装包尚未包含它；不改写此前候选包的哈希或验收记录。后续发行需要对新源码重新冻结验收和打包。
