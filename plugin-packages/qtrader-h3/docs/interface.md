# QT H3 接口

- 创建：`POST /v1/videos`，Bearer 鉴权，multipart/form-data。
- 字段：`model=h3-video`、`prompt`、字符串 `seconds`、像素 `size`。
- 参考图：按顺序重复 `input_reference` 文件字段，最多 9 张，每张最多 24 MiB。
- 查询：`GET /v1/videos/{id}`；结果：`GET /v1/videos/{id}/content`。
- 优先读取 `sparkcine.outputs[0].download_url`，结果链接临时有效，由宿主持久化。
- 不声明取消接口，避免把 OpenAI 的删除语义误当成停止计费。

`size` 按分辨率的短边和画幅换算为整数像素。SparkCine 按短边选择能覆盖它的最小分辨率，
再匹配最近画幅，因此长边向上取整；短边不能向上跨入更贵规格。
五档为 480p、720p、768p、960p、1080p。720p 仅横竖屏；其他档支持
16:9、9:16、21:9、4:3、1:1、3:4。4–30 秒整数，960p/1080p 最长 15 秒，768p 21:9 最长 20 秒。

`h3-video` 的图片是普通参考图。首尾帧属于未接入的 `h3-video-frames`，不能自动改作普通图片。
SparkCine 原生 H3 入口另支持音频和参考视频；QT 当前提供的 OpenAI 兼容文档仅声明图片文件，
本插件不向该入口虚构音频、视频或生成音频开关字段。默认保留上游生成音频。
`optimize_prompt=false` 固定关闭额外收费的提示词优化。

