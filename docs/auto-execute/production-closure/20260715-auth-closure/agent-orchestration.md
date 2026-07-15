# 编排说明

本 run 使用 `serial-fallback`：当前 Codex App 不在附加 tmux OMX shell 中，且用户要求按模块持续推进，没有要求并行代理。单一执行者负责 API、Web、测试和集成证据，避免在已很脏的工作树中产生并发写冲突。

最终报告不得声称多代理执行；必须标记为 `SERIAL_FALLBACK`。
