---
title: Deploy Sigil on Grafana Cloud
menuTitle: Deploy to Cloud
description: Enable Grafana Sigil on your Grafana Cloud stack and start sending generation data.
keywords:
  - Sigil
  - Grafana Cloud
  - deployment
weight: 10
---

# Deploy Sigil on Grafana Cloud

{{< docs/public-preview product="Grafana Sigil" >}}

Grafana Cloud provides a managed Sigil deployment. You enable the plugin, configure your SDK to point at the Cloud endpoint, and start sending data.

## Before you begin

- A Grafana Cloud account. If you don't have one, [sign up at grafana.com](https://grafana.com/auth/sign-up/create-user).
- Administrator access to your Grafana Cloud stack.

## Enable the Sigil plugin

1. Sign in to Grafana Cloud as an administrator.
1. Navigate to **Administration** > **Plugins and data** > **Plugins**.
1. Search for **Grafana Sigil**.
1. Review and accept the terms.
1. Click **Save**.

After you enable the plugin, Sigil navigation items appear in the left sidebar.

## Get your endpoint credentials

1. In the Sigil plugin, navigate to **Configuration**.
1. Copy the generation export endpoint URL.
1. Create a Grafana Cloud API key with Sigil write permissions.
1. Note your Grafana Cloud instance ID.

## Configure your SDK

Point your SDK at the Cloud endpoint using basic auth. For example, in Python:

```python
from sigil_sdk import Client, ClientConfig
from sigil_sdk.config import GenerationExportConfig, AuthConfig

client = Client(
    ClientConfig(
        generation_export=GenerationExportConfig(
            protocol="http",
            endpoint="<CLOUD_ENDPOINT>/api/v1/generations:export",
            auth=AuthConfig(
                mode="basic",
                tenant_id="<INSTANCE_ID>",
                basic_password="<API_KEY>",
            ),
        ),
    )
)
```

Replace _CLOUD_ENDPOINT_, _INSTANCE_ID_, and _API_KEY_ with the values from your stack.

## Verify data

Run your instrumented agent and open **Conversations** in the Sigil plugin. Your first generation should appear within a few seconds.

## Next steps

- [Configure SDK options](../../configure/sdk/)
- [Set up online evaluation](../../guides/evaluation/)
