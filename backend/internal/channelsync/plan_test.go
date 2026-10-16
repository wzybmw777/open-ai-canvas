package channelsync

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestNextRunAtUsesHalfHourBoundaries(t *testing.T) {
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	for _, tc := range []struct{ now, want time.Time }{
		{time.Date(2026, 10, 16, 9, 12, 5, 0, zone), time.Date(2026, 10, 16, 9, 30, 0, 0, zone)},
		{time.Date(2026, 10, 16, 9, 30, 0, 0, zone), time.Date(2026, 10, 16, 10, 0, 0, 0, zone)},
		{time.Date(2026, 12, 31, 23, 59, 59, 0, zone), time.Date(2027, 1, 1, 0, 0, 0, 0, zone)},
	} {
		if got := NextRunAt(tc.now); !got.Equal(tc.want) || got.Location() != time.UTC {
			t.Fatalf("next run for %s = %s, want %s in UTC", tc.now, got, tc.want)
		}
	}
}

func TestMicrocreditsAndProfitRatio(t *testing.T) {
	for _, tc := range []struct {
		value json.Number
		want  int64
	}{{"0.000001", 1}, {"1.65", 1650000}, {"1e-6", 1}, {"0", 0}} {
		got, err := Microcredits(tc.value)
		if err != nil || got != tc.want {
			t.Fatalf("%s = %d, %v", tc.value, got, err)
		}
	}
	for _, value := range []json.Number{"-1", "null", "0.0000001", "1e30"} {
		if _, err := Microcredits(value); err == nil {
			t.Fatalf("accepted %s", value)
		}
	}
	for _, tc := range []struct{ cost, oldCost, oldSale, want int64 }{{8, 4, 5, 10}, {8, 5, 6, 10}, {0, 0, 0, 0}, {0, 0, 8, 8}} {
		got, err := PreserveRatio(tc.cost, tc.oldCost, tc.oldSale, true)
		if err != nil || got != tc.want {
			t.Fatalf("ratio = %d, %v", got, err)
		}
	}
	if _, err := PreserveRatio(1, 0, 0, true); err == nil {
		t.Fatal("free-to-paid must require review")
	}
	if _, err := PreserveRatio(1, 1, 2, false); err == nil {
		t.Fatal("unconfigured cost must fail")
	}
}

func TestChannelCostUsesSelectedGroupQuoteInsteadOfOfficialOrDescriptionPrice(t *testing.T) {
	var catalog Catalog
	if err := json.Unmarshal([]byte(`{"code":0,"data":{"groups":[{"id":1,"rate_multiplier":1,"models":[{"name":"seedance","pricing":{"billing_mode":"video","per_request_price":0.25}}]},{"id":95,"rate_multiplier":1,"models":[{"name":"seedance","description":"直连 0.25 元/秒","official_pricing":{"per_request_price":0.25},"pricing":{"billing_mode":"video","intervals":[{"tier_label":"720p","per_request_price":0.35}]}}]}]}}`), &catalog); err != nil {
		t.Fatal(err)
	}
	group, err := SelectGroup(catalog, 95)
	if err != nil {
		t.Fatal(err)
	}
	item := model.ChannelModel{ModelKey: "seedance", PriceTiers: []model.ChannelModelPriceTier{{
		SelectorJSON: `{"vquality":"720p"}`, BillingMode: "per_second", Enabled: true, PriceConfigured: true,
		UnitPriceMicrocredits: 375000, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 300000},
	}}}
	plan, err := Build([]model.ChannelModel{item}, []string{"seedance"}, nil, group, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Models) != 1 || plan.Summary.Enabled != 1 {
		t.Fatalf("plan = %#v", plan)
	}
	tier := plan.Models[0].PriceTiers[0]
	if tier.CostPricing.UnitPriceMicrocredits != 350000 || tier.UnitPriceMicrocredits != 437500 {
		t.Fatalf("incorrect channel cost or sale ratio: %#v", tier)
	}
}

