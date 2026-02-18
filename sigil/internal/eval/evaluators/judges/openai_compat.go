package judges

import "net/http"

type OpenAICompatClient struct {
	*openAICompatHTTPClient
}

func NewOpenAICompatClient(httpClient *http.Client, providerID, baseURL, apiKey string) *OpenAICompatClient {
	return &OpenAICompatClient{openAICompatHTTPClient: newOpenAICompatHTTPClient(httpClient, providerID, baseURL, apiKey)}
}
