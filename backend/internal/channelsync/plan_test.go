package channelsync

import (
	"encoding/json"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestNextMidnightUsesShanghaiAcrossYear(t *testing.T) {
	now := time.Date(2026, 12, 31, 16, 0, 0, 0, time.UTC)
	want := time.Date(2027, 1, 1, 16, 0, 0, 0, time.UTC)
	if got := NextMidnight(now); !got.Equal(want) {
		t.Fatalf("next midnight = %s, want %s", got, want)
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

func TestBuildRetainsManualDisableAndRetiredModels(t *testing.T) {
	items := []model.ChannelModel{{ModelKey: "enabled", Enabled: true}, {ModelKey: "manual", Enabled: false}}
	plan, err := Build(items, []string{"manual", "new", "retired"}, map[string]bool{"retired": true}, nil, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Models) != 1 || plan.Models[0].ModelKey != "enabled" || plan.Models[0].Enabled || len(plan.NewKeys) != 1 || plan.NewKeys[0] != "new" {
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
	items := []model.ChannelModel{{ModelKey: "image", ProviderModelKey: "image", PriceTiers: []model.ChannelModelPriceTier{tier}}}
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