func TestBuildReactivatesConfiguredTiersAndSkipsRetiredImports(t *testing.T) {
	items := []model.ChannelModel{{ModelKey: "enabled", Enabled: true}, {ModelKey: "manual", Enabled: false, PriceTiers: []model.ChannelModelPriceTier{{ProviderModelKey: "manual", Enabled: true, PriceConfigured: true}}}}
	plan, err := Build(items, []string{"manual", "new", "retired"}, map[string]bool{"retired": true}, nil, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Models) != 2 || plan.Models[0].ModelKey != "enabled" || plan.Models[0].Enabled || !plan.Models[1].Enabled || plan.Summary.Enabled != 1 || len(plan.NewKeys) != 1 || plan.NewKeys[0] != "new" {
		t.Fatalf("plan = %#v", plan)
	}
	if _, err := Build(items, nil, nil, nil, false, true); err == nil {
		t.Fatal("empty upstream must preserve all local models")
	}
}

func TestTierPricesValidateQualityAndKeepOriginalSnapshot(t *testing.T) {
	var group Group
	if err := json.Unmarshal([]byte(`{"id":83,"rate_multiplier":1,"models":[{"name":"image-2k","pricing":{"billing_mode":"image","per_request_price":0.1,"intervals":[]}}]}`), &group); err != nil {
		t.Fatal(err)
	}
	tier := model.ChannelModelPriceTier{ID: "tier", ProviderModelKey: "image-2k", SelectorJSON: `{"quality":"2k"}`, BillingMode: "fixed_request", Enabled: true, PriceConfigured: true, UnitPriceMicrocredits: 50000, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 40000}}
	items := []model.ChannelModel{{ModelKey: "image", ProviderModelKey: "image", Enabled: true, PriceTiers: []model.ChannelModelPriceTier{tier}}}
	plan, err := Build(items, []string{"image-2k"}, nil, &group, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Models) != 1 || plan.Models[0].PriceTiers[0].UnitPriceMicrocredits != 125000 || items[0].PriceTiers[0].UnitPriceMicrocredits != 50000 {
		t.Fatalf("plan = %#v", plan)
	}
	group.Models[0].Pricing.BillingMode = "video"
	if _, err := Build(items, []string{"image-2k"}, nil, &group, true, false); err == nil {
		t.Fatal("billing mode change must reject plan")
	}
}

func TestSelectGroupRejectsChangedMultiplier(t *testing.T) {
	zero := 0
	catalog := Catalog{Code: &zero}
	catalog.Data.Groups = []Group{{ID: 1, RateMultiplier: "1.2", Models: []UpstreamModel{{Name: "a"}}}}
	if _, err := SelectGroup(catalog, 1); err == nil {
		t.Fatal("changed rate accepted")
	}
	catalog.Data.Groups[0].RateMultiplier = "1"
	if _, err := SelectGroup(catalog, 1); err != nil {
		t.Fatal(err)
	}
}

func TestBuildDisablesModelsMissingUpstreamPrice(t *testing.T) {
	var group Group
	if err := json.Unmarshal([]byte(`{"models":[{"name":"priced","pricing":{"billing_mode":"image","per_request_price":0}}]}`), &group); err != nil {
		t.Fatal(err)
	}
	tier := model.ChannelModelPriceTier{SelectorJSON: `{}`, BillingMode: "fixed_request", Enabled: true, PriceConfigured: true, UnitPriceMicrocredits: 5, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 4}}
	priced := tier
	priced.ProviderModelKey = "priced"
	items := []model.ChannelModel{
		{ModelKey: "gpt-image-2-adobe", Enabled: true, PriceTiers: []model.ChannelModelPriceTier{tier, tier}},
		{ModelKey: "gpt-image-2.5-adobe", Enabled: true, PriceTiers: []model.ChannelModelPriceTier{priced, tier}},
		{ModelKey: "priced", Enabled: true, PriceTiers: []model.ChannelModelPriceTier{priced}},
		{ModelKey: "manual", Enabled: false, PriceTiers: []model.ChannelModelPriceTier{tier}},
	}
	plan, err := Build(items, []string{"gpt-image-2-adobe", "gpt-image-2.5-adobe", "priced", "manual"}, nil, &group, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Models) != 3 || plan.Summary.Disabled != 2 || plan.Summary.Prices != 1 || len(plan.Summary.Warnings) != 3 {
		t.Fatalf("unexpected plan: %#v", plan)
	}
	for i := 0; i < 2; i++ {
		if plan.Models[i].Enabled || !items[i].Enabled || plan.Models[i].PriceTiers[0].UnitPriceMicrocredits != 5 {
			t.Fatalf("missing price should disable without changing stored prices or snapshot: %#v", plan.Models[i])
		}
		if plan.Summary.Warnings[i] != items[i].ModelKey+"：上游未提供价格，相关模型已停用" {
			t.Fatal(plan.Summary.Warnings[i])
		}
	}
	if !plan.Models[2].Enabled || plan.Models[2].PriceTiers[0].UnitPriceMicrocredits != 0 {
		t.Fatal("explicit zero price must remain available")
	}
}

