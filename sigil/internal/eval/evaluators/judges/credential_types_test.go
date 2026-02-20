package judges

import (
	"fmt"
	"testing"

	cloudcredentials "cloud.google.com/go/auth/credentials"
	"golang.org/x/oauth2/google"
)

func TestOAuthCredentialsTypeFromJSONSupportedTypes(t *testing.T) {
	tests := []struct {
		name string
		want google.CredentialsType
	}{
		{name: "service_account", want: google.ServiceAccount},
		{name: "authorized_user", want: google.AuthorizedUser},
		{name: "external_account", want: google.ExternalAccount},
		{name: "external_account_authorized_user", want: google.ExternalAccountAuthorizedUser},
		{name: "impersonated_service_account", want: google.ImpersonatedServiceAccount},
		{name: "gdch_service_account", want: google.GDCHServiceAccount},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			payload := []byte(fmt.Sprintf(`{"type":%q}`, tc.want))
			got, err := oauthCredentialsTypeFromJSON(payload)
			if err != nil {
				t.Fatalf("oauthCredentialsTypeFromJSON error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("oauthCredentialsTypeFromJSON type=%q want %q", got, tc.want)
			}
		})
	}
}

func TestCloudCredentialsTypeFromJSONSupportedTypes(t *testing.T) {
	tests := []struct {
		name string
		want cloudcredentials.CredType
	}{
		{name: "service_account", want: cloudcredentials.ServiceAccount},
		{name: "authorized_user", want: cloudcredentials.AuthorizedUser},
		{name: "external_account", want: cloudcredentials.ExternalAccount},
		{name: "external_account_authorized_user", want: cloudcredentials.ExternalAccountAuthorizedUser},
		{name: "impersonated_service_account", want: cloudcredentials.ImpersonatedServiceAccount},
		{name: "gdch_service_account", want: cloudcredentials.GDCHServiceAccount},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			payload := []byte(fmt.Sprintf(`{"type":%q}`, tc.want))
			got, err := cloudCredentialsTypeFromJSON(payload)
			if err != nil {
				t.Fatalf("cloudCredentialsTypeFromJSON error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("cloudCredentialsTypeFromJSON type=%q want %q", got, tc.want)
			}
		})
	}
}
