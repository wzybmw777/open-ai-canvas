# YX 视频接口

来源：[玉玺盒子视频文档](https://yuxibox.cn/docs/videos/seedance-2.0%EF%BC%88YX%EF%BC%89)。

## 请求

创建为 `POST /v1/videos`，JSON 使用 `model`、`prompt`、字符串 `seconds` 和 `ratio`。统一字段 `duration` 转为 `seconds`，`aspectRatio=auto` 转为 `ratio=adaptive`；使用 ratio 时省略 size，输出固定 720p。

`images` 按顺序映射到 `reference_images`，`videos` 和 `audios` 保留对应数组名称，传 HTTPS 或 data URL。空参考数组省略。2.0 支持 5/10/15 秒，默认 15 秒，最多 9 图、3 视频、3 音频；2.5 支持 4–30 秒，默认 30 秒，最多 30 图、10 视频、10 音频。这些限制由模型能力配置校验。

## 响应与下载

创建响应读取 `id`、`status` 和 `error.message`。查询为 `GET /v1/videos/{taskId}`，queued / in_progress / completed / failed 映射为任务状态。完成后通过携带渠道鉴权的 `GET /v1/videos/{taskId}/content` 下载并持久化视频，无需公开下载地址。

协议不推断价格，按秒和按次价格均由渠道模型的价格档决定；不改变已配置利润比例。密钥不放入 URL、请求示例或日志。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "yuxibox-video",
  "name": "玉玺盒子 YX 视频",
  "version": "1.0.0",
  "author": "YuxiBox / 影策",
  "description": "YX Seedance 2.0 / 2.5 的 OpenAI Video 协议，支持多模态参考和鉴权下载。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "yuxibox-video",
        "label": "玉玺盒子 YX 视频",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://yuxibox.cn",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "YX Seedance 的完整模型标识，保留中文括号与按次后缀。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词，最多 16000 字符。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "seconds",
            "description": "2.0 支持 5/10/15 秒；2.5 支持 4–30 秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "画幅比例；auto 映射为 adaptive，固定 720p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "按连接顺序发送图片 HTTPS / data URL。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos",
            "description": "参考视频 HTTPS / data URL。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios",
            "description": "参考音频 HTTPS / data URL。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$gt": [
                {
                  "$ref": "request.duration"
                },
                0
              ]
            },
            "message": "YX 视频必须指定有效时长"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "seconds": {
              "$toString": {
                "$ref": "request.duration"
              }
            },
            "ratio": {
              "$switch": {
                "cases": [
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "request.aspectRatio"
                        },
                        "auto"
                      ]
                    },
                    "then": "adaptive"
                  }
                ],
                "default": {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                }
              }
            },
            "reference_images": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.images"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.videos"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "audios": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.audios"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              "pending"
            ]
          },
          "message": {
            "$ref": "response.error.message"
          },
          "errorPaths": [
            "error.code",
            "error.message"
          ],
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
