// Package channelsync validates upstream snapshots and prepares atomic channel changes.
package channelsync

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

func NextMidnight(now time.Time) time.Time {
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	local := now.In(zone)
	return time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, zone).UTC()
}

type Catalog struct {
	Code *int `json:"code"`
	Data struct {
		Groups []Group `json:"groups"`
	} `json:"data"`
}
type Group struct {
	ID                   int             `json:"id"`
	Name                 string          `json:"name"`
	RateMultiplier       json.Number     `json:"rate_multiplier"`
	PeakRateEnabled      bool            `json:"peak_rate_enabled"`
	ImageRateIndependent bool            `json:"image_rate_independent"`
	ImageRateMultiplier  json.Number     `json:"image_rate_multiplier"`
	VideoRateIndependent bool            `json:"video_rate_independent"`
	VideoRateMultiplier  json.Number     `json:"video_rate_multiplier"`
	Models               []UpstreamModel `json:"models"`
}
type UpstreamModel struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	TimePricing json.RawMessage `json:"time_pricing"`
	Pricing     struct {
		BillingMode     string      `json:"billing_mode"`
		PerRequestPrice json.Number `json:"per_request_price"`
		Intervals       []struct {
			Label     string      `json:"tier_label"`
			MinTokens int64       `json:"min_tokens"`
			MaxTokens *int64      `json:"max_tokens"`
			Price     json.Number `json:"per_request_price"`
		} `json:"intervals"`
	} `json:"pricing"`
}
type Plan struct {
	Models  []model.ChannelModel
	NewKeys []string
	Summary Summary
}
type Summary struct {
	Authorized   int      `json:"authorized"`
	Added        int      `json:"added"`
	Disabled     int      `json:"disabled"`
	Prices       int      `json:"prices"`
	Descriptions int      `json:"descriptions"`
	Warnings     []string `json:"warnings"`
}

func SelectGroup(catalog Catalog, id int) (*Group, error) {
	if catalog.Code == nil || *catalog.Code != 0 {
		return nil, fmt.Errorf("上游价格目录返回失败")
	}
	var selected *Group
	for i := range catalog.Data.Groups {
		if catalog.Data.Groups[i].ID == id {
			if selected != nil {
				return nil, fmt.Errorf("上游价格分组重复")
			}
			selected = &catalog.Data.Groups[i]
		}
	}
	if selected == nil || len(selected.Models) == 0 {
		return nil, fmt.Errorf("上游价格分组不存在或为空")
	}
	if selected.RateMultiplier != "1" || selected.PeakRateEnabled ||
		(selected.ImageRateIndependent && selected.ImageRateMultiplier != "1") ||
		(selected.VideoRateIndependent && selected.VideoRateMultiplier != "1") {
		return nil, fmt.Errorf("上游分组倍率或峰时计费已变化，需要人工复核")
	}
	return selected, nil
}

func Build(existing []model.ChannelModel, authorized []string, retired map[string]bool, group *Group, prices, importNew bool) (*Plan, error) {
	available := map[string]bool{}
	for _, key := range authorized {
		key = strings.TrimSpace(key)
		if key == "" || available[key] {
			return nil, fmt.Errorf("上游授权目录包含空值或重复型号")
		}
		available[key] = true
	}
	if len(available) == 0 {
		return nil, fmt.Errorf("上游授权目录为空，保留本地配置")
	}
	upstream := map[string]UpstreamModel{}
	if group != nil {
		for _, item := range group.Models {
			if item.Name == "" {
				return nil, fmt.Errorf("上游价格目录包含空型号")
			}
			if _, ok := upstream[item.Name]; ok {
				return nil, fmt.Errorf("上游价格目录包含重复型号")
			}
			upstream[item.Name] = item
		}
	}
	plan := &Plan{Summary: Summary{Authorized: len(available), Warnings: []string{}}}
	known := map[string]bool{}
	for _, original := range existing {
		item := original
		item.PriceTiers = append([]model.ChannelModelPriceTier(nil), original.PriceTiers...)
		known[item.ModelKey] = true
		if item.ProviderModelKey != "" {
			known[item.ProviderModelKey] = true
		}
		for _, tier := range item.PriceTiers {
			if tier.ProviderModelKey != "" {
				known[tier.ProviderModelKey] = true
			}
		}
		key := item.ProviderModelKey
		if key == "" {
			key = item.ModelKey
		}
		usable := available[key]
		for _, tier := range item.PriceTiers {
			if available[tier.ProviderModelKey] {
				usable = true
			}
		}
		changed := false
		if !usable && item.Enabled {
			item.Enabled = false
			plan.Summary.Disabled++
			changed = true
		}
		if source, ok := upstream[key]; ok && source.Description != "" {
			description := []rune(source.Description)
			if len(description) > 500 {
				description = description[:500]
			}
			if item.Description != string(description) {
				item.Description = string(description)
				changed = true
				plan.Summary.Descriptions++
			}
		}
		modelPricesChanged := false
		if prices {
			for i := range item.PriceTiers {
				tier := &item.PriceTiers[i]
				if !tier.Enabled || !tier.PriceConfigured {
					continue
				}
				sku := tier.ProviderModelKey
				if sku == "" {
					sku = key
				}
				source, ok := upstream[sku]
				if !ok {
					plan.Summary.Warnings = append(plan.Summary.Warnings, sku+"：上游未提供价格，保留原价")
					continue
				}
				cost, err := TierCost(source, *tier)
				if err != nil {
					return nil, fmt.Errorf("%s：%w", sku, err)
				}
				sale, err := PreserveRatio(cost, tier.CostPricing.UnitPriceMicrocredits, tier.UnitPriceMicrocredits, tier.CostPricing.Configured)
				if err != nil {
					return nil, fmt.Errorf("%s：%w", sku, err)
				}
				if cost != tier.CostPricing.UnitPriceMicrocredits || sale != tier.UnitPriceMicrocredits {
					tier.CostPricing.UnitPriceMicrocredits = cost
					tier.UnitPriceMicrocredits = sale
					changed = true
					modelPricesChanged = true
					plan.Summary.Prices++
				}
			}
			if modelPricesChanged && len(item.PriceTiers) > 0 {
				item.UnitPriceMicrocredits = item.PriceTiers[0].UnitPriceMicrocredits
			}
		}
		if changed {
			plan.Models = append(plan.Models, item)
		}
	}
	if importNew {
		for _, key := range authorized {
			if known[key] || retired[strings.ToLower(strings.TrimSpace(key))] {
				continue
			}
			if group != nil {
				if _, ok := upstream[key]; !ok {
					continue
				}
			}
			plan.NewKeys = append(plan.NewKeys, key)
		}
	}
	plan.Summary.Added = len(plan.NewKeys)
	return plan, nil
}

