package go_sms_sender

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Huyi's upstream client sends full text over HTTP without checking acceptance.
// Canvas uses the documented HTTPS template-variable API with the host transport.
func sendHuyiTemplate(ctx context.Context, client *HuyiClient, transport *singleSendTransport, params map[string]string, phone string) (SendResult, error) {
	result := SendResult{State: "unknown", Code: "acceptance_unknown"}
	if client.appId == "" || client.appKey == "" || strings.TrimSpace(client.template) == "" || len(params) == 0 || len(params) > 8 {
		return SendResult{State: "rejected", Code: "invalid_configuration"}, ErrSendRejected
	}
	values := make([]string, len(params))
	for i := range values {
		value, ok := params[strconv.Itoa(i)]
		if !ok || value == "" || strings.Contains(value, "|") {
			return SendResult{State: "rejected", Code: "invalid_configuration"}, ErrSendRejected
		}
		values[i] = value
	}
	form := url.Values{
		"account": {client.appId}, "password": {client.appKey},
		"mobile": {strings.TrimPrefix(phone, "+86")}, "templateid": {client.template},
		"content": {strings.Join(values, "|")},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.ihuyi.com/sms/Submit.json", strings.NewReader(form.Encode()))
	if err != nil {
		return result, ErrSendUnknown
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	transport.host = "api.ihuyi.com"
	response, err := transport.RoundTrip(req)
	if err != nil {
		return result, ErrSendUnknown
	}
	response.Body.Close()
	if transport.status < 200 || transport.status >= 300 {
		return result, ErrSendUnknown
	}
	var body struct {
		Code  *int   `json:"code"`
		SMSID string `json:"smsid"`
	}
	if json.Unmarshal(transport.body, &body) != nil || body.Code == nil {
		return result, ErrSendUnknown
	}
	if *body.Code != 2 {
		return SendResult{State: "rejected", Code: strconv.Itoa(*body.Code)}, ErrSendRejected
	}
	if body.SMSID == "" || body.SMSID == "0" {
		return result, ErrSendUnknown
	}
	return SendResult{State: "accepted", MessageID: body.SMSID}, nil
}