func TestBuildRestoresOnlyFullyPricedAndAuthorizedModels(t *testing.T) {
	for _, tc := range []struct {
		name, source                          string
		authorized                            bool
		prices                                bool
		wantEnabled, wantPrices, wantWarnings int
		wantSale                              int64
	}{
		{"restored price", `{"name":"video","pricing":{"billing_mode":"per_request","per_request_price":0.000008}}`, true, true, 1, 1, 0, 10},
		{"unchanged price", `{"name":"video","pricing":{"billing_mode":"per_request","per_request_price":0.000004}}`, true, true, 1, 0, 0, 5},
		{"explicit zero", `{"name":"video","pricing":{"billing_mode":"per_request","per_request_price":0}}`, true, true, 1, 1, 0, 0},
		{"null price", `{"name":"video","pricing":{"billing_mode":"per_request","per_request_price":null}}`, true, true, 0, 0, 1, 5},
		{"omitted price", `{"name":"video","pricing":{"billing_mode":"per_request"}}`, true, true, 0, 0, 1, 5},
		{"omitted pricing", `{"name":"video"}`, true, true, 0, 0, 1, 5},
		{"missing SKU", `{"name":"other"}`, true, true, 0, 0, 1, 5},
		{"missing authorization", `{"name":"video","pricing":{"billing_mode":"per_request","per_request_price":0.000008}}`, false, true, 0, 0, 0, 5},
		{"price updates disabled", `{"name":"video","pricing":{"billing_mode":"per_request","per_request_price":0.000008}}`, true, false, 1, 0, 0, 5},
		{"missing price with updates disabled", `{"name":"video","pricing":{"billing_mode":"per_request","per_request_price":null}}`, true, false, 0, 0, 1, 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var source UpstreamModel
			if err := json.Unmarshal([]byte(tc.source), &source); err != nil {
				t.Fatal(err)
			}
			original := model.ChannelModel{ModelKey: "video", PriceTiers: []model.ChannelModelPriceTier{{
				SelectorJSON: `{}`, BillingMode: "fixed_request", Enabled: true, PriceConfigured: true,
				UnitPriceMicrocredits: 5, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 4},
			}}}
			keys := []string{"other"}
			if tc.authorized {
				keys = append(keys, "video")
			}
			plan, err := Build([]model.ChannelModel{original}, keys, nil, &Group{Models: []UpstreamModel{source}}, tc.prices, false)
			if err != nil {
				t.Fatal(err)
			}
			if plan.Summary.Enabled != tc.wantEnabled || plan.Summary.Prices != tc.wantPrices || len(plan.Summary.Warnings) != tc.wantWarnings {
				t.Fatalf("summary = %#v", plan.Summary)
			}
			if tc.wantEnabled == 1 {
				if len(plan.Models) != 1 || !plan.Models[0].Enabled || plan.Models[0].PriceTiers[0].UnitPriceMicrocredits != tc.wantSale {
					t.Fatalf("models = %#v", plan.Models)
				}
			} else if len(plan.Models) != 0 {
				t.Fatalf("unexpected changes: %#v", plan.Models)
			}
			if original.Enabled || original.PriceTiers[0].UnitPriceMicrocredits != 5 {
				t.Fatal("original snapshot changed")
			}
		})
	}
}