func Microcredits(value json.Number) (int64, error) {
	amount, ok := new(big.Rat).SetString(string(value))
	if !ok || amount.Sign() < 0 {
		return 0, fmt.Errorf("上游成本缺失或无效")
	}
	amount.Mul(amount, big.NewRat(1000000, 1))
	if !amount.IsInt() || !amount.Num().IsInt64() {
		return 0, fmt.Errorf("上游成本超出微积分精度或范围")
	}
	return amount.Num().Int64(), nil
}

func PreserveRatio(cost, oldCost, oldSale int64, configured bool) (int64, error) {
	if !configured || oldCost < 0 || oldSale < 0 {
		return 0, fmt.Errorf("本地成本未配置，不能推断利润比例")
	}
	if oldCost == 0 {
		if cost == 0 {
			return oldSale, nil
		}
		return 0, fmt.Errorf("免费成本变为收费，需要人工定价")
	}
	numerator := new(big.Int).Mul(big.NewInt(cost), big.NewInt(oldSale))
	numerator.Add(numerator, big.NewInt(oldCost-1))
	numerator.Div(numerator, big.NewInt(oldCost))
	if !numerator.IsInt64() {
		return 0, fmt.Errorf("售价超出范围")
	}
	return numerator.Int64(), nil
}

func TierCost(source UpstreamModel, tier model.ChannelModelPriceTier) (int64, error) {
	mode := map[string]string{"image": "fixed_request", "per_request": "fixed_request", "video": "per_second"}[source.Pricing.BillingMode]
	if mode == "" || tier.BillingMode != mode || len(source.TimePricing) > 0 && string(source.TimePricing) != "null" && string(source.TimePricing) != "false" {
		return 0, fmt.Errorf("计费方式已变化或包含动态计费，需要人工复核")
	}
	if tier.InputTokenPriceMicrocredits != 0 || tier.OutputTokenPriceMicrocredits != 0 || tier.CachedTokenPriceMicrocredits != 0 ||
		tier.CostPricing.InputTokenPriceMicrocredits != 0 || tier.CostPricing.OutputTokenPriceMicrocredits != 0 || tier.CostPricing.CachedTokenPriceMicrocredits != 0 {
		return 0, fmt.Errorf("该价格档包含 token 价格，需要人工复核")
	}
	var selector map[string]string
	if err := json.Unmarshal([]byte(tier.SelectorJSON), &selector); err != nil {
		return 0, fmt.Errorf("本地价格选择器无效")
	}
	quality := selector["quality"]
	if quality == "" {
		quality = selector["vquality"]
	}
	for key := range selector {
		if key != "quality" && key != "vquality" && key != "operation" {
			return 0, fmt.Errorf("价格选择器需要人工复核")
		}
	}
	if selector["quality"] != "" && selector["vquality"] != "" || tier.VideoSeconds != 0 {
		return 0, fmt.Errorf("价格选择器存在歧义")
	}
	if len(source.Pricing.Intervals) == 0 {
		return Microcredits(source.Pricing.PerRequestPrice)
	}
	var found *int64
	for _, interval := range source.Pricing.Intervals {
		if quality != "" && !strings.EqualFold(interval.Label, quality) {
			continue
		}
		if interval.MinTokens != 0 || interval.MaxTokens != nil {
			return 0, fmt.Errorf("上游价格档需要人工复核")
		}
		cost, err := Microcredits(interval.Price)
		if err != nil {
			return 0, err
		}
		if found != nil && (quality != "" || *found != cost) {
			return 0, fmt.Errorf("上游价格档存在歧义")
		}
		found = &cost
	}
	if found == nil {
		return 0, fmt.Errorf("上游缺少对应规格报价")
	}
	return *found, nil
}
