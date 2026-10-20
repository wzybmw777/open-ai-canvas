package channelsync

import (
	"regexp"
	"strings"
)

// Public descriptions contain capabilities; upstream monetary quotes belong in pricing fields.
var descriptionPrice = regexp.MustCompile(`(?i)(?:(?:直连价?|价格|售价|成本|单价|仅需|低至)\s*[:：]?\s*)?(?:[¥￥$]\s*[0-9]+(?:\.[0-9]+)?|(?:USD|CNY|RMB|人民币)\s*[0-9]+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?\s*(?:美元|美金|人民币|元|USD|CNY|RMB))\s*(?:[/／]\s*(?:requests?|seconds?|images?|videos?|tokens?|次|秒|条|张|个|分钟))?`)

func descriptionWithoutPrices(description string) string {
	if !descriptionPrice.MatchString(description) {
		return description
	}
	parts := strings.FieldsFunc(descriptionPrice.ReplaceAllString(description, ""), func(r rune) bool {
		return r == '|' || r == '｜'
	})
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			cleaned = append(cleaned, part)
		}
	}
	return strings.Join(cleaned, " | ")
}
