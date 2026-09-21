package app

import (
	"encoding/json"
	"fmt"
	"sort"

	"infinite-canvas/backend/internal/repository"
)

const maxCloudAgentBindingRows = 20
const maxCloudAgentRowBindings = 16

var cloudAgentStoryboardAssetRoles = []string{"character", "environment", "wardrobe", "prop", "weapon", "style", "motion", "audio"}

type cloudAgentStoryboardAssetBinding struct {
	NodeID   string `json:"nodeId"`
	Role     string `json:"role"`
	Priority *int   `json:"priority"`
}

type cloudAgentStoryboardBindingsArgs struct {
	SnapshotHash string `json:"snapshotHash"`
	NodeID       string `json:"nodeId"`
	Mode         string `json:"mode"`
	Rows         []struct {
		RowID         string                              `json:"rowId"`
		AssetBindings *[]cloudAgentStoryboardAssetBinding `json:"assetBindings"`
	} `json:"rows"`
}

func cloudAgentStoryboardBindingsSchema() map[string]any {
	binding := map[string]any{"type": "object", "additionalProperties": false, "required": []string{"nodeId", "role", "priority"}, "properties": map[string]any{
		"nodeId":   map[string]any{"type": "string", "description": "当前画布内已保存且就绪的图片、视频或音频资产节点 ID"},
		"role":     map[string]any{"type": "string", "enum": cloudAgentStoryboardAssetRoles},
		"priority": map[string]any{"type": "integer", "minimum": 0, "maximum": 100},
	}}
	return map[string]any{"type": "array", "minItems": 1, "maxItems": maxCloudAgentBindingRows, "items": map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"rowId", "assetBindings"}, "properties": map[string]any{
			"rowId":         map[string]any{"type": "string", "description": "canvas_read_storyboard 返回的真实镜头行 ID，不使用镜头编号代替"},
			"assetBindings": map[string]any{"type": "array", "maxItems": maxCloudAgentRowBindings, "items": binding},
		},
	}}
}

