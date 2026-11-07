# 本地语音模型

语音识别使用 sherpa-onnx + Paraformer 中文小模型（离线运行）。

- 下载：`cd server && npm run asr:model`（默认走 hf-mirror，约 82MB）
- 来源：https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09
- 模型文件不入库（见 .gitignore）；Docker 构建前需先下载到本目录，构建时整体 COPY 进镜像。
- TTS 默认使用浏览器 speechSynthesis（系统语音，音色/语速可调）；如需服务端 TTS，配置 `TTS_BASE_URL` / `TTS_MODEL` / `TTS_VOICE`（OpenAI 兼容 /audio/speech）。
