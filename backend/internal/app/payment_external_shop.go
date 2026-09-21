package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const externalTopupShopSettingKey = "external_topup_shop"

type ExternalTopupShopSetting struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
}

func defaultExternalTopupShopSetting() ExternalTopupShopSetting {
	return ExternalTopupShopSetting{URL: "https://wzyp.cn/shop/69G55K8Q"}
}

func (s *Service) ExternalTopupShop(actor *model.User) (*ExternalTopupShopSetting, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	setting, err := s.readExternalTopupShop()
	if err != nil || !setting.Enabled {
		return nil, err
	}
	return &setting, nil
}

func (s *Service) AdminExternalTopupShop(actor *model.User) (*ExternalTopupShopSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, err := s.readExternalTopupShop()
	return &setting, err
}

func (s *Service) UpdateExternalTopupShop(actor *model.User, input ExternalTopupShopSetting) (*ExternalTopupShopSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	input.URL = strings.TrimSpace(input.URL)
	if err := validateExternalTopupShopURL(input.URL); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	current, err := s.repo.SystemSetting(externalTopupShopSettingKey)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	previous := defaultExternalTopupShopSetting()
	if current != nil {
		if err := json.Unmarshal([]byte(current.ValueJSON), &previous); err != nil {
			return nil, errors.New("外部充值链接配置无效")
		}
	}
	setting := &model.SystemSetting{Key: externalTopupShopSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_external_shop.update", "system_setting", externalTopupShopSettingKey, "更新链动小铺链接配置", map[string]any{
		"previousEnabled": previous.Enabled, "enabled": input.Enabled, "urlChanged": previous.URL != input.URL,
	}); err != nil {
		return nil, err
	}
	return &input, nil
}

func (s *Service) readExternalTopupShop() (ExternalTopupShopSetting, error) {
	setting, err := s.repo.SystemSetting(externalTopupShopSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultExternalTopupShopSetting(), nil
	}
	if err != nil {
		return ExternalTopupShopSetting{}, err
	}
	var value ExternalTopupShopSetting
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return ExternalTopupShopSetting{}, errors.New("外部充值链接配置无效")
	}
	if err := validateExternalTopupShopURL(value.URL); err != nil {
		return ExternalTopupShopSetting{}, err
	}
	return value, nil
}

func validateExternalTopupShopURL(raw string) error {
	parsed, err := url.Parse(raw)
	if len(raw) > 2048 || err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.Fragment != "" || strings.ContainsAny(raw, "\r\n\t") {
		return NewAppError(http.StatusBadRequest, "请输入有效的 HTTPS 店铺链接（不含账号信息或锚点）")
	}
	return nil
}