func prepareCloudAgentStoryboardBindings(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentStoryboardMutationPlan, error) {
	var args cloudAgentStoryboardBindingsArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, storyboardArgumentError("关联资产")
	}
	if args.SnapshotHash == "" || (args.Mode != "merge" && args.Mode != "replace") || len(args.Rows) < 1 || len(args.Rows) > maxCloudAgentBindingRows {
		return nil, BadAuthRequest("关联资产需要最新快照、merge 或 replace 模式，以及 1 到 20 个镜头行")
	}
	if err := validateCloudAgentID(args.NodeID, "分镜节点ID", 80); err != nil {
		return nil, err
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	beforeHash := cloudAgentCanvasHash(doc)
	if beforeHash != args.SnapshotHash {
		return nil, creationConflict("画布已变化，本次未关联资产；请重新读取分镜")
	}
	node, _, rows, err := storyboardNodeFromDocument(doc, args.NodeID)
	if err != nil {
		return nil, err
	}
	descriptor, supported := cloudAgentNodeCapabilityForType(stringValue(node["type"]))
	if !supported || !cloudAgentContainsString(descriptor.Actions, "bind_row_assets") {
		return nil, BadAuthRequest("当前节点能力不支持镜头级资产关联")
	}
	meta, _ := node["metadata"].(map[string]any)
	if node["locked"] == true || meta["locked"] == true {
		return nil, BadAuthRequest("分镜节点已锁定，不能修改资产关联")
	}
	allNodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, err
	}
	byID := map[string]map[string]any{}
	for _, row := range rows {
		byID[stringValue(row["id"])] = row
	}
	seenRows := map[string]bool{}
	items := []cloudAgentApprovalPreviewItem{}
	for _, update := range args.Rows {
		row := byID[update.RowID]
		if row == nil || seenRows[update.RowID] {
			return nil, BadAuthRequest("镜头行不存在或重复，请先读取真实 rowId")
		}
		seenRows[update.RowID] = true
		if update.AssetBindings == nil || len(*update.AssetBindings) > maxCloudAgentRowBindings || (args.Mode == "merge" && len(*update.AssetBindings) == 0) {
			return nil, BadAuthRequest("每个镜头必须提供资产关联数组，最多 16 项；merge 模式至少一项")
		}
		bindings := []cloudAgentStoryboardAssetBinding{}
		if args.Mode == "merge" && row["assetBindings"] != nil {
			raw, err := json.Marshal(row["assetBindings"])
			if err != nil || json.Unmarshal(raw, &bindings) != nil {
				return nil, BadAuthRequest("镜头已有资产关联格式无效，请显式替换修复")
			}
		}
		positions := map[string]int{}
		for index, binding := range bindings {
			if _, exists := positions[binding.NodeID]; exists {
				return nil, BadAuthRequest("镜头已有重复资产关联，请显式替换修复")
			}
			positions[binding.NodeID] = index
		}
		seenBindings := map[string]bool{}
		for _, binding := range *update.AssetBindings {
			if seenBindings[binding.NodeID] {
				return nil, BadAuthRequest("同一镜头不能重复指定资产节点")
			}
			seenBindings[binding.NodeID] = true
			if index, exists := positions[binding.NodeID]; exists {
				bindings[index] = binding
			} else {
				bindings = append(bindings, binding)
			}
		}
		if len(bindings) > maxCloudAgentRowBindings {
			return nil, BadAuthRequest("合并后每个镜头最多关联 16 项资产")
		}
		for _, binding := range bindings {
			if err := validateCloudAgentID(binding.NodeID, "资产节点ID", 80); err != nil {
				return nil, err
			}
			if !cloudAgentContainsString(cloudAgentStoryboardAssetRoles, binding.Role) || binding.Priority == nil || *binding.Priority < 0 || *binding.Priority > 100 {
				return nil, BadAuthRequest("资产角色无效，或 priority 不是 0 到 100 的整数")
			}
			asset := allNodes[binding.NodeID]
			if asset == nil || binding.NodeID == args.NodeID {
				return nil, BadAuthRequest("关联资产必须是当前画布中的媒体节点")
			}
			if _, _, err := cloudAgentReference(repo, userID, asset); err != nil {
				return nil, err
			}
		}
		sort.SliceStable(bindings, func(i, j int) bool { return *bindings[i].Priority > *bindings[j].Priority })
		next, details := []any{}, []string{}
		for _, binding := range bindings {
			next = append(next, map[string]any{"nodeId": binding.NodeID, "role": binding.Role, "priority": *binding.Priority})
			roleLabel := map[string]string{"character": "角色", "environment": "场景", "wardrobe": "服装", "prop": "道具", "weapon": "武器", "style": "风格", "motion": "动作", "audio": "音频"}[binding.Role]
			details = append(details, fmt.Sprintf("《%s》：%s，优先级 %d", truncateRunes(stringValue(allNodes[binding.NodeID]["title"]), 120), roleLabel, *binding.Priority))
		}
		row["assetBindings"] = next
		items = append(items, cloudAgentApprovalPreviewItem{Operation: "edit_storyboard", NodeID: args.NodeID, NodeTitle: stringValue(node["title"]), NodeType: "script", NodeTypeLabel: "分镜脚本", Fields: []string{fmt.Sprintf("第 %v 镜头的资产关联", row["shotNumber"])}, Details: details, Summary: fmt.Sprintf("分镜《%s》第 %v 镜头关联 %d 项资产", stringValue(node["title"]), row["shotNumber"], len(bindings))})
	}
	return &cloudAgentStoryboardMutationPlan{Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: beforeHash, Preview: cloudAgentApprovalPreview{Kind: "canvas_mutation", Title: "确认关联分镜资产", Description: fmt.Sprintf("准备更新 %d 个镜头的资产关联，批准后写入分镜表，不提交生成任务。", len(items)), Items: items}}, nil
}
