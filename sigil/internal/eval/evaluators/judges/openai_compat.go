package judges

import "net/http"

type OpenAICompatClient struct {
	*openAICompatHTTPClient
}

func NewOpenAICompatClient(httpClient *http.Client, baseURL, apiKey string) *OpenAICompatClient {
	return &OpenAICompatClient{openAICompatHTTPClient: newOpenAICompatHTTPClient(httpClient, baseURL, apiKey)}
}