func TestBuildRequiresAllActiveSKUsAndKeepsUnconfiguredImportsDisabled(t *testing.T) {
	var group Group
	if err := json.Unmarshal([]byte(`{"models":[{"name":"video","pricing":{"billing_mode":"video","intervals":[{"tier_label":"720p","per_request_price":0.1}]}}]}`), &group); err != nil {
		t.Fatal(err)
	}
	item := model.ChannelModel{ModelKey: "video", PriceTiers: []model.ChannelModelPriceTier{{
		ProviderModelKey: "video", SelectorJSON: `{"vquality":"1080p"}`, BillingMode: "per_second", Enabled: true, PriceConfigured: true,
		UnitPriceMicrocredits: 5, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 4},
	}}}
	for _, enabled := range []bool{false, true} {
		item.Enabled = enabled
		plan, err := Build([]model.ChannelModel{item}, []string{"video"}, nil, &group, true, false)
		if err != nil {
			t.Fatal(err)
		}
		if plan.Summary.Enabled != 0 || len(plan.Summary.Warnings) != 1 || plan.Summary.Prices != 0 {
			t.Fatalf("summary = %#v", plan.Summary)
		}
		if enabled && (len(plan.Models) != 1 || plan.Models[0].Enabled || plan.Summary.Disabled != 1) {
			t.Fatalf("missing resolution was not disabled: %#v", plan)
		}
	}
	plan, err := Build([]model.ChannelModel{{ModelKey: "video"}}, []string{"video", "new"}, nil, &group, true, true)
	if err != nil || len(plan.Models) != 0 || plan.Summary.Enabled != 0 || len(plan.NewKeys) != 0 {
		t.Fatalf("unconfigured model activated: %#v, %v", plan, err)
	}
	item.PriceTiers[0].SelectorJSON = `{"vquality":"720p"}`
	item.PriceTiers = append(item.PriceTiers, model.ChannelModelPriceTier{ProviderModelKey: "other", Enabled: true, PriceConfigured: true})
	plan, err = Build([]model.ChannelModel{item}, []string{"video"}, nil, &group, true, false)
	if err != nil || plan.Summary.Enabled != 0 || len(plan.Models) != 1 || plan.Models[0].Enabled {
		t.Fatalf("partially authorized model activated: %#v, %v", plan, err)
	}
}

func TestSelectGroupRejectsMissingOrEmptyWithSpecificError(t *testing.T) {
	zero := 0
	for _, groups := range []([]Group){nil, {{ID: 7}}} {
		catalog := Catalog{Code: &zero}
		catalog.Data.Groups = groups
		if _, err := SelectGroup(catalog, 7); !errors.Is(err, ErrPriceGroupUnavailable) {
			t.Fatalf("error = %v, want price group unavailable", err)
		}
	}
}

func TestBuildPreservesSplitOptionDescriptionsAndSyncsPrices(t *testing.T) {
	var group Group
	if err := json.Unmarshal([]byte(`{"models":[{"name":"h3-video","description":"4–30 秒；高清最长 15 秒","pricing":{"billing_mode":"video","intervals":[{"tier_label":"768p","min_tokens":0,"max_tokens":null,"per_request_price":0.02},{"tier_label":"1080p","min_tokens":0,"max_tokens":null,"per_request_price":0.2}]}},{"name":"single","description":"updated"}]}`), &group); err != nil {
		t.Fatal(err)
	}
	items := []model.ChannelModel{
		{ModelKey: "h3-video", ProviderModelKey: "h3-video", Enabled: true, Description: "4–30 秒"},
		{ModelKey: "h3-video-hd", ProviderModelKey: "h3-video", Enabled: true, Description: "4–15 秒"},
		{ModelKey: "h3-empty", ProviderModelKey: "h3-video", Enabled: true},
		{ModelKey: "single", Enabled: true, Description: "old"},
	}
	for i, resolution := range []string{"768p", "1080p"} {
		items[i].PriceTiers = []model.ChannelModelPriceTier{{
			SelectorJSON: `{"vquality":"` + resolution + `"}`, BillingMode: "per_second", Enabled: true, PriceConfigured: true,
			UnitPriceMicrocredits: 18750, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 15000},
		}}
	}
	plan, err := Build(items, []string{"h3-video", "single"}, nil, &group, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Models) != 4 || plan.Summary.Descriptions != 2 || plan.Summary.Prices != 2 {
		t.Fatalf("unexpected plan: %#v", plan)
	}
	for i, want := range []int64{25000, 250000} {
		if plan.Models[i].Description != items[i].Description || plan.Models[i].PriceTiers[0].UnitPriceMicrocredits != want {
			t.Fatalf("split option changed description or missed price: %#v", plan.Models[i])
		}
	}
	if plan.Models[2].Description != group.Models[0].Description || plan.Models[3].Description != "updated" {
		t.Fatal("empty or unsplit descriptions must still sync")
	}
	if items[0].PriceTiers[0].UnitPriceMicrocredits != 18750 {
		t.Fatal("sync mutated the original snapshot")
	}
}
