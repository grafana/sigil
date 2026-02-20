package judges

import (
	"encoding/json"
	"fmt"
	"strings"

	cloudcredentials "cloud.google.com/go/auth/credentials"
	"golang.org/x/oauth2/google"
)

type credentialsTypeEnvelope struct {
	Type string `json:"type"`
}

func oauthCredentialsTypeFromJSON(payload []byte) (google.CredentialsType, error) {
	credentialType, err := credentialsTypeFromJSON(payload)
	if err != nil {
		return "", err
	}

	switch credentialType {
	case string(google.ServiceAccount):
		return google.ServiceAccount, nil
	case string(google.AuthorizedUser):
		return google.AuthorizedUser, nil
	case string(google.ExternalAccount):
		return google.ExternalAccount, nil
	case string(google.ExternalAccountAuthorizedUser):
		return google.ExternalAccountAuthorizedUser, nil
	case string(google.ImpersonatedServiceAccount):
		return google.ImpersonatedServiceAccount, nil
	case string(google.GDCHServiceAccount):
		return google.GDCHServiceAccount, nil
	default:
		return "", fmt.Errorf("unsupported oauth credential type %q", credentialType)
	}
}

func cloudCredentialsTypeFromJSON(payload []byte) (cloudcredentials.CredType, error) {
	credentialType, err := credentialsTypeFromJSON(payload)
	if err != nil {
		return "", err
	}

	switch credentialType {
	case string(cloudcredentials.ServiceAccount):
		return cloudcredentials.ServiceAccount, nil
	case string(cloudcredentials.AuthorizedUser):
		return cloudcredentials.AuthorizedUser, nil
	case string(cloudcredentials.ExternalAccount):
		return cloudcredentials.ExternalAccount, nil
	case string(cloudcredentials.ExternalAccountAuthorizedUser):
		return cloudcredentials.ExternalAccountAuthorizedUser, nil
	case string(cloudcredentials.ImpersonatedServiceAccount):
		return cloudcredentials.ImpersonatedServiceAccount, nil
	case string(cloudcredentials.GDCHServiceAccount):
		return cloudcredentials.GDCHServiceAccount, nil
	default:
		return "", fmt.Errorf("unsupported cloud credential type %q", credentialType)
	}
}

func credentialsTypeFromJSON(payload []byte) (string, error) {
	var envelope credentialsTypeEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return "", err
	}

	credentialType := strings.TrimSpace(envelope.Type)
	if credentialType == "" {
		return "", fmt.Errorf("credentials json is missing type")
	}
	return credentialType, nil
}