报价使用 QT 密钥所属分组 100 的实时人民币秒价；SparkCine 公共零售价不等于该分组成本。
公开页面还说明单次最低费用，QT 分组未提供最低费用字段；真实账单的最低扣费规则须单独核对。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "qtrader-h3",
  "name": "QT SparkCine H3",
  "version": "1.0.0",
  "author": "影策",
  "description": "QT 上游 h3-video：OpenAI Videos multipart，seconds 与像素 size，最多 9 张参考图。",
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
        "id": "qtrader-h3",
        "label": "QT SparkCine H3",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation"
        ],
        "baseUrl": "https://api.qtrader.cc",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true
          },
          {
            "name": "resolution",
            "type": "string",
            "required": true
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": true
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "h3-video"
              ]
            },
            "message": "此协议仅支持 h3-video"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gt": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    0
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    12000
                  ]
                }
              ]
            },
            "message": "提示词需为 1–12000 字符"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    4
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    30
                  ]
                }
              ]
            },
            "message": "时长需为 4–30 秒"
          },
          {
            "assert": {
              "$and": [
                {
                  "$in": [
                    {
                      "$ref": "request.resolution"
                    },
                    [
                      "480p",
                      "720p",
                      "768p",
                      "960p",
                      "1080p"
                    ]
                  ]
                },
                {
                  "$in": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    [
                      "16:9",
                      "9:16",
                      "21:9",
                      "4:3",
                      "1:1",
                      "3:4"
                    ]
                  ]
                },
                {
                  "$or": [
                    {
                      "$ne": [
                        {
                          "$ref": "request.resolution"
                        },
                        "720p"
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$ref": "request.aspectRatio"
                        },
                        [
                          "16:9",
                          "9:16"
                        ]
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "请选择支持的分辨率与画幅比例；720p 仅支持横竖屏"
          },
          {
            "assert": {
              "$or": [
                {
                  "$and": [
                    {
                      "$ne": [
                        {
                          "$ref": "request.resolution"
                        },
                        "960p"
                      ]
                    },
                    {
                      "$ne": [
                        {
                          "$ref": "request.resolution"
                        },
                        "1080p"
                      ]
                    }
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    15
                  ]
                }
              ]
            },
            "message": "960p/1080p 最长 15 秒"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.resolution"
                    },
                    "768p"
                  ]
                },
                {
                  "$ne": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "21:9"
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    20
                  ]
                }
              ]
            },
            "message": "768p 21:9 最长 20 秒"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                9
              ]
            },
            "message": "最多 9 张参考图"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "此 OpenAI 兼容入口仅开放参考图"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "image",
                      "where": {
                        "$and": [
                          {
                            "$ne": [
                              {
                                "$ref": "image.role"
                              },
                              "reference_image"
                            ]
                          },
                          {
                            "$ne": [
                              {
                                "$ref": "image.role"
                              },
                              ""
                            ]
                          },
                          {
                            "$ne": [
                              {
                                "$ref": "image.role"
                              },
                              null
                            ]
                          }
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "h3-video 只接受普通参考图；首尾帧需使用未接入的 frames 型号"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "multipart/form-data",
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
            "size": {
              "$switch": {
                "cases": [
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "request.resolution"
                        },
                        "480p"
                      ]
                    },
                    "then": {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "16:9"
                              ]
                            },
                            "then": "854x480"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "9:16"
                              ]
                            },
                            "then": "480x854"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "21:9"
                              ]
                            },
                            "then": "1120x480"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "4:3"
                              ]
                            },
                            "then": "640x480"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "1:1"
                              ]
                            },
                            "then": "480x480"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "3:4"
                              ]
                            },
                            "then": "480x640"
                          }
                        ],
                        "default": null
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "request.resolution"
                        },
                        "720p"
                      ]
                    },
                    "then": {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "16:9"
                              ]
                            },
                            "then": "1280x720"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "9:16"
                              ]
                            },
                            "then": "720x1280"
                          }
                        ],
                        "default": null
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "request.resolution"
                        },
                        "768p"
                      ]
                    },
                    "then": {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "16:9"
                              ]
                            },
                            "then": "1366x768"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "9:16"
                              ]
                            },
                            "then": "768x1366"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "21:9"
                              ]
                            },
                            "then": "1792x768"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "4:3"
                              ]
                            },
                            "then": "1024x768"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "1:1"
                              ]
                            },
                            "then": "768x768"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "3:4"
                              ]
                            },
                            "then": "768x1024"
                          }
                        ],
                        "default": null
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "request.resolution"
                        },
                        "960p"
                      ]
                    },
                    "then": {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "16:9"
                              ]
                            },
                            "then": "1707x960"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "9:16"
                              ]
                            },
                            "then": "960x1707"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "21:9"
                              ]
                            },
                            "then": "2240x960"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "4:3"
                              ]
                            },
                            "then": "1280x960"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "1:1"
                              ]
                            },
                            "then": "960x960"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "3:4"
                              ]
                            },
                            "then": "960x1280"
                          }
                        ],
                        "default": null
                      }
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "request.resolution"
                        },
                        "1080p"
                      ]
                    },
                    "then": {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "16:9"
                              ]
                            },
                            "then": "1920x1080"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "9:16"
                              ]
                            },
                            "then": "1080x1920"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "21:9"
                              ]
                            },
                            "then": "2520x1080"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "4:3"
                              ]
                            },
                            "then": "1440x1080"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "1:1"
                              ]
                            },
                            "then": "1080x1080"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.aspectRatio"
                                },
                                "3:4"
                              ]
                            },
                            "then": "1080x1440"
                          }
                        ],
                        "default": null
                      }
                    }
                  }
                ],
                "default": null
              }
            },
            "optimize_prompt": false
          },
          "files": [
            {
              "name": "input_reference",
              "source": {
                "$sortByOrder": {
                  "$ref": "request.images"
                }
              }
            }
          ]
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
                "$ref": "response.task_id"
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
              }
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.sparkcine.outputs.0.download_url"
              },
              {
                "$ref": "response.metadata.direct_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.url"
              }
            ]
          },
          "errorPaths": [
            "error.message",
            "error.code"
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
